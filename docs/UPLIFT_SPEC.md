# Uplift MVP build specification

> **Read this first — the visual identity in this document is superseded.**
>
> On 2026-11-10 the product owner rejected the brand kit this specification
> describes. The following are **not approved and must not be used**:
> the purple-and-lime palette (`#885BFF`, `#6635D9`, `#F1EBFF`, `#B5FF69`),
> the angular "U" symbol, the italic uppercase sports wordmark, and the
> esports / fantasy-league aesthetic. Space Grotesk headings went with it.
>
> What still stands: the name **Uplift**, white backgrounds, and every
> functional requirement below.
>
> The current identity ("Crew": ink on warm white, black selected states,
> color reserved for people, habits and states) is defined in
> [`docs/DESIGN.md`](./DESIGN.md) and implemented in `src/theme/`. The
> decision record is in [`docs/DECISIONS.md`](./DECISIONS.md) (D-001).
>
> Order of authority: (1) the 2026-11-10 design brief for visual direction,
> (2) this specification for functionality, (3) the "Friday crew" reference
> image for visual style, (4) the earlier five-screen Uplift mockup for screen
> content and flows only.
>
> Passages that are superseded are marked **[SUPERSEDED]** inline. The original
> text is kept so the history is traceable. Do not "restore" it.

---

Uplift is a mobile app for private habit challenges among friends and family. This handoff specifies an implementable MVP for Claude Code, including product behavior, screens, permissions, database design, verification, tests, and delivery milestones.

**[SUPERSEDED — see notice at top]** ~~The approved direction is white backgrounds, electric violet, lime accents, and competitive social energy inspired by fantasy league apps.~~ The name remains Uplift. Each challenge has an admin with manual correction controls. Screen time requires daily screenshot evidence or an actual supported connection; never a self-reported completion checkbox.

Build defaults below resolve unspecified details so implementation can proceed. They are product choices, not claims that these choices were previously approved. Live payments, native Screen Time integration, and child account support are separate release tracks. The working MVP must honestly distinguish functional features from demonstrations.

# Claude Code operating instructions

Act as the senior product engineer implementing Uplift. Build the app, not just a landing page, wireframe, or plan. Read this specification completely, inspect the existing repository and its instructions, and preserve unrelated work. In an empty repository use the stack below. In an established repository prefer its working conventions unless incompatible with the requirements.

Create CLAUDE.md with the product invariants and implementation commands, docs/UPLIFT_SPEC.md with this specification, docs/DECISIONS.md for assumptions, and docs/BUILD_STATUS.md for completed milestones and remaining work. Never silently omit a requirement. Track deferred work explicitly.

Implement in working vertical slices. Run appropriate tests after each slice. Start with the real screenshot submission and admin review loop, then expand. Do not stop after scaffolding. Make routine implementation choices independently. Ask only when a missing credential, platform approval, or material product decision blocks actual functionality; continue all independent work.

Never invent successful payments, connected device data, delivered notifications, or completed tests. No service secrets in the mobile bundle. No client-controlled authoritative scores. Do not deploy publicly, submit to stores, charge users, or create paid services merely because this document asks for a build.

Deliver runnable source, migrations, deterministic seed fixtures, tests, setup instructions, a demo mode, and a precise list of capabilities requiring external setup. Keep the demo visually identifiable and isolated from real accounts.

# Product definition and scope

Tagline: Level up. Together.

Value proposition: Turn the group chat into a place where people challenge each other to build better habits. Circles persist across challenges. Members check in, review progress, encourage each other, and run another challenge.

## Functional MVP

- Email and password authentication, verification, password reset, session restoration, and sign out.

- Profiles with display name, optional avatar, and timezone.

- Private Circles with owner, admins, members, invitation codes, and membership management.

- Screen time, reading, prayer, pushup, and simple custom challenges.

- Draft, scheduled, active, review, completed, and canceled challenge states.

- Same daily target for every participant; configurable dates and required successful days.

- Daily check-ins, private evidence upload, admin review, corrections, and append-only audit history.

- Standings calculated from approved successful days.

- Circle chat, reactions, activity events, in-app notifications, and optional local reminders.

- Results and rematches that require fresh participant acceptance.

- Full empty, loading, validation, permission, and network-error states.

