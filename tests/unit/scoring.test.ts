import {
  canResubmitOnTime,
  computeStandings,
  decisionWindow,
  deriveDayStatus,
  evaluateAccepted,
  isValidDailyValue,
  meetsTarget,
  ordinal,
  peerVisibleStatus,
  provenanceLabel,
  resubmitUntil,
  selfReportOutcome,
  type DayStatus,
} from '@/domain';

const NY = 'America/New_York';

describe('targets', () => {
  it('screen time is an inclusive maximum: 120 passes a 120-minute goal, 121 fails', () => {
    expect(meetsTarget('lte', 120, 120)).toBe(true);
    expect(meetsTarget('lte', 120, 119)).toBe(true);
    expect(meetsTarget('lte', 120, 0)).toBe(true);
    expect(meetsTarget('lte', 120, 121)).toBe(false);
  });

  it('minimum goals need at least the target', () => {
    expect(meetsTarget('gte', 20, 19)).toBe(false);
    expect(meetsTarget('gte', 20, 20)).toBe(true);
    expect(meetsTarget('gte', 50, 51)).toBe(true);
    expect(meetsTarget('gte', 50, 49)).toBe(false);
  });

  it('yes/no goals succeed only on yes', () => {
    expect(meetsTarget('bool', 1, 1)).toBe(true);
    expect(meetsTarget('bool', 1, 0)).toBe(false);
  });

  it('approving valid over-limit evidence yields a failed day, not a success', () => {
    expect(evaluateAccepted('lte', 120, 150)).toBe('fail');
    expect(evaluateAccepted('lte', 120, 95)).toBe('success');
  });

  it('a self-reported value below a minimum stays open rather than failing early', () => {
    expect(selfReportOutcome('gte', 50, 30)).toBe('open');
    expect(selfReportOutcome('gte', 50, 50)).toBe('success');
  });

  it('validates daily values per habit', () => {
    expect(isValidDailyValue('screen_time', 'lte', 0)).toBe(true);
    expect(isValidDailyValue('screen_time', 'lte', 1440)).toBe(true);
    expect(isValidDailyValue('screen_time', 'lte', 1441)).toBe(false);
    expect(isValidDailyValue('screen_time', 'lte', 95.5)).toBe(false);
    expect(isValidDailyValue('screen_time', 'lte', -1)).toBe(false);
    expect(isValidDailyValue('prayer', 'bool', 1)).toBe(true);
    expect(isValidDailyValue('prayer', 'bool', 2)).toBe(false);
    expect(isValidDailyValue('custom', 'gte', 2.5)).toBe(true);
    // 2.2 * 100 is not exactly 220 in floating point; it is still a valid two-decimal value.
    expect(isValidDailyValue('custom', 'gte', 2.2)).toBe(true);
    expect(isValidDailyValue('custom', 'gte', 0.07)).toBe(true);
    expect(isValidDailyValue('custom', 'gte', 2.555)).toBe(false);
    expect(isValidDailyValue('pushups', 'gte', Number.NaN)).toBe(false);
  });
});

describe('day status', () => {
  const date = '2026-11-10';
  const at = (iso: string) => new Date(iso);

  it('follows the clock when nothing final is recorded', () => {
    expect(deriveDayStatus({ date, timeZone: NY, now: at('2026-11-10T04:59:59Z') })).toBe('upcoming');
    expect(deriveDayStatus({ date, timeZone: NY, now: at('2026-11-10T05:00:00Z') })).toBe('open');
    expect(deriveDayStatus({ date, timeZone: NY, now: at('2026-11-11T04:59:59Z') })).toBe('open');
    expect(deriveDayStatus({ date, timeZone: NY, now: at('2026-11-11T05:00:00Z') })).toBe('due');
    expect(deriveDayStatus({ date, timeZone: NY, now: at('2026-11-11T16:59:59Z') })).toBe('due');
  });

  it('a missing day is only missed once its deadline has passed', () => {
    expect(deriveDayStatus({ date, timeZone: NY, now: at('2026-11-11T16:59:59Z') })).not.toBe('missed');
    expect(deriveDayStatus({ date, timeZone: NY, now: at('2026-11-11T17:00:00Z') })).toBe('missed');
  });

  it('an open (below target) record becomes missed after the deadline', () => {
    const record = { outcome: 'open' as const };
    expect(deriveDayStatus({ date, timeZone: NY, now: at('2026-11-10T20:00:00Z'), record })).toBe('open');
    expect(deriveDayStatus({ date, timeZone: NY, now: at('2026-11-12T00:00:00Z'), record })).toBe('missed');
  });

  it('pending review stays pending forever: it never turns into success or failure by itself', () => {
    const record = { outcome: 'pending' as const };
    expect(deriveDayStatus({ date, timeZone: NY, now: at('2026-11-11T12:00:00Z'), record })).toBe('pending');
    expect(deriveDayStatus({ date, timeZone: NY, now: at('2027-01-01T00:00:00Z'), record })).toBe('pending');
  });

  it('keeps decided outcomes', () => {
    for (const outcome of ['success', 'fail', 'rejected', 'late_pending'] as const) {
      expect(deriveDayStatus({ date, timeZone: NY, now: at('2026-12-01T00:00:00Z'), record: { outcome } })).toBe(outcome);
    }
  });
});

