import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { zonedTimeToUtc } from '@/domain';
import type { ChallengeDetail, DraftInput } from '@/data/types';

import { adminClient, anonClient, closeDb, createUser, expectCode, resetClock, resetData, setClock, sql, TINY_PNG, TZ, type TestUser } from './support/harness';

/**
 * Authorization is proven against the real stack (auth, PostgREST, storage,
 * RLS), acting as real signed-in users with the public key — including direct
 * table and storage calls a hostile client could make. Hidden buttons prove nothing.
 */

const at = (date: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return zonedTimeToUtc(date, h ?? 0, m ?? 0, TZ);
};

let evidenceFile = '';
const evidence = () => ({ uri: evidenceFile, mime: 'image/png' as const, byteSize: TINY_PNG.length });
let n = 0;
const key = (p: string) => `${p}-${String((n += 1)).padStart(6, '0')}`;

let owner: TestUser; // Circle A owner + challenge admin
let player: TestUser; // Circle A member + participant
let peer: TestUser; // Circle A member + participant
let outsider: TestUser; // owns Circle B only
let circleA = '';
let circleB = '';
let challenge: ChallengeDetail;
let playerPid = '';
let peerPid = '';

const draft = (circleId: string, overrides: Partial<DraftInput> = {}): DraftInput => ({
  circleId,
  name: 'Screen Time Showdown',
  description: '',
  habitType: 'screen_time',
  metricUnit: 'minutes',
  timezone: TZ,
  target: 120,
  comparator: 'lte',
  requiredDays: 2,
  verification: 'evidence',
  startDate: '2026-03-03',
  endDate: '2026-03-05',
  draftStep: 5,
  ...overrides,
});

beforeAll(async () => {
  await resetData();
  const dir = await mkdtemp(path.join(tmpdir(), 'uplift-authz-'));
  evidenceFile = path.join(dir, 'proof.png');
  await writeFile(evidenceFile, TINY_PNG);
  await setClock(at('2026-03-02', '10:00'));

  owner = await createUser('Olive');
  player = await createUser('Pat');
  peer = await createUser('Quinn');
  outsider = await createUser('Rae');

  circleA = (await owner.repo.createCircle({ name: 'Circle A', timezone: TZ })).id;
  const { code } = await owner.repo.createInvite({ circleId: circleA });
  await player.repo.redeemInvite({ code, idempotencyKey: key('join') });
  await peer.repo.redeemInvite({ code, idempotencyKey: key('join') });
  circleB = (await outsider.repo.createCircle({ name: 'Circle B', timezone: TZ })).id;

  const created = await owner.repo.saveDraft(draft(circleA));
  challenge = await owner.repo.publishChallenge({ challengeId: created.id, expectedRevision: created.revision, joinAsParticipant: false });
  playerPid = (await player.repo.joinChallenge({ challengeId: challenge.id, acceptedVersionId: challenge.rules.id })).viewer.participantId!;
  peerPid = (await peer.repo.joinChallenge({ challengeId: challenge.id, acceptedVersionId: challenge.rules.id })).viewer.participantId!;

  // Day one is over; the player has one screenshot waiting for review.
  await setClock(at('2026-03-04', '08:00'));
  await player.repo.submitCheckin({ challengeId: challenge.id, date: '2026-03-03', value: 95, evidence: evidence(), idempotencyKey: key('d1') });
  await owner.repo.sendMessage({ circleId: circleA, text: 'hello circle', clientId: key('msg') });
}, 180_000);

afterAll(async () => {
  await resetClock();
  await closeDb();
});

