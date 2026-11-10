-- Circle chat, notifications, audit listing, reminders, account deletion,
-- retention helpers and realtime.

-- ---------------------------------------------------------------------------
-- Cursors: "<timestamp>|<uuid>" of the last row of the previous page
-- ---------------------------------------------------------------------------

create or replace function app.cursor_ts(p_cursor text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_cursor is null or p_cursor = '' then
    return null;
  end if;
  return split_part(p_cursor, '|', 1)::timestamptz;
exception when others then
  raise exception 'VALIDATION' using detail = 'Bad paging cursor.';
end
$$;

create or replace function app.cursor_id(p_cursor text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_cursor is null or p_cursor = '' then
    return null;
  end if;
  return split_part(p_cursor, '|', 2)::uuid;
exception when others then
  raise exception 'VALIDATION' using detail = 'Bad paging cursor.';
end
$$;

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------

-- Newest first, paginated. Durable rows are the source of truth; realtime only
-- tells clients when to ask again.
create or replace function public.list_messages(p_circle_id uuid, p_before text default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_ts timestamptz := app.cursor_ts(p_before);
  v_id uuid := app.cursor_id(p_before);
  v_items jsonb;
  v_next text := null;
begin
  if not app.is_circle_member(p_circle_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;

  with page as (
    select m.id, m.created_at
    from public.messages m
    where m.circle_id = p_circle_id
      and m.deleted_at is null
      and (v_ts is null or (m.created_at, m.id) < (v_ts, v_id))
    order by m.created_at desc, m.id desc
    limit v_limit + 1
  ),
  shown as (
    select * from page order by created_at desc, id desc limit v_limit
  )
  select
    coalesce((select jsonb_agg(app.message_json(s.id, v_uid) order by s.created_at desc, s.id desc) from shown s), '[]'::jsonb),
    case
      when (select count(*) from page) > v_limit
        then (select s.created_at::text || '|' || s.id::text from shown s order by s.created_at asc, s.id asc limit 1)
      else null
    end
  into v_items, v_next;

  return jsonb_build_object('items', v_items, 'next_cursor', v_next);
end
$$;

-- Plain text only, up to 2,000 characters. Retries are deduplicated by the
-- client's message id. The author is always the session user and the type is
-- always 'user': members cannot forge system messages.
create or replace function public.send_message(p_circle_id uuid, p_text text, p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_text text := btrim(coalesce(p_text, ''));
  v_id uuid;
  v_name text;
  r record;
begin
  if not app.is_circle_member(p_circle_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if p_client_id is null or char_length(p_client_id) < 8 or char_length(p_client_id) > 100 then
    raise exception 'VALIDATION' using detail = 'Missing message id.';
  end if;
  if char_length(v_text) < 1 then
    raise exception 'VALIDATION' using detail = 'Write a message first.';
  end if;
  if char_length(v_text) > 2000 then
    raise exception 'VALIDATION' using detail = 'Messages can be up to 2,000 characters.';
  end if;

  select m.id into v_id from public.messages m where m.author_id = v_uid and m.client_id = p_client_id;
  if v_id is not null then
    return app.message_json(v_id, v_uid);
  end if;

  if (
    select count(*) from public.messages m
    where m.author_id = v_uid and m.created_at > app.now() - interval '1 minute'
  ) >= 30 then
    raise exception 'RATE_LIMITED';
  end if;

  insert into public.messages (circle_id, author_id, text, type, client_id)
  values (p_circle_id, v_uid, v_text, 'user', p_client_id)
  on conflict (author_id, client_id) do nothing
  returning id into v_id;
  if v_id is null then
    select m.id into v_id from public.messages m where m.author_id = v_uid and m.client_id = p_client_id;
    return app.message_json(v_id, v_uid);
  end if;

  -- Mentions: "@Display Name" of a current member. The notification carries no message text.
  v_name := app.display_name(v_uid);
  for r in
    select m.user_id, pr.display_name
    from public.circle_members m
    join public.profiles pr on pr.id = m.user_id
    where m.circle_id = p_circle_id and m.removed_at is null and m.user_id <> v_uid
      and char_length(btrim(pr.display_name)) > 0
  loop
    if position(lower('@' || r.display_name) in lower(v_text)) > 0 then
      perform app.notify(
        r.user_id, 'mention', p_circle_id,
        jsonb_build_object('circle_id', p_circle_id, 'circle_name', (select name from public.circles where id = p_circle_id), 'actor_name', v_name),
        'mention:' || v_id
      );
    end if;
  end loop;

  return app.message_json(v_id, v_uid);
end
$$;

create or replace function public.toggle_reaction(p_message_id uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_circle uuid;
begin
  select m.circle_id into v_circle from public.messages m where m.id = p_message_id and m.deleted_at is null;
  if v_circle is null or not app.is_circle_member(v_circle, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if p_emoji is null or p_emoji not in ('👏', '🔥', '💪', '🙌', '😂', '❤️') then
    raise exception 'VALIDATION' using detail = 'That reaction isn’t available.';
  end if;

  delete from public.reactions where message_id = p_message_id and user_id = v_uid and emoji = p_emoji;
  if not found then
    insert into public.reactions (message_id, circle_id, user_id, emoji)
    values (p_message_id, v_circle, v_uid, p_emoji)
    on conflict (message_id, user_id, emoji) do nothing;
  end if;
  return app.message_json(p_message_id, v_uid);
end
$$;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

create or replace function public.list_notifications(p_before text default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_ts timestamptz := app.cursor_ts(p_before);
  v_id uuid := app.cursor_id(p_before);
  v_items jsonb;
  v_next text := null;
begin
  with page as (
    select n.id, n.type, n.payload, n.created_at, n.read_at
    from public.notifications n
    where n.recipient_id = v_uid
      and (v_ts is null or (n.created_at, n.id) < (v_ts, v_id))
    order by n.created_at desc, n.id desc
    limit v_limit + 1
  ),
  shown as (
    select * from page order by created_at desc, id desc limit v_limit
  )
  select
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id', s.id, 'type', s.type, 'payload', s.payload, 'created_at', s.created_at, 'read_at', s.read_at)
        order by s.created_at desc, s.id desc
      )
      from shown s
    ), '[]'::jsonb),
    case
      when (select count(*) from page) > v_limit
        then (select s.created_at::text || '|' || s.id::text from shown s order by s.created_at asc, s.id asc limit 1)
      else null
    end
  into v_items, v_next;

  return jsonb_build_object('items', v_items, 'next_cursor', v_next);
end
$$;

-- Recipient-owned records only.
create or replace function public.acknowledge_notification(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
begin
  update public.notifications set read_at = coalesce(read_at, app.now())
  where id = p_notification_id and recipient_id = v_uid;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
end
$$;

create or replace function public.acknowledge_all_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
begin
  update public.notifications set read_at = app.now() where recipient_id = v_uid and read_at is null;
end
$$;

-- ---------------------------------------------------------------------------
-- Change history
-- ---------------------------------------------------------------------------

create or replace function public.list_audit(
  p_challenge_id uuid default null, p_circle_id uuid default null, p_before text default null, p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_ts timestamptz := app.cursor_ts(p_before);
  v_id uuid := app.cursor_id(p_before);
  v_circle uuid := p_circle_id;
  v_items jsonb;
  v_next text := null;
begin
  if p_challenge_id is not null then
    if not app.can_view_challenge(p_challenge_id, v_uid) then
      raise exception 'NOT_FOUND';
    end if;
    select c.circle_id into v_circle from public.challenges c where c.id = p_challenge_id;
  elsif p_circle_id is not null then
    if not app.is_circle_member(p_circle_id, v_uid) then
      raise exception 'NOT_FOUND';
    end if;
  else
    raise exception 'VALIDATION' using detail = 'Choose a Circle or a challenge.';
  end if;

  with page as (
    select a.*
    from public.audit_events a
    where a.circle_id = v_circle
      and (p_challenge_id is null or a.challenge_id = p_challenge_id)
      and (a.challenge_id is null or app.can_view_challenge(a.challenge_id, v_uid))
      and (
        a.visibility = 'members'
        or a.subject_user_id = v_uid
        or (a.challenge_id is not null and app.is_challenge_admin(a.challenge_id, v_uid))
        or (a.challenge_id is null and app.is_circle_admin(a.circle_id, v_uid))
      )
      and (v_ts is null or (a.created_at, a.id) < (v_ts, v_id))
    order by a.created_at desc, a.id desc
    limit v_limit + 1
  ),
  shown as (
    select * from page order by created_at desc, id desc limit v_limit
  )
  select
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'action', s.action,
          'actor', app.person_json(s.actor_id),
          'subject', app.person_json(s.subject_user_id),
          'circle_id', s.circle_id,
          'challenge_id', s.challenge_id,
          'local_date', s.local_date,
          'before', s.before,
          'after', s.after,
          'reason', s.reason,
          'created_at', s.created_at
        )
        order by s.created_at desc, s.id desc
      )
      from shown s
    ), '[]'::jsonb),
    case
      when (select count(*) from page) > v_limit
        then (select s.created_at::text || '|' || s.id::text from shown s order by s.created_at asc, s.id asc limit 1)
      else null
    end
  into v_items, v_next;

  return jsonb_build_object('items', v_items, 'next_cursor', v_next);
end
$$;

-- ---------------------------------------------------------------------------
-- Reminder preferences (scheduling itself is local to the device)
-- ---------------------------------------------------------------------------

create or replace function public.list_reminders()
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
    select jsonb_agg(
      jsonb_build_object('challenge_id', rp.challenge_id, 'enabled', rp.enabled, 'local_time', to_char(rp.local_time, 'HH24:MI'))
      order by rp.challenge_id
    )
    from public.reminder_preferences rp
    where rp.user_id = v_uid
  ), '[]'::jsonb);
end
$$;

create or replace function public.set_reminder(p_challenge_id uuid, p_enabled boolean, p_local_time text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_time time;
begin
  if not app.can_view_challenge(p_challenge_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.participants p where p.challenge_id = p_challenge_id and p.user_id = v_uid and p.removed_at is null
  ) then
    raise exception 'FORBIDDEN' using detail = 'Reminders are for challenges you’re playing in.';
  end if;
  if p_local_time is null or p_local_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'VALIDATION' using detail = 'Choose a reminder time.';
  end if;
  v_time := p_local_time::time;

  insert into public.reminder_preferences (user_id, challenge_id, enabled, local_time, updated_at)
  values (v_uid, p_challenge_id, coalesce(p_enabled, false), v_time, app.now())
  on conflict (user_id, challenge_id) do update
    set enabled = excluded.enabled, local_time = excluded.local_time, updated_at = excluded.updated_at;

  return jsonb_build_object('challenge_id', p_challenge_id, 'enabled', coalesce(p_enabled, false), 'local_time', to_char(v_time, 'HH24:MI'));
end
$$;

-- ---------------------------------------------------------------------------
-- Account deletion
-- ---------------------------------------------------------------------------
--
-- Two steps, because private files live in the storage service:
--   1. begin_account_deletion: checks nothing would be orphaned, flags the
--      profile, and returns the person's evidence object paths. The app then
--      deletes those objects through the storage API (a storage policy allows
--      it only while the flag is set).
--   2. complete_account_deletion: verifies no owned evidence object remains,
--      leaves every Circle, anonymizes what stays in shared history, and
--      deletes the auth user, which revokes every session.
--
-- Retained after deletion, attributed to "Deleted member": scores, standings
-- and audit events. Chat messages written by the account are removed.

create or replace function app.deletion_blockers(p_user uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_blocking text;
begin
  select string_agg(c.name, ', ') into v_blocking
  from public.circle_members m
  join public.circles c on c.id = m.circle_id
  where m.user_id = p_user and m.removed_at is null and m.role = 'owner' and c.archived_at is null
    and exists (
      select 1 from public.circle_members o where o.circle_id = c.id and o.removed_at is null and o.user_id <> p_user
    );
  if v_blocking is not null then
    raise exception 'LAST_OWNER' using detail = format('Transfer ownership first for: %s.', v_blocking);
  end if;

  select string_agg(ch.name, ', ') into v_blocking
  from public.challenge_admins a
  join public.challenges ch on ch.id = a.challenge_id
  where a.user_id = p_user and a.revoked_at is null and ch.status in ('scheduled', 'active', 'review')
    and exists (
      select 1 from public.circle_members o where o.circle_id = ch.circle_id and o.removed_at is null and o.user_id <> p_user
    )
    and not exists (
      select 1 from public.challenge_admins o
      where o.challenge_id = a.challenge_id and o.user_id <> p_user and o.revoked_at is null
        and app.is_circle_member(ch.circle_id, o.user_id)
    );
  if v_blocking is not null then
    raise exception 'LAST_ADMIN' using detail = format('Appoint another admin first for: %s.', v_blocking);
  end if;
end
$$;

create or replace function public.begin_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
begin
  perform app.deletion_blockers(v_uid);
  update public.profiles set deletion_requested_at = app.now(), updated_at = app.now() where id = v_uid;
  return jsonb_build_object(
    'evidence_paths', coalesce((
      select jsonb_agg(o.name order by o.name)
      from storage.objects o
      where o.bucket_id = 'evidence' and o.owner_id = v_uid::text
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.cancel_account_deletion()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
begin
  update public.profiles set deletion_requested_at = null, updated_at = app.now() where id = v_uid;
end
$$;

create or replace function public.complete_account_deletion()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_now timestamptz := app.now();
  r record;
begin
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.deletion_requested_at is not null) then
    raise exception 'VALIDATION' using detail = 'Start account deletion first.';
  end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'evidence' and o.owner_id = v_uid::text) then
    raise exception 'UPLOAD_INCOMPLETE' using detail = 'Your private proof files aren’t fully removed yet. Try again.';
  end if;
  perform app.deletion_blockers(v_uid);

  for r in
    select m.circle_id,
      (select count(*) from public.circle_members o where o.circle_id = m.circle_id and o.removed_at is null and o.user_id <> v_uid) as others
    from public.circle_members m
    join public.circles c on c.id = m.circle_id
    where m.user_id = v_uid and m.removed_at is null and c.archived_at is null
  loop
    if r.others = 0 then
      update public.challenges
      set status = 'canceled', canceled_at = v_now, canceled_by = v_uid, canceled_reason = 'The Circle was closed.', updated_at = v_now
      where circle_id = r.circle_id and status in ('scheduled', 'active', 'review');
      delete from public.challenges where circle_id = r.circle_id and status = 'draft';
      update public.circle_members set removed_at = v_now, removed_by = v_uid, removed_reason = 'Account deleted'
      where circle_id = r.circle_id and user_id = v_uid and removed_at is null;
      update public.circles set archived_at = v_now, updated_at = v_now where id = r.circle_id;
    else
      perform app.detach_member(r.circle_id, v_uid, v_uid, 'Account deleted', true);
      perform app.audit(r.circle_id, null, null, v_uid, 'member.account_deleted', null, null, null, null);
    end if;
  end loop;

  update public.evidence set purged_at = v_now where uploaded_by = v_uid and purged_at is null;
  delete from public.evidence_uploads where user_id = v_uid;
  delete from public.notifications where recipient_id = v_uid;
  delete from public.reminder_preferences where user_id = v_uid;
  update public.messages set text = '—', deleted_at = v_now where author_id = v_uid and deleted_at is null;
  delete from public.reactions where user_id = v_uid;

  -- The tombstone that shared history keeps pointing at.
  update public.profiles
  set display_name = '', avatar_color = 'sand', avatar_face = 0, avatar_path = null, timezone = 'UTC',
      deleted_at = v_now, updated_at = v_now
  where id = v_uid;

  -- Removes credentials and revokes every session and refresh token.
  delete from auth.users where id = v_uid;
end
$$;

-- ---------------------------------------------------------------------------
-- Retention helpers (service role only; see scripts/retention.mjs)
-- ---------------------------------------------------------------------------
--
-- Proposed beta policy: evidence files are deleted 30 days after a challenge
-- is completed or canceled. Nothing here runs by itself: a job has to be
-- scheduled. docs/BUILD_STATUS.md says whether one is configured.

create or replace function public.maintenance_evidence_due(p_retention_days integer default 30)
returns table (evidence_id uuid, object_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.private_object_path
  from public.evidence e
  join public.submissions s on s.id = e.submission_id
  join public.daily_records r on r.id = s.daily_record_id
  join public.participants p on p.id = r.participant_id
  join public.challenges c on c.id = p.challenge_id
  where e.purged_at is null
    and c.status in ('completed', 'canceled')
    and coalesce(c.completed_at, c.canceled_at) < app.now() - make_interval(days => greatest(coalesce(p_retention_days, 30), 0))
    -- Unresolved disputes delay deletion.
    and not exists (select 1 from public.disputes d where d.daily_record_id = r.id and d.status = 'open')
$$;

create or replace function public.maintenance_mark_purged(p_evidence_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.evidence set purged_at = app.now() where id = any (p_evidence_ids) and purged_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Staged uploads that were never attached to a submission.
create or replace function public.maintenance_abandoned_uploads()
returns table (upload_id uuid, object_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.object_path
  from public.evidence_uploads u
  where u.finalized_at is null and u.expires_at < app.now() - interval '1 hour'
$$;

create or replace function public.maintenance_forget_uploads(p_upload_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.evidence_uploads where id = any (p_upload_ids) and finalized_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant execute on function
  public.list_messages(uuid, text, integer),
  public.send_message(uuid, text, text),
  public.toggle_reaction(uuid, text),
  public.list_notifications(text, integer),
  public.acknowledge_notification(uuid),
  public.acknowledge_all_notifications(),
  public.list_audit(uuid, uuid, text, integer),
  public.list_reminders(),
  public.set_reminder(uuid, boolean, text),
  public.begin_account_deletion(),
  public.cancel_account_deletion(),
  public.complete_account_deletion()
to authenticated;

grant execute on function
  public.maintenance_evidence_due(integer),
  public.maintenance_mark_purged(uuid[]),
  public.maintenance_abandoned_uploads(),
  public.maintenance_forget_uploads(uuid[])
to service_role;

-- ---------------------------------------------------------------------------
-- Realtime: an accelerator for chat and the activity badge. RLS still applies
-- to every subscriber, and clients always re-read the durable rows.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
    alter publication supabase_realtime add table public.reactions;
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
