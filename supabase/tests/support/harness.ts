import { readFile } from 'node:fs/promises';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';

import { SupabaseRepository } from '@/data/supabase/SupabaseRepository';
import type { LocalEvidence } from '@/data/types';
import { AppError, type ErrorCode } from '@/domain/errors';

/**
 * Test harness for the real local backend.
 *
 * Users are created through the auth admin API, then sign in with the public
 * key exactly like the app does. Everything a "user" does in a test goes
 * through the same HTTP API and RLS as production. The direct Postgres
 * connection is only for the test clock, cleanup and raw-row assertions.
 */

export const env = {
  url: process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321',
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
  secretKey: process.env.SUPABASE_SECRET_KEY ?? '',
  dbUrl: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  mailpitUrl: process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324',
};

export const TZ = 'America/New_York';

let pg: Client | null = null;

export async function db(): Promise<Client> {
  if (!pg) {
    pg = new Client({ connectionString: env.dbUrl });
    await pg.connect();
  }
  return pg;
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = await db();
  const result = await client.query(text, params);
  return result.rows as T[];
}

export async function closeDb(): Promise<void> {
  if (pg) {
    await pg.end().catch(() => undefined);
    pg = null;
  }
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export function anonClient(): SupabaseClient {
  return createClient(env.url, env.publishableKey, clientOptions);
}

let admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  if (!admin) admin = createClient(env.url, env.secretKey, clientOptions);
  return admin;
}

export const readEvidenceFromDisk = async (evidence: LocalEvidence): Promise<Uint8Array> => new Uint8Array(await readFile(evidence.uri));

export interface TestUser {
  id: string;
  email: string;
  password: string;
  name: string;
  client: SupabaseClient;
  repo: SupabaseRepository;
}

let userCounter = 0;

/** Creates a verified account, signs it in with the public key and completes the profile. */
export async function createUser(name: string, options: { timezone?: string; onboard?: boolean; color?: string; face?: number } = {}): Promise<TestUser> {
  userCounter += 1;
  const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.${Date.now().toString(36)}.${userCounter}@uplift.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const created = await adminClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);

  const client = anonClient();
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`signIn failed: ${signedIn.error.message}`);

  const repo = new SupabaseRepository(client, readEvidenceFromDisk);
  if (options.onboard !== false) {
    await repo.saveProfile({
      displayName: name,
      timezone: options.timezone ?? TZ,
      avatar: { color: (options.color as 'sun') ?? 'sun', face: options.face ?? userCounter % 10 },
    });
  }
  return { id: created.data.user.id, email, password, name, client, repo };
}

/** Moves the server clock (app.now()) to an instant. Local stacks only. */
export async function setClock(to: Date | string): Promise<void> {
  const target = typeof to === 'string' ? new Date(to) : to;
  await sql('update app.clock set offset_seconds = floor(extract(epoch from ($1::timestamptz - pg_catalog.now())))::bigint', [target.toISOString()]);
}

export async function resetClock(): Promise<void> {
  await sql('update app.clock set offset_seconds = 0');
}

export async function serverNow(): Promise<Date> {
  const rows = await sql<{ now: Date }>('select app.now() as now');
  return rows[0]!.now;
}

/** Removes every row and stored file so each test file starts clean. */
export async function resetData(): Promise<void> {
  const bucket = adminClient().storage.from('evidence');
  const paths = await sql<{ name: string }>("select name from storage.objects where bucket_id = 'evidence'");
  for (let i = 0; i < paths.length; i += 100) {
    await bucket.remove(paths.slice(i, i + 100).map((row) => row.name));
  }
  await sql('truncate table public.profiles, public.circles cascade');
  await sql('truncate table app.invite_attempts');
  await sql('delete from auth.users');
  await sql("update app.config set value = 'true' where key in ('clock_override_enabled', 'demo_rewards_enabled')");
  await resetClock();
}

/** Asserts that a promise rejects with a specific AppError code. */
export async function expectCode(promise: Promise<unknown>, code: ErrorCode): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code !== code) throw new Error(`Expected ${code} but got ${error.code}${error.message ? `: ${error.message}` : ''}`);
      return error;
    }
    throw error;
  }
  throw new Error(`Expected ${code} but the call succeeded`);
}

/** Calls a server function directly, the way a hostile client could. Returns the raw PostgREST result. */
export async function rawRpc(client: SupabaseClient, fn: string, args?: Record<string, unknown>) {
  return client.rpc(fn, args);
}

/** A tiny valid PNG (1x1), enough for the storage service. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
