# Uplift

_Level up. Together._ Private habit challenges for friends and family: less
screen time, more reading, prayer, pushups and custom goals. Circles are
persistent private groups; challenges are time-limited contests inside them.
Every challenge has an admin who reviews proof and can correct results, with a
visible change history.

Built with Expo (SDK 58) + Expo Router + TypeScript, and Supabase (Auth,
Postgres with row-level security, private Storage, Realtime).

- What works, what is demo-only, and what is deferred: [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md)
- Product and engineering decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md)
- Visual identity ("Crew") and component rules: [`docs/DESIGN.md`](docs/DESIGN.md)
- Functional specification: [`docs/UPLIFT_SPEC.md`](docs/UPLIFT_SPEC.md)
- Release checklist: [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md)
- Notes for coding agents: [`CLAUDE.md`](CLAUDE.md)

## Requirements

- Node 20+ and npm
- For the real backend: Docker (for `supabase start`). The Supabase CLI is a dev dependency.
- For phones: the Expo Go app is **not** enough because the app uses a development build
  (`expo-secure-store`, `expo-notifications`, image tools). See "Running on a device".

```bash
npm install
```

## 1. Demo Mode (no backend, nothing to configure)

```bash
npm run web:demo        # in a browser, http://localhost:8081
npm run start:demo      # on a simulator / development build
```

Demo Mode runs entirely on this device with sample data for "The Inner Circle"
(AJ, Ben, Kaan, Dad, Mia, Leo — invented people). A yellow banner on every
screen says so. Tap it to view the app as another person (for example AJ the
admin, then Leo the player), move the demo clock forward, or reset. Nothing is
sent anywhere and no money is involved. Reloading the page resets the demo.

The sample data is not a table of fixed scores: it is a replay of three weeks
of activity through the same rules the server uses, so every number on screen
can be traced to records.

## 2. Real backend, locally

```bash
npm run db:start        # local Supabase in Docker (first run downloads images)
npm run db:reset        # apply supabase/migrations + supabase/seed.sql
npm run db:env          # write the local URL + publishable key into .env
npm run seed:dev        # optional: The Inner Circle as six local accounts
npm run web             # or: npm start
```

`seed:dev` prints six local sign-ins (`aj@uplift.local` … `leo@uplift.local`)
with a random password. It refuses to run against anything but localhost.
Verification and password-reset codes go to the local mail catcher at
http://127.0.0.1:54324.

`supabase/seed.sql` turns on two **local-only** server flags: a test clock
(used by tests and the seeder to exercise deadlines) and demo reward previews.
They are off in every migration and must stay off in hosted projects.

## 3. Hosted Supabase project

1. Create a project at supabase.com.
2. Link and push the schema: `npx supabase link --project-ref <ref>` then
   `npx supabase db push` (do **not** pass `--include-seed`).
3. Authentication → Providers → Email: enable email confirmations; minimum
   password length 8.
4. Authentication → Email Templates: Uplift verifies with a 6-digit code typed
   into the app. Use `{{ .Token }}` in the "Confirm signup" and "Reset password"
   templates (see `supabase/templates/`).
5. Configure a real SMTP sender (the built-in one is rate-limited).
6. Copy the project URL and the **publishable (anon)** key into `.env`
   (see `.env.example`). Never put the service-role / secret key in `.env`;
   the app refuses to start if it detects one.
7. Optional: schedule `scripts/retention.mjs` (see below).

## Tests

```bash
npm run check           # lint + typecheck + unit tests (no backend)
npm test                # unit, domain, demo-repository and journey tests
npm run test:db         # database, authorization and journey tests on the local stack
npm run e2e:web         # browser flow in Demo Mode (needs `npm run web:demo` running)
```

Latest results are recorded in `docs/BUILD_STATUS.md`.

## Retention job

`scripts/retention.mjs` deletes evidence files 30 days after a challenge
finishes (delayed by open disputes) and cleans abandoned uploads. It needs the
service-role key and must run on a server or a scheduler, never in the app:

```bash
SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/retention.mjs --dry-run
```

It is **not scheduled** by this repository.

## Running on a device

This project uses Continuous Native Generation (`ios/` and `android/` are
generated). Build a development client once, then use `npm start`:

```bash
npx expo run:ios        # macOS + Xcode
npx expo run:android    # Android Studio / SDK
```

or in the cloud with EAS (`npx eas-cli@latest build --profile development`),
which needs an Expo account and, for iOS devices, an Apple Developer account.
No signing credentials are included. A phone cannot reach `127.0.0.1`: point
`EXPO_PUBLIC_SUPABASE_URL` at your computer's LAN IP when testing locally.

## Project layout

```
src/app/         Expo Router routes (thin re-exports of feature screens)
src/features/    Screens by feature
src/components/  Design-system primitives
src/theme/       Tokens, typography, contrast helpers
src/domain/      Pure rules: time zones, scoring, lifecycle, rewards, errors
src/data/        Repository interface, Supabase + Demo implementations, hooks, sample scenario
src/lib/         Config, Supabase client, secure storage, evidence picker, logging
supabase/        Config, migrations, seed, database tests
tests/           Unit, demo and shared journey tests
e2e/             Browser end-to-end flow
docs/            Spec, design, decisions, build status, release checklist, screenshots
```
