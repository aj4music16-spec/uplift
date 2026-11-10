import {
  adminReminderDue,
  disputeGate,
  effectiveStatus,
  finalizationBlockers,
  finalSubmissionDeadline,
  incrementGate,
  joinGate,
  submissionGate,
  type ChallengeClock,
  type FinalizationRecord,
  type SubmissionContext,
} from '@/domain';

const NY = 'America/New_York';
// Seven days, Nov 3 – Nov 9 2026 in New York (UTC-5 the whole week).
const challenge: ChallengeClock = { status: 'scheduled', startDate: '2026-11-03', endDate: '2026-11-09', timeZone: NY };
const at = (iso: string) => new Date(iso);

describe('challenge status', () => {
  it('starts at local midnight on the start date', () => {
    expect(effectiveStatus(challenge, at('2026-11-03T04:59:59Z'))).toBe('scheduled');
    expect(effectiveStatus(challenge, at('2026-11-03T05:00:00Z'))).toBe('active');
  });

  it('ends at the local midnight after the end date, then stays in review', () => {
    expect(effectiveStatus(challenge, at('2026-11-10T04:59:59Z'))).toBe('active');
    expect(effectiveStatus(challenge, at('2026-11-10T05:00:00Z'))).toBe('review');
    // Time alone never completes a challenge.
    expect(effectiveStatus(challenge, at('2027-06-01T00:00:00Z'))).toBe('review');
  });

  it('draft, completed and canceled are not driven by the clock', () => {
    for (const status of ['draft', 'completed', 'canceled'] as const) {
      expect(effectiveStatus({ ...challenge, status }, at('2026-11-05T12:00:00Z'))).toBe(status);
    }
  });

  it('the final deadline is noon after the last day', () => {
    expect(finalSubmissionDeadline('2026-11-09', NY).toISOString()).toBe('2026-11-10T17:00:00.000Z');
  });
});

