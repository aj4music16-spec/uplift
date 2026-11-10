-- LOCAL DEVELOPMENT ONLY.
--
-- This file runs after migrations on `supabase db reset` / `npm run db:reset`.
-- It is never applied to a hosted project by `supabase db push` unless you pass
-- --include-seed, and you should not.
--
-- It turns on two server-side flags that are OFF in every migration:
--   clock_override_enabled  lets tests and the dev seed move the server clock
--                           (app.clock.offset_seconds) to exercise deadlines.
--   demo_rewards_enabled    allows DEMO reward previews on local data.
--
-- It creates no users and no credentials. Sample people and challenges are
-- created through the real API by `npm run seed:dev`.

update app.config set value = 'true' where key in ('clock_override_enabled', 'demo_rewards_enabled');
update app.clock set offset_seconds = 0;
