-- Private helpers in schema `app`.
--
-- Everything here is SECURITY DEFINER with an empty search_path and fully
-- qualified names. Read helpers used by RLS policies are granted to API roles;
-- helpers with side effects are not granted to anyone and can only be reached
-- from the server functions that own them.
--
-- The rule helpers (day windows, statuses, targets) are the SQL twin of
-- src/domain. supabase/tests/conformance.test.ts checks them against each other.

-- ---------------------------------------------------------------------------
-- Habit catalog (twin of src/domain/habits.ts)
-- ---------------------------------------------------------------------------

create table app.habits (
  habit_type text primary key,
  default_comparator text not null,
  min_target numeric not null,
  max_target numeric not null,
  max_daily_value numeric not null,
  evidence_mandatory boolean not null,
  uses_increments boolean not null,
  requires_finished_day boolean not null,
  private_detail boolean not null
);
alter table app.habits enable row level security;

insert into app.habits values
  ('screen_time', 'lte', 15, 1440, 1440, true, false, true, false),
  ('reading', 'gte', 1, 600, 1440, false, false, false, false),
  ('prayer', 'bool', 1, 1, 1, false, false, false, true),
  ('pushups', 'gte', 1, 10000, 100000, false, true, false, false),
  ('custom', 'bool', 1, 1000000, 1000000, false, false, false, false);

-- ---------------------------------------------------------------------------
-- Identity and membership
-- ---------------------------------------------------------------------------

-- The acting person: always from the session, never from an argument.
create or replace function app.require_user()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.deleted_at is null) then
    raise exception 'AUTH_REQUIRED';
  end if;
  return v_uid;
end
$$;

