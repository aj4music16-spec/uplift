-- Uplift schema.
--
-- Conventions
--   * UUID primary keys, foreign keys everywhere, checked enums (text + CHECK).
--   * Timestamps are UTC (timestamptz). Challenge days are `date` values in the
--     challenge's own immutable IANA time zone.
--   * Clients never write to these tables directly. Every mutation goes through
--     a SECURITY DEFINER function (later migrations) that derives identity from
--     the session. RLS (migration 300) only ever grants SELECT.
--   * `app` is a private schema: helpers, server flags and the test clock. It is
--     not exposed through the HTTP API.

create schema if not exists app;

-- Lock down defaults before creating anything: nothing in `public` or `app` is
-- callable or writable by API roles unless a later statement grants it.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema app revoke execute on functions from public, anon, authenticated;
alter default privileges in schema app revoke all on tables from public, anon, authenticated;
revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Server-side configuration and the controllable clock
-- ---------------------------------------------------------------------------

-- Flags that only a database administrator can change. A client flag is never
-- enough to turn anything on.
--   demo_rewards_enabled   'true' allows DEMO reward previews. There is no live money mode at all.
--   clock_override_enabled 'true' lets app.clock shift app.now(). Local development and tests only.
create table app.config (
  key text primary key,
  value text not null
);
insert into app.config (key, value) values
  ('demo_rewards_enabled', 'false'),
  ('clock_override_enabled', 'false');

create table app.clock (
  id boolean primary key default true check (id),
  offset_seconds bigint not null default 0
);
insert into app.clock (id, offset_seconds) values (true, 0);

alter table app.config enable row level security;
alter table app.clock enable row level security;

-- The server's idea of "now". Identical to now() unless the override flag is on.
create or replace function app.now()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from app.config where key = 'clock_override_enabled' and value = 'true')
      then pg_catalog.now() + pg_catalog.make_interval(secs => coalesce((select offset_seconds from app.clock), 0)::double precision)
    else pg_catalog.now()
  end
$$;
grant execute on function app.now() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- `id` always equals the auth user id. The foreign key lives on a separate
-- nullable column so that deleting the account (auth.users row) leaves an
-- anonymized tombstone that shared history (audit, chat, standings) can still
-- reference.
create table public.profiles (
  id uuid primary key,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  display_name text not null default '' check (char_length(display_name) <= 40),
  avatar_color text not null default 'sun'
    check (avatar_color in ('sun', 'coral', 'sky', 'mint', 'rose', 'iris', 'peach', 'teal', 'sage', 'sand')),
  avatar_face smallint not null default 0 check (avatar_face between 0 and 9),
  avatar_path text, -- reserved for photo avatars (deferred)
  timezone text not null default 'UTC',
  onboarded_at timestamptz,
  deletion_requested_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default app.now(),
  updated_at timestamptz not null default app.now(),
  constraint profiles_auth_user_matches check (auth_user_id is null or auth_user_id = id)
);

-- ---------------------------------------------------------------------------
-- Circles
-- ---------------------------------------------------------------------------

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  owner_id uuid not null references public.profiles (id),
  timezone text not null,
  archived_at timestamptz,
  created_at timestamptz not null default app.now(),
  updated_at timestamptz not null default app.now()
);

create table public.circle_members (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  role text not null check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default app.now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  removed_reason text,
  unique (circle_id, user_id)
);
create index circle_members_user_active on public.circle_members (user_id) where removed_at is null;
create index circle_members_circle_active on public.circle_members (circle_id) where removed_at is null;
-- Exactly one active owner per Circle.
create unique index circle_members_one_owner on public.circle_members (circle_id) where role = 'owner' and removed_at is null;

-- ---------------------------------------------------------------------------
-- Challenges and versioned rules
-- ---------------------------------------------------------------------------

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  creator_id uuid not null references public.profiles (id),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  description text not null default '' check (char_length(description) <= 280),
  habit_type text not null check (habit_type in ('screen_time', 'reading', 'prayer', 'pushups', 'custom')),
  metric_unit text not null check (char_length(btrim(metric_unit)) between 1 and 20),
  timezone text not null,
  start_date date not null,
  end_date date not null,
  -- scheduled -> active -> review follow the clock and are persisted lazily by
  -- app.sync_status; always read app.effective_status(). completed is only
  -- reached through public.finalize_challenge.
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'active', 'review', 'completed', 'canceled')),
  current_rule_version_id uuid,
  revision integer not null default 1,
  -- There is deliberately no live money value. Only demo previews exist.
  reward_mode text not null default 'none' check (reward_mode in ('none', 'demo_sponsor', 'demo_pot')),
  draft_step smallint not null default 1 check (draft_step between 1 and 5),
  rematch_of_id uuid references public.challenges (id) on delete set null,
  published_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  canceled_by uuid references public.profiles (id),
  canceled_reason text,
  finalize_reminder_sent_at timestamptz,
  created_at timestamptz not null default app.now(),
  updated_at timestamptz not null default app.now(),
  constraint challenges_dates check (end_date >= start_date and end_date - start_date < 30)
);
create index challenges_circle on public.challenges (circle_id, status);

