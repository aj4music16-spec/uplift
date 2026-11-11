import type { Repository } from '@/data/repository';
import type { ChallengeDetail, DraftInput, LocalEvidence, StandingView } from '@/data/types';
import { AppError, zonedTimeToUtc, type ErrorCode } from '@/domain';

/**
 * The critical two-user journey, written once against the Repository
 * interface and run against BOTH implementations:
 *   - tests/demo/journey.demo.test.ts        DemoRepository, fixed clock, no backend
 *   - tests/integration/journey.supabase.test.ts  real local Supabase stack
 *
 * It covers the specification's end-to-end flows 1-9 at the data boundary:
 * create and join a Circle, publish and accept a screen-time challenge, upload
 * proof with a controlled clock, review, reject and resubmit, admin
 * correction, dispute and finalization blocking, chat, completion and rematch.
 */

export interface Actor {
  id: string;
  name: string;
  repo: Repository;
}

export interface JourneyHarness {
  createUser(name: string): Promise<Actor>;
  /** Moves the clock both repositories and the server agree on. */
  setNow(instant: Date): Promise<void>;
  /** A local image the repository can upload as evidence. */
  evidence(): LocalEvidence;
  teardown(): Promise<void>;
}

const TZ = 'America/New_York';
const at = (date: string, time: string): Date => {
  const [hour, minute] = time.split(':').map(Number);
  return zonedTimeToUtc(date, hour ?? 0, minute ?? 0, TZ);
};

async function expectCode(promise: Promise<unknown>, code: ErrorCode): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code !== code) throw new Error(`Expected ${code} but got ${error.code}${error.message ? ` (${error.message})` : ''}`);
      return error;
    }
    throw error;
  }
  throw new Error(`Expected ${code} but the call succeeded`);
}

const row = (detail: ChallengeDetail, actor: Actor): StandingView => {
  const found = detail.standings.find((s) => s.person.userId === actor.id);
  if (!found) throw new Error(`${actor.name} is not in the standings`);
  return found;
};