- No-reward challenges work end to end. Sponsored and shared-pot screens work only as clearly marked demo previews.

## Deferred

Live money collection and payout; automatic screen-time tracking; public discovery; minors and parental-account workflows; personalized goals within one challenge; head-to-head brackets; team scoring; seasons; video verification; OCR fraud decisions; remote push notifications.

For the initial private beta, use adult testers. This is a scope decision, not a legal conclusion. Do not portray the MVP as a finished child-facing product.

Do not add premium subscriptions, ads, an AI coach, or arbitrary XP systems. The proposed business model remains a small transaction fee on future funded challenges with free core use.

# Recommended implementation

Use Expo React Native with TypeScript and Expo Router for an iOS-first mobile app with Android-compatible core flows. A web preview is useful for review but is not a substitute for native testing.

Use Supabase for Auth, Postgres, private Storage, and realtime Circle chat. Put authoritative mutations in Postgres functions or authenticated server functions with transactional database operations. Use TanStack Query for server state, React Hook Form and Zod for forms, and a small shared token/component system for styling. Avoid a second backend framework for the MVP.

Choose mutually compatible stable package versions at implementation time, record them, and commit a lockfile. Follow current official Expo setup guidance rather than copying guessed SDK versions.

Use a repository adapter boundary: SupabaseRepository for real data and DemoRepository for deterministic local fixtures. Domain scoring and validation must be shared; do not implement a separate fake product for screenshots.

Suggested folders:

- app/: Expo Router routes and layouts.

- src/features/: auth, circles, challenges, checkins, moderation, chat, notifications, profile.

- src/components/: shared UI primitives.

- src/theme/: colors, typography, spacing, radii.

- src/domain/: pure scoring, lifecycle, time, and reward-preview rules.

- src/data/: repositories, queries, mutations.

- src/lib/: validated configuration, Supabase client, logging.

- supabase/migrations/: ordered schema, indexes, RLS, functions.

- supabase/tests/: database and authorization tests.

- tests/: domain and integration tests.

- e2e/: critical device flows.

- docs/: setup, architecture, decisions, build status, release checklist.

Development configuration should include public backend URL and publishable client key, app environment, and demo flag. Any service-role credential stays server-side. Provide .env.example with placeholders only. Document local Supabase startup, migration reset, seed, app launch, test commands, and hosted project setup.

# Design system

> **[SUPERSEDED — see notice at top]** The token table, fonts and logo guidance in this section describe the rejected brand kit. Use `docs/DESIGN.md` and `src/theme/` instead. Still in force from this section: white UI throughout, spacing scale, minimum 44×44 touch targets, measured contrast, dynamic text, screen-reader labels, reduced motion, labels in addition to color, the component list, minimal gradients, clear type hierarchy, restrained borders, and no all-italic or all-caps UI.

Use a white UI throughout the primary experience. Do not revert to the rejected soft wellness branding or dark esports dashboard.

| Token | Value or rule |
| - | - |
| Background | #FFFFFF |
| Secondary surface | #F5F6FA |
| Primary ink | #171D29 |
| Secondary text | #647084 |
| Border | #E6E8EE |
| Brand violet | #885BFF |
| Action violet | #6635D9 for stronger text contrast |
| Soft violet | #F1EBFF |
| Lime accent | #B5FF69 with dark ink text |
| Error | #B42318 with icon and explanation |
| Font | Inter for UI; Space Grotesk for headings where available |
| Scores | Tabular numerals; optional IBM Plex Mono |
| Spacing | 4, 8, 12, 16, 20, 24, 32 |
| Card radius | 16 |
| Field radius | 12 |
| Touch targets | At least 44 by 44 points |

Measure text contrast; do not assume a palette is accessible. Support dynamic text, screen readers, reduced motion, and labels in addition to color. Test compact devices and large text without clipping.

**[SUPERSEDED]** ~~Use an original angular U symbol and compact italic uppercase UPLIFT wordmark.~~ If exact vector artwork is absent, create a temporary simple original vector mark and identify it in documentation; do not invent an asset path or copy Sleeper branding.