create or replace function app.circle_role(p_circle uuid, p_user uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.circle_members m
  join public.circles c on c.id = m.circle_id
  where m.circle_id = p_circle
    and m.user_id = p_user
    and m.removed_at is null
    and c.archived_at is null
$$;

create or replace function app.is_circle_member(p_circle uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.circle_role(p_circle, p_user) is not null
$$;

create or replace function app.is_circle_admin(p_circle uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.circle_role(p_circle, p_user) in ('owner', 'admin'), false)
$$;

-- Challenge admin = an explicit, unrevoked assignment AND still an active
-- Circle member. Circle ownership alone grants nothing here.
create or replace function app.is_challenge_admin(p_challenge uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.challenge_admins a
    join public.challenges c on c.id = a.challenge_id
    where a.challenge_id = p_challenge
      and a.user_id = p_user
      and a.revoked_at is null
      and app.is_circle_member(c.circle_id, p_user)
  )
$$;

-- Drafts are visible to their admins only.
create or replace function app.can_view_challenge(p_challenge uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.challenges c
    where c.id = p_challenge
      and app.is_circle_member(c.circle_id, p_user)
      and (c.status <> 'draft' or app.is_challenge_admin(c.id, p_user))
  )
$$;

create or replace function app.shares_circle(p_other uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_other = p_user or exists (
    select 1
    from public.circle_members mine
    join public.circle_members theirs on theirs.circle_id = mine.circle_id
    join public.circles c on c.id = mine.circle_id
    where mine.user_id = p_user
      and theirs.user_id = p_other
      and mine.removed_at is null
      and theirs.removed_at is null
      and c.archived_at is null
  )
$$;

-- The participant row (and the person behind it) for a daily record.
create or replace function app.record_owner(p_record uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id
  from public.daily_records r
  join public.participants p on p.id = r.participant_id
  where r.id = p_record
$$;

create or replace function app.record_challenge(p_record uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.challenge_id
  from public.daily_records r
  join public.participants p on p.id = r.participant_id
  where r.id = p_record
$$;

-- Owner (while still a Circle member) or an assigned challenge admin.
create or replace function app.can_view_record(p_record uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.daily_records r
    join public.participants p on p.id = r.participant_id
    join public.challenges c on c.id = p.challenge_id
    where r.id = p_record
      and (
        (p.user_id = p_user and app.is_circle_member(c.circle_id, p_user))
        or app.is_challenge_admin(c.id, p_user)
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- Calendar math in the challenge time zone
-- ---------------------------------------------------------------------------

-- First instant of a local date. `timestamp AT TIME ZONE` resolves a skipped
-- midnight to the transition instant and an ambiguous one to standard time,
-- exactly like src/domain/time.ts.
create or replace function app.day_start(p_date date, p_tz text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (p_date::timestamp at time zone p_tz)
$$;

-- Noon on the following local date.
create or replace function app.day_deadline(p_date date, p_tz text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (((p_date + 1)::timestamp + interval '12 hours') at time zone p_tz)
$$;

create or replace function app.local_date(p_ts timestamptz, p_tz text)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_ts at time zone p_tz)::date
$$;

create or replace function app.is_valid_timezone(p_tz text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_tz is not null and exists (select 1 from pg_catalog.pg_timezone_names n where n.name = p_tz)
$$;

-- scheduled -> active -> review follow the clock. Nothing else does.
create or replace function app.effective_status(p_status text, p_start date, p_end date, p_tz text, p_now timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status not in ('scheduled', 'active') then p_status
    when p_now >= app.day_start(p_end + 1, p_tz) then 'review'
    when p_now >= app.day_start(p_start, p_tz) then 'active'
    else 'scheduled'
  end
$$;

-- ---------------------------------------------------------------------------
-- Scoring rules
-- ---------------------------------------------------------------------------

-- lte is inclusive: exactly 120 minutes passes a 120-minute maximum.
create or replace function app.meets_target(p_comparator text, p_target numeric, p_value numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_comparator
    when 'lte' then p_value <= p_target
    when 'gte' then p_value >= p_target
    when 'bool' then p_value >= 1
    else false
  end
$$;

create or replace function app.valid_daily_value(p_habit text, p_comparator text, p_value numeric)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_value is not null and p_value >= 0 and case
    when p_comparator = 'bool' then p_value in (0, 1)
    when p_value > (select h.max_daily_value from app.habits h where h.habit_type = p_habit) then false
    when p_habit = 'custom' then p_value = round(p_value, 2)
    else p_value = trunc(p_value)
  end
$$;

-- What a day looks like right now. A missing day is never "missed" before its
-- deadline, and pending never changes by itself.
create or replace function app.day_status(p_outcome text, p_date date, p_tz text, p_now timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_outcome is not null and p_outcome <> 'open' then p_outcome
    when p_now < app.day_start(p_date, p_tz) then 'upcoming'
    when p_now < app.day_start(p_date + 1, p_tz) then 'open'
    when p_now < app.day_deadline(p_date, p_tz) then 'due'
    else 'missed'
  end
$$;

-- The 24-hour window after a review decision or override.
create or replace function app.window_open(p_decided timestamptz, p_acknowledged timestamptz, p_now timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_decided is not null
    and not (p_acknowledged is not null and p_acknowledged >= p_decided)
    and p_now < p_decided + interval '24 hours'
$$;

create or replace function app.resubmit_until(p_date date, p_tz text, p_decided timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select greatest(app.day_deadline(p_date, p_tz), coalesce(p_decided + interval '24 hours', app.day_deadline(p_date, p_tz)))
$$;

create or replace function app.can_resubmit_on_time(
  p_outcome text, p_date date, p_tz text, p_decided timestamptz, p_acknowledged timestamptz, p_now timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_outcome = 'rejected'
    and not (p_decided is not null and p_acknowledged is not null and p_acknowledged >= p_decided)
    and p_now < app.resubmit_until(p_date, p_tz, p_decided),
    false
  )
$$;

-- Evidence rejections are private: to other players a rejected day looks like
-- one still waiting for a submission, then like a missed one.
create or replace function app.peer_status(p_status text, p_resubmit_open boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status = 'rejected' then case when p_resubmit_open then 'due' else 'missed' end
    when p_status = 'late_pending' then 'pending'
    else p_status
  end
$$;

-- The newest in-force rule version whose effective date is on or before the date.
create or replace function app.rule_for_date(p_challenge uuid, p_date date)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select v.id from public.rule_versions v
      where v.challenge_id = p_challenge and v.status in ('active', 'superseded') and v.effective_date <= p_date
      order by v.version desc limit 1
    ),
    (
      select v.id from public.rule_versions v
      where v.challenge_id = p_challenge and v.status in ('active', 'superseded')
      order by v.version asc limit 1
    )
  )
$$;

-- Complete validation of a challenge's substantive terms (twin of validateTerms).
create or replace function app.validate_terms(
  p_habit text, p_unit text, p_target numeric, p_comparator text, p_required integer, p_verification text,
  p_start date, p_end date, p_today date, p_phase text, p_started boolean, p_current_start date
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  h app.habits%rowtype;
  v_duration integer;
begin
  select * into h from app.habits where habit_type = p_habit;
  if not found then
    raise exception 'VALIDATION' using detail = 'Choose a habit.';
  end if;

  if p_habit = 'custom' then
    if p_comparator is null or p_comparator not in ('bool', 'gte') then
      raise exception 'VALIDATION' using detail = 'That goal type isn’t available for this habit.';
    end if;
  elsif p_comparator is distinct from h.default_comparator then
    raise exception 'VALIDATION' using detail = 'That goal type isn’t available for this habit.';
  end if;

  if p_verification is null or p_verification not in ('evidence', 'self_report') then
    raise exception 'VALIDATION' using detail = 'Choose how check-ins are verified.';
  end if;
  if h.evidence_mandatory and p_verification <> 'evidence' then
    raise exception 'VALIDATION' using detail = 'Screen time always needs a screenshot. It can’t be self-reported.';
  end if;

  if p_comparator = 'bool' then
    if p_target is distinct from 1 then
      raise exception 'VALIDATION' using detail = 'A yes/no goal is one check-in a day.';
    end if;
  else
    if p_target is null or p_target <= 0 then
      raise exception 'VALIDATION' using detail = 'Set a daily target above zero.';
    end if;
    if p_target < h.min_target or p_target > h.max_target then
      raise exception 'VALIDATION' using detail = format('Choose a target between %s and %s %s.', h.min_target, h.max_target, coalesce(p_unit, ''));
    end if;
    if p_habit <> 'custom' and p_target <> trunc(p_target) then
      raise exception 'VALIDATION' using detail = 'Use a whole number.';
    end if;
  end if;
  if char_length(btrim(coalesce(p_unit, ''))) = 0 then
    raise exception 'VALIDATION' using detail = 'Name the unit, like “glasses” or “km”.';
  end if;
  if char_length(btrim(p_unit)) > 20 then
    raise exception 'VALIDATION' using detail = 'Keep the unit under 20 characters.';
  end if;

  if p_start is null then
    raise exception 'VALIDATION' using detail = 'Choose a start date.';
  end if;
  if p_end is null then
    raise exception 'VALIDATION' using detail = 'Choose an end date.';
  end if;
  v_duration := p_end - p_start + 1;
  if v_duration < 1 then
    raise exception 'VALIDATION' using detail = 'The end date can’t be before the start date.';
  end if;
  if v_duration > 30 then
    raise exception 'VALIDATION' using detail = 'Challenges run for up to 30 days.';
  end if;

  if p_phase = 'publish' or not coalesce(p_started, false) then
    -- Starting "today" would mean it already began at local midnight, and
    -- nobody can join a started challenge.
    if p_start <= p_today then
      raise exception 'VALIDATION' using detail = 'Start tomorrow or later so everyone has time to join.';
    end if;
  else
    if p_start is distinct from p_current_start then
      raise exception 'VALIDATION' using detail = 'The start date can’t change once a challenge has started.';
    end if;
    -- New rules apply from the next challenge day, so there has to be one.
    if p_end < p_today + 1 then
      raise exception 'VALIDATION' using detail = 'The new end date must be tomorrow or later.';
    end if;
  end if;

  if p_required is null or p_required < 1 then
    raise exception 'VALIDATION' using detail = 'At least one successful day is required.';
  end if;
  if p_required > v_duration then
    raise exception 'VALIDATION' using detail = format('Required days can’t be more than the %s scheduled days.', v_duration);
  end if;
end
$$;

create or replace function app.require_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'VALIDATION' using detail = 'Add a short reason so everyone understands the change.';
  end if;
  if char_length(btrim(p_reason)) > 500 then
    raise exception 'VALIDATION' using detail = 'Keep the reason under 500 characters.';
  end if;
  return btrim(p_reason);
end
$$;

-- ---------------------------------------------------------------------------
-- JSON builders
-- ---------------------------------------------------------------------------

-- The only shape in which another person's profile leaves the database.
-- Never includes email.
create or replace function app.person_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', p.id,
    'display_name', case
      when p.deleted_at is not null then 'Deleted member'
      when btrim(p.display_name) = '' then 'New member'
      else p.display_name
    end,
    'avatar', jsonb_build_object('color', p.avatar_color, 'face', p.avatar_face),
    'deleted', p.deleted_at is not null
  )
  from public.profiles p
  where p.id = p_user
$$;

create or replace function app.profile_json(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'timezone', p.timezone,
    'avatar', jsonb_build_object('color', p.avatar_color, 'face', p.avatar_face),
    'onboarded', p.onboarded_at is not null
  )
  from public.profiles p
  where p.id = p_user and p.deleted_at is null
$$;

create or replace function app.rules_json(p_version uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', v.id,
    'version', v.version,
    'status', v.status,
    'target', v.target,
    'comparator', v.comparator,
    'required_days', v.required_days,
    'verification', v.verification,
    'start_date', v.start_date,
    'end_date', v.end_date,
    'effective_date', v.effective_date
  )
  from public.rule_versions v
  where v.id = p_version
$$;

-- Safe context attached to notifications and system messages.
create or replace function app.challenge_payload(p_challenge uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'circle_id', c.circle_id,
    'circle_name', ci.name,
    'challenge_id', c.id,
    'challenge_name', c.name,
    'habit_type', c.habit_type
  )
  from public.challenges c
  join public.circles ci on ci.id = c.circle_id
  where c.id = p_challenge
$$;

create or replace function app.display_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app.person_json(p_user) ->> 'display_name'
$$;

-- ---------------------------------------------------------------------------
-- Side effects (never granted to API roles)
-- ---------------------------------------------------------------------------

create or replace function app.audit(
  p_circle uuid, p_challenge uuid, p_actor uuid, p_subject uuid, p_action text, p_local_date date,
  p_before jsonb, p_after jsonb, p_reason text, p_visibility text default 'members', p_source_submission uuid default null
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events
    (circle_id, challenge_id, actor_id, subject_user_id, action, local_date, before, after, reason, visibility, source_submission_id)
  values
    (p_circle, p_challenge, p_actor, p_subject, p_action, p_local_date, p_before, p_after, p_reason, p_visibility, p_source_submission)
  returning id
$$;

-- Persisted in-app notification. The dedupe key makes every producer idempotent.
create or replace function app.notify(p_recipient uuid, p_type text, p_entity uuid, p_payload jsonb, p_dedupe text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, type, entity_id, payload, dedupe_key)
  select p_recipient, p_type, p_entity, coalesce(p_payload, '{}'::jsonb), p_dedupe
  where exists (select 1 from public.profiles p where p.id = p_recipient and p.deleted_at is null)
  on conflict (recipient_id, dedupe_key) do nothing
$$;

-- Server-generated chat line. author_id is always null, which members cannot produce.
create or replace function app.system_message(p_circle uuid, p_text text, p_event jsonb, p_event_id uuid default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.messages (circle_id, author_id, text, type, event, event_id)
  values (p_circle, null, left(p_text, 2000), 'system', p_event, p_event_id)
$$;

-- ---------------------------------------------------------------------------
-- Finalization and lifecycle
-- ---------------------------------------------------------------------------

-- Everything that currently stops completion (twin of finalizationBlockers).
create or replace function app.finalization_blockers(p_challenge uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.challenges%rowtype;
  v_now timestamptz := app.now();
  v_deadline timestamptz;
  v_out jsonb := '[]'::jsonb;
  v_count integer;
  v_until timestamptz;
begin
  select * into c from public.challenges where id = p_challenge;
  if not found then
    return jsonb_build_array(jsonb_build_object('code', 'NOT_IN_REVIEW', 'count', 0, 'until', null));
  end if;
  if app.effective_status(c.status, c.start_date, c.end_date, c.timezone, v_now) <> 'review' then
    return jsonb_build_array(jsonb_build_object('code', 'NOT_IN_REVIEW', 'count', 0, 'until', null));
  end if;

  v_deadline := app.day_deadline(c.end_date, c.timezone);
  if v_now < v_deadline then
    v_out := v_out || jsonb_build_object('code', 'DEADLINE_NOT_REACHED', 'count', 0, 'until', v_deadline);
  end if;

  select count(*) into v_count
  from public.daily_records r
  join public.participants p on p.id = r.participant_id
  where p.challenge_id = p_challenge and p.removed_at is null and r.outcome in ('pending', 'late_pending');
  if v_count > 0 then
    v_out := v_out || jsonb_build_object('code', 'REVIEW_PENDING', 'count', v_count, 'until', null);
  end if;

  select count(*) into v_count
  from public.disputes d
  join public.daily_records r on r.id = d.daily_record_id
  join public.participants p on p.id = r.participant_id
  where p.challenge_id = p_challenge and p.removed_at is null and d.status = 'open';
  if v_count > 0 then
    v_out := v_out || jsonb_build_object('code', 'DISPUTE_OPEN', 'count', v_count, 'until', null);
  end if;

  select count(*), max(r.decided_at + interval '24 hours') into v_count, v_until
  from public.daily_records r
  join public.participants p on p.id = r.participant_id
  where p.challenge_id = p_challenge and p.removed_at is null
    and app.window_open(r.decided_at, r.acknowledged_at, v_now);
  if v_count > 0 then
    v_out := v_out || jsonb_build_object('code', 'DISPUTE_WINDOW_OPEN', 'count', v_count, 'until', v_until);
  end if;

  return v_out;
end
$$;

-- Persists clock-driven status changes and sends the 48-hour admin reminder.
-- Cheap when nothing changed; called at the top of every challenge operation.
create or replace function app.sync_status(p_challenge uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.challenges%rowtype;
  v_now timestamptz := app.now();
  v_status text;
  r record;
begin
  select * into c from public.challenges where id = p_challenge;
  if not found then
    return null;
  end if;
  v_status := app.effective_status(c.status, c.start_date, c.end_date, c.timezone, v_now);

  if v_status <> c.status then
    select * into c from public.challenges where id = p_challenge for update;
    v_status := app.effective_status(c.status, c.start_date, c.end_date, c.timezone, v_now);
    if v_status <> c.status then
      update public.challenges set status = v_status, updated_at = v_now where id = p_challenge;
      if c.status = 'scheduled' then
        perform app.audit(c.circle_id, c.id, null, null, 'challenge.started', c.start_date, null, null, null);
      end if;
      if v_status = 'review' then
        -- An unanswered proposal cannot outlive the challenge days it would change.
        update public.rule_versions set status = 'withdrawn', decided_at = v_now
        where challenge_id = p_challenge and status = 'proposed';
        perform app.audit(c.circle_id, c.id, null, null, 'challenge.ended', c.end_date, null, null, null);
        perform app.system_message(
          c.circle_id,
          c.name || ' has ended. Results are final once reviews are done.',
          app.challenge_payload(c.id) || jsonb_build_object('type', 'challenge_ended')
        );
      end if;
    end if;
  end if;

  -- 48 hours after the final deadline, remind admins of outstanding work.
  -- Nothing is approved or rejected automatically.
  if v_status = 'review'
     and c.finalize_reminder_sent_at is null
     and v_now >= app.day_deadline(c.end_date, c.timezone) + interval '48 hours'
     and exists (
       select 1 from jsonb_array_elements(app.finalization_blockers(p_challenge)) b
       where b ->> 'code' in ('REVIEW_PENDING', 'DISPUTE_OPEN')
     )
  then
    update public.challenges set finalize_reminder_sent_at = v_now
    where id = p_challenge and finalize_reminder_sent_at is null;
    if found then
      for r in select a.user_id from public.challenge_admins a where a.challenge_id = p_challenge and a.revoked_at is null loop
        perform app.notify(r.user_id, 'finalize_reminder', p_challenge, app.challenge_payload(p_challenge), 'finalize_reminder:' || p_challenge);
      end loop;
    end if;
  end if;

  return v_status;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants: read helpers that RLS policies and API roles may evaluate
-- ---------------------------------------------------------------------------

grant execute on function
  app.circle_role(uuid, uuid),
  app.is_circle_member(uuid, uuid),
  app.is_circle_admin(uuid, uuid),
  app.is_challenge_admin(uuid, uuid),
  app.can_view_challenge(uuid, uuid),
  app.shares_circle(uuid, uuid),
  app.record_owner(uuid),
  app.record_challenge(uuid),
  app.can_view_record(uuid, uuid)
to authenticated;
