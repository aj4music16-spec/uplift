# Build status

_Last updated 2026-11-17. Nothing here is deployed, published to a store, or connected to a payment provider._

## Milestones

| # | Milestone | State |
| - | - | - |
| 1 | Foundation: repo, config, tokens, domain rules, design exploration | Done |
| 2 | Identity and Circles (accounts, profile, Circles, invitations) | Done |
| 3 | Challenge lifecycle (wizard, publish, accept rules, start, finish, rematch) | Done |
| 4 | Verification: check-in, private proof, review, rejection, adjustment, dispute, audit | Done |
| 5 | Social and results (Circle chat, activity, standings, results, history) | Done |
| 6 | Reward previews | Demo only, by design |
| 7 | Hardening | Partly done — see "Not verified" and "Known limitations" |

## Functional (real backend and Demo Mode, same rules)

- Email + password sign-up with a 6-digit emailed code, sign-in, password reset, profile setup with a generated avatar.
- Circles: create, list, overview, members, roles, leave, invite codes/links with preview and expiry.
- Challenges for screen time, reading, prayer, pushups and custom goals: 5-step wizard, draft → published → active → finished, accepting rules, one immutable time zone, rematch.
- Daily check-in. Screen time requires a screenshot and can only be submitted after the day has ended, until noon the next local day (late requests need admin approval). Other habits are self-reported where the rules allow it.
- Admin review queue: approve (the verified value is then compared with the target — approval is not success), reject with a reason, resubmission, admin adjustment with a required reason, "Admin self-reviewed" label, 24-hour dispute window, finalization.
- Append-only change history written in the same transaction as each correction.
- Standings from successful days only, shared ranks for ties, pending days shown separately and never scored.
- Circle chat (Realtime on the real backend), Activity feed, results, personal history.
- Privacy and account: data summary, account deletion (tombstone, evidence removed first), local opt-in reminders.
- Authorization is server-side: every write is a server function that derives identity from the session; row-level security on every table; evidence in a private bucket behind short-lived signed URLs.

## Demo only

- **Demo Mode** (`npm run web:demo`): in-memory sample Circle "The Inner Circle", labeled on every screen, never contacts a backend. Persona switch, demo clock and reset live behind the banner. The sample data is a replay through the real rules, not fixed numbers.
- **Reward previews** (sponsor / shared pot): screens labeled "Demo reward — no money collected" with "Illustrative fee, not final pricing". No live reward mode exists in the schema; the server refuses previews unless a local-only flag is on. No money moves anywhere.
- **Synthetic screenshot sample** for screen-time proof, Demo Mode only, watermarked "SYNTHETIC SAMPLE".

## Deferred / not built

- Native screen-time connection (Apple Family Controls / Android usage stats). No "Connect" button is shown. See `docs/RELEASE_CHECKLIST.md` track C.
- Live payments, payouts, balances (track B).
- Server push notifications. Reminders are local notifications only.
- Photo avatars; social sign-in; public or discoverable Circles; the map from the reference image (never a feature).
- Server-side content inspection of uploads (magic-byte / image validation). Uploads are restricted by path, size and declared type only.
- Scheduling of the evidence retention job (`scripts/retention.mjs` exists; an operator must schedule it).

## Verified on 2026-11-17

| Check | Command | Result |
| - | - | - |
| Lint | `npm run lint` | Pass, no warnings |
| Types | `npm run typecheck` | Pass |
| Unit + demo contract tests | `npm test` | 166 passed |
| Database, authorization, journey on local Supabase | `npm run test:db` | 44 passed (conformance 10, journey 10, authorization 24) |
| Browser flow in Demo Mode | `npm run e2e:web` | 7 of 7 checks passed |
| Sample data on the real local backend | `npm run seed:dev` | Standings match Demo Mode (run on 2026-11-12) |
| Retention job | `node scripts/retention.mjs --dry-run` | Dry run only |

Screens were captured from the running web build with `node e2e/screens.mjs`
(390×844 and 320×568) into `docs/screenshots/` and inspected; see the section
"Visual review" below.

## Not verified (could not run here)

- **iOS and Android builds.** No simulator, device or signing in this environment. Everything visual was checked in the web build only; native photo picking, HEIC conversion, secure storage, local notifications, safe areas and keyboard behavior are untested on devices.
- **A hosted Supabase project**, real SMTP delivery, and the email-code flow driven through the UI (the code flow is covered by backend tests against the local mail catcher).
- **Retention deletion path** (only the dry run was executed).
- Screen readers (VoiceOver / TalkBack) and OS-level large-text settings.
- Load, concurrency beyond the optimistic-revision tests, and poor-network behavior on devices.

## Known limitations

- Demo Mode data resets on page reload.
- An admin can review their own proof (labeled "Admin self-reviewed"); this must change before any money is involved.
- Product defaults in `docs/DECISIONS.md` (P-001 … P-014) are build assumptions awaiting the product owner's confirmation.

## External setup needed for a private beta

See `README.md` section 3 and `docs/RELEASE_CHECKLIST.md` track A: a hosted Supabase project, SMTP sender, email templates, EAS / Apple / Google developer accounts for device builds.

## Visual review

All 21 screens were captured at 390×844 and 320×568 and every image was looked
at. Design rules held on every screen (white background, warm cards, black
primary action, Demo banner, no purple or lime). Seven layout defects were found,
mostly at 320px; fixes were re-shot and confirmed for the sample-image watermark
(now a band below the total), the Home "Due" row, the Circle card's Owner pill
and the pinned footer button. Left as is: the wizard's step pills and the review
filter row scroll horizontally by design; only the first viewport of long
screens was captured.