describe('check-in gate', () => {
  const screenTime = (overrides: Partial<SubmissionContext>): SubmissionContext => ({
    challenge,
    habitType: 'screen_time',
    comparator: 'lte',
    verification: 'evidence',
    date: '2026-11-05',
    now: at('2026-11-06T13:00:00Z'),
    ...overrides,
  });

  it('refuses screen-time proof before the measured day has fully ended', () => {
    // 11:59 PM local on Nov 5.
    expect(submissionGate(screenTime({ now: at('2026-11-06T04:59:00Z') }))).toEqual({ ok: false, code: 'DAY_NOT_FINISHED' });
    // Midday on the day itself.
    expect(submissionGate(screenTime({ now: at('2026-11-05T17:00:00Z') }))).toEqual({ ok: false, code: 'DAY_NOT_FINISHED' });
    // Midnight: the day is over, the proof is now meaningful.
    expect(submissionGate(screenTime({ now: at('2026-11-06T05:00:00Z') }))).toEqual({ ok: true, late: false });
  });

  it('accepts on-time submissions until noon the next local date, then only as late', () => {
    expect(submissionGate(screenTime({ now: at('2026-11-06T16:59:59Z') }))).toEqual({ ok: true, late: false });
    expect(submissionGate(screenTime({ now: at('2026-11-06T17:00:00Z') }))).toEqual({ ok: true, late: true });
  });

  it('other habits may be logged during the day', () => {
    const reading: SubmissionContext = {
      challenge,
      habitType: 'reading',
      comparator: 'gte',
      verification: 'self_report',
      date: '2026-11-05',
      now: at('2026-11-05T17:00:00Z'),
    };
    expect(submissionGate(reading)).toEqual({ ok: true, late: false });
    expect(submissionGate({ ...reading, date: '2026-11-06' })).toEqual({ ok: false, code: 'DAY_NOT_STARTED' });
  });

  it('is closed outside the challenge window and states', () => {
    expect(submissionGate(screenTime({ now: at('2026-11-02T12:00:00Z'), date: '2026-11-03' }))).toEqual({ ok: false, code: 'NOT_STARTED' });
    expect(submissionGate(screenTime({ date: '2026-11-10', now: at('2026-11-11T13:00:00Z') }))).toEqual({ ok: false, code: 'VALIDATION' });
    expect(submissionGate(screenTime({ challenge: { ...challenge, status: 'completed' } }))).toEqual({ ok: false, code: 'CHALLENGE_CLOSED' });
    expect(submissionGate(screenTime({ challenge: { ...challenge, status: 'canceled' } }))).toEqual({ ok: false, code: 'CHALLENGE_CLOSED' });
  });

  it('the last day can still be submitted during review', () => {
    expect(submissionGate(screenTime({ date: '2026-11-09', now: at('2026-11-10T12:00:00Z') }))).toEqual({ ok: true, late: false });
  });

  it('a pending entry can be revised before the deadline but not after', () => {
    const record = { outcome: 'pending' as const };
    expect(submissionGate(screenTime({ record, now: at('2026-11-06T12:00:00Z') }))).toEqual({ ok: true, late: false });
    expect(submissionGate(screenTime({ record, now: at('2026-11-06T18:00:00Z') }))).toEqual({ ok: false, code: 'REVIEW_PENDING' });
  });

  it('reviewed and overridden days are final for the participant', () => {
    expect(submissionGate(screenTime({ record: { outcome: 'success', provenance: 'evidence_reviewed' } }))).toEqual({ ok: false, code: 'ALREADY_DECIDED' });
    expect(submissionGate(screenTime({ record: { outcome: 'fail', provenance: 'admin_self_reviewed' } }))).toEqual({ ok: false, code: 'ALREADY_DECIDED' });
    expect(submissionGate(screenTime({ record: { outcome: 'success', provenance: 'admin_adjusted' } }))).toEqual({ ok: false, code: 'ALREADY_DECIDED' });
  });

  it('a rejected entry can be resubmitted on time within the decision window, and late after it', () => {
    const record = { outcome: 'rejected' as const, decidedAt: '2026-11-06T20:00:00Z' };
    expect(submissionGate(screenTime({ record, now: at('2026-11-07T19:00:00Z') }))).toEqual({ ok: true, late: false });
    expect(submissionGate(screenTime({ record, now: at('2026-11-07T20:00:00Z') }))).toEqual({ ok: true, late: true });
  });

  it('a late request waiting for the admin blocks further submissions', () => {
    expect(submissionGate(screenTime({ record: { outcome: 'late_pending' } }))).toEqual({ ok: false, code: 'REVIEW_PENDING' });
  });

  it('rep increments follow the same window but are never accepted late', () => {
    const pushups: SubmissionContext = {
      challenge,
      habitType: 'pushups',
      comparator: 'gte',
      verification: 'self_report',
      date: '2026-11-05',
      now: at('2026-11-05T15:00:00Z'),
    };
    expect(incrementGate(pushups)).toEqual({ ok: true, late: false });
    expect(incrementGate({ ...pushups, now: at('2026-11-06T17:00:00Z') })).toEqual({ ok: false, code: 'DEADLINE_PASSED' });
    expect(incrementGate({ ...pushups, record: { outcome: 'pending' } })).toEqual({ ok: false, code: 'REVIEW_PENDING' });
    expect(incrementGate({ ...pushups, habitType: 'reading' })).toEqual({ ok: false, code: 'VALIDATION' });
  });
});

describe('joining', () => {
  const base = { challenge, now: at('2026-11-02T12:00:00Z'), currentVersionId: 'v2', acceptedVersionId: 'v2', participantCount: 3 };

  it('needs acceptance of the current rules before the start', () => {
    expect(joinGate(base)).toEqual({ ok: true, late: false });
    expect(joinGate({ ...base, acceptedVersionId: 'v1' })).toEqual({ ok: false, code: 'RULES_CHANGED' });
  });

  it('no late joins after the start', () => {
    expect(joinGate({ ...base, now: at('2026-11-03T05:00:00Z') })).toEqual({ ok: false, code: 'CHALLENGE_STARTED' });
  });

  it('respects the participant limit and closed states', () => {
    expect(joinGate({ ...base, participantCount: 50 })).toEqual({ ok: false, code: 'LIMIT_REACHED' });
    expect(joinGate({ ...base, challenge: { ...challenge, status: 'canceled' } })).toEqual({ ok: false, code: 'CHALLENGE_CLOSED' });
  });
});

