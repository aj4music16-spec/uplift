-- Daily check-ins, evidence, review, corrections and disputes.
--
-- Invariants enforced here (see CLAUDE.md):
--   * Client input never sets approval, outcome, reviewer, provenance or score.
--   * Screen time needs evidence, and evidence for a day cannot be submitted
--     before that day has ended in the challenge time zone.
--   * Pending adds no score and never resolves by itself.
--   * Approving evidence and meeting the target are separate.
--   * Every correction writes its audit event in the same transaction.

-- Whether the participant may submit for a date right now: 'ok', 'late', or an
-- error code. Twin of submissionGate in src/domain/lifecycle.ts.
create or replace function app.submission_gate(p_challenge uuid, p_date date, p_participant uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.challenges%rowtype;
  r public.daily_records%rowtype;
  v public.rule_versions%rowtype;
  h app.habits%rowtype;
  v_now timestamptz := app.now();
  v_status text;
  v_has_record boolean;
  v_past_deadline boolean;
begin
  select * into c from public.challenges where id = p_challenge;
  v_status := app.effective_status(c.status, c.start_date, c.end_date, c.timezone, v_now);
  if v_status in ('draft', 'scheduled') then
    return 'NOT_STARTED';
  end if;
  if v_status in ('completed', 'canceled') then
    return 'CHALLENGE_CLOSED';
  end if;
  if p_date is null or p_date < c.start_date or p_date > c.end_date then
    return 'VALIDATION';
  end if;
  if v_now < app.day_start(p_date, c.timezone) then
    return 'DAY_NOT_STARTED';
  end if;

  select * into r from public.daily_records where participant_id = p_participant and local_date = p_date;
  v_has_record := found;
  select * into v from public.rule_versions
  where id = case when v_has_record then r.rule_version_id else app.rule_for_date(c.id, p_date) end;
  select * into h from app.habits where habit_type = c.habit_type;

  -- A maximum goal (screen time) cannot be proven until the whole day is over.
  if (v.comparator = 'lte' or h.requires_finished_day) and v_now < app.day_start(p_date + 1, c.timezone) then
    return 'DAY_NOT_FINISHED';
  end if;

  v_past_deadline := v_now >= app.day_deadline(p_date, c.timezone);
  if v_has_record then
    if r.outcome = 'late_pending' then
      return 'REVIEW_PENDING';
    end if;
    if r.provenance = 'admin_adjusted' then
      return 'ALREADY_DECIDED';
    end if;
    if r.outcome = 'rejected' then
      return case
        when app.can_resubmit_on_time(r.outcome, p_date, c.timezone, r.decided_at, r.acknowledged_at, v_now) then 'ok'
        else 'late'
      end;
    end if;
    if r.outcome = 'pending' then
      return case when v_past_deadline then 'REVIEW_PENDING' else 'ok' end;
    end if;
    if r.outcome in ('success', 'fail') and r.provenance in ('evidence_reviewed', 'admin_self_reviewed') then
      return 'ALREADY_DECIDED';
    end if;
    if r.outcome = 'success' and v_past_deadline then
      return 'ALREADY_DECIDED';
    end if;
  end if;
  return case when v_past_deadline then 'late' else 'ok' end;
end
$$;

-- One public "goal completed" line per day, without detail for private habits.
create or replace function app.announce_success(p_record uuid, p_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.daily_records%rowtype;
  p public.participants%rowtype;
  c public.challenges%rowtype;
  v_private boolean;
  v_name text;
begin
  select * into r from public.daily_records where id = p_record;
  if not found or r.outcome <> 'success' or r.success_announced then
    return;
  end if;
  update public.daily_records set success_announced = true where id = r.id;
  select * into p from public.participants where id = r.participant_id;
  select * into c from public.challenges where id = p.challenge_id;
  select h.private_detail into v_private from app.habits h where h.habit_type = c.habit_type;
  v_name := app.display_name(p.user_id);
  perform app.system_message(
    c.circle_id,
    case
      when v_private then v_name || ' completed the daily goal.'
      else v_name || ' hit the goal for ' || to_char(r.local_date, 'Mon FMDD') || '.'
    end,
    app.challenge_payload(c.id) || jsonb_build_object('type', p_type, 'user_id', p.user_id, 'name', v_name, 'local_date', r.local_date)
  );
end
$$;

-- Brings the increment ledger in line with an accepted total.
create or replace function app.reconcile_ledger(p_record uuid, p_actor uuid, p_total numeric, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sum numeric;
begin
  select coalesce(sum(i.amount), 0) into v_sum from public.activity_increments i where i.daily_record_id = p_record;
  if p_total is not null and p_total <> v_sum then
    insert into public.activity_increments (daily_record_id, actor_id, amount, kind, idempotency_key)
    values (p_record, p_actor, p_total - v_sum, 'correction', p_key)
    on conflict (actor_id, idempotency_key) do nothing;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Reading a day
-- ---------------------------------------------------------------------------

create or replace function public.get_day(p_challenge_id uuid, p_local_date date, p_participant_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  c public.challenges%rowtype;
  p public.participants%rowtype;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or not app.can_view_challenge(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  perform app.sync_status(c.id);

  if p_participant_id is null then
    select * into p from public.participants where challenge_id = c.id and user_id = v_uid;
    if not found then
      raise exception 'FORBIDDEN' using detail = 'You’re not playing in this challenge.';
    end if;
  else
    select * into p from public.participants where id = p_participant_id and challenge_id = c.id;
    if not found then
      raise exception 'NOT_FOUND';
    end if;
    -- Another player's day is only open to assigned challenge admins.
    if p.user_id <> v_uid and not app.is_challenge_admin(c.id, v_uid) then
      raise exception 'FORBIDDEN';
    end if;
  end if;
  if p_local_date is null or p_local_date < c.start_date or p_local_date > c.end_date then
    raise exception 'VALIDATION' using detail = 'That date isn’t part of this challenge.';
  end if;
  return app.day_json(p.id, p_local_date, v_uid);
end
$$;

-- ---------------------------------------------------------------------------
-- Evidence staging
-- ---------------------------------------------------------------------------

-- Issues a scoped, unguessable upload destination for one day's proof. Nothing
-- is recorded against the day until public.submit_checkin verifies the object.
create or replace function public.begin_evidence_upload(
  p_challenge_id uuid, p_local_date date, p_mime text, p_byte_size integer, p_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  c public.challenges%rowtype;
  p public.participants%rowtype;
  v public.rule_versions%rowtype;
  v_gate text;
  v_path text;
  v_id uuid;
begin
  select * into c from public.challenges where id = p_challenge_id;
  if not found or not app.can_view_challenge(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  select * into p from public.participants where challenge_id = c.id and user_id = v_uid;
  if not found or p.removed_at is not null then
    raise exception 'FORBIDDEN';
  end if;
  perform app.sync_status(c.id);

  v_gate := app.submission_gate(c.id, p_local_date, p.id);
  if v_gate not in ('ok', 'late') then
    raise exception '%', v_gate;
  end if;
  select * into v from public.rule_versions where id = coalesce(
    (select r.rule_version_id from public.daily_records r where r.participant_id = p.id and r.local_date = p_local_date),
    app.rule_for_date(c.id, p_local_date)
  );
  if v.verification <> 'evidence' then
    raise exception 'VALIDATION' using detail = 'This challenge doesn’t take proof uploads.';
  end if;
  if p_mime is null or p_mime not in ('image/jpeg', 'image/png') then
    raise exception 'VALIDATION' using detail = 'Use a JPEG or PNG image.';
  end if;
  if p_byte_size is null or p_byte_size < 1 or p_byte_size > 10485760 then
    raise exception 'VALIDATION' using detail = 'Images can be up to 10 MB.';
  end if;
  if (
    select count(*) from public.evidence_uploads u
    where u.user_id = v_uid and u.created_at > v_now - interval '10 minutes'
  ) >= 20 then
    raise exception 'RATE_LIMITED';
  end if;

  v_path := v_uid::text || '/' || c.id::text || '/' || p_local_date::text || '/' || gen_random_uuid()::text
    || case p_mime when 'image/png' then '.png' else '.jpg' end;
  insert into public.evidence_uploads (user_id, challenge_id, participant_id, local_date, object_path, mime, byte_size, sha256, expires_at)
  values (
    v_uid, c.id, p.id, p_local_date, v_path, p_mime, p_byte_size,
    case when p_sha256 ~ '^[0-9a-f]{64}$' then p_sha256 else null end,
    v_now + interval '1 hour'
  )
  returning id into v_id;

  return jsonb_build_object('upload_id', v_id, 'bucket', 'evidence', 'path', v_path, 'expires_at', v_now + interval '1 hour');
end
$$;

-- Path for a signed URL, only for the participant (while a member) and
-- assigned challenge admins. The storage policy enforces the same rule again.
create or replace function public.get_evidence_path(p_evidence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  e public.evidence%rowtype;
  v_record uuid;
  v_owner uuid;
  v_challenge uuid;
  v_date date;
begin
  select * into e from public.evidence where id = p_evidence_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  select s.daily_record_id into v_record from public.submissions s where s.id = e.submission_id;
  if not app.can_view_record(v_record, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if e.purged_at is not null then
    raise exception 'NOT_FOUND' using detail = 'This proof was removed under the retention policy.';
  end if;

  v_owner := app.record_owner(v_record);
  if v_owner <> v_uid then
    -- Access by someone other than the participant leaves a trace the participant can see.
    v_challenge := app.record_challenge(v_record);
    select r.local_date into v_date from public.daily_records r where r.id = v_record;
    perform app.audit(
      (select c.circle_id from public.challenges c where c.id = v_challenge),
      v_challenge, v_uid, v_owner, 'evidence.viewed', v_date, null, null, null, 'restricted', e.submission_id
    );
  end if;
  return jsonb_build_object('bucket', 'evidence', 'path', e.private_object_path);
end
$$;

-- ---------------------------------------------------------------------------
-- Submitting
-- ---------------------------------------------------------------------------

create or replace function public.submit_checkin(
  p_challenge_id uuid, p_local_date date, p_value numeric, p_upload_id uuid, p_idempotency_key text, p_late boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  c public.challenges%rowtype;
  p public.participants%rowtype;
  r public.daily_records%rowtype;
  v public.rule_versions%rowtype;
  h app.habits%rowtype;
  u public.evidence_uploads%rowtype;
  v_object_owner text;
  v_object_meta jsonb;
  v_has_record boolean;
  v_gate text;
  v_is_late boolean;
  v_version integer;
  v_prev uuid;
  v_sub uuid;
  v_status text;
  v_prior text;
  a record;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 or char_length(p_idempotency_key) > 100 then
    raise exception 'VALIDATION' using detail = 'Missing request id.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or not app.can_view_challenge(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  -- Locking the participant row serializes this person's check-ins.
  select * into p from public.participants where challenge_id = c.id and user_id = v_uid for update;
  if not found or p.removed_at is not null then
    raise exception 'FORBIDDEN';
  end if;
  perform app.sync_status(c.id);

  -- A retried request returns the stored result; it never creates another version.
  if exists (
    select 1 from public.submissions s
    join public.daily_records dr on dr.id = s.daily_record_id
    where dr.participant_id = p.id and dr.local_date = p_local_date and s.idempotency_key = p_idempotency_key
  ) or exists (
    select 1 from public.activity_increments i where i.actor_id = v_uid and i.idempotency_key = p_idempotency_key
  ) then
    return app.day_json(p.id, p_local_date, v_uid);
  end if;

  v_gate := app.submission_gate(c.id, p_local_date, p.id);
  if v_gate not in ('ok', 'late') then
    raise exception '%', v_gate;
  end if;
  v_is_late := v_gate = 'late';
  if v_is_late and not coalesce(p_late, false) then
    raise exception 'DEADLINE_PASSED';
  end if;

  select * into r from public.daily_records where participant_id = p.id and local_date = p_local_date for update;
  v_has_record := found;
  select * into v from public.rule_versions
  where id = case when v_has_record then r.rule_version_id else app.rule_for_date(c.id, p_local_date) end;
  select * into h from app.habits where habit_type = c.habit_type;

  if not app.valid_daily_value(c.habit_type, v.comparator, p_value) then
    raise exception 'VALIDATION' using detail = 'Enter a valid amount for this goal.';
  end if;

  if v.verification = 'evidence' then
    -- Stage -> upload -> verify the object exists and belongs to the actor ->
    -- finalize. A failed upload can never leave a pending record behind.
    if p_upload_id is null then
      raise exception 'EVIDENCE_REQUIRED';
    end if;
    select * into u from public.evidence_uploads where id = p_upload_id and user_id = v_uid for update;
    if not found or u.finalized_at is not null or u.challenge_id <> c.id or u.participant_id <> p.id or u.local_date <> p_local_date then
      raise exception 'UPLOAD_INCOMPLETE';
    end if;
    select o.owner_id, o.metadata into v_object_owner, v_object_meta
    from storage.objects o
    where o.bucket_id = 'evidence' and o.name = u.object_path;
    if not found then
      raise exception 'UPLOAD_INCOMPLETE';
    end if;
    if v_object_owner is distinct from v_uid::text then
      raise exception 'FORBIDDEN';
    end if;
    if coalesce((v_object_meta ->> 'size')::bigint, 0) < 1
       or (v_object_meta ->> 'size')::bigint > 10485760
       or coalesce(v_object_meta ->> 'mimetype', '') not in ('image/jpeg', 'image/png')
    then
      raise exception 'VALIDATION' using detail = 'Proof must be a JPEG or PNG image up to 10 MB.';
    end if;
  elsif p_upload_id is not null then
    raise exception 'VALIDATION' using detail = 'This challenge doesn’t take proof uploads.';
  end if;

  if not v_has_record then
    insert into public.daily_records (participant_id, local_date, rule_version_id)
    values (p.id, p_local_date, v.id)
    returning * into r;
  end if;
  v_prior := r.outcome;

  -- Reps live in the increment ledger: setting a total writes a correction entry.
  if h.uses_increments and v.verification = 'self_report' and not v_is_late then
    perform app.reconcile_ledger(r.id, v_uid, p_value, p_idempotency_key);
    update public.daily_records
    set effective_value = p_value,
        outcome = case when app.meets_target(v.comparator, v.target, p_value) then 'success' else 'open' end,
        provenance = 'self_reported',
        revision = revision + 1,
        updated_at = v_now
    where id = r.id;
    perform app.announce_success(r.id, 'goal_completed');
    return app.day_json(p.id, p_local_date, v_uid);
  end if;

  select coalesce(max(s.version), 0) + 1 into v_version from public.submissions s where s.daily_record_id = r.id;
  select s.id into v_prev from public.submissions s
  where s.daily_record_id = r.id and s.status in ('pending', 'late')
  order by s.version desc limit 1;
  -- A newer version replaces a waiting one; nothing is deleted.
  update public.submissions set status = 'superseded' where daily_record_id = r.id and status in ('pending', 'late');

  v_status := case when v_is_late then 'late' when v.verification = 'evidence' then 'pending' else 'accepted' end;
  insert into public.submissions (daily_record_id, version, entered_value, submitted_at, status, supersedes_id, idempotency_key, is_late, prior_outcome)
  values (r.id, v_version, p_value, v_now, v_status, v_prev, p_idempotency_key, v_is_late, v_prior)
  returning id into v_sub;

  if v.verification = 'evidence' then
    insert into public.evidence (submission_id, private_object_path, mime, byte_size, sha256, etag, uploaded_by)
    values (v_sub, u.object_path, v_object_meta ->> 'mimetype', (v_object_meta ->> 'size')::integer, u.sha256, v_object_meta ->> 'eTag', v_uid);
    update public.evidence_uploads set finalized_at = v_now where id = u.id;
  end if;

  if v_is_late then
    -- Waits for an admin to accept or decline. Adds no score.
    update public.daily_records
    set outcome = 'late_pending', provenance = null, revision = revision + 1, updated_at = v_now
    where id = r.id;
  elsif v.verification = 'evidence' then
    -- Pending review. Adds no score and never resolves by itself.
    update public.daily_records
    set outcome = 'pending', effective_value = p_value, provenance = null, decided_at = null, acknowledged_at = null,
        revision = revision + 1, updated_at = v_now
    where id = r.id;
  else
    -- Valid self-reports are accepted by the server and labeled as such.
    update public.daily_records
    set effective_value = p_value,
        outcome = case when app.meets_target(v.comparator, v.target, p_value) then 'success' else 'open' end,
        provenance = 'self_reported',
        revision = revision + 1,
        updated_at = v_now
    where id = r.id;
    perform app.announce_success(r.id, 'goal_completed');
  end if;

  if v_status in ('pending', 'late') then
    for a in
      select ca.user_id from public.challenge_admins ca
      where ca.challenge_id = c.id and ca.revoked_at is null and ca.user_id <> v_uid
    loop
      perform app.notify(
        a.user_id, case when v_is_late then 'late_submission' else 'review_needed' end, c.id,
        app.challenge_payload(c.id) || jsonb_build_object('actor_name', app.display_name(v_uid), 'local_date', p_local_date, 'participant_id', p.id),
        'review_needed:' || v_sub
      );
    end loop;
  end if;

  perform app.audit(
    c.circle_id, c.id, v_uid, v_uid,
    case when v_is_late then 'checkin.submitted_late' else 'checkin.submitted' end,
    p_local_date, null,
    jsonb_build_object('version', v_version, 'value', p_value, 'has_evidence', v.verification = 'evidence'),
    null, 'restricted', v_sub
  );
  return app.day_json(p.id, p_local_date, v_uid);
end
$$;

-- Adds reps to the day's ledger. The idempotency key makes a retried request a no-op.
create or replace function public.add_reps(p_challenge_id uuid, p_local_date date, p_amount numeric, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  c public.challenges%rowtype;
  p public.participants%rowtype;
  r public.daily_records%rowtype;
  v public.rule_versions%rowtype;
  h app.habits%rowtype;
  v_has_record boolean;
  v_gate text;
  v_total numeric;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 8 or char_length(p_idempotency_key) > 100 then
    raise exception 'VALIDATION' using detail = 'Missing request id.';
  end if;
  select * into c from public.challenges where id = p_challenge_id;
  if not found or not app.can_view_challenge(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  select * into p from public.participants where challenge_id = c.id and user_id = v_uid for update;
  if not found or p.removed_at is not null then
    raise exception 'FORBIDDEN';
  end if;
  perform app.sync_status(c.id);

  if exists (select 1 from public.activity_increments i where i.actor_id = v_uid and i.idempotency_key = p_idempotency_key) then
    return app.day_json(p.id, p_local_date, v_uid);
  end if;

  select * into h from app.habits where habit_type = c.habit_type;
  if not h.uses_increments then
    raise exception 'VALIDATION' using detail = 'This goal isn’t logged in increments.';
  end if;
  if p_amount is null or p_amount <> trunc(p_amount) or p_amount < 1 or p_amount > 10000 then
    raise exception 'VALIDATION' using detail = 'Add between 1 and 10,000 at a time.';
  end if;

  v_gate := app.submission_gate(c.id, p_local_date, p.id);
  if v_gate = 'late' then
    raise exception 'DEADLINE_PASSED';
  end if;
  if v_gate <> 'ok' then
    raise exception '%', v_gate;
  end if;

  select * into r from public.daily_records where participant_id = p.id and local_date = p_local_date for update;
  v_has_record := found;
  if v_has_record and r.outcome in ('pending', 'rejected') then
    raise exception 'REVIEW_PENDING';
  end if;
  select * into v from public.rule_versions
  where id = case when v_has_record then r.rule_version_id else app.rule_for_date(c.id, p_local_date) end;
  if not v_has_record then
    insert into public.daily_records (participant_id, local_date, rule_version_id)
    values (p.id, p_local_date, v.id)
    returning * into r;
  end if;

  select coalesce(sum(i.amount), 0) into v_total from public.activity_increments i where i.daily_record_id = r.id;
  if v_total + p_amount > h.max_daily_value then
    raise exception 'VALIDATION' using detail = 'That’s more than a day can hold.';
  end if;
  insert into public.activity_increments (daily_record_id, actor_id, amount, kind, idempotency_key)
  values (r.id, v_uid, p_amount, 'add', p_idempotency_key);
  v_total := v_total + p_amount;

  if v.verification = 'self_report' then
    update public.daily_records
    set effective_value = v_total,
        outcome = case when app.meets_target(v.comparator, v.target, v_total) then 'success' else 'open' end,
        provenance = 'self_reported',
        revision = revision + 1,
        updated_at = v_now
    where id = r.id;
    perform app.announce_success(r.id, 'goal_completed');
  else
    -- Proof is required: the total counts only after it is submitted and reviewed.
    update public.daily_records set effective_value = v_total, revision = revision + 1, updated_at = v_now where id = r.id;
  end if;
  return app.day_json(p.id, p_local_date, v_uid);
end
$$;

-- ---------------------------------------------------------------------------
-- Review (assigned challenge admins only)
-- ---------------------------------------------------------------------------

create or replace function public.get_review_queue(p_challenge_id uuid)
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
  if not app.is_challenge_admin(p_challenge_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  perform app.sync_status(p_challenge_id);

  return jsonb_build_object(
    'challenge_id', p_challenge_id,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'submission_id', s.id,
          'record_id', r.id,
          'record_revision', r.revision,
          'participant_id', p.id,
          'person', app.person_json(p.user_id),
          'date', r.local_date,
          'entered_value', s.entered_value,
          'submitted_at', s.submitted_at,
          'kind', case when s.status = 'late' then 'late' else 'review' end,
          'evidence_id', e.id,
          'duplicate', e.id is not null and exists (
            select 1
            from public.evidence e2
            join public.submissions s2 on s2.id = e2.submission_id
            join public.daily_records r2 on r2.id = s2.daily_record_id
            join public.participants p2 on p2.id = r2.participant_id
            where e2.id <> e.id and p2.challenge_id = p_challenge_id and r2.id <> r.id
              and ((e.etag is not null and e2.etag = e.etag) or (e.sha256 is not null and e2.sha256 = e.sha256))
          ),
          'own', p.user_id = v_uid
        )
        order by s.submitted_at, s.id
      )
      from public.submissions s
      join public.daily_records r on r.id = s.daily_record_id
      join public.participants p on p.id = r.participant_id
      left join public.evidence e on e.submission_id = s.id
      where p.challenge_id = p_challenge_id and p.removed_at is null and s.status in ('pending', 'late')
    ), '[]'::jsonb),
    'disputes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'dispute_id', d.id,
          'record_id', r.id,
          'participant_id', p.id,
          'person', app.person_json(p.user_id),
          'date', r.local_date,
          'reason', d.reason,
          'created_at', d.created_at
        )
        order by d.created_at, d.id
      )
      from public.disputes d
      join public.daily_records r on r.id = d.daily_record_id
      join public.participants p on p.id = r.participant_id
      where p.challenge_id = p_challenge_id and p.removed_at is null and d.status = 'open'
    ), '[]'::jsonb),
    'server_now', app.now()
  );
end
$$;

-- Approve or reject one submission version. expected_revision makes two admins
-- reviewing at once fail safely: the second gets REVISION_CONFLICT.
create or replace function public.review_submission(
  p_submission_id uuid, p_decision text, p_corrected_value numeric, p_reason text, p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  s public.submissions%rowtype;
  r public.daily_records%rowtype;
  p public.participants%rowtype;
  c public.challenges%rowtype;
  v public.rule_versions%rowtype;
  h app.habits%rowtype;
  v_record uuid;
  v_self boolean;
  v_reason text;
  v_value numeric;
  v_corrected boolean;
  v_outcome text;
  v_event uuid;
  v_actor text;
  v_name text;
begin
  select sub.daily_record_id into v_record from public.submissions sub where sub.id = p_submission_id;
  if v_record is null then
    raise exception 'NOT_FOUND';
  end if;
  select * into r from public.daily_records where id = v_record for update;
  select * into p from public.participants where id = r.participant_id;
  select * into c from public.challenges where id = p.challenge_id;
  if not app.can_view_challenge(c.id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  -- An admin of another Circle or challenge has no power here.
  if not app.is_challenge_admin(c.id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if app.sync_status(c.id) not in ('active', 'review') then
    raise exception 'CHALLENGE_CLOSED';
  end if;
  if r.revision is distinct from p_expected_revision then
    raise exception 'REVISION_CONFLICT';
  end if;
  select * into s from public.submissions where id = p_submission_id;
  if s.status <> 'pending' then
    raise exception 'ALREADY_DECIDED';
  end if;

  select * into v from public.rule_versions where id = r.rule_version_id;
  select * into h from app.habits where habit_type = c.habit_type;
  v_self := p.user_id = v_uid;
  v_actor := app.display_name(v_uid);
  v_name := app.display_name(p.user_id);

  if p_decision = 'reject' then
    v_reason := app.require_reason(p_reason);
    update public.submissions set status = 'rejected' where id = s.id;
    update public.daily_records
    set outcome = 'rejected', provenance = null, decided_at = v_now, acknowledged_at = null,
        revision = revision + 1, updated_at = v_now
    where id = r.id;
    insert into public.reviews (submission_id, reviewer_id, decision, reason, self_review, reviewed_at)
    values (s.id, v_uid, 'rejected', v_reason, v_self, v_now);
    -- Private: the reason reaches the participant and admins, not the group.
    perform app.audit(
      c.circle_id, c.id, v_uid, p.user_id, 'review.rejected', r.local_date,
      jsonb_build_object('outcome', r.outcome, 'value', s.entered_value), jsonb_build_object('outcome', 'rejected'),
      v_reason, 'restricted', s.id
    );
    perform app.notify(
      p.user_id, 'review_rejected', c.id,
      app.challenge_payload(c.id) || jsonb_build_object('local_date', r.local_date, 'reason', v_reason, 'participant_id', p.id),
      'review:' || s.id
    );

  elsif p_decision = 'approve' then
    v_value := coalesce(p_corrected_value, s.entered_value);
    v_corrected := p_corrected_value is not null and p_corrected_value <> s.entered_value;
    if v_corrected then
      v_reason := app.require_reason(p_reason);
    else
      v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    end if;
    if not app.valid_daily_value(c.habit_type, v.comparator, v_value) then
      raise exception 'VALIDATION' using detail = 'Enter a valid amount for this goal.';
    end if;
    -- Approving the evidence and meeting the target are separate questions.
    v_outcome := case when app.meets_target(v.comparator, v.target, v_value) then 'success' else 'fail' end;

    update public.submissions set status = 'accepted' where id = s.id;
    if h.uses_increments then
      perform app.reconcile_ledger(r.id, v_uid, v_value, 'review:' || s.id);
    end if;
    update public.daily_records
    set effective_value = v_value,
        outcome = v_outcome,
        provenance = case when v_self then 'admin_self_reviewed' else 'evidence_reviewed' end,
        decided_at = v_now,
        acknowledged_at = null,
        revision = revision + 1,
        updated_at = v_now
    where id = r.id;
    insert into public.reviews (submission_id, reviewer_id, decision, corrected_value, reason, self_review, reviewed_at)
    values (s.id, v_uid, 'approved', case when v_corrected then p_corrected_value else null end, v_reason, v_self, v_now);

    perform app.audit(
      c.circle_id, c.id, v_uid, p.user_id, 'review.approved', r.local_date,
      jsonb_build_object('outcome', r.outcome), jsonb_build_object('outcome', v_outcome, 'value', v_value, 'self_review', v_self),
      v_reason, 'restricted', s.id
    );
    if v_corrected then
      v_event := app.audit(
        c.circle_id, c.id, v_uid, p.user_id, 'review.value_corrected', r.local_date,
        jsonb_build_object('value', s.entered_value), jsonb_build_object('value', v_value, 'outcome', v_outcome),
        v_reason, 'members', s.id
      );
      perform app.system_message(
        c.circle_id,
        v_actor || ' corrected ' || v_name || '’s result for ' || to_char(r.local_date, 'Mon FMDD') || '.',
        app.challenge_payload(c.id) || jsonb_build_object('type', 'admin_corrected', 'actor_name', v_actor, 'name', v_name, 'user_id', p.user_id, 'local_date', r.local_date),
        v_event
      );
    end if;
    perform app.notify(
      p.user_id, 'review_approved', c.id,
      app.challenge_payload(c.id) || jsonb_build_object('local_date', r.local_date, 'outcome', v_outcome, 'corrected', v_corrected, 'participant_id', p.id),
      'review:' || s.id
    );
    perform app.announce_success(r.id, 'checkin_approved');
  else
    raise exception 'VALIDATION' using detail = 'Choose approve or reject.';
  end if;

  return app.day_json(p.id, r.local_date, v_uid);
end
$$;

-- A late submission only counts if an admin accepts it; it then follows the
-- ordinary, audited path (evidence still gets reviewed).
create or replace function public.accept_late_submission(p_submission_id uuid, p_accept boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  s public.submissions%rowtype;
  r public.daily_records%rowtype;
  p public.participants%rowtype;
  c public.challenges%rowtype;
  v public.rule_versions%rowtype;
  h app.habits%rowtype;
  v_record uuid;
  v_reason text;
begin
  select sub.daily_record_id into v_record from public.submissions sub where sub.id = p_submission_id;
  if v_record is null then
    raise exception 'NOT_FOUND';
  end if;
  select * into r from public.daily_records where id = v_record for update;
  select * into p from public.participants where id = r.participant_id;
  select * into c from public.challenges where id = p.challenge_id;
  if not app.can_view_challenge(c.id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if not app.is_challenge_admin(c.id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if app.sync_status(c.id) not in ('active', 'review') then
    raise exception 'CHALLENGE_CLOSED';
  end if;
  select * into s from public.submissions where id = p_submission_id;
  if s.status <> 'late' then
    raise exception 'ALREADY_DECIDED';
  end if;
  v_reason := app.require_reason(p_reason);
  select * into v from public.rule_versions where id = r.rule_version_id;
  select * into h from app.habits where habit_type = c.habit_type;

  if not coalesce(p_accept, false) then
    update public.submissions set status = 'declined' where id = s.id;
    update public.daily_records
    set outcome = case when s.prior_outcome in ('open', 'rejected') then s.prior_outcome else 'open' end,
        provenance = null,
        decided_at = v_now,
        acknowledged_at = null,
        revision = revision + 1,
        updated_at = v_now
    where id = r.id;
    insert into public.reviews (submission_id, reviewer_id, decision, reason, self_review, reviewed_at)
    values (s.id, v_uid, 'late_declined', v_reason, p.user_id = v_uid, v_now);
    perform app.audit(c.circle_id, c.id, v_uid, p.user_id, 'late.declined', r.local_date, null, null, v_reason, 'restricted', s.id);
    perform app.notify(
      p.user_id, 'late_declined', c.id,
      app.challenge_payload(c.id) || jsonb_build_object('local_date', r.local_date, 'reason', v_reason, 'participant_id', p.id),
      'late:' || s.id
    );
  else
    insert into public.reviews (submission_id, reviewer_id, decision, reason, self_review, reviewed_at)
    values (s.id, v_uid, 'late_accepted', v_reason, p.user_id = v_uid, v_now);
    perform app.audit(c.circle_id, c.id, v_uid, p.user_id, 'late.accepted', r.local_date, null, null, v_reason, 'members', s.id);

    if v.verification = 'evidence' then
      update public.submissions set status = 'pending' where id = s.id;
      update public.daily_records
      set outcome = 'pending', effective_value = s.entered_value, provenance = null, decided_at = null, acknowledged_at = null,
          revision = revision + 1, updated_at = v_now
      where id = r.id;
    else
      update public.submissions set status = 'accepted' where id = s.id;
      if h.uses_increments then
        perform app.reconcile_ledger(r.id, v_uid, s.entered_value, 'late:' || s.id);
      end if;
      update public.daily_records
      set effective_value = s.entered_value,
          outcome = case when app.meets_target(v.comparator, v.target, s.entered_value) then 'success' else 'open' end,
          provenance = 'self_reported',
          revision = revision + 1,
          updated_at = v_now
      where id = r.id;
      perform app.announce_success(r.id, 'goal_completed');
    end if;
    perform app.notify(
      p.user_id, 'late_accepted', c.id,
      app.challenge_payload(c.id) || jsonb_build_object('local_date', r.local_date, 'participant_id', p.id),
      'late:' || s.id
    );
  end if;

  return app.day_json(p.id, r.local_date, v_uid);
end
$$;

-- ---------------------------------------------------------------------------
-- Overrides ("Admin adjusted")
-- ---------------------------------------------------------------------------

-- The state change, the overrides row and the audit event commit together.
-- Provenance is always admin_adjusted: an override is never presented as
-- verified evidence.
create or replace function app.apply_override(p_record uuid, p_actor uuid, p_outcome text, p_value numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.now();
  r public.daily_records%rowtype;
  p public.participants%rowtype;
  c public.challenges%rowtype;
  v public.rule_versions%rowtype;
  v_prior text;
  v_value numeric;
  v_source uuid;
  v_override uuid;
  v_event uuid;
  v_actor text;
  v_name text;
begin
  select * into r from public.daily_records where id = p_record for update;
  select * into p from public.participants where id = r.participant_id;
  select * into c from public.challenges where id = p.challenge_id;
  select * into v from public.rule_versions where id = r.rule_version_id;

  if p_value is not null and not app.valid_daily_value(c.habit_type, v.comparator, p_value) then
    raise exception 'VALIDATION' using detail = 'Enter a valid amount for this goal.';
  end if;
  v_value := coalesce(p_value, r.effective_value);
  v_prior := app.day_status(r.outcome, r.local_date, c.timezone, v_now);

  select s.id into v_source from public.submissions s where s.daily_record_id = r.id order by s.version desc limit 1;
  -- A waiting submission is settled by the override; its history stays.
  update public.submissions set status = 'superseded' where daily_record_id = r.id and status in ('pending', 'late');

  update public.daily_records
  set outcome = p_outcome,
      effective_value = v_value,
      provenance = 'admin_adjusted',
      decided_at = v_now,
      acknowledged_at = null,
      success_announced = success_announced or p_outcome = 'success',
      revision = revision + 1,
      updated_at = v_now
  where id = r.id;

  insert into public.overrides (daily_record_id, actor_id, prior_outcome, prior_value, new_outcome, new_value, reason)
  values (r.id, p_actor, v_prior, r.effective_value, p_outcome, v_value, p_reason)
  returning id into v_override;

  v_event := app.audit(
    c.circle_id, c.id, p_actor, p.user_id, 'day.overridden', r.local_date,
    jsonb_build_object('outcome', v_prior, 'value', r.effective_value),
    jsonb_build_object('outcome', p_outcome, 'value', v_value),
    p_reason, 'members', v_source
  );

  v_actor := app.display_name(p_actor);
  v_name := app.display_name(p.user_id);
  perform app.system_message(
    c.circle_id,
    v_actor || ' adjusted ' || v_name || '’s result for ' || to_char(r.local_date, 'Mon FMDD') || '.',
    app.challenge_payload(c.id) || jsonb_build_object('type', 'admin_corrected', 'actor_name', v_actor, 'name', v_name, 'user_id', p.user_id, 'local_date', r.local_date),
    v_event
  );
  perform app.notify(
    p.user_id, 'day_overridden', c.id,
    app.challenge_payload(c.id) || jsonb_build_object('local_date', r.local_date, 'outcome', p_outcome, 'reason', p_reason, 'actor_name', v_actor, 'participant_id', p.id),
    'override:' || v_override
  );
end
$$;

create or replace function public.override_day(
  p_participant_id uuid, p_local_date date, p_outcome text, p_value numeric, p_reason text, p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  p public.participants%rowtype;
  c public.challenges%rowtype;
  r public.daily_records%rowtype;
  v_reason text;
begin
  select * into p from public.participants where id = p_participant_id for update;
  if not found or not app.can_view_challenge(p.challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  select * into c from public.challenges where id = p.challenge_id;
  if not app.is_challenge_admin(c.id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if app.sync_status(c.id) not in ('active', 'review') then
    raise exception 'CHALLENGE_CLOSED';
  end if;
  if p.removed_at is not null then
    raise exception 'VALIDATION' using detail = 'This player was removed from the challenge.';
  end if;
  if p_outcome is null or p_outcome not in ('success', 'fail') then
    raise exception 'VALIDATION' using detail = 'Choose success or not counted.';
  end if;
  v_reason := app.require_reason(p_reason);
  if p_local_date is null or p_local_date < c.start_date or p_local_date > c.end_date then
    raise exception 'VALIDATION' using detail = 'That date isn’t part of this challenge.';
  end if;
  if v_now < app.day_start(p_local_date, c.timezone) then
    raise exception 'DAY_NOT_STARTED';
  end if;

  select * into r from public.daily_records where participant_id = p.id and local_date = p_local_date for update;
  if found then
    if r.revision is distinct from p_expected_revision then
      raise exception 'REVISION_CONFLICT';
    end if;
  else
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'REVISION_CONFLICT';
    end if;
    insert into public.daily_records (participant_id, local_date, rule_version_id)
    values (p.id, p_local_date, app.rule_for_date(c.id, p_local_date))
    returning * into r;
  end if;

  perform app.apply_override(r.id, v_uid, p_outcome, p_value, v_reason);
  return app.day_json(p.id, p_local_date, v_uid);
end
$$;

-- ---------------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------------

create or replace function public.open_dispute(p_record_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  r public.daily_records%rowtype;
  p public.participants%rowtype;
  c public.challenges%rowtype;
  v_reason text;
  v_dispute uuid;
  a record;
begin
  select * into r from public.daily_records where id = p_record_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  select * into p from public.participants where id = r.participant_id;
  select * into c from public.challenges where id = p.challenge_id;
  if not app.can_view_challenge(c.id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  -- Only the participant can dispute their own day.
  if p.user_id <> v_uid or p.removed_at is not null then
    raise exception 'FORBIDDEN';
  end if;
  if app.sync_status(c.id) not in ('active', 'review') then
    raise exception 'CHALLENGE_CLOSED';
  end if;
  if exists (select 1 from public.disputes d where d.daily_record_id = r.id and d.status = 'open') then
    raise exception 'DISPUTE_OPEN';
  end if;
  if r.decided_at is null then
    raise exception 'VALIDATION' using detail = 'Only an admin decision can be disputed.';
  end if;
  if exists (select 1 from public.disputes d where d.daily_record_id = r.id and d.created_at >= r.decided_at) then
    raise exception 'ALREADY_DECIDED';
  end if;
  if not app.window_open(r.decided_at, r.acknowledged_at, v_now) then
    raise exception 'DISPUTE_WINDOW_CLOSED';
  end if;
  v_reason := app.require_reason(p_reason);

  insert into public.disputes (daily_record_id, raised_by, reason) values (r.id, v_uid, v_reason) returning id into v_dispute;
  perform app.audit(c.circle_id, c.id, v_uid, v_uid, 'dispute.opened', r.local_date, null, null, v_reason, 'restricted');
  for a in
    select ca.user_id from public.challenge_admins ca
    where ca.challenge_id = c.id and ca.revoked_at is null and ca.user_id <> v_uid
  loop
    perform app.notify(
      a.user_id, 'dispute_opened', c.id,
      app.challenge_payload(c.id) || jsonb_build_object('actor_name', app.display_name(v_uid), 'local_date', r.local_date, 'participant_id', p.id),
      'dispute:' || v_dispute
    );
  end loop;
  return app.day_json(p.id, r.local_date, v_uid);
end
$$;

-- The admin explains the decision. An outcome only changes through the same
-- audited override path as any other correction.
create or replace function public.resolve_dispute(
  p_dispute_id uuid, p_upheld boolean, p_resolution text, p_override_outcome text default null, p_override_value numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  d public.disputes%rowtype;
  r public.daily_records%rowtype;
  p public.participants%rowtype;
  c public.challenges%rowtype;
  v_resolution text;
begin
  select * into d from public.disputes where id = p_dispute_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  select * into r from public.daily_records where id = d.daily_record_id for update;
  select * into p from public.participants where id = r.participant_id;
  select * into c from public.challenges where id = p.challenge_id;
  if not app.can_view_challenge(c.id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if not app.is_challenge_admin(c.id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if app.sync_status(c.id) not in ('active', 'review') then
    raise exception 'CHALLENGE_CLOSED';
  end if;
  select * into d from public.disputes where id = p_dispute_id for update;
  if d.status <> 'open' then
    raise exception 'ALREADY_DECIDED';
  end if;
  v_resolution := app.require_reason(p_resolution);
  if p_override_outcome is not null and p_override_outcome not in ('success', 'fail') then
    raise exception 'VALIDATION' using detail = 'Choose success or not counted.';
  end if;

  update public.disputes
  set status = case when coalesce(p_upheld, false) then 'upheld' else 'denied' end,
      resolver_id = v_uid, resolution = v_resolution, resolved_at = v_now
  where id = d.id;
  perform app.audit(
    c.circle_id, c.id, v_uid, p.user_id, 'dispute.resolved', r.local_date, null,
    jsonb_build_object('status', case when coalesce(p_upheld, false) then 'upheld' else 'denied' end),
    v_resolution, 'restricted'
  );
  if p_override_outcome is not null then
    perform app.apply_override(r.id, v_uid, p_override_outcome, p_override_value, v_resolution);
  end if;
  perform app.notify(
    p.user_id, 'dispute_resolved', c.id,
    app.challenge_payload(c.id) || jsonb_build_object('local_date', r.local_date, 'upheld', coalesce(p_upheld, false), 'resolution', v_resolution, 'participant_id', p.id),
    'dispute_resolved:' || d.id
  );
  return app.day_json(p.id, r.local_date, v_uid);
end
$$;

-- The participant accepts the latest decision and waives the rest of their
-- dispute window, so results do not have to wait for it.
create or replace function public.acknowledge_decision(p_record_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  r public.daily_records%rowtype;
  p public.participants%rowtype;
begin
  select * into r from public.daily_records where id = p_record_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  select * into p from public.participants where id = r.participant_id;
  if not app.can_view_challenge(p.challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if p.user_id <> v_uid then
    raise exception 'FORBIDDEN';
  end if;
  if r.decided_at is not null and (r.acknowledged_at is null or r.acknowledged_at < r.decided_at) then
    update public.daily_records set acknowledged_at = app.now(), updated_at = app.now() where id = r.id;
  end if;
  return app.day_json(p.id, r.local_date, v_uid);
end
$$;

grant execute on function
  public.get_day(uuid, date, uuid),
  public.begin_evidence_upload(uuid, date, text, integer, text),
  public.get_evidence_path(uuid),
  public.submit_checkin(uuid, date, numeric, uuid, text, boolean),
  public.add_reps(uuid, date, numeric, text),
  public.get_review_queue(uuid),
  public.review_submission(uuid, text, numeric, text, integer),
  public.accept_late_submission(uuid, boolean, text),
  public.override_day(uuid, date, text, numeric, text, integer),
  public.open_dispute(uuid, text),
  public.resolve_dispute(uuid, boolean, text, text, numeric),
  public.acknowledge_decision(uuid)
to authenticated;