Components: ScreenShell, Header, CircleSelector, AvatarStack, ChallengeCard, StatusBadge, SegmentedTabs, DayProgress, MetricRow, StandingRow, EvidenceUploader, SubmissionState, ReviewCard, AuditEvent, ChatBubble, PrimaryButton, EmptyState, ErrorState, ConfirmationSheet, Toast.

Keep gradients minimal. Use clear type hierarchy and restrained borders. Do not put the entire UI in italic or all caps.

# Navigation and screen requirements

Bottom tabs: Home, Circles, Activity, Profile. Check-in forms, challenge creation, review queues, and results are nested screens.

| Screen | Required content and actions |
| - | - |
| Welcome | Product explanation, create account, sign in, preserve incoming invitation |
| Authentication | Register, verify email, sign in, reset password, field errors |
| Profile setup | Display name, optional avatar, timezone confirmation |
| Home | Today’s actions across Circles, pending submissions, active challenge cards, create challenge |
| Circle list | Memberships, create Circle, join by code, empty state |
| Circle overview | Name, avatars, Challenges / Standings / Chat tabs, invitations |
| Circle members | Roles, invite, remove with reason, transfer owner |
| Invitation preview | Limited group/challenge summary, sign-in gate, accept or decline |
| Create challenge | Multi-step wizard described below, save draft |
| Challenge details | Goal, dates, timezone, verification method, admin, participant list, progress, rules |
| Check-in | Selected date, input appropriate to habit, proof where required, submit |
| Submission detail | Original data, evidence for authorized viewers, review status, feedback, correction history |
| Review queue | Pending entries, filters by person/date, evidence preview, approve/reject |
| Admin console | Edit settings, membership, late submissions, corrected results, audit trail |
| Standings | Rank, avatar, successful days, pending count, own-row highlight |
| Circle chat | Messages, reactions, pinned challenge, system progress cards |
| Activity | Invites, reviews, mentions, rule changes, results, read/unread |
| Results | Final successes, ties, review status, reward preview if demo, rematch |
| Profile | History, settings, reminders, privacy, account deletion |
| Reward preview | Explicit demo label, funding mode, amount, illustrative fee, no live checkout |

Home prioritizes unfinished actions. For screen time the action is usually “Submit yesterday’s screenshot”; never prompt for proof of a completed day before the day ends.

All actionable buttons must navigate or perform a real operation. Future features should be hidden or clearly disabled with an explanation. Do not show a “Connect” button that returns fake success.

# Challenge creation and joining

Use a five-step wizard with back navigation and persisted drafts:

1. Choose Circle, habit, challenge name, and optional description.

2. Set daily target and metric.

3. Set start date, end date, timezone, and required successful days.

4. Choose allowed verification method and review behavior.

5. Select reward mode and review the complete rules.

Defaults: seven consecutive calendar days, tomorrow as the start date in the Circle timezone, all seven days required, no reward. Allowed duration is 1–30 days in the MVP. Required days must be between 1 and duration. All days are scheduled; custom weekdays are deferred.

Targets: screen time at most 120 minutes/day; reading at least 20 minutes/day; prayer one yes/no check-in/day; pushups at least 50 reps/day; custom either yes/no or a positive numeric minimum with a clear unit. Use “2 hours or less” rather than ambiguous “under 2 hours” for an inclusive threshold.

Screen time proof is mandatory. Other habits default to self-report with an optional screenshot/photo requirement chosen by the admin. A timer is optional convenience for reading and is labeled self-reported, not independently verified.

Publishing creates a versioned rules snapshot. Circle members are invited; they are not automatically enrolled. Joining requires explicit acceptance of the current rules. No late joins after the start in the MVP. Preview may be shown to invitees but full chat, member details, and evidence require access.

Creator is the first challenge admin and may also participate. At least one active challenge admin must remain. Circle ownership does not silently grant access to all challenge evidence; admin assignment is explicit and auditable.

# Time and challenge lifecycle

Store timestamps in UTC and store one immutable IANA timezone per published challenge. Each daily occurrence uses a date key in that timezone. Travel or device timezone changes do not change challenge dates.

Start is local midnight on the start date. End is the local midnight immediately after the end date. Use timezone-aware calendar math; do not add 24-hour milliseconds across daylight saving transitions.

