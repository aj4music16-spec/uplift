/**
 * Evidence retention job (proposed beta policy).
 *
 *  - Deletes private evidence files 30 days after a challenge is completed or
 *    canceled, except for days with an open dispute.
 *  - Deletes staged uploads that were never attached to a submission.
 *
 * Runs with the service-role key, which must only ever live on a server or in
 * a scheduler's secret store — never in the app or in .env for Expo.
 *
 *   SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/retention.mjs [--dry-run] [--days 30]
 *
 * NOT scheduled by this repository. Until an operator schedules it (cron, a
 * CI schedule, or a Supabase scheduled function), nothing is deleted
 * automatically. See docs/BUILD_STATUS.md.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (service role). Never put that key in the app.');
  process.exit(1);
}
const dryRun = process.argv.includes('--dry-run');
const daysArg = process.argv.indexOf('--days');
const days = daysArg > -1 ? Number(process.argv[daysArg + 1]) : 30;

const client = createClient(url, key, { auth: { persistSession: false } });
const bucket = client.storage.from('evidence');

async function run() {
  const due = await client.rpc('maintenance_evidence_due', { p_retention_days: days });
  if (due.error) throw due.error;
  const abandoned = await client.rpc('maintenance_abandoned_uploads');
  if (abandoned.error) throw abandoned.error;
  console.log(`${due.data.length} evidence file(s) past retention, ${abandoned.data.length} abandoned upload(s).`);
  if (dryRun) return;

  for (let i = 0; i < due.data.length; i += 100) {
    const chunk = due.data.slice(i, i + 100);
    const removed = await bucket.remove(chunk.map((r) => r.object_path));
    if (removed.error) throw removed.error;
    const marked = await client.rpc('maintenance_mark_purged', { p_evidence_ids: chunk.map((r) => r.evidence_id) });
    if (marked.error) throw marked.error;
  }
  for (let i = 0; i < abandoned.data.length; i += 100) {
    const chunk = abandoned.data.slice(i, i + 100);
    const removed = await bucket.remove(chunk.map((r) => r.object_path));
    if (removed.error) throw removed.error;
    const forgot = await client.rpc('maintenance_forget_uploads', { p_upload_ids: chunk.map((r) => r.upload_id) });
    if (forgot.error) throw forgot.error;
  }
  console.log('Retention run complete.');
}

run().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
