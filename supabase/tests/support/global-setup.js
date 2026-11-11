/**
 * Runs once before the backend test project.
 *
 * The database tests need a local Supabase stack (`npm run db:start`). They
 * talk to it through the real HTTP API (auth, PostgREST, storage) and use a
 * direct Postgres connection only to move the test clock and to assert on raw
 * rows. Keys are read from `supabase status`; nothing is hard-coded.
 */
const { execSync } = require('node:child_process');
const { Client } = require('pg');

module.exports = async function globalSetup() {
  const dbUrl = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  process.env.SUPABASE_DB_URL = dbUrl;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SECRET_KEY) {
    try {
      const raw = execSync('npx supabase status -o json', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
      const status = JSON.parse(raw.slice(raw.indexOf('{')));
      process.env.SUPABASE_URL = process.env.SUPABASE_URL || status.API_URL;
      process.env.SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || status.PUBLISHABLE_KEY || status.ANON_KEY;
      process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || status.SECRET_KEY || status.SERVICE_ROLE_KEY;
      process.env.MAILPIT_URL = process.env.MAILPIT_URL || status.MAILPIT_URL || status.INBUCKET_URL || 'http://127.0.0.1:54324';
    } catch (error) {
      throw new Error(
        'Backend tests need the local Supabase stack. Start it with `npm run db:start` (Docker required).\n' +
          `Could not read \`supabase status\`: ${error.message}`,
      );
    }
  }

  const client = new Client({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const { rows } = await client.query(
      "select to_regclass('public.challenges') as schema_ok, (select value from app.config where key = 'clock_override_enabled') as clock",
    );
    if (!rows[0].schema_ok) throw new Error('The Uplift schema is not applied. Run `npm run db:reset`.');
    if (rows[0].clock !== 'true') {
      throw new Error('The test clock is off. Run `npm run db:reset` so supabase/seed.sql enables it (local only).');
    }
    await client.query('update app.clock set offset_seconds = 0');
  } catch (error) {
    throw new Error(`Backend tests could not use the local database at ${dbUrl}.\nCause: ${error.message}`);
  } finally {
    await client.end().catch(() => {});
  }
};