export function defineJourney(label: string, make: () => Promise<JourneyHarness>): void {
  describe(`two-user journey — ${label}`, () => {
    let h: JourneyHarness;
    let ava: Actor; // creates the Circle and the challenge; challenge admin
    let ben: Actor; // joins and plays
    let cy: Actor; // never a member: the outsider
    let circleId = '';
    let challengeId = '';
    let benParticipantId = '';
    let day2RecordId = '';
    let day3RecordId = '';
    let key = 0;
    const nextKey = (prefix: string) => `${prefix}-${String((key += 1)).padStart(6, '0')}`;

    const draftInput = (): DraftInput => ({
      circleId,
      name: 'Screen Time Showdown',
      description: 'Two hours or less, every day.',
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
    });

    beforeAll(async () => {
      h = await make();
      await h.setNow(at('2026-03-02', '10:00'));
      ava = await h.createUser('Ava');
      ben = await h.createUser('Ben');
      cy = await h.createUser('Cy');
    }, 120_000);

    afterAll(async () => {
      await h?.teardown();
    });

    it('1. A creates a Circle, invites B, and B joins', async () => {
      const circle = await ava.repo.createCircle({ name: 'Test Circle', timezone: TZ });
      circleId = circle.id;
      expect(circle).toMatchObject({ role: 'owner', memberCount: 1, timezone: TZ });

      // Only Circle admins can invite.
      const { code } = await ava.repo.createInvite({ circleId });
      expect(code.replace(/-/g, '')).toHaveLength(12);

      const preview = await ben.repo.previewInvite(code);
      expect(preview).toMatchObject({ circleName: 'Test Circle', memberCount: 1, alreadyMember: false, inviterName: 'Ava', challenge: null });
      // A wrong code says nothing about why it failed.
      await expectCode(ben.repo.previewInvite('ZZZZ-ZZZZ-ZZZZ'), 'INVITE_INVALID');

      const joined = await ben.repo.redeemInvite({ code, idempotencyKey: nextKey('join') });
      expect(joined).toEqual({ circleId, challengeId: null, alreadyMember: false });
      // Redeeming again never consumes another use.
      const again = await ben.repo.redeemInvite({ code, idempotencyKey: nextKey('join') });
      expect(again.alreadyMember).toBe(true);
      const invites = await ava.repo.listInvites(circleId);
      expect(invites).toHaveLength(1);
      expect(invites[0]?.useCount).toBe(1);

      const detail = await ben.repo.getCircle(circleId);
      expect(detail.circle.role).toBe('member');
      expect(detail.members.map((m) => [m.displayName, m.role])).toEqual([
        ['Ava', 'owner'],
        ['Ben', 'member'],
      ]);

      // Members cannot invite, and outsiders cannot even see the Circle.
      await expectCode(ben.repo.createInvite({ circleId }), 'FORBIDDEN');
      await expectCode(cy.repo.getCircle(circleId), 'NOT_FOUND');
    });

    it('2. A publishes a screen-time challenge and B accepts the rules', async () => {
      const draft = await ava.repo.saveDraft(draftInput());
      challengeId = draft.id;
      expect(draft.status).toBe('draft');
      expect(draft.admins.map((p) => p.displayName)).toEqual(['Ava']);
      // Drafts are visible only to their admins.
      await expectCode(ben.repo.getChallenge(challengeId), 'NOT_FOUND');

      // Screen time can never be self-reported.
      const selfReport = await ava.repo.saveDraft({ ...draftInput(), id: challengeId, expectedRevision: draft.revision, verification: 'self_report' });
      await expectCode(
        ava.repo.publishChallenge({ challengeId, expectedRevision: selfReport.revision, joinAsParticipant: true }),
        'VALIDATION',
      );
      const fixed = await ava.repo.saveDraft({ ...draftInput(), id: challengeId, expectedRevision: selfReport.revision });
      // A stale revision cannot publish.
      await expectCode(ava.repo.publishChallenge({ challengeId, expectedRevision: draft.revision, joinAsParticipant: true }), 'REVISION_CONFLICT');

      const published = await ava.repo.publishChallenge({ challengeId, expectedRevision: fixed.revision, joinAsParticipant: true });
      expect(published.status).toBe('scheduled');
      expect(published.rules).toMatchObject({ version: 1, status: 'active', target: 120, comparator: 'lte', requiredDays: 2, verification: 'evidence' });
      expect(published.participantCount).toBe(1);
      expect(published.viewer).toMatchObject({ isAdmin: true });

      // B is invited, not enrolled.
      const seen = await ben.repo.getChallenge(challengeId);
      expect(seen.viewer.participantId).toBeNull();
      expect(seen.viewer.isAdmin).toBe(false);
      const inbox = await ben.repo.listNotifications({});
      expect(inbox.items.some((n) => n.type === 'challenge_invite')).toBe(true);

      // Stale terms can never enroll anyone.
      await expectCode(
        ben.repo.joinChallenge({ challengeId, acceptedVersionId: '00000000-0000-4000-8000-000000000000' }),
        'RULES_CHANGED',
      );
      const joined = await ben.repo.joinChallenge({ challengeId, acceptedVersionId: seen.rules.id });
      expect(joined.participantCount).toBe(2);
      benParticipantId = joined.viewer.participantId ?? '';
      expect(benParticipantId).not.toBe('');
      // Joining twice is a no-op.
      expect((await ben.repo.joinChallenge({ challengeId, acceptedVersionId: seen.rules.id })).participantCount).toBe(2);

      // Outsiders cannot see or join.
      await expectCode(cy.repo.getChallenge(challengeId), 'NOT_FOUND');
      await expectCode(cy.repo.joinChallenge({ challengeId, acceptedVersionId: seen.rules.id }), 'NOT_FOUND');

      // Nothing can be checked in before the start.
      await expectCode(
        ben.repo.submitCheckin({ challengeId, date: '2026-03-03', value: 90, evidence: h.evidence(), idempotencyKey: nextKey('early') }),
        'NOT_STARTED',
      );
    });

    it('3. with a controlled clock, B uploads a completed-day screenshot', async () => {
      // Midday on day one: the day is not over, so proof is meaningless.
      await h.setNow(at('2026-03-03', '12:00'));
      expect((await ben.repo.getChallenge(challengeId)).status).toBe('active');
      await expectCode(
        ben.repo.submitCheckin({ challengeId, date: '2026-03-03', value: 95, evidence: h.evidence(), idempotencyKey: nextKey('early') }),
        'DAY_NOT_FINISHED',
      );
      // Still not over at 11:59 pm.
      await h.setNow(at('2026-03-03', '23:59'));
      await expectCode(
        ben.repo.submitCheckin({ challengeId, date: '2026-03-03', value: 95, evidence: h.evidence(), idempotencyKey: nextKey('early') }),
        'DAY_NOT_FINISHED',
      );
      // Late joins are refused once it has started.
      await expectCode(cy.repo.joinChallenge({ challengeId, acceptedVersionId: '00000000-0000-4000-8000-000000000000' }), 'NOT_FOUND');

      await h.setNow(at('2026-03-04', '08:00'));
      // No self-reported checkbox for screen time: evidence is mandatory.
      await expectCode(
        ben.repo.submitCheckin({ challengeId, date: '2026-03-03', value: 95, evidence: null, idempotencyKey: nextKey('noproof') }),
        'EVIDENCE_REQUIRED',
      );

      const submitKey = nextKey('d1');
      const day = await ben.repo.submitCheckin({ challengeId, date: '2026-03-03', value: 95, evidence: h.evidence(), idempotencyKey: submitKey });
      expect(day.status).toBe('pending');
      expect(day.record).toMatchObject({ outcome: 'pending', provenance: null });
      expect(day.submissions).toHaveLength(1);
      expect(day.submissions[0]).toMatchObject({ version: 1, status: 'pending', enteredValue: 95, isLate: false });
      expect(day.submissions[0]?.evidence).not.toBeNull();

      // A retried request never creates a second version.
      const retry = await ben.repo.submitCheckin({ challengeId, date: '2026-03-03', value: 95, evidence: h.evidence(), idempotencyKey: submitKey });
      expect(retry.submissions).toHaveLength(1);

      // Pending proof adds no score.
      const detail = await ava.repo.getChallenge(challengeId);
      expect(row(detail, ben)).toMatchObject({ successfulDays: 0, pendingDays: 1 });
      expect(detail.pendingReviewCount).toBe(1);
      const home = await ben.repo.getHome();
      const card = home.challenges.find((c) => c.id === challengeId);
      expect(card?.myDays.map((d) => d.status)).toEqual(['pending', 'open', 'upcoming']);
    });

    it('4. A reviews it, and standings change only after the review', async () => {
      const queue = await ava.repo.getReviewQueue(challengeId);
      expect(queue.items).toHaveLength(1);
      const item = queue.items[0]!;
      expect(item).toMatchObject({ kind: 'review', enteredValue: 95, date: '2026-03-03', own: false });
      expect(item.evidenceId).not.toBeNull();

      // Evidence is private to the participant and assigned admins.
      expect((await ava.repo.getEvidenceUrl(item.evidenceId!)).url.length).toBeGreaterThan(10);
      expect((await ben.repo.getEvidenceUrl(item.evidenceId!)).url.length).toBeGreaterThan(10);
      await expectCode(cy.repo.getEvidenceUrl(item.evidenceId!), 'NOT_FOUND');
      // Only admins see the queue or decide.
      await expectCode(ben.repo.getReviewQueue(challengeId), 'FORBIDDEN');
      await expectCode(
        ben.repo.reviewSubmission({ submissionId: item.submissionId, decision: 'approve', expectedRevision: item.recordRevision }),
        'FORBIDDEN',
      );
      // A stale revision fails safely.
      await expectCode(
        ava.repo.reviewSubmission({ submissionId: item.submissionId, decision: 'approve', expectedRevision: item.recordRevision - 1 }),
        'REVISION_CONFLICT',
      );
      // Rejecting needs a reason.
      await expectCode(
        ava.repo.reviewSubmission({ submissionId: item.submissionId, decision: 'reject', reason: ' ', expectedRevision: item.recordRevision }),
        'VALIDATION',
      );

      const reviewed = await ava.repo.reviewSubmission({ submissionId: item.submissionId, decision: 'approve', expectedRevision: item.recordRevision });
      expect(reviewed.status).toBe('success');
      expect(reviewed.record).toMatchObject({ outcome: 'success', provenance: 'evidence_reviewed', effectiveValue: 95 });
      // The same version cannot be decided twice.
      await expectCode(
        ava.repo.reviewSubmission({
          submissionId: item.submissionId,
          decision: 'reject',
          reason: 'Changed my mind',
          expectedRevision: reviewed.record!.revision,
        }),
        'ALREADY_DECIDED',
      );

      let detail = await ben.repo.getChallenge(challengeId);
      expect(row(detail, ben)).toMatchObject({ successfulDays: 1, pendingDays: 0, rank: 1, tied: false });
      expect(row(detail, ava)).toMatchObject({ successfulDays: 0, rank: 2 });

      // The admin plays too. Exactly 120 minutes passes a 120-minute maximum,
      // and reviewing your own proof is labeled as such.
      const own = await ava.repo.submitCheckin({ challengeId, date: '2026-03-03', value: 120, evidence: h.evidence(), idempotencyKey: nextKey('a-d1') });
      const selfReviewed = await ava.repo.reviewSubmission({
        submissionId: own.submissions[0]!.id,
        decision: 'approve',
        expectedRevision: own.record!.revision,
      });
      expect(selfReviewed.record).toMatchObject({ outcome: 'success', provenance: 'admin_self_reviewed' });
      expect(selfReviewed.submissions[0]?.reviews[0]?.selfReview).toBe(true);

      detail = await ben.repo.getChallenge(challengeId);
      expect(detail.standings.map((s) => [s.person.displayName, s.successfulDays, s.rank, s.tied])).toEqual(
        expect.arrayContaining([
          ['Ava', 1, 1, true],
          ['Ben', 1, 1, true],
        ]),
      );
    });

    it('5. A rejects another entry; B sees the reason and resubmits; history remains', async () => {
      await h.setNow(at('2026-03-05', '08:00'));
      const first = await ben.repo.submitCheckin({ challengeId, date: '2026-03-04', value: 110, evidence: h.evidence(), idempotencyKey: nextKey('d2') });
      day2RecordId = first.record!.id;

      const rejected = await ava.repo.reviewSubmission({
        submissionId: first.submissions[0]!.id,
        decision: 'reject',
        reason: 'The date isn’t visible. Please send the Day view.',
        expectedRevision: first.record!.revision,
      });
      expect(rejected.status).toBe('rejected');

      const seen = await ben.repo.getDay({ challengeId, date: '2026-03-04' });
      expect(seen.status).toBe('rejected');
      expect(seen.submissions[0]?.reviews[0]).toMatchObject({ decision: 'rejected', reason: 'The date isn’t visible. Please send the Day view.' });
      const inbox = await ben.repo.listNotifications({});
      const notice = inbox.items.find((n) => n.type === 'review_rejected');
      expect(notice?.payload.reason).toBe('The date isn’t visible. Please send the Day view.');
      // A rejected day scores nothing.
      expect(row(await ben.repo.getChallenge(challengeId), ben).successfulDays).toBe(1);

      const second = await ben.repo.submitCheckin({ challengeId, date: '2026-03-04', value: 110, evidence: h.evidence(), idempotencyKey: nextKey('d2') });
      expect(second.status).toBe('pending');
      expect(second.submissions.map((s) => [s.version, s.status])).toEqual([
        [2, 'pending'],
        [1, 'rejected'],
      ]);
      // The rejection is still there, reason and all.
      expect(second.submissions[1]?.reviews[0]?.reason).toContain('Day view');

      // The admin reads 2h 10m on the screenshot: valid evidence, failed day.
      const corrected = await ava.repo.reviewSubmission({
        submissionId: second.submissions[0]!.id,
        decision: 'approve',
        correctedValue: 130,
        reason: 'The screenshot shows 2h 10m.',
        expectedRevision: second.record!.revision,
      });
      expect(corrected.status).toBe('fail');
      expect(corrected.record).toMatchObject({ outcome: 'fail', effectiveValue: 130, provenance: 'evidence_reviewed' });
      expect(corrected.submissions[0]?.reviews[0]).toMatchObject({ decision: 'approved', correctedValue: 130 });
      expect(row(await ben.repo.getChallenge(challengeId), ben).successfulDays).toBe(1);
    });

    it('7a. B opens a dispute and finalization is blocked', async () => {
      const disputed = await ben.repo.openDispute({ recordId: day2RecordId, reason: 'It shows 1h 50m on my phone.' });
      expect(disputed.disputes).toHaveLength(1);
      expect(disputed.disputes[0]).toMatchObject({ status: 'open', reason: 'It shows 1h 50m on my phone.' });
      await expectCode(ben.repo.openDispute({ recordId: day2RecordId, reason: 'Again, please.' }), 'DISPUTE_OPEN');
      // Only the participant can dispute their own day.
      await expectCode(ava.repo.openDispute({ recordId: day2RecordId, reason: 'Not mine to dispute.' }), 'FORBIDDEN');

      // Still running: cannot finalize.
      await expectCode(ava.repo.finalizeChallenge(challengeId), 'NOT_STARTED');

      // The activity window ended at midnight, but the last day's check-ins are open until noon.
      await h.setNow(at('2026-03-06', '08:00'));
      const inReview = await ava.repo.getChallenge(challengeId);
      expect(inReview.status).toBe('review');
      expect(inReview.finalization?.blockers.map((b) => b.code)).toEqual(expect.arrayContaining(['DEADLINE_NOT_REACHED', 'DISPUTE_OPEN']));
      await expectCode(ava.repo.finalizeChallenge(challengeId), 'DEADLINE_NOT_REACHED');

      await h.setNow(at('2026-03-06', '13:00'));
      await expectCode(ava.repo.finalizeChallenge(challengeId), 'DISPUTE_OPEN');
      expect((await ava.repo.getChallenge(challengeId)).readyToFinalize).toBe(false);
    });

    it('6. A manually corrects a day; B sees "Admin adjusted" and the audit reason', async () => {
      // B never submitted day three and the deadline has passed.
      const missed = await ben.repo.getDay({ challengeId, date: '2026-03-05' });
      expect(missed.status).toBe('missed');
      expect(missed.record).toBeNull();

      // An override needs a reason, and only an assigned admin may do it.
      await expectCode(
        ava.repo.overrideDay({ participantId: benParticipantId, date: '2026-03-05', outcome: 'success', reason: '', expectedRevision: 0 }),
        'VALIDATION',
      );
      await expectCode(
        ben.repo.overrideDay({ participantId: benParticipantId, date: '2026-03-05', outcome: 'success', reason: 'Trust me', expectedRevision: 0 }),
        'FORBIDDEN',
      );

      const adjusted = await ava.repo.overrideDay({
        participantId: benParticipantId,
        date: '2026-03-05',
        outcome: 'success',
        value: 100,
        reason: 'Phone was in for repair; I checked it in person.',
        expectedRevision: 0,
      });
      day3RecordId = adjusted.record!.id;
      expect(adjusted.status).toBe('success');
      // Never "Screenshot verified": provenance is admin_adjusted.
      expect(adjusted.record).toMatchObject({ outcome: 'success', provenance: 'admin_adjusted', effectiveValue: 100 });

      const seen = await ben.repo.getDay({ challengeId, date: '2026-03-05' });
      expect(seen.overrides).toHaveLength(1);
      expect(seen.overrides[0]).toMatchObject({
        priorOutcome: 'missed',
        newOutcome: 'success',
        newValue: 100,
        reason: 'Phone was in for repair; I checked it in person.',
      });
      expect(seen.overrides[0]?.actor.displayName).toBe('Ava');

      // The change history records actor, participant, date, old -> new and the reason.
      const audit = await ben.repo.listAudit({ challengeId });
      const event = audit.items.find((e) => e.action === 'day.overridden');
      expect(event).toMatchObject({
        localDate: '2026-03-05',
        reason: 'Phone was in for repair; I checked it in person.',
        before: { outcome: 'missed' },
        after: { outcome: 'success', value: 100 },
      });
      expect(event?.actor?.displayName).toBe('Ava');
      expect(event?.subject?.displayName).toBe('Ben');

      const detail = await ben.repo.getChallenge(challengeId);
      const mine = row(detail, ben);
      expect(mine.successfulDays).toBe(2);
      expect(mine.days.find((d) => d.date === '2026-03-05')).toMatchObject({ status: 'success', adjusted: true });
    });

    it('7b. the dispute is resolved, windows expire or are waived, then it can finalize', async () => {
      const queue = await ava.repo.getReviewQueue(challengeId);
      expect(queue.disputes).toHaveLength(1);
      const dispute = queue.disputes[0]!;
      await expectCode(ben.repo.resolveDispute({ disputeId: dispute.disputeId, upheld: true, resolution: 'I agree with myself' }), 'FORBIDDEN');

      const resolved = await ava.repo.resolveDispute({
        disputeId: dispute.disputeId,
        upheld: true,
        resolution: 'You were right: the total included a second device.',
        override: { outcome: 'success', value: 110 },
      });
      expect(resolved.disputes[0]).toMatchObject({ status: 'upheld', resolution: 'You were right: the total included a second device.' });
      expect(resolved.record).toMatchObject({ outcome: 'success', provenance: 'admin_adjusted', effectiveValue: 110 });

      // Both corrections opened a 24-hour dispute window.
      await expectCode(ava.repo.finalizeChallenge(challengeId), 'DISPUTE_WINDOW_OPEN');
      // B can waive their own window by acknowledging a decision...
      const acknowledged = await ben.repo.acknowledgeDecision(day2RecordId);
      expect(acknowledged.record?.acknowledgedAt).not.toBeNull();
      // ...but the other one is still open.
      await expectCode(ava.repo.finalizeChallenge(challengeId), 'DISPUTE_WINDOW_OPEN');
      const blocked = await ava.repo.getChallenge(challengeId);
      expect(blocked.finalization?.blockers).toEqual([expect.objectContaining({ code: 'DISPUTE_WINDOW_OPEN', count: 1 })]);

      await ben.repo.acknowledgeDecision(day3RecordId);
      expect((await ava.repo.getChallenge(challengeId)).readyToFinalize).toBe(true);
    });

    it('8. members chat and react; missed messages are recovered from durable rows', async () => {
      const first = await ava.repo.sendMessage({ circleId, text: 'Who is actually staying under 2 hours?', clientId: nextKey('msg') });
      expect(first).toMatchObject({ kind: 'user', text: 'Who is actually staying under 2 hours?' });
      expect(first.author?.displayName).toBe('Ava');
      // A retried send is deduplicated by the client id.
      const retried = await ava.repo.sendMessage({ circleId, text: 'Who is actually staying under 2 hours?', clientId: first.clientId! });
      expect(retried.id).toBe(first.id);

      const reacted = await ben.repo.toggleReaction({ messageId: first.id, emoji: '🔥' });
      expect(reacted.reactions).toEqual([{ emoji: '🔥', count: 1, mine: true }]);
      const forAva = (await ava.repo.listMessages({ circleId, limit: 50 })).items.find((m) => m.id === first.id);
      expect(forAva?.reactions).toEqual([{ emoji: '🔥', count: 1, mine: false }]);
      expect((await ben.repo.toggleReaction({ messageId: first.id, emoji: '🔥' })).reactions).toEqual([]);

      // B is "offline" while A sends three messages, then catches up.
      for (const text of ['one', 'two', 'three']) await ava.repo.sendMessage({ circleId, text, clientId: nextKey('msg') });
      const caughtUp = await ben.repo.listMessages({ circleId, limit: 100 });
      const userTexts = caughtUp.items.filter((m) => m.kind === 'user').map((m) => m.text);
      expect(userTexts).toEqual(['three', 'two', 'one', 'Who is actually staying under 2 hours?']);

      // Paging walks backwards without gaps or repeats.
      const page1 = await ben.repo.listMessages({ circleId, limit: 3 });
      expect(page1.items).toHaveLength(3);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await ben.repo.listMessages({ circleId, limit: 100, before: page1.nextCursor });
      const ids = [...page1.items, ...page2.items].map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(caughtUp.items.map((m) => m.id));

      // System events are server-generated and never carry proof.
      const system = caughtUp.items.filter((m) => m.kind === 'system');
      expect(system.every((m) => m.author === null)).toBe(true);
      const types = system.map((m) => m.event?.type);
      expect(types).toEqual(expect.arrayContaining(['member_joined', 'challenge_published', 'participant_joined', 'checkin_approved', 'admin_corrected']));
      expect(JSON.stringify(caughtUp.items)).not.toMatch(/evidence|signed|\.png|\.jpg/i);

      // Limits and outsiders.
      await expectCode(ava.repo.sendMessage({ circleId, text: 'x'.repeat(2001), clientId: nextKey('msg') }), 'VALIDATION');
      await expectCode(cy.repo.listMessages({ circleId }), 'NOT_FOUND');
      await expectCode(cy.repo.sendMessage({ circleId, text: 'hi', clientId: nextKey('msg') }), 'NOT_FOUND');
      await expectCode(cy.repo.toggleReaction({ messageId: first.id, emoji: '🔥' }), 'NOT_FOUND');
    });

    it('9. the challenge completes, standings are stable, and a rematch is a fresh draft', async () => {
      const done = await ava.repo.finalizeChallenge(challengeId);
      expect(done.status).toBe('completed');
      expect(done.completedAt).not.toBeNull();
      expect(done.standings.map((s) => [s.person.displayName, s.successfulDays, s.rank, s.qualified])).toEqual([
        ['Ben', 3, 1, true],
        ['Ava', 1, 2, false],
      ]);

      // Finalization is idempotent, for anyone who asks.
      const again = await ben.repo.finalizeChallenge(challengeId);
      expect(again.completedAt).toBe(done.completedAt);
      expect(again.standings).toEqual((await ben.repo.getChallenge(challengeId)).standings);

      // Nothing can change after completion.
      const closed = await ava.repo.getDay({ challengeId, date: '2026-03-03', participantId: benParticipantId });
      await expectCode(
        ava.repo.overrideDay({
          participantId: benParticipantId,
          date: '2026-03-03',
          outcome: 'fail',
          reason: 'Too late to change',
          expectedRevision: closed.record!.revision,
        }),
        'CHALLENGE_CLOSED',
      );
      await expectCode(
        ben.repo.submitCheckin({ challengeId, date: '2026-03-05', value: 60, evidence: h.evidence(), idempotencyKey: nextKey('late'), late: true }),
        'CHALLENGE_CLOSED',
      );
      await h.setNow(at('2026-03-07', '13:30'));
      const later = await ben.repo.getChallenge(challengeId);
      expect(later.standings.map((s) => [s.person.displayName, s.successfulDays, s.rank])).toEqual([
        ['Ben', 3, 1],
        ['Ava', 1, 2],
      ]);

      // Everyone involved is told.
      const inbox = await ben.repo.listNotifications({ limit: 100 });
      expect(inbox.items.map((n) => n.type)).toEqual(
        expect.arrayContaining(['challenge_invite', 'review_approved', 'review_rejected', 'day_overridden', 'dispute_resolved', 'challenge_completed']),
      );
      await ben.repo.acknowledgeAllNotifications();
      expect((await ben.repo.getHome()).unreadNotifications).toBe(0);

      // Rematch: same settings, fresh draft, no reward, no players, new dates.
      const rematch = await ben.repo.createRematch(challengeId);
      expect(rematch.id).not.toBe(challengeId);
      expect(rematch).toMatchObject({
        status: 'draft',
        rematchOfId: challengeId,
        rewardMode: 'none',
        participantCount: 0,
        name: 'Screen Time Showdown',
        startDate: '2026-03-08',
        endDate: '2026-03-10',
      });
      expect(rematch.rules).toMatchObject({ version: 1, status: 'draft', target: 120, comparator: 'lte', requiredDays: 2, verification: 'evidence' });
      expect(rematch.admins.map((p) => p.displayName)).toEqual(['Ben']);
      expect(rematch.standings).toEqual([]);
      // It is the rematcher's private draft until published.
      await expectCode(ava.repo.getChallenge(rematch.id), 'NOT_FOUND');

      const history = await ben.repo.getHistory();
      expect(history.map((c) => c.id)).toContain(challengeId);
    });
  });
}
