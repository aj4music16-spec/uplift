/**
 * Runs once before the backend test project.
 *
 * The database tests need a local Supabase stack (`npm run db:start`). They
 * connect straight to Postgres and through the real HTTP API. If the stack is
 * not reachable we fail fast with an explanation instead of 200 confusing
 * connection errors.
 */
const { Client } = require('pg');

module.exports = async function globalSetup() {
  const url = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const { rows } = await client.query("select to_regclass('public.challenges') as t");
    if (!rows[0].t) {
      throw new Error('The Uplift schema is not applied. Run `npm run db:reset` first.');
    }
  } catch (error) {
    throw new Error(
      `Backend tests need the local Supabase stack.\n` +
        `Start it with \`npm run db:start\` (Docker required), then \`npm run db:reset\`.\n` +
        `Tried: ${url}\nCause: ${error.message}`,
    );
  } finally {
    await client.end().catch(() => {});
  }
};