create table public.challenge_admins (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  assigned_by uuid not null references public.profiles (id),
  assigned_at timestamptz not null default app.now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  unique (challenge_id, user_id)
);
create index challenge_admins_user_active on public.challenge_admins (user_id) where revoked_at is null;

create table public.rule_versions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  version integer not null check (version >= 1),
  target numeric(12, 2) not null check (target > 0),
  comparator text not null check (comparator in ('lte', 'gte', 'bool')),
  required_days integer not null check (required_days >= 1),
  verification text not null check (verification in ('evidence', 'self_report')),
  start_date date not null,
  end_date date not null,
  -- First challenge date this version governs.
  effective_date date not null,
  status text not null check (status in ('draft', 'active', 'superseded', 'proposed', 'declined', 'withdrawn')),
  reason text,
  proposed_by uuid references public.profiles (id),
  created_at timestamptz not null default app.now(),
  decided_at timestamptz,
  activated_at timestamptz,
  unique (challenge_id, version),
  constraint rule_versions_dates check (end_date >= start_date and end_date - start_date < 30),
  constraint rule_versions_required check (required_days <= end_date - start_date + 1),
  constraint rule_versions_bool_target check (comparator <> 'bool' or target = 1)
);
create unique index rule_versions_one_active on public.rule_versions (challenge_id) where status = 'active';
create unique index rule_versions_one_proposed on public.rule_versions (challenge_id) where status = 'proposed';

alter table public.challenges
  add constraint challenges_current_rule_fk foreign key (current_rule_version_id)
  references public.rule_versions (id) deferrable initially deferred;

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  joined_at timestamptz not null default app.now(),
  accepted_version_id uuid not null references public.rule_versions (id),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  removed_reason text,
  -- Defeats concurrent duplicate joins.
  unique (challenge_id, user_id)
);
create index participants_user on public.participants (user_id);

create table public.rule_acceptances (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.rule_versions (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  decision text not null check (decision in ('accepted', 'declined')),
  decided_at timestamptz not null default app.now(),
  unique (version_id, participant_id)
);

-- ---------------------------------------------------------------------------
-- Daily records, submissions, evidence, moderation
-- ---------------------------------------------------------------------------

-- One record per participant and challenge date. Linked to the participant row
-- so a record can never be attached to an arbitrary user/challenge pair.
create table public.daily_records (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants (id) on delete cascade,
  local_date date not null,
  -- The rule version that governs this date (historical days keep theirs).
  rule_version_id uuid not null references public.rule_versions (id),
  effective_value numeric(12, 2) check (effective_value is null or effective_value >= 0),
  -- open: nothing final yet. pending / late_pending add no score.
  outcome text not null default 'open' check (outcome in ('open', 'pending', 'late_pending', 'success', 'fail', 'rejected')),
  provenance text check (provenance in ('self_reported', 'evidence_reviewed', 'admin_self_reviewed', 'admin_adjusted')),
  revision integer not null default 1,
  -- Last admin decision (review or override): starts the 24h dispute window.
  decided_at timestamptz,
  -- The participant waived the rest of the window for that decision.
  acknowledged_at timestamptz,
  success_announced boolean not null default false,
  created_at timestamptz not null default app.now(),
  updated_at timestamptz not null default app.now(),
  unique (participant_id, local_date),
  constraint daily_records_counted_has_provenance check (outcome not in ('success', 'fail') or provenance is not null)
);
create index daily_records_outcome on public.daily_records (participant_id, outcome);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  daily_record_id uuid not null references public.daily_records (id) on delete cascade,
  version integer not null check (version >= 1),
  entered_value numeric(12, 2) not null check (entered_value >= 0),
  submitted_at timestamptz not null default app.now(),
  -- late: sent after the deadline, waiting for an admin to accept or decline it.
  status text not null check (status in ('pending', 'late', 'accepted', 'rejected', 'declined', 'superseded')),
  supersedes_id uuid references public.submissions (id),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  is_late boolean not null default false,
  -- Record outcome before this submission, restored if a late request is declined.
  prior_outcome text,
  unique (daily_record_id, version),
  unique (daily_record_id, idempotency_key)
);
create index submissions_status on public.submissions (status) where status in ('pending', 'late');