Daily submission deadline is noon on the following local date. This applies to all categories; non-screen-time entries may be submitted during the day, but screen-time evidence for date D cannot be submitted before D has fully ended. Explain this deadline before joining.

States:

- draft: editable and visible only to organizer/admins.

- scheduled: published, joining open, not started.

- active: daily participation open.

- review: activity window ended; final-day submission grace and moderation still open.

- completed: last deadline passed and no pending reviews or open disputes.

- canceled: terminal; show reason, preserve history.

Pending review never turns into a success automatically. At 48 hours after the final submission deadline, remind admins of outstanding work; do not silently reject valid unresolved proof. Completion requires resolution and an idempotent finalization transaction.

A missed submission becomes a failed day after its deadline unless an admin explicitly accepts a late submission or overrides the outcome. Do not call a missing day failed before its deadline. Pending review is its own status and adds no score.

Cancelation is supported. Pause is deferred; do not display a pause button that has undefined effects. Rematch copies settings into a new draft, clears progress, invites members anew, and starts with no reward.

# Daily check-ins and screen-time proof

## Screen time

The participant selects the completed day, enters the displayed screen-time total, and uploads a screenshot of the system day view. The screenshot must show the relevant date and usage total. MVP measurement is total usage for one declared primary phone; exclude weekly averages and cross-device totals. Explain the device scope in rules and proof instructions.

Use photo-library selection for system screenshots. Allow JPEG/PNG and converted HEIC; normalize accepted images, limit uploaded output to 10 MB, preserve enough resolution to read the date and total, and validate MIME and content server-side. Avoid unnecessary photo-library access.

Preview before submitting. A warning should explain that screenshots may contain app names or sensitive information. Allow cropping only if the required date and total remain visible. Strip location metadata when feasible. Evidence is private to the submitter and assigned challenge admins; the group sees outcome, not the image.

Submitting creates pending review. Admin verifies date, scope, total, readability, and duplicate concerns, then approves the evidence or rejects it with a reason. Approval of evidence and meeting the target are separate: a valid screenshot showing 150 minutes is verified evidence but an unsuccessful day for a 120-minute goal.

No OCR-based automatic acceptance in MVP. Image hashes may flag repeated files for human review but cannot prove fraud. Prevent a rejected entry from being resubmitted without a new version and preserved history.

If an admin manually marks success without ordinary proof, display “Admin adjusted” and require a reason. It must never say “Device verified” or “Screenshot verified.” This preserves the user’s manual-control requirement without pretending evidence exists.

## Other habits

Reading: enter minutes for the day, or use an optional foreground timer then submit. Store cumulative daily minutes, not unlimited completion events.

Pushups: add rep increments. Store an idempotent increment ledger and calculate daily total; repeated network retries must not add reps twice. Allow correction before approval and preserve revisions.

Prayer: one private yes/no daily check-in. No prayer text is requested. Display “Self-reported” where verification status is shown.

Custom: yes/no or nonnegative numeric input according to the published rules.

Evidence-required versions use the same pending review pipeline. Self-report entries are accepted automatically by the server if valid, explicitly labeled self-reported.

One daily record per challenge participant and date. Multiple versions and increments may exist beneath it. Client input is never trusted to set approval, outcome, reviewer, or score.

# Admin powers and change history

Every challenge has a named admin. The admin can review evidence, accept late submissions, correct values, override a daily outcome with a reason, remove a participant, edit challenge settings, cancel a challenge, appoint another admin, and resolve participant disputes.

Distinguish cosmetic edits from substantive changes. Name, description, and cover changes can take effect immediately. After start, changes to target, required days, dates, or verification create a proposal with a before/after preview. Require acceptance by all current participants before activation. If anyone declines, original rules remain. New rules apply from the next challenge day after acceptance; historical day records retain their rule version. For retroactive exceptions use individual audited overrides. Timezone and habit type are immutable after publishing.

Admin corrections do not require a group vote. Record actor, action, affected participant/date, old value/outcome, new value/outcome, reason, timestamps, and source submission. Notify the affected user and show an appropriate system activity event without exposing evidence.

If an admin reviews their own evidence, label “Admin self-reviewed”; do not present it as independent review. A second admin can review instead. Real-money release must decide stronger self-review controls before activation.