describe('standings', () => {
  const days = (success: number, pending = 0, other: DayStatus[] = []): DayStatus[] => [
    ...Array<DayStatus>(success).fill('success'),
    ...Array<DayStatus>(pending).fill('pending'),
    ...other,
  ];

  it('uses competition ranking: 1, 1, 3, 3, 5, 6', () => {
    const rows = computeStandings(
      [
        { participantId: 'p-mia', removed: false, days: days(3) },
        { participantId: 'p-aj', removed: false, days: days(5) },
        { participantId: 'p-leo', removed: false, days: days(2) },
        { participantId: 'p-ben', removed: false, days: days(5) },
        { participantId: 'p-dad', removed: false, days: days(4) },
        { participantId: 'p-kaan', removed: false, days: days(4) },
      ],
      7,
    );
    expect(rows.map((r) => [r.participantId, r.rank, r.tied])).toEqual([
      ['p-aj', 1, true],
      ['p-ben', 1, true],
      ['p-dad', 3, true],
      ['p-kaan', 3, true],
      ['p-mia', 5, false],
      ['p-leo', 6, false],
    ]);
  });

  it('pending proof never scores and is counted separately', () => {
    const rows = computeStandings(
      [
        { participantId: 'a', removed: false, days: days(5, 1) },
        { participantId: 'b', removed: false, days: days(5) },
        { participantId: 'c', removed: false, days: days(4, 3) },
      ],
      7,
    );
    expect(rows.find((r) => r.participantId === 'a')).toMatchObject({ successfulDays: 5, pendingDays: 1, rank: 1, tied: true });
    expect(rows.find((r) => r.participantId === 'b')).toMatchObject({ successfulDays: 5, pendingDays: 0, rank: 1, tied: true });
    // Three pending screenshots do not lift c above anyone.
    expect(rows.find((r) => r.participantId === 'c')).toMatchObject({ successfulDays: 4, pendingDays: 3, rank: 3 });
  });

  it('late requests count as awaiting review; rejected, failed, missed and open days count for nothing', () => {
    const [row] = computeStandings(
      [{ participantId: 'a', removed: false, days: ['success', 'late_pending', 'rejected', 'fail', 'missed', 'open', 'upcoming'] }],
      7,
    );
    expect(row).toMatchObject({ successfulDays: 1, pendingDays: 1, qualified: false });
  });

  it('each day contributes at most one success', () => {
    // One status per scheduled date is the only input, so a day can never count twice.
    const [row] = computeStandings([{ participantId: 'a', removed: false, days: days(7) }], 7);
    expect(row?.successfulDays).toBe(7);
    expect(row?.qualified).toBe(true);
  });

  it('qualification uses the required-day threshold', () => {
    const rows = computeStandings(
      [
        { participantId: 'a', removed: false, days: days(5) },
        { participantId: 'b', removed: false, days: days(4) },
      ],
      5,
    );
    expect(rows.map((r) => r.qualified)).toEqual([true, false]);
  });

  it('everyone tied shares first place', () => {
    const rows = computeStandings(
      ['c', 'a', 'b'].map((participantId) => ({ participantId, removed: false, days: days(3) })),
      7,
    );
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1]);
    expect(rows.every((r) => r.tied)).toBe(true);
    // Stable visual order by ID; it is not a tie-break.
    expect(rows.map((r) => r.participantId)).toEqual(['a', 'b', 'c']);
  });

  it('removed participants keep their history but are unranked and never qualify', () => {
    const rows = computeStandings(
      [
        { participantId: 'a', removed: true, days: days(7) },
        { participantId: 'b', removed: false, days: days(2) },
      ],
      2,
    );
    expect(rows).toEqual([
      expect.objectContaining({ participantId: 'b', rank: 1, tied: false, qualified: true }),
      expect.objectContaining({ participantId: 'a', rank: null, removed: true, qualified: false, successfulDays: 7 }),
    ]);
  });

  it('formats ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th',
    ]);
  });
});

