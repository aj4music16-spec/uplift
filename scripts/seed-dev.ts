/**
 * Seeds a LOCAL Supabase stack with "The Inner Circle" by replaying the same
 * scenario Demo Mode uses, through the real API (auth, server functions,
 * storage, RLS). Refuses to run against anything but localhost.
 *
 *   npm run db:reset && npm run seed:dev
 *
 * It creates six local test accounts with a random password printed once.
 * There are no fixed credentials. Uploaded "screenshots" are synthetic
 * placeholder images, clearly not real phone data.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

import { seedInnerCircle } from '../src/data/scenario/innerCircle';
import { SupabaseRepository } from '../src/data/supabase/SupabaseRepository';
import { dateKeyAt } from '../src/domain/time';

// A 1x1 PNG. Real evidence is reviewed by people; these are placeholders.
const PLACEHOLDER = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function main() {
  const raw = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const status = JSON.parse(raw.slice(raw.indexOf('{')));
  const url: string = status.API_URL;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error(`Refusing to seed a non-local backend: ${url}`);
  const publishable: string = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const secret: string = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  const db = new Client({ connectionString: status.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  await db.connect();
  const [{ clock }] = (await db.query("select value as clock from app.config where key = 'clock_override_enabled'")).rows;
  if (clock !== 'true') throw new Error('The local test clock is off. Run `npm run db:reset` first (supabase/seed.sql enables it locally).');

  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const password = `local-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}`;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const dir = mkdtempSync(path.join(tmpdir(), 'uplift-seed-'));
  const accounts: string[] = [];

  await seedInnerCircle({
    timeZone,
    today: dateKeyAt(new Date(), timeZone),
    async createPerson(key, name, avatar) {
      const email = `${key}@uplift.local`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw new Error(`Could not create ${email}: ${created.error.message}. Run npm run db:reset first.`);
      const client = createClient(url, publishable, { auth: { persistSession: false } });
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error) throw signed.error;
      const repo = new SupabaseRepository(client, async () => new Uint8Array(PLACEHOLDER));
      await repo.saveProfile({ displayName: name, timezone: timeZone, avatar });
      accounts.push(email);
      return { id: created.data.user!.id, repo };
    },
    async setNow(instant) {
      await db.query('update app.clock set offset_seconds = floor(extract(epoch from ($1::timestamptz - pg_catalog.now())))::bigint', [instant.toISOString()]);
    },
    evidence(spec) {
      const file = path.join(dir, `${spec.date}-${spec.minutes}-${spec.view ?? 'day'}.png`);
      writeFileSync(file, PLACEHOLDER);
      return { uri: file, mime: 'image/png', byteSize: PLACEHOLDER.length };
    },
  });

  await db.query('update app.clock set offset_seconds = 0');
  await db.end();
  console.log('Seeded The Inner Circle on the local stack.');
  console.log(`Sign in with any of: ${accounts.join(', ')}`);
  console.log(`Local password for all six: ${password}`);
  console.log('Emails go to the local mail catcher (Mailpit) at http://127.0.0.1:54324.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