Allow participants to dispute a review with a short reason. Admin resolves with an explanation. Open disputes block finalization. MVP uses a 24-hour dispute window after the review decision or an admin override; completion waits for applicable windows to expire as well as all open disputes to resolve. A participant may waive their own remaining window by acknowledging a decision.

Prevent modification after completed in MVP; corrections must be resolved before finalization. Show clear confirmation for removing participants or canceling. Removed members lose future access; retain historical scores/audit for remaining authorized members. Exclude removed participants from future reward-preview eligibility and show removal status.

Circle admins manage Circle membership and appoint challenge admins through an explicit logged action. The last owner/admin cannot leave without transferring responsibility. Server-side membership checks enforce this, not just disabled buttons.

# Scoring and standings

Use completed successful days, not invented points.

For each date: determine the applicable rules version, obtain the latest valid submission/review or override, calculate outcome, and expose verification provenance separately.

- Minimum targets: value >= target.

- Screen-time maximum: value <= target.

- Boolean goals: true.

- Pending, rejected, missing, and failed days contribute zero.

- Admin override may set success or failure with provenance.

- Each day contributes at most one success.

- Required-day threshold determines qualification.

Standings order by successful days descending. Equal totals share a rank using competition ranking: 1, 1, 3. Deterministic secondary ordering by stable participant ID is only visual and must not imply a tie-break winner.

Show pending counts independently. Example: “5 successful · 1 awaiting review.” Do not let an unreviewed screenshot improve rank.

No excused-day scoring adjustment in MVP: admins can accept late proof or explicitly override success/failure. This avoids hidden denominator changes. Always show required days and all scheduled dates.

Server-derived summaries are authoritative. Recompute affected participant totals transactionally after review, override, or correction. Results can be computed directly for small groups; avoid writable client score caches. Default scale limits: 50 members per Circle and 50 participants per challenge.

# Rewards and payment boundary

Core monetization concept: optional sponsor or participant-funded pool; Uplift takes a small disclosed transaction fee. No rate has been approved.

Implement no-reward challenges as production functionality. In explicit Demo Mode only, show sponsor/shared-pot configuration and simulated reward allocation. Display “Demo reward — no money collected” beside every simulated amount, including cards, results, and activity.

Create a PaymentProvider interface but do not wire live collection. Payment states in production must not be inferred from client requests. Live reward mode is server-disabled; a hidden client flag is insufficient.

For preview arithmetic use integer cents, one currency (USD), and configurable illustrative fees. A seeded example may use 5%, labeled “Illustrative fee, not final pricing.” Calculate total, fee, net reward, eligible finishers, and per-person allocation from one shared function. Split net cents equally; allocate leftover cents deterministically by stable participant ID and disclose the method. Zero qualifiers produces a simulated refund state, never division by zero. Do not label simulated money withdrawable.

Future live-money work must specify provider eligibility, jurisdiction/age restrictions, sponsor fees versus participant deductions, failed funding, refunds, withdrawal, chargebacks, webhook verification, idempotent ledger entries, payout eligibility, dispute holds, and reconciliation. Resolve those before enabling payment features; do not treat a payment SDK as a complete solution.

# Data model

Use UUID primary keys, foreign keys, created_at/updated_at timestamps where appropriate, checked enums, and explicit indexes. Treat the following as the schema contract; write actual migrations rather than leaving this as a diagram.