describe('decision windows', () => {
  const decidedAt = '2026-11-10T15:00:00Z';

  it('stays open for 24 hours after a decision', () => {
    expect(decisionWindow({ decidedAt }, new Date('2026-11-11T14:59:59Z')).open).toBe(true);
    expect(decisionWindow({ decidedAt }, new Date('2026-11-11T15:00:00Z')).open).toBe(false);
    expect(decisionWindow({ decidedAt }, new Date('2026-11-10T16:00:00Z')).closesAt?.toISOString()).toBe('2026-11-11T15:00:00.000Z');
  });

  it('is closed when there was no admin decision (self-reports)', () => {
    expect(decisionWindow({ decidedAt: null }, new Date('2026-11-10T16:00:00Z'))).toEqual({ open: false, closesAt: null });
  });

  it('can be waived by the participant, but only for the decision they saw', () => {
    const now = new Date('2026-11-10T16:00:00Z');
    expect(decisionWindow({ decidedAt, acknowledgedAt: '2026-11-10T15:30:00Z' }, now).open).toBe(false);
    // An acknowledgement of an earlier decision does not waive a newer one.
    expect(decisionWindow({ decidedAt, acknowledgedAt: '2026-11-10T14:00:00Z' }, now).open).toBe(true);
  });

  it('gives a rejected entry until the later of the deadline and the decision window to resubmit on time', () => {
    // Deadline for Nov 9 is Nov 10 17:00Z; the rejection at 15:00Z extends resubmission to Nov 11 15:00Z.
    expect(resubmitUntil('2026-11-09', NY, decidedAt).toISOString()).toBe('2026-11-11T15:00:00.000Z');
    expect(resubmitUntil('2026-11-10', NY, '2026-11-11T06:00:00Z').toISOString()).toBe('2026-11-12T06:00:00.000Z');
    // A rejection made well before the deadline leaves the original deadline in place.
    expect(resubmitUntil('2026-11-12', NY, '2026-11-12T06:00:00Z').toISOString()).toBe('2026-11-13T17:00:00.000Z');
    const record = { outcome: 'rejected' as const, decidedAt };
    expect(canResubmitOnTime({ date: '2026-11-09', timeZone: NY, now: new Date('2026-11-11T14:00:00Z'), record })).toBe(true);
    expect(canResubmitOnTime({ date: '2026-11-09', timeZone: NY, now: new Date('2026-11-11T15:00:00Z'), record })).toBe(false);
    expect(
      canResubmitOnTime({
        date: '2026-11-09',
        timeZone: NY,
        now: new Date('2026-11-10T16:00:00Z'),
        record: { ...record, acknowledgedAt: '2026-11-10T15:10:00Z' },
      }),
    ).toBe(false);
  });
});

describe('what peers and labels show', () => {
  it('hides evidence rejections from other players', () => {
    expect(peerVisibleStatus('rejected', true)).toBe('due');
    expect(peerVisibleStatus('rejected', false)).toBe('missed');
    expect(peerVisibleStatus('late_pending', false)).toBe('pending');
    expect(peerVisibleStatus('success', false)).toBe('success');
    expect(peerVisibleStatus('fail', false)).toBe('fail');
  });

  it('never presents an override or a self-review as independent verification', () => {
    expect(provenanceLabel('admin_adjusted', 'screen_time')).toBe('Admin adjusted');
    expect(provenanceLabel('admin_self_reviewed', 'screen_time')).toBe('Admin self-reviewed');
    expect(provenanceLabel('evidence_reviewed', 'screen_time')).toBe('Screenshot verified');
    expect(provenanceLabel('evidence_reviewed', 'pushups')).toBe('Proof verified');
    expect(provenanceLabel('self_reported', 'prayer')).toBe('Self-reported');
    expect(provenanceLabel(null, 'prayer')).toBeNull();
  });
});