describe('disputes and finalization', () => {
  const inReview = at('2026-11-10T18:00:00Z'); // after the final deadline
  const record = (overrides: Partial<FinalizationRecord>): FinalizationRecord => ({
    outcome: 'success',
    date: '2026-11-08',
    participantRemoved: false,
    ...overrides,
  });

  it('cannot finalize before the activity window ends', () => {
    expect(finalizationBlockers({ challenge, now: at('2026-11-09T12:00:00Z'), records: [], openDisputes: 0 })).toEqual([
      { code: 'NOT_IN_REVIEW', count: 0, until: null },
    ]);
  });

  it('waits for the last day’s submission deadline', () => {
    const blockers = finalizationBlockers({ challenge, now: at('2026-11-10T12:00:00Z'), records: [], openDisputes: 0 });
    expect(blockers).toEqual([{ code: 'DEADLINE_NOT_REACHED', count: 0, until: at('2026-11-10T17:00:00Z') }]);
  });

  it('is clear when nothing is outstanding', () => {
    expect(finalizationBlockers({ challenge, now: inReview, records: [record({})], openDisputes: 0 })).toEqual([]);
  });

  it('pending reviews block completion indefinitely; they are never auto-approved or auto-rejected', () => {
    const records = [record({ outcome: 'pending' }), record({ outcome: 'late_pending' }), record({})];
    for (const now of [inReview, at('2026-12-25T00:00:00Z')]) {
      expect(finalizationBlockers({ challenge, now, records, openDisputes: 0 })).toEqual([
        { code: 'REVIEW_PENDING', count: 2, until: null },
      ]);
    }
  });

  it('open disputes block completion', () => {
    expect(finalizationBlockers({ challenge, now: inReview, records: [], openDisputes: 1 })).toEqual([
      { code: 'DISPUTE_OPEN', count: 1, until: null },
    ]);
  });

  it('waits for 24-hour dispute windows unless the participant waives them', () => {
    const decided = record({ decidedAt: '2026-11-10T17:30:00Z' });
    expect(finalizationBlockers({ challenge, now: inReview, records: [decided], openDisputes: 0 })).toEqual([
      { code: 'DISPUTE_WINDOW_OPEN', count: 1, until: at('2026-11-11T17:30:00Z') },
    ]);
    expect(finalizationBlockers({ challenge, now: at('2026-11-11T17:30:00Z'), records: [decided], openDisputes: 0 })).toEqual([]);
    const waived = record({ decidedAt: '2026-11-10T17:30:00Z', acknowledgedAt: '2026-11-10T17:45:00Z' });
    expect(finalizationBlockers({ challenge, now: inReview, records: [waived], openDisputes: 0 })).toEqual([]);
  });

  it('records of removed participants never block', () => {
    const records = [record({ outcome: 'pending', participantRemoved: true }), record({ decidedAt: '2026-11-10T17:30:00Z', participantRemoved: true })];
    expect(finalizationBlockers({ challenge, now: inReview, records, openDisputes: 0 })).toEqual([]);
  });

  it('reminds admins 48 hours after the final deadline while work is outstanding', () => {
    const blockers = finalizationBlockers({ challenge, now: inReview, records: [record({ outcome: 'pending' })], openDisputes: 0 });
    expect(adminReminderDue(challenge, at('2026-11-12T16:59:59Z'), blockers)).toBe(false);
    expect(adminReminderDue(challenge, at('2026-11-12T17:00:00Z'), blockers)).toBe(true);
    expect(adminReminderDue(challenge, at('2026-11-12T17:00:00Z'), [])).toBe(false);
  });

  it('a dispute can only be opened once, inside the window, on a decided day', () => {
    const base = {
      challenge,
      now: at('2026-11-06T21:00:00Z'),
      record: { outcome: 'fail' as const, decidedAt: '2026-11-06T20:00:00Z' },
      hasOpenDispute: false,
      disputedSinceDecision: false,
    };
    expect(disputeGate(base)).toEqual({ ok: true, late: false });
    expect(disputeGate({ ...base, now: at('2026-11-07T20:00:00Z') })).toEqual({ ok: false, code: 'DISPUTE_WINDOW_CLOSED' });
    expect(disputeGate({ ...base, hasOpenDispute: true })).toEqual({ ok: false, code: 'DISPUTE_OPEN' });
    expect(disputeGate({ ...base, disputedSinceDecision: true })).toEqual({ ok: false, code: 'ALREADY_DECIDED' });
    expect(disputeGate({ ...base, record: { outcome: 'success' as const } })).toEqual({ ok: false, code: 'VALIDATION' });
    expect(disputeGate({ ...base, challenge: { ...challenge, status: 'completed' } })).toEqual({ ok: false, code: 'CHALLENGE_CLOSED' });
  });
});
