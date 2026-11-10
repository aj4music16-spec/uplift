-- Row level security.
--
-- Model: deny by default.
--   * RLS is enabled on every table.
--   * API roles get SELECT only, and only where a policy says so. There are no
--     INSERT/UPDATE/DELETE grants or policies at all: every write goes through
--     a server function that checks identity, role and state itself.
--   * `anon` can read nothing. (It may call public.preview_invite only.)
--   * Policies use the SECURITY DEFINER helpers in `app` so they never recurse.

alter table public.profiles enable row level security;
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.invitations enable row level security;
alter table public.invitation_redemptions enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_admins enable row level security;
alter table public.rule_versions enable row level security;
alter table public.rule_acceptances enable row level security;
alter table public.participants enable row level security;
alter table public.daily_records enable row level security;
alter table public.submissions enable row level security;
alter table public.activity_increments enable row level security;
alter table public.evidence_uploads enable row level security;
alter table public.evidence enable row level security;
alter table public.reviews enable row level security;
alter table public.overrides enable row level security;
alter table public.disputes enable row level security;
alter table public.audit_events enable row level security;
alter table public.messages enable row level security;
alter table public.reactions enable row level security;
alter table public.notifications enable row level security;
alter table public.reward_previews enable row level security;
alter table public.reminder_preferences enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Profiles: only the basic, shareable columns are readable through the table,
-- and only for people who share an active Circle with you. Email lives in
-- auth.users and is never exposed. Your own full profile comes from
-- public.get_my_profile().
grant select (id, display_name, avatar_color, avatar_face, deleted_at) on public.profiles to authenticated;
create policy profiles_select_shared_circle on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (deleted_at is null and app.shares_circle(id)));

-- Circles and membership: active members only.
grant select on public.circles to authenticated;
create policy circles_select_member on public.circles
  for select to authenticated
  using (app.is_circle_member(id));

grant select on public.circle_members to authenticated;
create policy circle_members_select_member on public.circle_members
  for select to authenticated
  using (app.is_circle_member(circle_id) and (removed_at is null or app.is_circle_admin(circle_id)));

-- Invitations: Circle admins, and never the token hash.
grant select (id, circle_id, challenge_id, expires_at, max_uses, use_count, revoked_at, created_by, created_at)
  on public.invitations to authenticated;
create policy invitations_select_circle_admin on public.invitations
  for select to authenticated
  using (app.is_circle_admin(circle_id));
-- invitation_redemptions: no grant, no policy. Server functions only.

-- Challenges: active Circle members; drafts only for their admins.
grant select on public.challenges to authenticated;
create policy challenges_select_visible on public.challenges
  for select to authenticated
  using (app.can_view_challenge(id));

grant select on public.challenge_admins to authenticated;
create policy challenge_admins_select_visible on public.challenge_admins
  for select to authenticated
  using (app.can_view_challenge(challenge_id));

grant select on public.rule_versions to authenticated;
create policy rule_versions_select_visible on public.rule_versions
  for select to authenticated
  using (app.can_view_challenge(challenge_id));

grant select on public.rule_acceptances to authenticated;
create policy rule_acceptances_select_visible on public.rule_acceptances
  for select to authenticated
  using (exists (select 1 from public.rule_versions v where v.id = version_id and app.can_view_challenge(v.challenge_id)));

grant select on public.participants to authenticated;
create policy participants_select_visible on public.participants
  for select to authenticated
  using (app.can_view_challenge(challenge_id));

-- Daily records and everything beneath them: the participant (while still a
-- member) and assigned challenge admins. Other players get peer-safe standings
-- from public.get_challenge, never these rows.
grant select on public.daily_records to authenticated;
create policy daily_records_select_owner_or_admin on public.daily_records
  for select to authenticated
  using (app.can_view_record(id));

grant select on public.submissions to authenticated;
create policy submissions_select_owner_or_admin on public.submissions
  for select to authenticated
  using (app.can_view_record(daily_record_id));

grant select on public.activity_increments to authenticated;
create policy activity_increments_select_owner_or_admin on public.activity_increments
  for select to authenticated
  using (app.can_view_record(daily_record_id));

grant select on public.evidence to authenticated;
create policy evidence_select_owner_or_admin on public.evidence
  for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id and app.can_view_record(s.daily_record_id)));

grant select on public.evidence_uploads to authenticated;
create policy evidence_uploads_select_own on public.evidence_uploads
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.reviews to authenticated;
create policy reviews_select_owner_or_admin on public.reviews
  for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = submission_id and app.can_view_record(s.daily_record_id)));

grant select on public.overrides to authenticated;
create policy overrides_select_owner_or_admin on public.overrides
  for select to authenticated
  using (app.can_view_record(daily_record_id));

grant select on public.disputes to authenticated;
create policy disputes_select_owner_or_admin on public.disputes
  for select to authenticated
  using (app.can_view_record(daily_record_id));

-- Audit: Circle members see member-visible events; restricted events (for
-- example a rejection reason) only reach the affected person and admins.
grant select on public.audit_events to authenticated;
create policy audit_events_select_scoped on public.audit_events
  for select to authenticated
  using (
    app.is_circle_member(circle_id)
    and (challenge_id is null or app.can_view_challenge(challenge_id))
    and (
      visibility = 'members'
      or subject_user_id = (select auth.uid())
      or (challenge_id is not null and app.is_challenge_admin(challenge_id))
      or (challenge_id is null and app.is_circle_admin(circle_id))
    )
  );

-- Chat: active members only.
grant select on public.messages to authenticated;
create policy messages_select_member on public.messages
  for select to authenticated
  using (deleted_at is null and app.is_circle_member(circle_id));

grant select on public.reactions to authenticated;
create policy reactions_select_member on public.reactions
  for select to authenticated
  using (app.is_circle_member(circle_id));

-- Notifications and reminders: your own.
grant select on public.notifications to authenticated;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()));

grant select on public.reminder_preferences to authenticated;
create policy reminder_preferences_select_own on public.reminder_preferences
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Demo reward previews: readable with the challenge. Never writable by clients.
grant select on public.reward_previews to authenticated;
create policy reward_previews_select_visible on public.reward_previews
  for select to authenticated
  using (app.can_view_challenge(challenge_id));