describe('non-members', () => {
  it('cannot read Circle, challenge, chat or record rows directly', async () => {
    for (const table of ['circles', 'circle_members', 'challenges', 'participants', 'messages', 'daily_records', 'submissions', 'evidence', 'audit_events', 'reward_previews']) {
      const { data, error } = await outsider.client.from(table).select('*').limit(50);
      expect(error).toBeNull();
      const rows = (data ?? []) as Record<string, unknown>[];
      // The outsider only ever sees rows of their own Circle B.
      expect(rows.every((row) => row.circle_id === circleB || row.id === circleB)).toBe(true);
    }
    const { data: messages } = await outsider.client.from('messages').select('id').eq('circle_id', circleA);
    expect(messages).toEqual([]);
  });

  it('cannot use the server functions either', async () => {
    await expectCode(outsider.repo.getCircle(circleA), 'NOT_FOUND');
    await expectCode(outsider.repo.getChallenge(challenge.id), 'NOT_FOUND');
    await expectCode(outsider.repo.listMessages({ circleId: circleA }), 'NOT_FOUND');
    await expectCode(outsider.repo.getReviewQueue(challenge.id), 'NOT_FOUND');
    await expectCode(outsider.repo.listAudit({ challengeId: challenge.id }), 'NOT_FOUND');
  });

  it('signed-out clients can read nothing and call nothing but an invite preview', async () => {
    const anon = anonClient();
    for (const table of ['profiles', 'circles', 'challenges', 'messages', 'daily_records']) {
      const { data, error } = await anon.from(table).select('*').limit(5);
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
    expect((await anon.rpc('get_home')).error).not.toBeNull();
    const preview = await anon.rpc('preview_invite', { p_code: 'ZZZZ-ZZZZ-ZZZZ' });
    expect(preview.error).toBeNull();
    expect(preview.data).toEqual({ status: 'invalid' });
  });

  it('profiles expose only basic fields, and only to people sharing a Circle', async () => {
    const { data: seen } = await outsider.client.from('profiles').select('id, display_name');
    expect((seen ?? []).map((p) => p.id)).toEqual([outsider.id]);
    const { data: shared } = await player.client.from('profiles').select('id, display_name');
    expect((shared ?? []).map((p) => p.display_name).sort()).toEqual(['Olive', 'Pat', 'Quinn']);
    // Time zone and other private columns are not selectable at all; email never lives here.
    expect((await player.client.from('profiles').select('timezone')).error).not.toBeNull();
    expect((await player.client.from('profiles').select('email')).error).not.toBeNull();
  });
});

describe('members cannot write around the server functions', () => {
  it('cannot edit a peer’s check-in or their own outcome', async () => {
    const [record] = await sql<{ id: string }>('select r.id from public.daily_records r where r.participant_id = $1', [playerPid]);
    for (const client of [peer.client, player.client]) {
      const update = await client.from('daily_records').update({ outcome: 'success', provenance: 'evidence_reviewed' }).eq('id', record!.id).select();
      expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);
      const insert = await client.from('reviews').insert({ submission_id: record!.id, reviewer_id: player.id, decision: 'approved' });
      expect(insert.error).not.toBeNull();
    }
    const [after] = await sql<{ outcome: string }>('select outcome from public.daily_records where id = $1', [record!.id]);
    expect(after!.outcome).toBe('pending');
    // A peer cannot even open someone else's day.
    await expectCode(peer.repo.getDay({ challengeId: challenge.id, date: '2026-03-03', participantId: playerPid }), 'FORBIDDEN');
  });

  it('cannot promote themselves', async () => {
    const direct = await player.client.from('circle_members').update({ role: 'owner' }).eq('user_id', player.id).select();
    expect(direct.error !== null || (direct.data ?? []).length === 0).toBe(true);
    await expectCode(player.repo.setMemberRole({ circleId: circleA, userId: player.id, role: 'admin' }), 'FORBIDDEN');
    await expectCode(player.repo.assignChallengeAdmin({ challengeId: challenge.id, userId: player.id }), 'FORBIDDEN');
    const admins = await player.client.from('challenge_admins').insert({ challenge_id: challenge.id, user_id: player.id, assigned_by: player.id });
    expect(admins.error).not.toBeNull();
    const [row] = await sql<{ role: string }>('select role from public.circle_members where user_id = $1', [player.id]);
    expect(row!.role).toBe('member');
  });

  it('cannot forge a system message, an audit event or a notification', async () => {
    const forged = await player.client.from('messages').insert({ circle_id: circleA, author_id: null, text: 'Pat hit the goal.', type: 'system' });
    expect(forged.error).not.toBeNull();
    const audit = await player.client.from('audit_events').insert({ circle_id: circleA, action: 'day.overridden', actor_id: owner.id });
    expect(audit.error).not.toBeNull();
    const notification = await player.client.from('notifications').insert({ recipient_id: peer.id, type: 'review_approved', dedupe_key: 'x' });
    expect(notification.error).not.toBeNull();
    // The real send path always records the caller as author and 'user' as type.
    const sent = await player.repo.sendMessage({ circleId: circleA, text: 'just me', clientId: key('msg') });
    expect(sent).toMatchObject({ kind: 'user' });
    expect(sent.author?.userId).toBe(player.id);
    expect(await sql("select 1 from public.messages where type = 'system' and text = 'Pat hit the goal.'")).toEqual([]);
  });

  it('cannot change lifecycle state or rules directly', async () => {
    const status = await owner.client.from('challenges').update({ status: 'completed' }).eq('id', challenge.id).select();
    expect(status.error !== null || (status.data ?? []).length === 0).toBe(true);
    const rules = await owner.client.from('rule_versions').update({ target: 600 }).eq('challenge_id', challenge.id).select();
    expect(rules.error !== null || (rules.data ?? []).length === 0).toBe(true);
    expect((await owner.repo.getChallenge(challenge.id)).status).toBe('active');
  });
});

