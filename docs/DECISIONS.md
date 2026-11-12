# Decisions and assumptions

Product and engineering choices made while building the MVP. The specification
(`docs/UPLIFT_SPEC.md`) says build defaults are "product choices, not claims that
these choices were previously approved" — the same applies here. Anything marked
**Assumption** should be confirmed by the product owner.

## Design

### D-001 — The original brand kit is rejected (2026-11-10)

The product owner's design brief of 2026-11-10 supersedes the specification's
"Design system" section. **Not approved, never to be reintroduced:** the
purple-and-lime palette (`#885BFF`, `#6635D9`, `#F1EBFF`, `#B5FF69`), the angular
"U" symbol, the italic uppercase sports wordmark, Space Grotesk headings, and the
esports / fantasy-league aesthetic.

Kept: the name Uplift, white backgrounds, and all functional requirements.

Authority order for future work: (1) the 2026-11-10 brief for visual direction,
(2) the specification for functionality, (3) the "Friday crew" reference image for
visual style, (4) the earlier five-screen Uplift mockup for content and flows only.

Guard: `tests/unit/contrast.test.ts` fails if the rejected colors reappear in
`src/theme/tokens.ts`. `CLAUDE.md` repeats this at the top.

### D-002 — Three directions explored; "Crew" chosen

Three lightweight directions were built on an in-app screen (`/design-lab`,
linked from Profile) showing the same heading, challenge card, avatar group and
primary action:

| | Direction | Idea | Why not / why |
| - | - | - | - |
| A | **Crew** (chosen) | Ink on warm white. Inter Tight headings, black selected pills and actions, soft white floating controls, color only on people and habits. | Closest translation of the reference; highest contrast; rewards stay visually quiet. |
| B | Almanac | Soft serif (Fraunces), ivory paper, hairlines, one evergreen accent. | Warm, but drifts toward the rejected "soft wellness" look and loses the black selected states. |
| C | Sticker | Bricolage Grotesque, color-blocked cards, outlines, hard shadows, cobalt action. | Fun, but spends color on chrome and puts borders on everything — the opposite of the brief. |

Screenshot: `docs/design/design-lab-directions.png`. The alternatives stay in
the app for review; only Crew's tokens (`src/theme/`) are used by product screens.

### D-003 — Wordmark instead of a symbol

The brief says a simple wordmark beats a forced symbol. The mark is lowercase
"uplift" in Inter Tight ExtraBold with the dot of the "i" enlarged and lifted.
It is a **temporary original vector mark**, generated from the font's outlines by
`scripts/build-wordmark.mjs` into `src/components/brand/wordmark.generated.ts`
(Inter Tight is under the SIL Open Font License). In the app the dot takes the
signed-in person's avatar color. There is no separate logo symbol; the app icon
is the wordmark's "u" and lifted dot.

### D-004 — Generated avatars, no photo upload in the MVP

The reference relies on expressive avatars with individually colored
backgrounds. The spec forbids scraped real people and asks for initials or
generated avatars. Avatars are original ink faces on a colored circle (10 colors
× 10 faces), chosen in profile setup. They need no photo permission and make
people the most colorful thing on screen. `profiles.avatar_path` exists in the
schema for a future photo avatar, which is **deferred**.

### D-005 — Emoji as the playful detail

Habits are marked with a large emoji on a soft tinted tile (the reference's pizza
slice). Emoji are decoration: a text label always sits next to them and they are
hidden from screen readers. UI controls use line icons (`lucide-react-native`).

### D-006 — Routes live in `src/app/`

The spec suggests `app/` at the repository root. The current official Expo
template (SDK 58) puts routes in `src/app/`, and the spec says to follow current
Expo guidance, so routes are in `src/app/`. Everything else matches the suggested
folders.

## Product rules

Filled in as features land — see the sections below in this file.

### D-007 — Typed routes off

Expo Router's generated route types were turned off (`app.json`) because
routes are added by several feature folders and plain string hrefs keep the
build independent of a generation step. Navigation targets are covered by the
browser end-to-end flow instead.

## Product rules (build defaults — confirm with the product owner)

### P-001 — Day boundaries, deadline and late submissions
Days are calendar dates in the challenge's immutable time zone. A day's
check-in is due at **noon the next local date**. After that, a person may send
a **late submission**; it counts only if an assigned admin accepts it (and, for
proof, approves the evidence). Rep increments are never accepted late.

### P-002 — Screen-time proof only after the day ends
Screen time can be submitted from local midnight after the day, never during
it. There is no self-report path for screen time anywhere (UI, server, schema
validation).

### P-003 — Rejection and resubmission
A rejected entry can be resubmitted as a new version until the later of the
original deadline and 24 hours after the rejection; after that it is a late
submission. Every version and review is kept.

### P-004 — Dispute window
24 hours after any admin decision (review or override). One dispute per
decision. The participant may waive the window by accepting the decision.
Completion waits for every window and every open dispute.

### P-005 — Admin reminder
48 hours after the final submission deadline, if reviews or disputes are still
outstanding, assigned admins get one in-app reminder. Nothing is approved or
rejected automatically.

### P-006 — Self-review
An admin may review their own proof; it is labeled "Admin self-reviewed" and
the reviewer is warned first. A second admin can be appointed to avoid it.
Must be revisited before any funded challenge.

### P-007 — Who can finalize
Any member who can see the challenge may trigger finalization; the server only
completes it when nothing blocks it, and the operation is idempotent. The app
shows the button to admins.

### P-008 — Rule changes after publishing
Proposals change target, required days, end date and verification; never the
start date (after the start), time zone, habit or goal type. All current
participants must accept; one decline keeps the old rules. Accepted changes
apply from the next challenge day; earlier days keep their rule version.
An unanswered proposal is withdrawn when the activity window ends.

### P-009 — Peer visibility
Other players see each day's outcome but not values, screenshots or rejection
reasons; a rejected day looks like one still due, then missed. Admins see
everything for their challenge. When someone other than the participant opens
their proof, that view is recorded in the participant's change history.

### P-010 — Limits
50 members per Circle, 50 players per challenge, 20 Circles per person,
10 drafts per person per Circle, invites 1–30 days and 1–50 uses (default 7
days, 25 uses), chat 2,000 characters and 30 messages a minute, 20 evidence
uploads per 10 minutes, invite guesses 10 per 15 minutes per account.

### P-011 — Account deletion and retention
Deletion removes the person's evidence files first, then leaves their Circles,
removes their chat messages and notifications, replaces their profile with an
anonymous "Deleted member" tombstone (so standings and audit history stay
coherent for others) and deletes the auth user, revoking all sessions. The last
owner of a Circle with other members must transfer ownership first.
Evidence retention (proposed beta default): 30 days after completion or
cancellation, delayed by open disputes, via `scripts/retention.mjs` — which an
operator must schedule.

### P-012 — Demo Mode
On when `EXPO_PUBLIC_DEMO_MODE=true` or when no backend is configured. It never
creates a Supabase client. Sample people can be switched from the banner;
account deletion and password changes are disabled there. A "Use a synthetic
sample" option replaces the photo picker for screen-time proof in Demo Mode
only, and its image is drawn and watermarked "SYNTHETIC SAMPLE".

### P-013 — Email verification by code
Sign-up and password reset use a 6-digit emailed code entered in the app, so
no deep-link or universal-link setup is required for the beta.

### P-014 — Reminders
Reminders are local notifications scheduled on the device (opt-in, generic
text, rescheduled on every change). Server push is deferred and never shown as
delivered.
