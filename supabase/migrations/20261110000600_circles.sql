-- Profile, Circles, membership and invitations.
--
-- Every function derives the acting person from the session (app.require_user)
-- and checks role/membership itself. None of them accepts "who is acting".

-- ---------------------------------------------------------------------------
-- Profile
-- ---------------------------------------------------------------------------

create or replace function public.get_my_profile()
returns jsonb
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
  return app.profile_json(v_uid);
end
$$;

-- The only fields a person can edit on their own profile.
create or replace function public.save_profile(p_display_name text, p_timezone text, p_avatar_color text, p_avatar_face integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.deleted_at is not null) then
    raise exception 'AUTH_REQUIRED';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'VALIDATION' using detail = 'Choose a display name between 1 and 40 characters.';
  end if;
  if not app.is_valid_timezone(p_timezone) then
    raise exception 'VALIDATION' using detail = 'Choose a valid time zone.';
  end if;
  if p_avatar_color is null or p_avatar_color not in ('sun', 'coral', 'sky', 'mint', 'rose', 'iris', 'peach', 'teal', 'sage', 'sand') then
    raise exception 'VALIDATION' using detail = 'Choose an avatar color.';
  end if;
  if p_avatar_face is null or p_avatar_face < 0 or p_avatar_face > 9 then
    raise exception 'VALIDATION' using detail = 'Choose an avatar face.';
  end if;

  insert into public.profiles (id, auth_user_id, display_name, timezone, avatar_color, avatar_face, onboarded_at)
  values (v_uid, v_uid, v_name, p_timezone, p_avatar_color, p_avatar_face, app.now())
  on conflict (id) do update
    set display_name = excluded.display_name,
        timezone = excluded.timezone,
        avatar_color = excluded.avatar_color,
        avatar_face = excluded.avatar_face,
        onboarded_at = coalesce(public.profiles.onboarded_at, excluded.onboarded_at),
        updated_at = app.now();

  return app.profile_json(v_uid);
end
$$;

-- ---------------------------------------------------------------------------
-- Circles
-- ---------------------------------------------------------------------------