describe('admin scope', () => {
  it('an admin of Circle B cannot review, override or see proof in Circle A', async () => {
    const queue = await owner.repo.getReviewQueue(challenge.id);
    const item = queue.items[0]!;
    await expectCode(outsider.repo.reviewSubmission({ submissionId: item.submissionId, decision: 'approve', expectedRevision: item.recordRevision }), 'NOT_FOUND');
    await expectCode(outsider.repo.overrideDay({ participantId: playerPid, date: '2026-03-03', outcome: 'success', reason: 'From another Circle', expectedRevision: item.recordRevision }), 'NOT_FOUND');
    await expectCode(outsider.repo.getEvidenceUrl(item.evidenceId!), 'NOT_FOUND');
  });

  it('a Circle owner without a challenge-admin assignment gets no evidence access', async () => {
    // Pat creates a challenge in Circle A; Olive owns the Circle but is not its admin.
    await setClock(at('2026-03-04', '08:30'));
    const created = await player.repo.saveDraft(draft(circleA, { name: 'Pat’s challenge', startDate: '2026-03-05', endDate: '2026-03-06', requiredDays: 1 }));
    const published = await player.repo.publishChallenge({ challengeId: created.id, expectedRevision: created.revision, joinAsParticipant: true });
    expect(published.admins.map((a) => a.userId)).toEqual([player.id]);
    await expectCode(owner.repo.getReviewQueue(published.id), 'FORBIDDEN');
    // Appointing an admin is explicit and logged.
    const appointed = await owner.repo.assignChallengeAdmin({ challengeId: published.id, userId: owner.id });
    expect(appointed.admins.map((a) => a.userId).sort()).toEqual([owner.id, player.id].sort());
    const audit = await player.repo.listAudit({ challengeId: published.id });
    expect(audit.items.some((e) => e.action === 'admin.assigned' && e.actor?.userId === owner.id)).toBe(true);
  });
});