| Table | Core fields and constraints |
| - | - |
| profiles | id references auth user, display_name, avatar_path, timezone, deleted_at |
| circles | id, name, owner_id, timezone, archived_at |
| circle_members | circle_id + user_id unique, role owner/admin/member, joined_at, removed_at |
| invitations | circle_id, optional challenge_id, token_hash unique, expires_at, max_uses, use_count, revoked_at, created_by |
| challenges | circle_id, creator_id, name, habit_type, metric_unit, timezone, start_date, end_date, status, current_rule_version_id, revision |
| challenge_admins | challenge_id + user_id unique, assigned_by, revoked_at |
| rule_versions | challenge_id, version unique within challenge, target, comparator, required_days, verification, start/end, effective_date, status |
| rule_acceptances | version_id + participant_id unique, accepted/declined, decided_at |
| participants | challenge_id + user_id unique, joined_at, accepted_version_id, removed_at |
| daily_records | participant_id + local_date unique, rule_version_id, effective_value, outcome, provenance, revision |
| submissions | daily_record_id, version unique per day, entered_value, submitted_at, status, supersedes_id, idempotency_key |
| activity_increments | daily_record_id, amount, idempotency_key unique per actor, created_at |
| evidence | submission_id, private_object_path unique, MIME, byte_size, sha256, uploaded_by |
| reviews | submission_id, reviewer_id, decision, corrected_value nullable, reason, reviewed_at |
| overrides | daily_record_id, actor_id, prior outcome/value, new outcome/value, reason, created_at |
| disputes | daily_record_id, raised_by, reason, status, resolver_id, resolution, resolved_at |
| messages | circle_id, author_id, text, type user/system, event_id optional, created_at, deleted_at |
| reactions | message_id + user_id + emoji unique |
| notifications | recipient_id, type, entity_id, dedupe_key unique per recipient, read_at |
| audit_events | circle_id, challenge_id optional, actor_id, action, safe before/after JSON, reason, created_at |
| reward_previews | challenge_id unique, demo_only true, mode, gross_cents, fee_bps, currency |
| reminder_preferences | user_id + challenge_id unique, enabled, local_time |

Audit events are append-only to clients. Changes to protected domain state and their audit records must commit in the same transaction.

Link daily records to participants rather than trusting separate arbitrary user/challenge inputs. Validate evidence path ownership and submission relationships. Use uniqueness constraints to defeat concurrent duplicate joins, daily records, and retries.

Invitation tokens must be random, stored hashed, expire after seven days by default, and be revocable. Redemption is authenticated and atomic with the membership insert and usage count; already-members do not consume another use. Rate-limit guessing and return non-enumerating errors.

# Authorization and storage

Enable RLS on every exposed table. Test both allowed and denied requests. Server functions must derive identity from authenticated context, never from a supplied user_id.

Rules:

- Users edit only allowed fields on their own profile.

- Basic profiles are visible only to users sharing an active Circle; never expose email in public profile queries.

- Circle data and chat require active membership.

- Challenge views require active membership; drafts require assigned admin.

- A participant can create or revise their own valid submission, but not approve it or set effective outcome.

- Only assigned challenge admins review, override, or access another participant’s proof.

- Evidence objects are private; signed URLs are short-lived and issued only after authorization.

- Participants can see safe standings and audit summaries without seeing peers’ screenshots.

- Removed users cannot read new Circle data or mint new evidence URLs.

- Client inserts into audit events, reviews for other users, lifecycle transitions, and payment states are denied except through scoped server functions.

- System messages are server-generated; members cannot impersonate them.

Do not use public evidence buckets. Enforce MIME and size constraints, unguessable object paths, and cleanup of abandoned uploads. Stage upload, verify the object exists and belongs to the actor, then finalize the submission transaction. A failed upload must not produce a pending record that claims evidence exists.

Cache only what is necessary; clear user-scoped cache on sign-out. Do not log screenshots, signed URLs, passwords, or full chat messages in diagnostics. Notification previews must not include sensitive proof.

Provide account deletion with session revocation and removal of owned private evidence according to a documented retention policy; anonymize retained shared audit/chat references where necessary. A proposed beta default is evidence deletion 30 days after challenge completion, delayed for unresolved disputes. Make deletion jobs and retention visible in setup docs rather than promising jobs that are not configured.

# Backend operation contracts

Use typed request/response objects, server validation, consistent error codes, and optimistic concurrency through expected_revision for sensitive edits. Mutation success must return canonical server data.