-- Idempotent increment ledger (reps). The daily total is the sum of amounts.
create table public.activity_increments (
  id uuid primary key default gen_random_uuid(),
  daily_record_id uuid not null references public.daily_records (id) on delete cascade,
  actor_id uuid not null references public.profiles (id),
  amount numeric(12, 2) not null check (amount <> 0),
  kind text not null default 'add' check (kind in ('add', 'correction')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default app.now(),
  -- A retried request can never add reps twice.
  unique (actor_id, idempotency_key)
);
create index activity_increments_record on public.activity_increments (daily_record_id);

-- Staged uploads: a destination is issued first, the object is uploaded, and
-- only then is the submission finalized. Rows that are never finalized are
-- abandoned uploads and get cleaned up.
create table public.evidence_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  local_date date not null,
  object_path text not null unique,
  mime text not null check (mime in ('image/jpeg', 'image/png')),
  byte_size integer not null check (byte_size between 1 and 10485760),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default app.now(),
  expires_at timestamptz not null,
  finalized_at timestamptz
);
create index evidence_uploads_user on public.evidence_uploads (user_id, created_at);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete cascade,
  private_object_path text not null unique,
  mime text not null check (mime in ('image/jpeg', 'image/png')),
  byte_size integer not null check (byte_size between 1 and 10485760),
  -- Client-computed hash and the storage service's own content tag. Equal
  -- values only flag a repeat for a human; they never prove anything.
  sha256 text,
  etag text,
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default app.now(),
  -- Set when the retention policy has removed the file.
  purged_at timestamptz
);
create index evidence_sha on public.evidence (sha256) where sha256 is not null;
create index evidence_etag on public.evidence (etag) where etag is not null;

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id),
  decision text not null check (decision in ('approved', 'rejected', 'late_accepted', 'late_declined')),
  corrected_value numeric(12, 2) check (corrected_value is null or corrected_value >= 0),
  reason text,
  -- The admin reviewed their own evidence. Never presented as independent review.
  self_review boolean not null default false,
  reviewed_at timestamptz not null default app.now()
);
create index reviews_submission on public.reviews (submission_id);

create table public.overrides (
  id uuid primary key default gen_random_uuid(),
  daily_record_id uuid not null references public.daily_records (id) on delete cascade,
  actor_id uuid not null references public.profiles (id),
  prior_outcome text,
  prior_value numeric(12, 2),
  new_outcome text not null check (new_outcome in ('success', 'fail')),
  new_value numeric(12, 2),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  created_at timestamptz not null default app.now()
);
create index overrides_record on public.overrides (daily_record_id);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  daily_record_id uuid not null references public.daily_records (id) on delete cascade,
  raised_by uuid not null references public.profiles (id),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  status text not null default 'open' check (status in ('open', 'upheld', 'denied')),
  resolver_id uuid references public.profiles (id),
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz not null default app.now()
);
create unique index disputes_one_open on public.disputes (daily_record_id) where status = 'open';

-- ---------------------------------------------------------------------------
-- Audit, social, notifications
-- ---------------------------------------------------------------------------

-- Append-only. Written only by server functions, in the same transaction as
-- the change they describe. `before`/`after` hold safe summaries: never
-- evidence, never private message text.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  challenge_id uuid references public.challenges (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  subject_user_id uuid references public.profiles (id),
  action text not null,
  local_date date,
  before jsonb,
  after jsonb,
  reason text,
  -- members: visible to the Circle. restricted: the affected person and admins only
  -- (for example a rejection reason).
  visibility text not null default 'members' check (visibility in ('members', 'restricted')),
  source_submission_id uuid,
  created_at timestamptz not null default app.now()
);
create index audit_events_challenge on public.audit_events (challenge_id, created_at desc);
create index audit_events_circle on public.audit_events (circle_id, created_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  author_id uuid references public.profiles (id),
  text text not null check (char_length(text) between 1 and 2000),
  type text not null check (type in ('user', 'system')),
  event jsonb,
  event_id uuid references public.audit_events (id) on delete set null,
  client_id text check (client_id is null or char_length(client_id) between 8 and 100),
  created_at timestamptz not null default app.now(),
  deleted_at timestamptz,
  -- System messages have no author; members cannot impersonate them.
  constraint messages_author_matches_type check ((type = 'user' and author_id is not null) or (type = 'system' and author_id is null)),
  -- Retried sends are deduplicated by the client's message id.
  unique (author_id, client_id)
);
create index messages_circle_time on public.messages (circle_id, created_at desc, id desc);

