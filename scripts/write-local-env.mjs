/**
 * Writes the LOCAL Supabase URL and publishable key into .env so the app talks
 * to `supabase start`. Only public values are written; the secret key is never
 * placed in .env because everything EXPO_PUBLIC_* ends up in the app bundle.
 *
 *   npm run db:start && npm run db:reset && npm run db:env
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const raw = execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const status = JSON.parse(raw.slice(raw.indexOf('{')));
const url = status.API_URL;
const key = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
if (!url || !key) throw new Error('Could not read the local API URL and publishable key from `supabase status`.');

const values = {
  EXPO_PUBLIC_APP_ENV: 'development',
  EXPO_PUBLIC_DEMO_MODE: 'false',
  EXPO_PUBLIC_SUPABASE_URL: url,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
};
const existing = existsSync('.env') ? readFileSync('.env', 'utf8').split('\n') : [];
const kept = existing.filter((line) => line.trim() && !Object.keys(values).some((k) => line.startsWith(`${k}=`)));
writeFileSync('.env', [...kept, ...Object.entries(values).map(([k, v]) => `${k}=${v}`)].join('\n') + '\n');
console.log(`Wrote .env for the local stack at ${url}.`);
console.log('A phone on your network cannot reach 127.0.0.1: replace it with your computer’s LAN IP to test on a device.');
