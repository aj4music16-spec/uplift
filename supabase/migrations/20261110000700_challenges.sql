-- Challenge lifecycle: drafts, publishing a versioned rules snapshot, joining,
-- rule-change proposals, admins, participants, cancelation, finalization,
-- rematches and (demo-only) reward previews.

create or replace function public.get_challenge(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
begin
  if not app.can_view_challenge(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  perform app.sync_status(p_challenge_id);
  return app.challenge_detail_json(p_challenge_id, v_uid);
end
$$;

-- ---------------------------------------------------------------------------
-- Drafts
-- ---------------------------------------------------------------------------

-- Creates or updates a draft. Only structural validation here so a draft can
-- be saved between wizard steps; the complete rules are validated on publish.
create or replace function public.save_draft(p_draft jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_id uuid := nullif(p_draft ->> 'id', '')::uuid;
  v_circle uuid := nullif(p_draft ->> 'circle_id', '')::uuid;
  v_name text := btrim(coalesce(p_draft ->> 'name', ''));
  v_description text := btrim(coalesce(p_draft ->> 'description', ''));
  v_habit text := p_draft ->> 'habit_type';
  v_unit text := btrim(coalesce(p_draft ->> 'metric_unit', ''));
  v_tz text := p_draft ->> 'timezone';
  v_target numeric := (p_draft ->> 'target')::numeric;
  v_comparator text := p_draft ->> 'comparator';
  v_required integer := (p_draft ->> 'required_days')::integer;
  v_verification text := p_draft ->> 'verification';
  v_start date := (p_draft ->> 'start_date')::date;
  v_end date := (p_draft ->> 'end_date')::date;
  v_step integer := least(5, greatest(1, coalesce((p_draft ->> 'draft_step')::integer, 1)));
  c public.challenges%rowtype;
  v_version uuid;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'VALIDATION' using detail = 'Give it a name between 2 and 60 characters.';
  end if;
  if char_length(v_description) > 280 then
    raise exception 'VALIDATION' using detail = 'Keep the description under 280 characters.';
  end if;
  if not exists (select 1 from app.habits h where h.habit_type = v_habit) then
    raise exception 'VALIDATION' using detail = 'Choose a habit.';
  end if;
  if char_length(v_unit) < 1 or char_length(v_unit) > 20 then
    raise exception 'VALIDATION' using detail = 'Name the unit in 20 characters or fewer.';
  end if;
  if not app.is_valid_timezone(v_tz) then
    raise exception 'VALIDATION' using detail = 'Choose a valid time zone.';
  end if;
  if v_target is null or v_target <= 0 or v_target > 1000000 then
    raise exception 'VALIDATION' using detail = 'Set a daily target above zero.';
  end if;
  if v_comparator is null or v_comparator not in ('lte', 'gte', 'bool') then
    raise exception 'VALIDATION' using detail = 'Choose a goal type.';
  end if;
  if v_comparator = 'bool' and v_target <> 1 then
    raise exception 'VALIDATION' using detail = 'A yes/no goal is one check-in a day.';
  end if;
  if v_verification is null or v_verification not in ('evidence', 'self_report') then
    raise exception 'VALIDATION' using detail = 'Choose how check-ins are verified.';
  end if;
  if v_start is null or v_end is null or v_end < v_start or v_end - v_start >= 30 then
    raise exception 'VALIDATION' using detail = 'Choose dates between 1 and 30 days apart.';
  end if;
  if v_required is null or v_required < 1 or v_required > v_end - v_start + 1 then
    raise exception 'VALIDATION' using detail = 'Required days must be between 1 and the number of scheduled days.';
  end if;

  if v_id is null then
    if v_circle is null or not app.is_circle_member(v_circle, v_uid) then
      raise exception 'FORBIDDEN';
    end if;
    if (
      select count(*) from public.challenges d
      join public.challenge_admins a on a.challenge_id = d.id and a.user_id = v_uid and a.revoked_at is null
      where d.circle_id = v_circle and d.status = 'draft'
    ) >= 10 then
      raise exception 'LIMIT_REACHED' using detail = 'Publish or delete a draft before starting another.';
    end if;

    insert into public.challenges (circle_id, creator_id, name, description, habit_type, metric_unit, timezone, start_date, end_date, status, draft_step)
    values (v_circle, v_uid, v_name, v_description, v_habit, v_unit, v_tz, v_start, v_end, 'draft', v_step)
    returning id into v_id;

    insert into public.rule_versions (challenge_id, version, target, comparator, required_days, verification, start_date, end_date, effective_date, status)
    values (v_id, 1, v_target, v_comparator, v_required, v_verification, v_start, v_end, v_start, 'draft')
    returning id into v_version;

    update public.challenges set current_rule_version_id = v_version where id = v_id;
    -- The creator is the first challenge admin.
    insert into public.challenge_admins (challenge_id, user_id, assigned_by) values (v_id, v_uid, v_uid);
  else
    select * into c from public.challenges where id = v_id for update;
    if not found or not app.is_challenge_admin(v_id, v_uid) then
      raise exception 'NOT_FOUND';
    end if;
    if c.status <> 'draft' then
      raise exception 'CHALLENGE_CLOSED' using detail = 'Published challenges change through a rule-change proposal.';
    end if;
    if c.revision is distinct from (p_draft ->> 'expected_revision')::integer then
      raise exception 'REVISION_CONFLICT';
    end if;
    if v_circle is not null and v_circle <> c.circle_id and not app.is_circle_member(v_circle, v_uid) then
      raise exception 'FORBIDDEN';
    end if;

    update public.challenges
    set circle_id = coalesce(v_circle, circle_id),
        name = v_name,
        description = v_description,
        habit_type = v_habit,
        metric_unit = v_unit,
        timezone = v_tz,
        start_date = v_start,
        end_date = v_end,
        draft_step = v_step,
        revision = revision + 1,
        updated_at = app.now()
    where id = v_id;

    update public.rule_versions
    set target = v_target, comparator = v_comparator, required_days = v_required, verification = v_verification,
        start_date = v_start, end_date = v_end, effective_date = v_start
    where id = c.current_rule_version_id;
  end if;

  return app.challenge_detail_json(v_id, v_uid);
end
$$;

create or replace function public.delete_draft(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  c public.challenges%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or not app.is_challenge_admin(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if c.status <> 'draft' then
    raise exception 'CHALLENGE_CLOSED' using detail = 'Only drafts can be deleted. Cancel a published challenge instead.';
  end if;
  delete from public.challenges where id = p_challenge_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Publish and join
-- ---------------------------------------------------------------------------

-- Publishing validates the complete rules and freezes them as version 1.
-- Circle members are invited; nobody is enrolled automatically (the creator
-- opts in explicitly with p_join_as_participant).
create or replace function public.publish_challenge(p_challenge_id uuid, p_expected_revision integer, p_join_as_participant boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  c public.challenges%rowtype;
  v public.rule_versions%rowtype;
  v_pid uuid;
  v_event uuid;
  r record;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or not app.is_challenge_admin(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if c.status <> 'draft' or c.revision is distinct from p_expected_revision then
    raise exception 'REVISION_CONFLICT';
  end if;
  if not app.is_valid_timezone(c.timezone) then
    raise exception 'VALIDATION' using detail = 'Choose a valid time zone.';
  end if;

  select * into v from public.rule_versions where id = c.current_rule_version_id;
  perform app.validate_terms(
    c.habit_type, c.metric_unit, v.target, v.comparator, v.required_days, v.verification,
    v.start_date, v.end_date, app.local_date(v_now, c.timezone), 'publish', false, null
  );

  update public.rule_versions set status = 'active', effective_date = start_date, activated_at = v_now where id = v.id;
  update public.challenges
  set status = 'scheduled', published_at = v_now, start_date = v.start_date, end_date = v.end_date,
      revision = revision + 1, updated_at = v_now
  where id = c.id;

  if coalesce(p_join_as_participant, false) then
    insert into public.participants (challenge_id, user_id, accepted_version_id)
    values (c.id, v_uid, v.id)
    returning id into v_pid;
    insert into public.rule_acceptances (version_id, participant_id, decision) values (v.id, v_pid, 'accepted');
  end if;

  v_event := app.audit(c.circle_id, c.id, v_uid, null, 'challenge.published', null, null, app.rules_json(v.id), null);
  perform app.system_message(
    c.circle_id,
    app.display_name(v_uid) || ' published ' || c.name || '. Review the rules to join.',
    app.challenge_payload(c.id) || jsonb_build_object('type', 'challenge_published', 'actor_name', app.display_name(v_uid)),
    v_event
  );
  for r in
    select m.user_id from public.circle_members m
    where m.circle_id = c.circle_id and m.removed_at is null and m.user_id <> v_uid
  loop
    perform app.notify(
      r.user_id, 'challenge_invite', c.id,
      app.challenge_payload(c.id) || jsonb_build_object('actor_name', app.display_name(v_uid)),
      'challenge_invite:' || c.id
    );
  end loop;

  return app.challenge_detail_json(c.id, v_uid);
end
$$;

-- Joining needs explicit acceptance of the current rule version, before the start.
create or replace function public.join_challenge(p_challenge_id uuid, p_accepted_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  c public.challenges%rowtype;
  p public.participants%rowtype;
  v_status text;
  v_pid uuid;
  v_name text;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or c.status = 'draft' or not app.is_circle_member(c.circle_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  v_status := app.sync_status(c.id);
  if v_status in ('completed', 'canceled') then
    raise exception 'CHALLENGE_CLOSED';
  end if;

  select * into p from public.participants where challenge_id = c.id and user_id = v_uid;
  if found then
    if p.removed_at is not null then
      raise exception 'FORBIDDEN' using detail = 'You were removed from this challenge.';
    end if;
    -- Already in: a retried join is a no-op.
    return app.challenge_detail_json(c.id, v_uid);
  end if;

  -- No late joins after the start.
  if v_status <> 'scheduled' then
    raise exception 'CHALLENGE_STARTED';
  end if;
  -- Stale terms can never enroll anyone.
  if p_accepted_version_id is distinct from c.current_rule_version_id then
    raise exception 'RULES_CHANGED';
  end if;
  if (select count(*) from public.participants x where x.challenge_id = c.id and x.removed_at is null) >= 50 then
    raise exception 'LIMIT_REACHED' using detail = 'This challenge is full (50 players).';
  end if;

  insert into public.participants (challenge_id, user_id, accepted_version_id)
  values (c.id, v_uid, c.current_rule_version_id)
  returning id into v_pid;
  insert into public.rule_acceptances (version_id, participant_id, decision) values (c.current_rule_version_id, v_pid, 'accepted');

  v_name := app.display_name(v_uid);
  perform app.audit(c.circle_id, c.id, v_uid, v_uid, 'participant.joined', null, null, jsonb_build_object('accepted_version', (select version from public.rule_versions where id = c.current_rule_version_id)), null);
  perform app.system_message(
    c.circle_id,
    v_name || ' is in for ' || c.name || '.',
    app.challenge_payload(c.id) || jsonb_build_object('type', 'participant_joined', 'user_id', v_uid, 'name', v_name)
  );
  return app.challenge_detail_json(c.id, v_uid);
end
$$;

-- Cosmetic edits take effect immediately and never need a vote.
create or replace function public.update_challenge_details(p_challenge_id uuid, p_name text, p_description text, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  c public.challenges%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := btrim(coalesce(p_description, ''));
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or not app.can_view_challenge(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if not app.is_challenge_admin(p_challenge_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if c.status in ('completed', 'canceled') then
    raise exception 'CHALLENGE_CLOSED';
  end if;
  if c.revision is distinct from p_expected_revision then
    raise exception 'REVISION_CONFLICT';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'VALIDATION' using detail = 'Give it a name between 2 and 60 characters.';
  end if;
  if char_length(v_description) > 280 then
    raise exception 'VALIDATION' using detail = 'Keep the description under 280 characters.';
  end if;

  if v_name is distinct from c.name or v_description is distinct from c.description then
    update public.challenges set name = v_name, description = v_description, revision = revision + 1, updated_at = app.now() where id = c.id;
    perform app.audit(
      c.circle_id, c.id, v_uid, null, 'challenge.details_updated', null,
      jsonb_build_object('name', c.name, 'description', c.description),
      jsonb_build_object('name', v_name, 'description', v_description),
      null
    );
  end if;
  return app.challenge_detail_json(c.id, v_uid);
end
$$;

-- ---------------------------------------------------------------------------
-- Rule changes
-- ---------------------------------------------------------------------------

-- Makes an accepted proposal the current rules. New rules apply from the first
-- day (if not started) or the next challenge day. Earlier days keep the
-- version they ran under: their records are never touched.
create or replace function app.activate_rule_version(p_version uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.rule_versions%rowtype;
  c public.challenges%rowtype;
  v_now timestamptz := app.now();
  v_status text;
  v_effective date;
  v_event uuid;
  r record;
begin
  select * into v from public.rule_versions where id = p_version for update;
  select * into c from public.challenges where id = v.challenge_id for update;
  v_status := app.effective_status(c.status, c.start_date, c.end_date, c.timezone, v_now);
  v_effective := case when v_status = 'scheduled' then v.start_date else app.local_date(v_now, c.timezone) + 1 end;

  -- A change that can no longer take effect is withdrawn, not applied retroactively.
  if v_status not in ('scheduled', 'active') or (v_status = 'active' and v_effective > v.end_date) then
    update public.rule_versions set status = 'withdrawn', decided_at = v_now where id = v.id;
    return;
  end if;

  update public.rule_versions set status = 'superseded' where challenge_id = c.id and status = 'active';
  update public.rule_versions
  set status = 'active', effective_date = v_effective, activated_at = v_now, decided_at = v_now
  where id = v.id;
  update public.challenges
  set current_rule_version_id = v.id, start_date = v.start_date, end_date = v.end_date,
      revision = revision + 1, updated_at = v_now
  where id = c.id;
  update public.participants set accepted_version_id = v.id where challenge_id = c.id and removed_at is null;

  v_event := app.audit(c.circle_id, c.id, v.proposed_by, null, 'rules.activated', v_effective, app.rules_json(c.current_rule_version_id), app.rules_json(v.id), v.reason);
  perform app.system_message(
    c.circle_id,
    'New rules for ' || c.name || ' are in effect.',
    app.challenge_payload(c.id) || jsonb_build_object('type', 'rule_change_activated', 'effective_date', v_effective),
    v_event
  );
  for r in select p.user_id from public.participants p where p.challenge_id = c.id and p.removed_at is null loop
    perform app.notify(
      r.user_id, 'rule_change_activated', c.id,
      app.challenge_payload(c.id) || jsonb_build_object('effective_date', v_effective),
      'rule_change_activated:' || v.id
    );
  end loop;
end
$$;

-- Activates a proposal once every current participant has accepted it.
create or replace function app.maybe_activate_proposal(p_version uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.rule_versions%rowtype;
begin
  select * into v from public.rule_versions where id = p_version and status = 'proposed' for update;
  if not found then
    return false;
  end if;
  if exists (
    select 1
    from public.participants p
    where p.challenge_id = v.challenge_id
      and p.removed_at is null
      and not exists (
        select 1 from public.rule_acceptances ra
        where ra.version_id = v.id and ra.participant_id = p.id and ra.decision = 'accepted'
      )
  ) then
    return false;
  end if;
  perform app.activate_rule_version(v.id);
  return true;
end
$$;

-- Substantive changes (target, required days, dates, verification) after
-- publishing are proposals with a before/after preview. They need every
-- current participant's acceptance; if anyone declines the original rules stay.
create or replace function public.propose_rule_change(p_challenge_id uuid, p_rules jsonb, p_reason text, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  c public.challenges%rowtype;
  cur public.rule_versions%rowtype;
  v_status text;
  v_reason text;
  v_today date;
  n_target numeric := (p_rules ->> 'target')::numeric;
  n_comparator text := p_rules ->> 'comparator';
  n_required integer := (p_rules ->> 'required_days')::integer;
  n_verification text := p_rules ->> 'verification';
  n_start date := (p_rules ->> 'start_date')::date;
  n_end date := (p_rules ->> 'end_date')::date;
  v_new uuid;
  v_event uuid;
  r record;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or not app.can_view_challenge(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if not app.is_challenge_admin(p_challenge_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  v_status := app.sync_status(c.id);
  if v_status not in ('scheduled', 'active') then
    raise exception 'CHALLENGE_CLOSED';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if c.revision is distinct from p_expected_revision then
    raise exception 'REVISION_CONFLICT';
  end if;
  if exists (select 1 from public.rule_versions pv where pv.challenge_id = c.id and pv.status = 'proposed') then
    raise exception 'PROPOSAL_PENDING';
  end if;
  v_reason := app.require_reason(p_reason);

  select * into cur from public.rule_versions where id = c.current_rule_version_id;
  v_today := app.local_date(v_now, c.timezone);
  if n_comparator is distinct from cur.comparator then
    raise exception 'VALIDATION' using detail = 'The goal type can’t change after publishing.';
  end if;
  perform app.validate_terms(
    c.habit_type, c.metric_unit, n_target, n_comparator, n_required, n_verification,
    n_start, n_end, v_today, 'change', v_status = 'active', cur.start_date
  );
  if n_target = cur.target and n_required = cur.required_days and n_verification = cur.verification
     and n_start = cur.start_date and n_end = cur.end_date then
    raise exception 'VALIDATION' using detail = 'Change at least one rule.';
  end if;

  insert into public.rule_versions
    (challenge_id, version, target, comparator, required_days, verification, start_date, end_date, effective_date, status, reason, proposed_by)
  values (
    c.id,
    (select max(x.version) + 1 from public.rule_versions x where x.challenge_id = c.id),
    n_target, n_comparator, n_required, n_verification, n_start, n_end,
    case when v_status = 'scheduled' then n_start else v_today + 1 end,
    'proposed', v_reason, v_uid
  )
  returning id into v_new;
  update public.challenges set revision = revision + 1, updated_at = v_now where id = c.id;

  -- Proposing is accepting, if the proposer is also playing.
  insert into public.rule_acceptances (version_id, participant_id, decision)
  select v_new, p.id, 'accepted'
  from public.participants p
  where p.challenge_id = c.id and p.user_id = v_uid and p.removed_at is null;

  v_event := app.audit(c.circle_id, c.id, v_uid, null, 'rules.proposed', null, app.rules_json(cur.id), app.rules_json(v_new), v_reason);

  if not app.maybe_activate_proposal(v_new) then
    perform app.system_message(
      c.circle_id,
      app.display_name(v_uid) || ' proposed a rule change for ' || c.name || '. It needs everyone’s OK.',
      app.challenge_payload(c.id) || jsonb_build_object('type', 'rule_change_proposed', 'actor_name', app.display_name(v_uid)),
      v_event
    );
    for r in
      select p.user_id from public.participants p
      where p.challenge_id = c.id and p.removed_at is null and p.user_id <> v_uid
    loop
      perform app.notify(
        r.user_id, 'rule_change_proposed', c.id,
        app.challenge_payload(c.id) || jsonb_build_object('actor_name', app.display_name(v_uid), 'reason', v_reason),
        'rule_change_proposed:' || v_new
      );
    end loop;
  end if;

  return app.challenge_detail_json(c.id, v_uid);
end
$$;

create or replace function public.respond_to_rule_change(p_version_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  v public.rule_versions%rowtype;
  c public.challenges%rowtype;
  v_pid uuid;
  v_event uuid;
  r record;
begin
  select * into v from public.rule_versions where id = p_version_id for update;
  if not found or not app.can_view_challenge(v.challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  select * into c from public.challenges where id = v.challenge_id for update;
  select p.id into v_pid from public.participants p
  where p.challenge_id = v.challenge_id and p.user_id = v_uid and p.removed_at is null;
  if v_pid is null then
    raise exception 'FORBIDDEN' using detail = 'Only current players respond to rule changes.';
  end if;
  perform app.sync_status(c.id);
  select * into v from public.rule_versions where id = p_version_id;
  if v.status <> 'proposed' then
    raise exception 'ALREADY_DECIDED';
  end if;

  insert into public.rule_acceptances (version_id, participant_id, decision)
  values (v.id, v_pid, case when p_accept then 'accepted' else 'declined' end)
  on conflict (version_id, participant_id) do update set decision = excluded.decision, decided_at = v_now;

  if p_accept then
    perform app.maybe_activate_proposal(v.id);
  else
    update public.rule_versions set status = 'declined', decided_at = v_now where id = v.id;
    update public.challenges set revision = revision + 1, updated_at = v_now where id = c.id;
    v_event := app.audit(c.circle_id, c.id, v_uid, null, 'rules.declined', null, null, app.rules_json(v.id), null);
    perform app.system_message(
      c.circle_id,
      'The proposed rule change for ' || c.name || ' was declined. The original rules stay.',
      app.challenge_payload(c.id) || jsonb_build_object('type', 'rule_change_declined'),
      v_event
    );
    for r in
      select a.user_id from public.challenge_admins a where a.challenge_id = c.id and a.revoked_at is null
      union
      select p.user_id from public.participants p where p.challenge_id = c.id and p.removed_at is null
    loop
      if r.user_id <> v_uid then
        perform app.notify(r.user_id, 'rule_change_declined', c.id, app.challenge_payload(c.id), 'rule_change_declined:' || v.id);
      end if;
    end loop;
  end if;

  return app.challenge_detail_json(c.id, v_uid);
end
$$;

create or replace function public.withdraw_rule_change(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v public.rule_versions%rowtype;
  c public.challenges%rowtype;
begin
  select * into v from public.rule_versions where id = p_version_id for update;
  if not found or not app.can_view_challenge(v.challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if not app.is_challenge_admin(v.challenge_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if v.status <> 'proposed' then
    raise exception 'ALREADY_DECIDED';
  end if;
  select * into c from public.challenges where id = v.challenge_id for update;
  update public.rule_versions set status = 'withdrawn', decided_at = app.now() where id = v.id;
  update public.challenges set revision = revision + 1, updated_at = app.now() where id = c.id;
  perform app.audit(c.circle_id, c.id, v_uid, null, 'rules.withdrawn', null, null, app.rules_json(v.id), null);
  return app.challenge_detail_json(c.id, v_uid);
end
$$;

-- ---------------------------------------------------------------------------
-- Cancel, admins, participants
-- ---------------------------------------------------------------------------

-- Terminal. History is preserved and the reason is shown.
create or replace function public.cancel_challenge(p_challenge_id uuid, p_reason text, p_expected_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  c public.challenges%rowtype;
  v_reason text;
  v_event uuid;
  r record;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or not app.can_view_challenge(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if not app.is_challenge_admin(p_challenge_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if c.status = 'draft' then
    raise exception 'VALIDATION' using detail = 'Delete the draft instead.';
  end if;
  if c.status in ('completed', 'canceled') then
    raise exception 'CHALLENGE_CLOSED';
  end if;
  if c.revision is distinct from p_expected_revision then
    raise exception 'REVISION_CONFLICT';
  end if;
  v_reason := app.require_reason(p_reason);

  update public.rule_versions set status = 'withdrawn', decided_at = v_now where challenge_id = c.id and status = 'proposed';
  update public.challenges
  set status = 'canceled', canceled_at = v_now, canceled_by = v_uid, canceled_reason = v_reason,
      revision = revision + 1, updated_at = v_now
  where id = c.id;

  v_event := app.audit(c.circle_id, c.id, v_uid, null, 'challenge.canceled', null, jsonb_build_object('status', c.status), jsonb_build_object('status', 'canceled'), v_reason);
  perform app.system_message(
    c.circle_id,
    c.name || ' was canceled.',
    app.challenge_payload(c.id) || jsonb_build_object('type', 'challenge_canceled', 'reason', v_reason),
    v_event
  );
  for r in
    select a.user_id from public.challenge_admins a where a.challenge_id = c.id and a.revoked_at is null
    union
    select p.user_id from public.participants p where p.challenge_id = c.id and p.removed_at is null
  loop
    if r.user_id <> v_uid then
      perform app.notify(r.user_id, 'challenge_canceled', c.id, app.challenge_payload(c.id) || jsonb_build_object('reason', v_reason), 'challenge_canceled:' || c.id);
    end if;
  end loop;
  return app.challenge_detail_json(c.id, v_uid);
end
$$;

-- Appointing an admin is explicit and logged. Existing challenge admins and
-- Circle admins may do it; Circle ownership alone never grants evidence access.
create or replace function public.assign_challenge_admin(p_challenge_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  c public.challenges%rowtype;
  v_changed boolean := false;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or not app.can_view_challenge(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if not (app.is_challenge_admin(c.id, v_uid) or app.is_circle_admin(c.circle_id, v_uid)) then
    raise exception 'FORBIDDEN';
  end if;
  if c.status in ('completed', 'canceled') then
    raise exception 'CHALLENGE_CLOSED';
  end if;
  if not app.is_circle_member(c.circle_id, p_user_id) then
    raise exception 'VALIDATION' using detail = 'Only current Circle members can be challenge admins.';
  end if;

  if exists (select 1 from public.challenge_admins a where a.challenge_id = c.id and a.user_id = p_user_id) then
    update public.challenge_admins
    set revoked_at = null, revoked_by = null, assigned_by = v_uid, assigned_at = app.now()
    where challenge_id = c.id and user_id = p_user_id and revoked_at is not null;
    v_changed := found;
  else
    insert into public.challenge_admins (challenge_id, user_id, assigned_by) values (c.id, p_user_id, v_uid);
    v_changed := true;
  end if;

  if v_changed then
    perform app.audit(c.circle_id, c.id, v_uid, p_user_id, 'admin.assigned', null, null, null, null);
    if p_user_id <> v_uid then
      perform app.notify(
        p_user_id, 'admin_assigned', c.id,
        app.challenge_payload(c.id) || jsonb_build_object('actor_name', app.display_name(v_uid)),
        'admin_assigned:' || c.id || ':' || extract(epoch from app.now())::bigint
      );
    end if;
  end if;
  return app.challenge_detail_json(c.id, v_uid);
end
$$;

create or replace function public.revoke_challenge_admin(p_challenge_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  c public.challenges%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or not app.can_view_challenge(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if not (app.is_challenge_admin(c.id, v_uid) or app.is_circle_admin(c.circle_id, v_uid)) then
    raise exception 'FORBIDDEN';
  end if;
  if c.status in ('completed', 'canceled') then
    raise exception 'CHALLENGE_CLOSED';
  end if;
  if not exists (
    select 1 from public.challenge_admins a where a.challenge_id = c.id and a.user_id = p_user_id and a.revoked_at is null
  ) then
    return app.challenge_detail_json(c.id, v_uid);
  end if;
  -- At least one active challenge admin must remain.
  if not exists (
    select 1 from public.challenge_admins o
    where o.challenge_id = c.id and o.user_id <> p_user_id and o.revoked_at is null
      and app.is_circle_member(c.circle_id, o.user_id)
  ) then
    raise exception 'LAST_ADMIN';
  end if;

  update public.challenge_admins set revoked_at = app.now(), revoked_by = v_uid
  where challenge_id = c.id and user_id = p_user_id and revoked_at is null;
  perform app.audit(c.circle_id, c.id, v_uid, p_user_id, 'admin.revoked', null, null, null, null);
  return app.challenge_detail_json(c.id, v_uid);
end
$$;

-- Removed participants lose future access; their records and audit history stay.
create or replace function public.remove_participant(p_participant_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  p public.participants%rowtype;
  c public.challenges%rowtype;
  v_reason text;
  r record;
begin
  select * into p from public.participants where id = p_participant_id for update;
  if not found or not app.can_view_challenge(p.challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if not app.is_challenge_admin(p.challenge_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  select * into c from public.challenges where id = p.challenge_id for update;
  if c.status in ('completed', 'canceled') then
    raise exception 'CHALLENGE_CLOSED';
  end if;
  if p.removed_at is not null then
    return app.challenge_detail_json(c.id, v_uid);
  end if;
  v_reason := app.require_reason(p_reason);

  update public.participants set removed_at = app.now(), removed_by = v_uid, removed_reason = v_reason where id = p.id;
  perform app.audit(c.circle_id, c.id, v_uid, p.user_id, 'participant.removed', null, null, null, v_reason);
  perform app.notify(
    p.user_id, 'removed_from_challenge', c.id,
    app.challenge_payload(c.id) || jsonb_build_object('reason', v_reason),
    'removed_from_challenge:' || p.id
  );
  for r in select v.id from public.rule_versions v where v.challenge_id = c.id and v.status = 'proposed' loop
    perform app.maybe_activate_proposal(r.id);
  end loop;
  return app.challenge_detail_json(c.id, v_uid);
end
$$;

-- ---------------------------------------------------------------------------
-- Finalization and rematch
-- ---------------------------------------------------------------------------

-- Server-owned and idempotent. Any member may ask; it only succeeds once the
-- last deadline has passed, nothing is pending, no dispute is open and every
-- dispute window has expired or been waived. Pending is never auto-resolved.
create or replace function public.finalize_challenge(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  c public.challenges%rowtype;
  v_blockers jsonb;
  v_code text;
  v_event uuid;
  r record;
begin
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or not app.can_view_challenge(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if c.status = 'completed' then
    return app.challenge_detail_json(c.id, v_uid);
  end if;
  if c.status in ('canceled', 'draft') then
    raise exception 'CHALLENGE_CLOSED';
  end if;

  perform app.sync_status(c.id);
  v_blockers := app.finalization_blockers(c.id);
  if jsonb_array_length(v_blockers) > 0 then
    v_code := v_blockers -> 0 ->> 'code';
    if v_code = 'NOT_IN_REVIEW' then
      raise exception 'NOT_STARTED' using detail = 'This challenge hasn’t ended yet.';
    end if;
    raise exception '%', v_code;
  end if;

  update public.challenges
  set status = 'completed', completed_at = v_now, revision = revision + 1, updated_at = v_now
  where id = c.id;

  v_event := app.audit(
    c.circle_id, c.id, v_uid, null, 'challenge.completed', c.end_date, null,
    jsonb_build_object('standings', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', s -> 'person' ->> 'user_id',
        'successful_days', s -> 'successful_days',
        'rank', s -> 'rank',
        'qualified', s -> 'qualified',
        'removed', s -> 'removed'
      )), '[]'::jsonb)
      from jsonb_array_elements(app.standings_json(c.id, v_uid)) s
    )),
    null
  );
  perform app.system_message(
    c.circle_id,
    c.name || ' is complete. The results are in.',
    app.challenge_payload(c.id) || jsonb_build_object('type', 'challenge_finished'),
    v_event
  );
  for r in
    select a.user_id from public.challenge_admins a where a.challenge_id = c.id and a.revoked_at is null
    union
    select p.user_id from public.participants p where p.challenge_id = c.id and p.removed_at is null
  loop
    perform app.notify(r.user_id, 'challenge_completed', c.id, app.challenge_payload(c.id), 'challenge_completed:' || c.id);
  end loop;

  return app.challenge_detail_json(c.id, v_uid);
end
$$;

-- Copies settings into a fresh draft: no progress, no reward, new dates.
-- Publishing it invites members anew and needs fresh acceptance from everyone.
create or replace function public.create_rematch(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  c public.challenges%rowtype;
  cur public.rule_versions%rowtype;
  v_today date;
  v_span integer;
  v_new uuid;
  v_version uuid;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or not app.can_view_challenge(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if c.status not in ('completed', 'canceled') then
    raise exception 'VALIDATION' using detail = 'A rematch is available once the challenge is finished.';
  end if;
  if not (
    app.is_challenge_admin(c.id, v_uid)
    or exists (select 1 from public.participants p where p.challenge_id = c.id and p.user_id = v_uid)
  ) then
    raise exception 'FORBIDDEN';
  end if;

  select * into cur from public.rule_versions where id = c.current_rule_version_id;
  v_today := app.local_date(app.now(), c.timezone);
  v_span := cur.end_date - cur.start_date;

  insert into public.challenges
    (circle_id, creator_id, name, description, habit_type, metric_unit, timezone, start_date, end_date, status, reward_mode, rematch_of_id, draft_step)
  values
    (c.circle_id, v_uid, c.name, c.description, c.habit_type, c.metric_unit, c.timezone, v_today + 1, v_today + 1 + v_span, 'draft', 'none', c.id, 5)
  returning id into v_new;

  insert into public.rule_versions (challenge_id, version, target, comparator, required_days, verification, start_date, end_date, effective_date, status)
  values (v_new, 1, cur.target, cur.comparator, cur.required_days, cur.verification, v_today + 1, v_today + 1 + v_span, v_today + 1, 'draft')
  returning id into v_version;
  update public.challenges set current_rule_version_id = v_version where id = v_new;
  insert into public.challenge_admins (challenge_id, user_id, assigned_by) values (v_new, v_uid, v_uid);

  perform app.audit(c.circle_id, v_new, v_uid, null, 'challenge.rematch_created', null, null, jsonb_build_object('rematch_of', c.id), null);
  return app.challenge_detail_json(v_new, v_uid);
end
$$;

-- ---------------------------------------------------------------------------
-- Reward previews (DEMO ONLY)
-- ---------------------------------------------------------------------------

-- There is no live reward mode anywhere in the schema, and even the demo
-- preview is refused unless a database administrator has turned on the
-- server-side flag. Nothing a client sends can enable payments.
create or replace function public.set_reward_preview(p_challenge_id uuid, p_mode text, p_gross_cents integer, p_fee_bps integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  c public.challenges%rowtype;
begin
  if not exists (select 1 from app.config where key = 'demo_rewards_enabled' and value = 'true') then
    raise exception 'LIVE_PAYMENTS_DISABLED';
  end if;
  if p_mode is null or p_mode not in ('none', 'demo_sponsor', 'demo_pot') then
    raise exception 'LIVE_PAYMENTS_DISABLED';
  end if;

  select * into c from public.challenges where id = p_challenge_id for update;
  if not found or not app.can_view_challenge(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if not app.is_challenge_admin(p_challenge_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if app.sync_status(c.id) not in ('draft', 'scheduled') then
    raise exception 'CHALLENGE_STARTED' using detail = 'A reward preview can only change before the challenge starts.';
  end if;

  if p_mode = 'none' then
    delete from public.reward_previews where challenge_id = c.id;
  else
    if p_gross_cents is null or p_gross_cents < 1 or p_gross_cents > 100000000 then
      raise exception 'VALIDATION' using detail = 'Enter a preview amount between $0.01 and $1,000,000.';
    end if;
    if p_fee_bps is null or p_fee_bps < 0 or p_fee_bps > 2000 then
      raise exception 'VALIDATION' using detail = 'The illustrative fee must be between 0% and 20%.';
    end if;
    insert into public.reward_previews (challenge_id, mode, gross_cents, fee_bps, sponsor_id, created_by)
    values (c.id, p_mode, p_gross_cents, p_fee_bps, case when p_mode = 'demo_sponsor' then v_uid else null end, v_uid)
    on conflict (challenge_id) do update
      set mode = excluded.mode, gross_cents = excluded.gross_cents, fee_bps = excluded.fee_bps,
          sponsor_id = excluded.sponsor_id, created_by = excluded.created_by;
  end if;
  update public.challenges set reward_mode = p_mode, revision = revision + 1, updated_at = app.now() where id = c.id;
  perform app.audit(
    c.circle_id, c.id, v_uid, null, 'reward_preview.set', null,
    jsonb_build_object('mode', c.reward_mode),
    jsonb_build_object('mode', p_mode, 'gross_cents', p_gross_cents, 'fee_bps', p_fee_bps, 'demo_only', true),
    null
  );
  return app.challenge_detail_json(c.id, v_uid);
end
$$;

-- ---------------------------------------------------------------------------
-- Home and history
-- ---------------------------------------------------------------------------

create or replace function public.get_home()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  r record;
begin
  for r in
    select c.id from public.challenges c
    where c.status in ('scheduled', 'active', 'review') and app.is_circle_member(c.circle_id, v_uid)
  loop
    perform app.sync_status(r.id);
  end loop;

  return jsonb_build_object(
    'circles', coalesce((
      select jsonb_agg(app.circle_summary_json(m.circle_id, v_uid) order by m.joined_at, m.id)
      from public.circle_members m
      join public.circles ci on ci.id = m.circle_id
      where m.user_id = v_uid and m.removed_at is null and ci.archived_at is null
    ), '[]'::jsonb),
    'challenges', coalesce((
      select jsonb_agg(app.challenge_card_json(c.id, v_uid) order by c.start_date, c.id)
      from public.challenges c
      where app.can_view_challenge(c.id, v_uid)
        and (
          c.status in ('draft', 'scheduled', 'active', 'review')
          or (
            coalesce(c.completed_at, c.canceled_at) > v_now - interval '14 days'
            and (
              app.is_challenge_admin(c.id, v_uid)
              or exists (select 1 from public.participants p where p.challenge_id = c.id and p.user_id = v_uid)
            )
          )
        )
    ), '[]'::jsonb),
    'unread_notifications', (select count(*) from public.notifications n where n.recipient_id = v_uid and n.read_at is null),
    'server_now', v_now
  );
end
$$;

create or replace function public.get_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
begin
  return coalesce((
    select jsonb_agg(app.challenge_card_json(x.id, v_uid) order by x.closed_at desc, x.id)
    from (
      select c.id, coalesce(c.completed_at, c.canceled_at) as closed_at
      from public.challenges c
      where c.status in ('completed', 'canceled')
        and app.can_view_challenge(c.id, v_uid)
        and (
          app.is_challenge_admin(c.id, v_uid)
          or exists (select 1 from public.participants p where p.challenge_id = c.id and p.user_id = v_uid)
        )
      order by closed_at desc
      limit 50
    ) x
  ), '[]'::jsonb);
end
$$;

grant execute on function
  public.get_challenge(uuid),
  public.save_draft(jsonb),
  public.delete_draft(uuid),
  public.publish_challenge(uuid, integer, boolean),
  public.join_challenge(uuid, uuid),
  public.update_challenge_details(uuid, text, text, integer),
  public.propose_rule_change(uuid, jsonb, text, integer),
  public.respond_to_rule_change(uuid, boolean),
  public.withdraw_rule_change(uuid),
  public.cancel_challenge(uuid, text, integer),
  public.assign_challenge_admin(uuid, uuid),
  public.revoke_challenge_admin(uuid, uuid),
  public.remove_participant(uuid, text),
  public.finalize_challenge(uuid),
  public.create_rematch(uuid),
  public.set_reward_preview(uuid, text, integer, integer),
  public.get_home(),
  public.get_history()
to authenticated;