create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  emoji text not null check (emoji in ('👏', '🔥', '💪', '🙌', '😂', '❤️')),
  created_at timestamptz not null default app.now(),
  unique (message_id, user_id, emoji)
);
create index reactions_message on public.reactions (message_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  entity_id uuid,
  -- Safe context for rendering (names, ids, dates). Never proof.
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamptz not null default app.now(),
  read_at timestamptz,
  unique (recipient_id, dedupe_key)
);
create index notifications_recipient on public.notifications (recipient_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Demo reward previews and reminders
-- ---------------------------------------------------------------------------

-- Illustration only. `demo_only` can never be false: there is no row shape
-- that represents collected or payable money.
create table public.reward_previews (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique references public.challenges (id) on delete cascade,
  demo_only boolean not null default true check (demo_only),
  mode text not null check (mode in ('demo_sponsor', 'demo_pot')),
  gross_cents integer not null check (gross_cents between 1 and 100000000),
  fee_bps integer not null check (fee_bps between 0 and 2000),
  currency text not null default 'USD' check (currency = 'USD'),
  sponsor_id uuid references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default app.now()
);

create table public.reminder_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  enabled boolean not null default false,
  local_time time not null default '09:00',
  updated_at timestamptz not null default app.now(),
  unique (user_id, challenge_id)
);

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete cascade,
  challenge_id uuid references public.challenges (id) on delete set null,
  -- SHA-256 of the code. The code itself is returned once and never stored.
  token_hash text not null unique,
  expires_at timestamptz not null,
  max_uses integer not null check (max_uses between 1 and 50),
  use_count integer not null default 0,
  revoked_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default app.now(),
  constraint invitations_uses check (use_count >= 0 and use_count <= max_uses)
);
create index invitations_circle on public.invitations (circle_id, created_at desc);

create table public.invitation_redemptions (
  invitation_id uuid not null references public.invitations (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  idempotency_key text not null,
  redeemed_at timestamptz not null default app.now(),
  primary key (invitation_id, user_id)
);

-- Failed lookups, for rate limiting guesses. Private.
create table app.invite_attempts (
  id bigint generated always as identity primary key,
  user_id uuid,
  origin text,
  attempted_at timestamptz not null default pg_catalog.now()
);
create index invite_attempts_user on app.invite_attempts (user_id, attempted_at);
create index invite_attempts_origin on app.invite_attempts (origin, attempted_at);
alter table app.invite_attempts enable row level security;

-- Chat rate limiting is derived from public.messages; no extra table needed.

-- ---------------------------------------------------------------------------
-- Integrity triggers (defense in depth: only server functions write here anyway)
-- ---------------------------------------------------------------------------

-- Time zone and habit type are immutable once a challenge is published.
create or replace function app.guard_challenge_immutables()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    if new.timezone is distinct from old.timezone then
      raise exception 'VALIDATION' using detail = 'The time zone can’t change after a challenge is published.';
    end if;
    if new.habit_type is distinct from old.habit_type then
      raise exception 'VALIDATION' using detail = 'The habit can’t change after a challenge is published.';
    end if;
    if new.circle_id is distinct from old.circle_id then
      raise exception 'VALIDATION' using detail = 'A challenge can’t move to another Circle.';
    end if;
  end if;
  -- Terminal states are terminal.
  if old.status in ('completed', 'canceled') and new.status is distinct from old.status then
    raise exception 'CHALLENGE_CLOSED';
  end if;
  return new;
end
$$;
create trigger challenges_guard_immutables before update on public.challenges
  for each row execute function app.guard_challenge_immutables();

-- Audit events can be inserted, never edited.
create or replace function app.forbid_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'FORBIDDEN' using detail = 'This table is append-only.';
end
$$;
create trigger audit_events_append_only before update on public.audit_events
  for each row execute function app.forbid_update();

-- Nothing about a completed challenge's scoring can change.
create or replace function app.guard_closed_challenge_records()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select c.status into v_status
  from public.participants p
  join public.challenges c on c.id = p.challenge_id
  where p.id = coalesce(new.participant_id, old.participant_id);
  if v_status in ('completed', 'canceled') then
    raise exception 'CHALLENGE_CLOSED';
  end if;
  return coalesce(new, old);
end
$$;
create trigger daily_records_guard_closed before insert or update on public.daily_records
  for each row execute function app.guard_closed_challenge_records();

-- A new auth user gets a profile row. The person completes it in profile setup.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, auth_user_id)
  values (new.id, new.id)
  on conflict (id) do nothing;
  return new;
end
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();