-- Atomically creates the Circle and its owner membership.
create or replace function public.create_circle(p_name text, p_timezone text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'VALIDATION' using detail = 'Give your Circle a name between 2 and 60 characters.';
  end if;
  if not app.is_valid_timezone(p_timezone) then
    raise exception 'VALIDATION' using detail = 'Choose a valid time zone.';
  end if;
  if (
    select count(*)
    from public.circle_members m
    join public.circles c on c.id = m.circle_id
    where m.user_id = v_uid and m.removed_at is null and c.archived_at is null
  ) >= 20 then
    raise exception 'LIMIT_REACHED' using detail = 'You can be in up to 20 Circles.';
  end if;

  insert into public.circles (name, owner_id, timezone) values (v_name, v_uid, p_timezone) returning id into v_id;
  insert into public.circle_members (circle_id, user_id, role) values (v_id, v_uid, 'owner');
  perform app.audit(v_id, null, v_uid, null, 'circle.created', null, null, jsonb_build_object('name', v_name, 'timezone', p_timezone), null);
  return app.circle_summary_json(v_id, v_uid);
end
$$;

create or replace function public.rename_circle(p_circle_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_name text := btrim(coalesce(p_name, ''));
  v_old text;
begin
  if not app.is_circle_admin(p_circle_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'VALIDATION' using detail = 'Give your Circle a name between 2 and 60 characters.';
  end if;
  select c.name into v_old from public.circles c where c.id = p_circle_id for update;
  if v_old is distinct from v_name then
    update public.circles set name = v_name, updated_at = app.now() where id = p_circle_id;
    perform app.audit(p_circle_id, null, v_uid, null, 'circle.renamed', null, jsonb_build_object('name', v_old), jsonb_build_object('name', v_name), null);
  end if;
  return app.circle_summary_json(p_circle_id, v_uid);
end
$$;

create or replace function public.get_circle(p_circle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  r record;
begin
  -- Non-members get the same answer as for a Circle that does not exist.
  if not app.is_circle_member(p_circle_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  for r in select c.id from public.challenges c where c.circle_id = p_circle_id and c.status in ('scheduled', 'active', 'review') loop
    perform app.sync_status(r.id);
  end loop;

  return jsonb_build_object(
    'circle', app.circle_summary_json(p_circle_id, v_uid),
    'members', coalesce((
      select jsonb_agg(
        app.person_json(m.user_id) || jsonb_build_object('role', m.role, 'joined_at', m.joined_at)
        order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.joined_at, m.id
      )
      from public.circle_members m
      where m.circle_id = p_circle_id and m.removed_at is null
    ), '[]'::jsonb),
    'challenges', coalesce((
      select jsonb_agg(
        app.challenge_card_json(c.id, v_uid)
        order by
          case app.effective_status(c.status, c.start_date, c.end_date, c.timezone, app.now())
            when 'active' then 0 when 'review' then 1 when 'scheduled' then 2 when 'draft' then 3 when 'completed' then 4 else 5
          end,
          c.start_date desc,
          c.id
      )
      from public.challenges c
      where c.circle_id = p_circle_id and app.can_view_challenge(c.id, v_uid)
    ), '[]'::jsonb),
    'server_now', app.now()
  );
end
$$;

-- Only the owner changes roles. Nobody can promote themselves.
create or replace function public.set_member_role(p_circle_id uuid, p_user_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_old text;
begin
  if app.circle_role(p_circle_id, v_uid) is distinct from 'owner' then
    raise exception 'FORBIDDEN';
  end if;
  if p_role is null or p_role not in ('admin', 'member') then
    raise exception 'VALIDATION' using detail = 'Choose admin or member.';
  end if;
  if p_user_id = v_uid then
    raise exception 'VALIDATION' using detail = 'Transfer ownership to change your own role.';
  end if;

  select m.role into v_old
  from public.circle_members m
  where m.circle_id = p_circle_id and m.user_id = p_user_id and m.removed_at is null
  for update;
  if v_old is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_old <> p_role then
    update public.circle_members set role = p_role where circle_id = p_circle_id and user_id = p_user_id;
    perform app.audit(p_circle_id, null, v_uid, p_user_id, 'member.role_changed', null, jsonb_build_object('role', v_old), jsonb_build_object('role', p_role), null);
    perform app.notify(
      p_user_id, 'role_changed', p_circle_id,
      jsonb_build_object('circle_id', p_circle_id, 'circle_name', (select name from public.circles where id = p_circle_id), 'role', p_role),
      'role_changed:' || p_circle_id || ':' || p_role || ':' || extract(epoch from app.now())::bigint
    );
  end if;
  return public.get_circle(p_circle_id);
end
$$;

create or replace function public.transfer_ownership(p_circle_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
begin
  if app.circle_role(p_circle_id, v_uid) is distinct from 'owner' then
    raise exception 'FORBIDDEN';
  end if;
  if p_user_id = v_uid then
    raise exception 'VALIDATION' using detail = 'You already own this Circle.';
  end if;
  perform 1 from public.circles c where c.id = p_circle_id for update;
  if not exists (
    select 1 from public.circle_members m where m.circle_id = p_circle_id and m.user_id = p_user_id and m.removed_at is null
  ) then
    raise exception 'NOT_FOUND';
  end if;

  -- Demote first: the one-owner index allows a single active owner.
  update public.circle_members set role = 'admin' where circle_id = p_circle_id and user_id = v_uid;
  update public.circle_members set role = 'owner' where circle_id = p_circle_id and user_id = p_user_id;
  update public.circles set owner_id = p_user_id, updated_at = app.now() where id = p_circle_id;

  perform app.audit(p_circle_id, null, v_uid, p_user_id, 'circle.ownership_transferred', null, jsonb_build_object('owner_id', v_uid), jsonb_build_object('owner_id', p_user_id), null);
  perform app.notify(
    p_user_id, 'ownership_received', p_circle_id,
    jsonb_build_object('circle_id', p_circle_id, 'circle_name', (select name from public.circles where id = p_circle_id), 'actor_name', app.display_name(v_uid)),
    'ownership_received:' || p_circle_id || ':' || extract(epoch from app.now())::bigint
  );
  return public.get_circle(p_circle_id);
end
$$;

-- Shared by remove_member and leave_circle. Removes a person from the Circle
-- and from its ongoing challenges while keeping every historical record.
create or replace function app.detach_member(p_circle uuid, p_user uuid, p_actor uuid, p_reason text, p_left boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.now();
  v_blocking text;
  r record;
begin
  -- At least one active challenge admin must remain on every ongoing challenge.
  select string_agg(c.name, ', ') into v_blocking
  from public.challenge_admins a
  join public.challenges c on c.id = a.challenge_id
  where c.circle_id = p_circle
    and a.user_id = p_user
    and a.revoked_at is null
    and c.status in ('scheduled', 'active', 'review')
    and not exists (
      select 1
      from public.challenge_admins o
      where o.challenge_id = a.challenge_id
        and o.user_id <> p_user
        and o.revoked_at is null
        and app.is_circle_member(c.circle_id, o.user_id)
    );
  if v_blocking is not null then
    raise exception 'LAST_ADMIN' using detail = format('Appoint another admin first for: %s.', v_blocking);
  end if;

  -- Private drafts nobody else can see go with them.
  delete from public.challenges c
  where c.circle_id = p_circle
    and c.status = 'draft'
    and exists (select 1 from public.challenge_admins a where a.challenge_id = c.id and a.user_id = p_user and a.revoked_at is null)
    and not exists (select 1 from public.challenge_admins o where o.challenge_id = c.id and o.user_id <> p_user and o.revoked_at is null);

  update public.challenge_admins a
  set revoked_at = v_now, revoked_by = p_actor
  from public.challenges c
  where c.id = a.challenge_id and c.circle_id = p_circle and a.user_id = p_user and a.revoked_at is null
    and c.status in ('draft', 'scheduled', 'active', 'review');

  update public.participants p
  set removed_at = v_now, removed_by = p_actor,
      removed_reason = case when p_left then 'Left the Circle' else 'Removed from the Circle' end
  from public.challenges c
  where c.id = p.challenge_id and c.circle_id = p_circle and p.user_id = p_user and p.removed_at is null
    and c.status in ('scheduled', 'active', 'review');

  update public.circle_members
  set removed_at = v_now, removed_by = p_actor, removed_reason = p_reason
  where circle_id = p_circle and user_id = p_user and removed_at is null;

  -- A pending rule change may now have every remaining participant's acceptance.
  for r in
    select v.id from public.rule_versions v
    join public.challenges c on c.id = v.challenge_id
    where c.circle_id = p_circle and v.status = 'proposed'
  loop
    perform app.maybe_activate_proposal(r.id);
  end loop;
end
$$;

-- Owners can remove anyone else; admins can remove members. Always with a reason.
create or replace function public.remove_member(p_circle_id uuid, p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_actor_role text := app.circle_role(p_circle_id, v_uid);
  v_target_role text;
  v_reason text;
begin
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception 'FORBIDDEN';
  end if;
  if p_user_id = v_uid then
    raise exception 'VALIDATION' using detail = 'Use “Leave Circle” to remove yourself.';
  end if;
  v_reason := app.require_reason(p_reason);
  perform 1 from public.circles c where c.id = p_circle_id for update;

  v_target_role := app.circle_role(p_circle_id, p_user_id);
  if v_target_role is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_target_role = 'owner' or (v_target_role = 'admin' and v_actor_role <> 'owner') then
    raise exception 'FORBIDDEN';
  end if;

  perform app.detach_member(p_circle_id, p_user_id, v_uid, v_reason, false);
  perform app.audit(p_circle_id, null, v_uid, p_user_id, 'member.removed', null, jsonb_build_object('role', v_target_role), null, v_reason);
  perform app.notify(
    p_user_id, 'removed_from_circle', p_circle_id,
    jsonb_build_object('circle_name', (select name from public.circles where id = p_circle_id), 'reason', v_reason),
    'removed_from_circle:' || p_circle_id || ':' || extract(epoch from app.now())::bigint
  );
  return public.get_circle(p_circle_id);
end
$$;

-- The last owner cannot walk away from other members: ownership has to be
-- transferred first. A sole member leaving archives the Circle.
create or replace function public.leave_circle(p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_role text;
  v_others integer;
begin
  perform 1 from public.circles c where c.id = p_circle_id for update;
  v_role := app.circle_role(p_circle_id, v_uid);
  if v_role is null then
    raise exception 'NOT_FOUND';
  end if;
  select count(*) into v_others
  from public.circle_members m
  where m.circle_id = p_circle_id and m.removed_at is null and m.user_id <> v_uid;

  if v_role = 'owner' and v_others > 0 then
    raise exception 'LAST_OWNER';
  end if;

  if v_others = 0 then
    -- Nobody is left to administer anything: close the Circle's open challenges.
    update public.challenges
    set status = 'canceled', canceled_at = app.now(), canceled_by = v_uid, canceled_reason = 'The Circle was closed.', updated_at = app.now()
    where circle_id = p_circle_id and status in ('scheduled', 'active', 'review');
    delete from public.challenges where circle_id = p_circle_id and status = 'draft';
    update public.circle_members set removed_at = app.now(), removed_by = v_uid, removed_reason = 'Left the Circle'
    where circle_id = p_circle_id and user_id = v_uid and removed_at is null;
    update public.circles set archived_at = app.now(), updated_at = app.now() where id = p_circle_id;
    perform app.audit(p_circle_id, null, v_uid, v_uid, 'circle.archived', null, null, null, 'The last member left.');
    return;
  end if;

  perform app.detach_member(p_circle_id, v_uid, v_uid, 'Left the Circle', true);
  perform app.audit(p_circle_id, null, v_uid, v_uid, 'member.left', null, jsonb_build_object('role', v_role), null, null);
  perform app.system_message(
    p_circle_id,
    app.display_name(v_uid) || ' left the Circle.',
    jsonb_build_object('type', 'member_left', 'user_id', v_uid, 'name', app.display_name(v_uid))
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

-- 12 characters from a 32-symbol alphabet (60 bits). Crockford base32: no I, L, O, U.
create or replace function app.new_invite_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bytes bytea := extensions.gen_random_bytes(12);
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_out text := '';
begin
  for i in 0..11 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) & 31) + 1, 1);
  end loop;
  return v_out;
end
$$;

-- Same normalization as src/domain/invites.ts: uppercase, drop separators, O->0, I/L->1.
create or replace function app.normalize_invite_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(regexp_replace(upper(coalesce(p_code, '')), '[^0-9A-Z]', '', 'g'), 'OIL', '011')
$$;

create or replace function app.hash_invite_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(app.normalize_invite_code(p_code), 'UTF8')), 'hex')
$$;

create or replace function app.request_origin()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers text := current_setting('request.headers', true);
begin
  if v_headers is null or v_headers = '' then
    return 'unknown';
  end if;
  return coalesce(nullif(btrim(split_part(coalesce(v_headers::json ->> 'x-forwarded-for', ''), ',', 1)), ''), 'unknown');
exception when others then
  return 'unknown';
end
$$;

-- Guess limiting: failed lookups in the last 15 minutes (real time, not the test clock).
create or replace function app.invite_rate_limited(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user is not null then (
      select count(*) from app.invite_attempts a
      where a.user_id = p_user and a.attempted_at > pg_catalog.now() - interval '15 minutes'
    ) >= 10
    else (
      select count(*) from app.invite_attempts a
      where a.user_id is null and a.origin = app.request_origin() and a.attempted_at > pg_catalog.now() - interval '15 minutes'
    ) >= 30
  end
$$;

-- Returns the code exactly once. Only its hash is stored.
create or replace function public.create_invite(
  p_circle_id uuid, p_challenge_id uuid default null, p_expires_in_days integer default 7, p_max_uses integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  v_code text;
  v_id uuid;
  v_days integer := coalesce(p_expires_in_days, 7);
  v_uses integer := coalesce(p_max_uses, 25);
begin
  if not app.is_circle_admin(p_circle_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  if v_days < 1 or v_days > 30 then
    raise exception 'VALIDATION' using detail = 'Invites can last between 1 and 30 days.';
  end if;
  if v_uses < 1 or v_uses > 50 then
    raise exception 'VALIDATION' using detail = 'An invite can be used between 1 and 50 times.';
  end if;
  if p_challenge_id is not null and not exists (
    select 1 from public.challenges c
    where c.id = p_challenge_id and c.circle_id = p_circle_id
      and app.effective_status(c.status, c.start_date, c.end_date, c.timezone, app.now()) = 'scheduled'
  ) then
    raise exception 'VALIDATION' using detail = 'That challenge isn’t open for joining.';
  end if;
  if (
    select count(*) from public.invitations i
    where i.circle_id = p_circle_id and i.revoked_at is null and i.expires_at > app.now() and i.use_count < i.max_uses
  ) >= 20 then
    raise exception 'LIMIT_REACHED' using detail = 'Revoke an old invite before creating another.';
  end if;

  v_code := app.new_invite_code();
  insert into public.invitations (circle_id, challenge_id, token_hash, expires_at, max_uses, created_by)
  values (p_circle_id, p_challenge_id, app.hash_invite_code(v_code), app.now() + make_interval(days => v_days), v_uses, v_uid)
  returning id into v_id;

  perform app.audit(p_circle_id, p_challenge_id, v_uid, null, 'invite.created', null, null, jsonb_build_object('max_uses', v_uses, 'expires_in_days', v_days), null, 'restricted');
  return jsonb_build_object('invite', app.invite_json(v_id), 'code', v_code);
end
$$;

create or replace function public.list_invites(p_circle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
begin
  if not app.is_circle_admin(p_circle_id, v_uid) then
    raise exception 'FORBIDDEN';
  end if;
  return coalesce((
    select jsonb_agg(app.invite_json(x.id) order by x.created_at desc, x.id)
    from (
      select i.id, i.created_at from public.invitations i
      where i.circle_id = p_circle_id
      order by i.created_at desc
      limit 50
    ) x
  ), '[]'::jsonb);
end
$$;

create or replace function public.revoke_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  i public.invitations%rowtype;
begin
  select * into i from public.invitations where id = p_invite_id for update;
  if not found or not app.is_circle_admin(i.circle_id, v_uid) then
    raise exception 'NOT_FOUND';
  end if;
  if i.revoked_at is null then
    update public.invitations set revoked_at = app.now() where id = p_invite_id;
    perform app.audit(i.circle_id, i.challenge_id, v_uid, null, 'invite.revoked', null, null, null, null, 'restricted');
  end if;
end
$$;

-- Limited summary for someone holding a code. Callable signed out, so an invite
-- can be previewed before an account exists. Answers are deliberately coarse:
-- 'invalid' covers unknown, revoked and used-up codes alike.
--
-- Returns a status instead of raising so that the failed attempt is recorded
-- (an exception would roll the attempt log back).
create or replace function public.preview_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  i public.invitations%rowtype;
  v_member boolean;
  v_challenge jsonb := null;
begin
  if app.invite_rate_limited(v_uid) then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  select * into i from public.invitations where token_hash = app.hash_invite_code(p_code);
  if not found
     or i.revoked_at is not null
     or exists (select 1 from public.circles c where c.id = i.circle_id and c.archived_at is not null)
  then
    insert into app.invite_attempts (user_id, origin) values (v_uid, app.request_origin());
    return jsonb_build_object('status', 'invalid');
  end if;

  v_member := v_uid is not null and app.is_circle_member(i.circle_id, v_uid);
  if not v_member then
    if i.expires_at <= app.now() then
      return jsonb_build_object('status', 'expired');
    end if;
    if i.use_count >= i.max_uses then
      insert into app.invite_attempts (user_id, origin) values (v_uid, app.request_origin());
      return jsonb_build_object('status', 'invalid');
    end if;
  end if;

  if i.challenge_id is not null then
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'habit_type', c.habit_type,
      'metric_unit', c.metric_unit,
      'target', v.target,
      'comparator', v.comparator,
      'start_date', c.start_date,
      'end_date', c.end_date
    )
    into v_challenge
    from public.challenges c
    join public.rule_versions v on v.id = c.current_rule_version_id
    where c.id = i.challenge_id
      and app.effective_status(c.status, c.start_date, c.end_date, c.timezone, app.now()) = 'scheduled';
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'preview', jsonb_build_object(
      'circle_id', i.circle_id,
      'circle_name', (select c.name from public.circles c where c.id = i.circle_id),
      'member_count', (select count(*) from public.circle_members m where m.circle_id = i.circle_id and m.removed_at is null),
      'inviter_name', app.display_name(i.created_by),
      'expires_at', i.expires_at,
      'already_member', v_member,
      'challenge', v_challenge
    )
  );
end
$$;

-- Authenticated and atomic: the membership insert, the redemption record and
-- the use count commit together under a lock on the invitation. Someone who is
-- already a member never consumes another use.
create or replace function public.redeem_invite(p_code text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_user();
  i public.invitations%rowtype;
  v_now timestamptz := app.now();
  v_count integer;
  v_challenge uuid := null;
  v_name text;
  r record;
begin
  if app.invite_rate_limited(v_uid) then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  select * into i from public.invitations where token_hash = app.hash_invite_code(p_code) for update;
  if not found
     or i.revoked_at is not null
     or exists (select 1 from public.circles c where c.id = i.circle_id and c.archived_at is not null)
  then
    insert into app.invite_attempts (user_id, origin) values (v_uid, app.request_origin());
    return jsonb_build_object('status', 'invalid');
  end if;

  if i.challenge_id is not null and exists (
    select 1 from public.challenges c
    where c.id = i.challenge_id
      and app.effective_status(c.status, c.start_date, c.end_date, c.timezone, v_now) = 'scheduled'
  ) then
    v_challenge := i.challenge_id;
  end if;

  if app.is_circle_member(i.circle_id, v_uid) then
    return jsonb_build_object(
      'status', 'ok',
      'result', jsonb_build_object('circle_id', i.circle_id, 'challenge_id', v_challenge, 'already_member', true)
    );
  end if;
  if i.expires_at <= v_now then
    return jsonb_build_object('status', 'expired');
  end if;
  if i.use_count >= i.max_uses then
    insert into app.invite_attempts (user_id, origin) values (v_uid, app.request_origin());
    return jsonb_build_object('status', 'invalid');
  end if;

  select count(*) into v_count from public.circle_members m where m.circle_id = i.circle_id and m.removed_at is null;
  if v_count >= 50 then
    raise exception 'LIMIT_REACHED' using detail = 'This Circle is full (50 members).';
  end if;

  insert into public.circle_members (circle_id, user_id, role)
  values (i.circle_id, v_uid, 'member')
  on conflict (circle_id, user_id) do update
    set role = 'member', joined_at = v_now, removed_at = null, removed_by = null, removed_reason = null;

  insert into public.invitation_redemptions (invitation_id, user_id, idempotency_key)
  values (i.id, v_uid, coalesce(p_idempotency_key, ''))
  on conflict (invitation_id, user_id) do update set idempotency_key = excluded.idempotency_key, redeemed_at = v_now;

  update public.invitations set use_count = use_count + 1 where id = i.id;

  v_name := app.display_name(v_uid);
  perform app.audit(i.circle_id, null, v_uid, v_uid, 'member.joined', null, null, jsonb_build_object('role', 'member'), null);
  perform app.system_message(i.circle_id, v_name || ' joined the Circle.', jsonb_build_object('type', 'member_joined', 'user_id', v_uid, 'name', v_name));
  for r in
    select m.user_id from public.circle_members m
    where m.circle_id = i.circle_id and m.removed_at is null and m.role in ('owner', 'admin') and m.user_id <> v_uid
  loop
    perform app.notify(
      r.user_id, 'member_joined', i.circle_id,
      jsonb_build_object('circle_id', i.circle_id, 'circle_name', (select name from public.circles where id = i.circle_id), 'actor_name', v_name),
      'member_joined:' || i.circle_id || ':' || v_uid || ':' || extract(epoch from v_now)::bigint
    );
  end loop;
  -- Open challenges are an invitation, never an automatic enrollment.
  for r in
    select c.id from public.challenges c
    where c.circle_id = i.circle_id
      and app.effective_status(c.status, c.start_date, c.end_date, c.timezone, v_now) = 'scheduled'
  loop
    perform app.notify(v_uid, 'challenge_invite', r.id, app.challenge_payload(r.id), 'challenge_invite:' || r.id);
  end loop;

  return jsonb_build_object(
    'status', 'ok',
    'result', jsonb_build_object('circle_id', i.circle_id, 'challenge_id', v_challenge, 'already_member', false)
  );
end
$$;

grant execute on function
  public.get_my_profile(),
  public.save_profile(text, text, text, integer),
  public.create_circle(text, text),
  public.rename_circle(uuid, text),
  public.get_circle(uuid),
  public.set_member_role(uuid, uuid, text),
  public.transfer_ownership(uuid, uuid),
  public.remove_member(uuid, uuid, text),
  public.leave_circle(uuid),
  public.create_invite(uuid, uuid, integer, integer),
  public.list_invites(uuid),
  public.revoke_invite(uuid),
  public.redeem_invite(text, text)
to authenticated;

-- The one function a signed-out visitor may call.
grant execute on function public.preview_invite(text) to anon, authenticated;