describe('evidence privacy through real storage policies', () => {
  let path = '';
  beforeAll(async () => {
    const [row] = await sql<{ private_object_path: string }>('select private_object_path from public.evidence limit 1');
    path = row!.private_object_path;
  });

  it('the bucket is private', async () => {
    const [bucket] = await sql<{ public: boolean; file_size_limit: string }>("select public, file_size_limit from storage.buckets where id = 'evidence'");
    expect(bucket).toMatchObject({ public: false });
    expect(Number(bucket!.file_size_limit)).toBe(10 * 1024 * 1024);
    const res = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/evidence/${path}`);
    expect(res.ok).toBe(false);
  });

  it('the participant and the assigned admin can mint a short-lived URL; a peer and an outsider cannot', async () => {
    for (const user of [player, owner]) {
      const signed = await user.client.storage.from('evidence').createSignedUrl(path, 60);
      expect(signed.error).toBeNull();
      const res = await fetch(signed.data!.signedUrl);
      expect(res.status).toBe(200);
      expect((await res.arrayBuffer()).byteLength).toBe(TINY_PNG.length);
    }
    for (const user of [peer, outsider]) {
      const signed = await user.client.storage.from('evidence').createSignedUrl(path, 60);
      expect(signed.error).not.toBeNull();
      const download = await user.client.storage.from('evidence').download(path);
      expect(download.error).not.toBeNull();
    }
  });

  it('nobody can upload outside a staged destination, overwrite or delete proof', async () => {
    const stray = await player.client.storage.from('evidence').upload(`${player.id}/anything.png`, TINY_PNG, { contentType: 'image/png' });
    expect(stray.error).not.toBeNull();
    const intoPeer = await peer.client.storage.from('evidence').upload(path, TINY_PNG, { contentType: 'image/png', upsert: true });
    expect(intoPeer.error).not.toBeNull();
    await player.client.storage.from('evidence').remove([path]);
    expect(await sql("select 1 from storage.objects where bucket_id = 'evidence' and name = $1", [path])).toHaveLength(1);
  });

  it('wrong file types are refused by the storage service', async () => {
    const ticket = await peer.client.rpc('begin_evidence_upload', { p_challenge_id: challenge.id, p_local_date: '2026-03-03', p_mime: 'image/png', p_byte_size: 100 });
    expect(ticket.error).toBeNull();
    const upload = await peer.client.storage.from('evidence').upload(ticket.data.path, Buffer.from('<html></html>'), { contentType: 'text/html' });
    expect(upload.error).not.toBeNull();
  });

  it('a submission cannot claim evidence that was never uploaded', async () => {
    const ticket = await peer.client.rpc('begin_evidence_upload', { p_challenge_id: challenge.id, p_local_date: '2026-03-03', p_mime: 'image/png', p_byte_size: 100 });
    const submit = await peer.client.rpc('submit_checkin', {
      p_challenge_id: challenge.id, p_local_date: '2026-03-03', p_value: 60, p_upload_id: ticket.data.upload_id, p_idempotency_key: key('ghost'), p_late: false,
    });
    expect(submit.error?.message).toBe('UPLOAD_INCOMPLETE');
    // And nothing was left behind claiming evidence exists.
    expect(await sql('select 1 from public.daily_records where participant_id = $1', [peerPid])).toEqual([]);
    // Nor can someone attach another person's staged upload.
    const stolen = await player.client.rpc('submit_checkin', {
      p_challenge_id: challenge.id, p_local_date: '2026-03-03', p_value: 60, p_upload_id: ticket.data.upload_id, p_idempotency_key: key('steal'), p_late: false,
    });
    expect(stolen.error).not.toBeNull();
  });
});

describe('duplicates and concurrency', () => {
  it('concurrent reviews of the same submission: exactly one wins', async () => {
    const queue = await owner.repo.getReviewQueue(challenge.id);
    const item = queue.items.find((i) => i.person.userId === player.id)!;
    const attempt = () => owner.client.rpc('review_submission', {
      p_submission_id: item.submissionId, p_decision: 'approve', p_corrected_value: null, p_reason: null, p_expected_revision: item.recordRevision,
    });
    const results = await Promise.all([attempt(), attempt(), attempt()]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error).map((r) => r.error!.message).sort()).toEqual(['REVISION_CONFLICT', 'REVISION_CONFLICT']);
    expect(await sql('select 1 from public.reviews where submission_id = $1', [item.submissionId])).toHaveLength(1);
  });

  it('concurrent duplicate joins and invite redemptions create one row and use one seat', async () => {
    const joiner = await createUser('Sam');
    const { code } = await owner.repo.createInvite({ circleId: circleA, maxUses: 5 });
    const results = await Promise.all([1, 2, 3, 4].map(() => joiner.client.rpc('redeem_invite', { p_code: code, p_idempotency_key: key('dup') })));
    expect(results.every((r) => !r.error && r.data.status === 'ok')).toBe(true);
    expect(await sql('select 1 from public.circle_members where circle_id = $1 and user_id = $2', [circleA, joiner.id])).toHaveLength(1);
    const [invite] = await sql<{ use_count: number }>('select use_count from public.invitations where token_hash = app.hash_invite_code($1)', [code]);
    expect(invite!.use_count).toBe(1);
  });

  it('retried increments, check-ins and messages never duplicate', async () => {
    await setClock(at('2026-03-04', '09:00'));
    const created = await owner.repo.saveDraft(draft(circleA, { name: 'Pushups', habitType: 'pushups', metricUnit: 'reps', target: 50, comparator: 'gte', verification: 'self_report', startDate: '2026-03-05', endDate: '2026-03-06', requiredDays: 1 }));
    const pushups = await owner.repo.publishChallenge({ challengeId: created.id, expectedRevision: created.revision, joinAsParticipant: true });
    await setClock(at('2026-03-05', '10:00'));
    const repKey = key('reps');
    const reps = await Promise.all([1, 2, 3].map(() => owner.client.rpc('add_reps', { p_challenge_id: pushups.id, p_local_date: '2026-03-05', p_amount: 20, p_idempotency_key: repKey })));
    expect(reps.filter((r) => r.error).length).toBe(0);
    const day = await owner.repo.getDay({ challengeId: pushups.id, date: '2026-03-05' });
    expect(day.record?.effectiveValue).toBe(20);
    expect(day.increments).toHaveLength(1);

    const clientId = key('msg');
    const sends = await Promise.all([1, 2, 3].map(() => owner.client.rpc('send_message', { p_circle_id: circleA, p_text: 'once', p_client_id: clientId })));
    expect(new Set(sends.map((s) => s.data?.id)).size).toBe(1);
    expect(await sql("select 1 from public.messages where text = 'once'")).toHaveLength(1);
  });
});

describe('corrections are atomic and audited', () => {
  it('an override writes its audit event in the same transaction', async () => {
    await setClock(at('2026-03-05', '13:00')); // day two (Mar 4) is past its deadline
    const before = await sql('select id from public.audit_events');
    // A failing override (no reason) leaves no record, override or audit row behind.
    await expectCode(owner.repo.overrideDay({ participantId: peerPid, date: '2026-03-04', outcome: 'success', reason: '', expectedRevision: 0 }), 'VALIDATION');
    expect(await sql('select id from public.audit_events')).toHaveLength(before.length);
    expect(await sql('select 1 from public.daily_records where participant_id = $1 and local_date = $2', [peerPid, '2026-03-04'])).toEqual([]);

    const adjusted = await owner.repo.overrideDay({ participantId: peerPid, date: '2026-03-04', outcome: 'success', value: 90, reason: 'Checked in person', expectedRevision: 0 });
    expect(adjusted.record?.provenance).toBe('admin_adjusted');
    const rows = await sql<{ action: string; reason: string; before: unknown; after: unknown; txid_same: boolean }>(
      `select a.action, a.reason, a.before, a.after, a.xmin::text = o.xmin::text as txid_same
       from public.audit_events a join public.overrides o on o.daily_record_id = $1
       where a.action = 'day.overridden' and a.subject_user_id = $2`,
      [adjusted.record!.id, peer.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'Checked in person', before: { outcome: 'missed', value: null }, after: { outcome: 'success', value: 90 }, txid_same: true });
    // Audit events are append-only, even for the database owner's API role.
    await expect(sql("update public.audit_events set reason = 'rewritten' where action = 'day.overridden'")).rejects.toThrow(/FORBIDDEN/);
  });
});

describe('removed members', () => {
  it('lose access to Circle data, chat and their own evidence URLs', async () => {
    await owner.repo.removeMember({ circleId: circleA, userId: player.id, reason: 'Testing removal' });
    await expectCode(player.repo.getCircle(circleA), 'NOT_FOUND');
    await expectCode(player.repo.getChallenge(challenge.id), 'NOT_FOUND');
    await expectCode(player.repo.listMessages({ circleId: circleA }), 'NOT_FOUND');
    await expectCode(player.repo.sendMessage({ circleId: circleA, text: 'still here?', clientId: key('msg') }), 'NOT_FOUND');
    const { data } = await player.client.from('messages').select('id').eq('circle_id', circleA);
    expect(data).toEqual([]);
    const [row] = await sql<{ private_object_path: string; id: string }>('select private_object_path, id from public.evidence where uploaded_by = $1 limit 1', [player.id]);
    await expectCode(player.repo.getEvidenceUrl(row!.id), 'NOT_FOUND');
    expect((await player.client.storage.from('evidence').createSignedUrl(row!.private_object_path, 60)).error).not.toBeNull();
    // Their history stays for the remaining members, marked as removed.
    const detail = await owner.repo.getChallenge(challenge.id);
    expect(detail.standings.find((s) => s.person.userId === player.id)).toMatchObject({ removed: true, rank: null, successfulDays: 1 });
  });
});

describe('payments cannot be enabled', () => {
  it('there is no live reward state, and previews need a server-side flag', async () => {
    const created = await owner.repo.saveDraft(draft(circleA, { name: 'Reward test', startDate: '2026-03-08', endDate: '2026-03-09', requiredDays: 1 }));
    // Direct writes are refused.
    expect((await owner.client.from('reward_previews').insert({ challenge_id: created.id, mode: 'demo_sponsor', gross_cents: 100, fee_bps: 0, demo_only: false, created_by: owner.id })).error).not.toBeNull();
    const mode = await owner.client.from('challenges').update({ reward_mode: 'live' }).eq('id', created.id).select();
    expect(mode.error !== null || (mode.data ?? []).length === 0).toBe(true);
    // Unknown modes are refused even with the demo flag on.
    expect((await owner.client.rpc('set_reward_preview', { p_challenge_id: created.id, p_mode: 'live', p_gross_cents: 100, p_fee_bps: 0 })).error?.message).toBe('LIVE_PAYMENTS_DISABLED');
    // The schema itself cannot hold a non-demo row or a live mode.
    await expect(sql("insert into public.reward_previews (challenge_id, demo_only, mode, gross_cents, fee_bps, created_by) values ($1, false, 'demo_pot', 100, 0, $2)", [created.id, owner.id])).rejects.toThrow();
    await expect(sql("update public.challenges set reward_mode = 'live' where id = $1", [created.id])).rejects.toThrow();

    // With the flag off (as in every migration), even a demo preview is refused.
    await sql("update app.config set value = 'false' where key = 'demo_rewards_enabled'");
    try {
      await expectCode(owner.repo.setRewardPreview({ challengeId: created.id, mode: 'demo_sponsor', grossCents: 10000, feeBps: 500 }), 'LIVE_PAYMENTS_DISABLED');
    } finally {
      await sql("update app.config set value = 'true' where key = 'demo_rewards_enabled'");
    }
    const preview = await owner.repo.setRewardPreview({ challengeId: created.id, mode: 'demo_sponsor', grossCents: 10000, feeBps: 500 });
    expect(preview.reward).toMatchObject({ demoOnly: true, grossCents: 10000 });
    // API roles cannot flip the flag or move the clock.
    expect((await owner.client.schema('app' as never).from('config').select('*')).error).not.toBeNull();
  });
});

describe('finalization', () => {
  it('is idempotent under concurrent calls and writes one completion event', async () => {
    await setClock(at('2026-03-08', '13:00')); // long after the final deadline and every window
    const results = await Promise.all([owner, peer, owner].map((u) => u.client.rpc('finalize_challenge', { p_challenge_id: challenge.id })));
    expect(results.every((r) => !r.error && r.data.status === 'completed')).toBe(true);
    expect(new Set(results.map((r) => r.data.completed_at)).size).toBe(1);
    expect(await sql("select 1 from public.audit_events where challenge_id = $1 and action = 'challenge.completed'", [challenge.id])).toHaveLength(1);
    expect(await sql("select 1 from public.notifications where type = 'challenge_completed' and entity_id = $1 and recipient_id = $2", [challenge.id, peer.id])).toHaveLength(1);
  });
});

describe('account deletion', () => {
  it('removes private evidence, revokes the session and leaves an anonymous tombstone', async () => {
    const leaver = await createUser('Tess');
    const { code } = await owner.repo.createInvite({ circleId: circleA });
    await leaver.repo.redeemInvite({ code, idempotencyKey: key('join') });
    const created = await owner.repo.saveDraft(draft(circleA, { name: 'Deletion test', startDate: '2026-03-09', endDate: '2026-03-10', requiredDays: 1 }));
    const published = await owner.repo.publishChallenge({ challengeId: created.id, expectedRevision: created.revision, joinAsParticipant: false });
    await leaver.repo.joinChallenge({ challengeId: published.id, acceptedVersionId: published.rules.id });
    await setClock(at('2026-03-10', '08:00'));
    await leaver.repo.submitCheckin({ challengeId: published.id, date: '2026-03-09', value: 80, evidence: evidence(), idempotencyKey: key('del') });
    await leaver.repo.sendMessage({ circleId: circleA, text: 'my last words', clientId: key('msg') });
    expect(await sql("select 1 from storage.objects where bucket_id = 'evidence' and owner_id = $1", [leaver.id])).toHaveLength(1);

    await leaver.repo.deleteAccount();

    expect(await sql("select 1 from storage.objects where bucket_id = 'evidence' and owner_id = $1", [leaver.id])).toEqual([]);
    expect(await sql('select 1 from auth.users where id = $1', [leaver.id])).toEqual([]);
    const [tombstone] = await sql<{ display_name: string; deleted: boolean; auth_user_id: string | null }>(
      'select display_name, deleted_at is not null as deleted, auth_user_id from public.profiles where id = $1', [leaver.id]);
    expect(tombstone).toEqual({ display_name: '', deleted: true, auth_user_id: null });
    expect(await sql("select 1 from public.messages where author_id = $1 and deleted_at is null", [leaver.id])).toEqual([]);
    // Shared history shows "Deleted member"; the old token gets nothing.
    const detail = await owner.repo.getChallenge(published.id);
    expect(detail.allParticipants.find((p) => p.person.userId === leaver.id)?.person).toMatchObject({ displayName: 'Deleted member', deleted: true });
    expect((await leaver.client.rpc('get_home')).error).not.toBeNull();
    expect((await adminClient().auth.admin.getUserById(leaver.id)).data.user).toBeNull();
  });

  it('refuses while the person is the last owner of a Circle with other members', async () => {
    await expectCode(owner.repo.beginAccountDeletion(), 'LAST_OWNER');
  });
});
