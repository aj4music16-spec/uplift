# Release checklist

Three separate tracks. Do not mix them: the private beta must not wait for, or
pretend to include, live payments or native screen-time tracking.

## A. Private beta (adult testers, no money)

Backend
- [ ] Hosted Supabase project created; migrations pushed with `supabase db push` (no seed).
- [ ] `select * from app.config` shows `demo_rewards_enabled = false` and `clock_override_enabled = false`.
- [ ] Email confirmations on; 6-digit code templates installed; real SMTP sender configured.
- [ ] Auth rate limits reviewed for the tester count.
- [ ] `npm run test:db` passes against a local stack built from the same migrations.
- [ ] Retention job scheduled (or explicitly accepted as not running) and documented to testers.
- [ ] Backups / point-in-time recovery enabled on the project.

App
- [ ] `.env` holds only the project URL and publishable key; `EXPO_PUBLIC_DEMO_MODE=false`.
- [ ] `npm run check` passes; `npm run e2e:web` passes in Demo Mode.
- [ ] Development / preview builds made with EAS for iOS (and Android if in scope).
- [ ] Manual device pass: sign-up with code, invite link on a second phone, screenshot
      check-in from the photo library (HEIC conversion, permission denied path),
      review, rejection + resubmission, admin adjustment, dispute, chat on poor network,
      large text, VoiceOver/TalkBack spot checks, local reminders.
- [ ] Privacy text reviewed by the product owner; testers told it is a beta for adults.
- [ ] App Store / Play listing privacy answers: photo access (user-selected), email, user content.

Product decisions to confirm (see `docs/DECISIONS.md`)
- [ ] Deadline (noon next day), 24-hour dispute window, 48-hour admin reminder.
- [ ] Evidence retention of 30 days after a challenge ends.
- [ ] Self-review allowed with "Admin self-reviewed" label (must change before money).

## B. Live payments (separate, not started)

Nothing in this build collects, holds or pays out money. Before any work:
- [ ] Provider chosen and eligibility confirmed; jurisdictions and age restrictions decided.
- [ ] Sponsor fees vs participant deductions; failed funding; refunds; withdrawals; chargebacks.
- [ ] Webhook verification; idempotent ledger; payout eligibility; dispute holds; reconciliation.
- [ ] Stronger controls on self-review and admin overrides for funded challenges.
- [ ] Legal review of contests and prizes in each launch market.
- [ ] Only then: implement `PaymentProvider` (src/domain/rewards.ts) and a server-side live mode.

## C. Native screen-time integration (feasibility spike, not started)

Screenshots stay the evidence method until this is proven.
- [ ] Apple: Family Controls entitlement request and approval for distribution.
- [ ] Determine whether DeviceActivity can produce a per-day total for the person's
      own device that the app may legitimately send to a server (the report
      extension is sandboxed and designed not to export data).
- [ ] Consent and on-device UX; App Review constraints.
- [ ] Android: UsageStatsManager / Digital Wellbeing feasibility and Play policy.
- [ ] Decide whether a device total is evidence, a hint for the admin, or nothing.
- [ ] Never show a "Connect" button until a connection genuinely works.