| Operation | Inputs and behavior |
| - | - |
| createCircle | Name/timezone; atomically create Circle and owner membership |
| createInvite | Authorized Circle, expiry, max uses; return token once |
| redeemInvite | Token + idempotency key; validate and join atomically |
| publishChallenge | Draft + expected revision; validate complete rules and publish snapshot |
| joinChallenge | Challenge + accepted version; reject stale terms or started challenge |
| beginEvidenceUpload | Authorized daily context + MIME/size; issue scoped upload destination |
| submitCheckin | Date, value, staged evidence reference, idempotency key; validate deadline and habit rules |
| addReps | Date, positive increment, idempotency key; enforce ownership and phase |
| reviewSubmission | Submission version, decision, optional corrected value, reason, expected revision |
| overrideDay | Daily record, explicit outcome/value, mandatory reason, expected revision |
| acceptLateSubmission | Submission, reason; produce ordinary auditable review path |
| proposeRuleChange | New rules + reason + expected revision; notify participants |
| respondToRuleChange | Proposal version + accept/decline; activate only when all required acceptances exist |
| openDispute | Daily record + reason; validate window |
| resolveDispute | Resolution + reason; update outcome only via audited operation |
| removeParticipant | Authorized target + reason; preserve historical records |
| finalizeChallenge | Server-owned idempotent transition; enforce deadlines, review and dispute conditions |
| cancelChallenge | Reason + expected revision; notify members, preserve history |
| sendMessage | Circle + bounded text + client message ID; deduplicate retries |
| acknowledgeNotification | Recipient-owned record only |

Use structured codes such as AUTH_REQUIRED, FORBIDDEN, RULES_CHANGED, DEADLINE_PASSED, EVIDENCE_REQUIRED, DAY_NOT_FINISHED, REVISION_CONFLICT, UPLOAD_INCOMPLETE, and REVIEW_PENDING. Map them to actionable user-facing copy.

Do not silently retry non-idempotent operations. Server functions with elevated database privileges must have an explicit search_path, minimal grants, and independent role/membership validation.

# Social behavior and notifications

Circle chat supports plain text up to 2,000 characters and a small emoji reaction set. Escape content; do not render arbitrary HTML. Messages show pending/sent/failed states, deduplicate by client ID, and reconcile after reconnection.

Realtime improves delivery but durable database rows are the source of truth. On reconnect, fetch missed messages and invalidate relevant challenge queries. Paginate chat and activity rather than loading all historical rows.

System events: challenge published, member joined, check-in approved, admin corrected a result, rule change proposed/activated, challenge finished. Rejected proof is a private notification to its owner; public activity need not shame the participant.

Prayer activity may say “Daily goal completed” without extra detail. Do not publish screenshots into chat.

Persist in-app notifications for invitations, review decisions, disputes, rule changes, and results. Local device reminders are opt-in and cancel/reschedule on membership changes, preference changes, or challenge completion. Remote push is deferred and must not be shown as delivered.

Use offline banners and allow non-authoritative local drafts. Final submissions require server acknowledgement. No optimistic successful score updates while proof is pending.

# Demo data and edge states

Seed a development-only Circle called The Inner Circle with synthetic members AJ, Ben, Kaan, Dad, Mia, and Leo. Use initials/generated avatars, not scraped real people. Never create fixed demo credentials in production.

Fixtures:

- Screen Time Showdown: seven days, 120-minute daily maximum.

- Pushup Club: 50 reps/day with partial daily progress.

- The 20-minute Club: reading.

- Daily Prayer: private self-reported completion.

- A future scheduled challenge, a draft, a completed challenge, and an empty Circle.

- Pending, accepted, rejected, late, missing, and admin-adjusted daily records.

- A dispute and a proposed rule change.

- A screenshot fixture with a visible date and daily total, marked synthetic.

- In Demo Mode only, a simulated sponsored reward.

Use an injectable fixed clock in tests. Demo dates can be generated relative to today, but derive scores from valid seeded entries. Do not show a score that the underlying records cannot reproduce.

Required UI states include no Circles, no challenges, no chat, offline, expired invite, invalid code, removed member, lost permission mid-session, upload failure, unreadable evidence, duplicate submission, rejected screenshot, session expiry, no finishers, and all members tied.

# Testing and acceptance criteria

Unit tests:

- Inclusive 120-minute screen-time threshold; 121 fails.

- Minimum-goal thresholds and one-point-per-day cap.

- Pending proof never scores.

- Approving valid over-limit evidence yields failure, not success.

- Competition ranking with ties.

- Rule-version effective dates and old-record preservation.

- Challenge local dates, daylight saving transitions, next-day noon deadline.

- No screen-time check-in before the measured day finishes.

- Dispute windows and finalization blocking.

- Deterministic integer-cent preview allocations and zero qualifiers.

Database/integration tests:

- Nonmembers cannot query Circle/chat/evidence.

- Members cannot edit peers’ check-ins or promote themselves.

- Participants cannot set approval/outcome or insert forged system messages.

- An admin of Circle A cannot review Circle B.

- Evidence privacy works through actual Storage policies.

- Removed members lose access.

- Duplicate requests do not create duplicate records, increments, messages, or invite uses.

- Concurrent reviews fail safely with revision conflict.

- Overrides produce audit events in the same transaction.

- Stale rule acceptance cannot enroll a participant.

- Direct API access cannot enable live payments.

- Finalization is idempotent.

End-to-end flows:

1. User A creates account and Circle, invites User B, and B joins.

2. A publishes a screen-time challenge and B accepts rules.

3. With a controlled clock, B uploads a completed-day screenshot.

4. A reviews it; standings update only after review.

5. A rejects another entry; B sees reason, resubmits, history remains.

6. A manually corrects a day; B sees Admin adjusted and audit reason.

7. B opens a dispute; finalization blocks until resolved and windows expire.

8. Members chat and react; reconnect recovers missed messages.

9. Challenge completes, final standings are stable, rematch creates a fresh draft.

10. No-backend demo works with a visible Demo Mode banner and no simulated real-world claims.

Test at small and large phone sizes, large font settings, keyboard-open forms, denied photo permissions, and slow upload networks. Run lint, typecheck, unit and database tests; run native end-to-end checks where available. State exactly which checks could not run and why.

# Implementation milestones

1. Foundation: repository, configuration, navigation, tokens, shared components, database migrations, local setup, and demo adapter.

2. Identity and Circles: auth, profiles, membership, invitations, authorization tests.

3. Challenge lifecycle: creation wizard, versioned rules, joining, time handling, Home, details.

4. Verification: upload pipeline, daily records, review queue, admin corrections, audit, standings. This is the critical product slice.

5. Social and results: chat, reactions, notifications, disputes, finalization, rematches.

6. Reward previews: explicit demo-only sponsor and pot UX, integer-cent calculation tests, disabled live provider boundary.

7. Hardening: RLS/storage tests, concurrency and failure recovery, deletion/retention jobs, accessibility, native QA, documentation.

Each milestone must leave the app runnable. Use actual backend behavior as soon as configuration is available. Do not present the work as complete if only static fixtures exist.

Definition of done: two authenticated users can create/join a Circle, accept a challenge, submit proof, review/correct it, see consistent standings and audit history, chat, and finish/rematch without direct database editing. Demo mode works independently. Every feature is identified as functional, demo-only, or deferred.

# Setup and delivery checklist

AJ needs a local Node/package-manager environment, Claude Code access, and a Supabase project or local Supabase environment. A physical-device distribution workflow may require platform accounts and signing configuration; explain the chosen Expo workflow in README without fabricating credentials.

Claude must deliver:

- Source repository and dependency lockfile.

- CLAUDE.md and complete product documentation.

- SQL migrations, authorization policies, functions, and development seeds.

- .env.example without real secrets.

- A working demo launch path and real-backend launch path.

- Reproducible automated test commands and results.

- Device/screenshots for key flows if tooling is available.

- Known limitations and external setup steps.

- A release checklist separating private beta from live payments/device integration.

Native screen-time integration is a feasibility spike, not a promised trivial connection. Evaluate Apple’s Family Controls/Device Activity capabilities, entitlements, distribution approval, extensions, consent, and whether the required measurement can actually support the product’s evidence model. Do not assume device totals can be freely exported to the backend. Android needs its own investigation. Keep screenshot fallback available.

Official implementation references:

- [Expo and Supabase](https://docs.expo.dev/guides/using-supabase/)

- [Supabase Expo quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native)

- [Supabase row level security](https://supabase.com/docs/guides/database/postgres/row-level-security)

- [Supabase storage access control](https://supabase.com/docs/guides/storage/security/access-control)

- [Apple Screen Time frameworks](https://developer.apple.com/documentation/screentimeapidocumentation/)

- [Apple Family Controls entitlement](https://developer.apple.com/documentation/familycontrols/requesting-the-family-controls-entitlement)

Read the current documentation when implementing; this specification defines product requirements, not a substitute for platform API documentation.
