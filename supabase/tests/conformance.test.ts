import {
  addDays,
  canResubmitOnTime,
  dateKeyAt,
  dayWindow,
  decisionWindow,
  deriveDayStatus,
  eachDate,
  effectiveStatus,
  HABITS,
  HABIT_TYPES,
  isValidDailyValue,
  meetsTarget,
  normalizeInviteCode,
  peerVisibleStatus,
  resubmitUntil,
  type Comparator,
  type DayStatus,
  type HabitType,
  type RecordOutcome,
} from '@/domain';

import { closeDb, sql } from './support/harness';

/**
 * The scoring and calendar rules exist twice: in TypeScript (src/domain, used
 * by the app and the demo) and in SQL (schema `app`, authoritative on the
 * server). These tests feed both the same inputs and require identical
 * answers, so the two can never drift apart unnoticed.
 */

afterAll(closeDb);

const ZONES = ['America/New_York', 'Europe/London', 'Africa/Cairo', 'Asia/Kolkata', 'Australia/Sydney', 'America/Santiago', 'Pacific/Auckland', 'UTC'];

describe('calendar math', () => {
  it('day start and submission deadline match for every day of 2026 in eight zones', async () => {
    const dates = eachDate('2026-01-01', '2026-12-31');
    for (const zone of ZONES) {
      const rows = await sql<{ d: string; start_at: Date; deadline_at: Date }>(
        `select d::text as d, app.day_start(d::date, $2) as start_at, app.day_deadline(d::date, $2) as deadline_at
         from unnest($1::text[]) as d`,
        [dates, zone],
      );
      expect(rows).toHaveLength(dates.length);
      for (const row of rows) {
        const window = dayWindow(row.d, zone);
        expect([zone, row.d, row.start_at.toISOString()]).toEqual([zone, row.d, window.startsAt.toISOString()]);
        expect([zone, row.d, row.deadline_at.toISOString()]).toEqual([zone, row.d, window.deadlineAt.toISOString()]);
      }
    }
  });

  it('local dates match around midnight', async () => {
    const instants = ['2026-03-08T04:59:59Z', '2026-03-08T05:00:00Z', '2026-11-01T03:59:59Z', '2026-11-01T04:00:00Z', '2026-06-15T23:30:00Z'];
    for (const zone of ZONES) {
      const rows = await sql<{ i: string; d: string }>(
        'select i, app.local_date(i::timestamptz, $2)::text as d from unnest($1::text[]) as i',
        [instants, zone],
      );
      for (const row of rows) {
        expect([zone, row.i, row.d]).toEqual([zone, row.i, dateKeyAt(new Date(row.i), zone)]);
      }
    }
  });
});

describe('statuses', () => {
  const zone = 'America/New_York';
  const date = '2026-03-07'; // the day before a DST change
  const instants = [
    '2026-03-07T04:59:59Z',
    '2026-03-07T05:00:00Z',
    '2026-03-08T04:59:59Z',
    '2026-03-08T05:00:00Z',
    '2026-03-08T15:59:59Z',
    '2026-03-08T16:00:00Z',
    '2026-04-01T00:00:00Z',
  ];
  const outcomes: (RecordOutcome | null)[] = [null, 'open', 'pending', 'late_pending', 'success', 'fail', 'rejected'];

  it('day status matches for every outcome and moment', async () => {
    for (const outcome of outcomes) {
      for (const instant of instants) {
        const [row] = await sql<{ status: DayStatus }>('select app.day_status($1, $2::date, $3, $4::timestamptz) as status', [outcome, date, zone, instant]);
        const expected = deriveDayStatus({ date, timeZone: zone, now: new Date(instant), record: outcome ? { outcome } : null });
        expect([outcome, instant, row!.status]).toEqual([outcome, instant, expected]);
      }
    }
  });

  it('challenge status follows the clock identically', async () => {
    const start = '2026-03-03';
    const end = '2026-03-09';
    const moments = ['2026-03-03T04:59:59Z', '2026-03-03T05:00:00Z', '2026-03-10T03:59:59Z', '2026-03-10T04:00:00Z', '2027-01-01T00:00:00Z'];
    for (const status of ['draft', 'scheduled', 'active', 'review', 'completed', 'canceled'] as const) {
      for (const moment of moments) {
        const [row] = await sql<{ s: string }>('select app.effective_status($1, $2::date, $3::date, $4, $5::timestamptz) as s', [status, start, end, zone, moment]);
        expect([status, moment, row!.s]).toEqual([status, moment, effectiveStatus({ status, startDate: start, endDate: end, timeZone: zone }, new Date(moment))]);
      }
    }
  });

  it('decision windows, resubmission deadlines and peer-safe statuses match', async () => {
    const decided = '2026-03-08T15:00:00Z';
    for (const now of ['2026-03-08T15:00:01Z', '2026-03-09T14:59:59Z', '2026-03-09T15:00:00Z']) {
      for (const acknowledged of [null, '2026-03-08T14:00:00Z', '2026-03-08T15:30:00Z']) {
        const [row] = await sql<{ open: boolean; resubmit: boolean; until: Date }>(
          `select app.window_open($1::timestamptz, $2::timestamptz, $3::timestamptz) as open,
                  app.can_resubmit_on_time('rejected', $4::date, $5, $1::timestamptz, $2::timestamptz, $3::timestamptz) as resubmit,
                  app.resubmit_until($4::date, $5, $1::timestamptz) as until`,
          [decided, acknowledged, now, date, zone],
        );
        const record = { outcome: 'rejected' as const, decidedAt: decided, acknowledgedAt: acknowledged };
        expect([now, acknowledged, row!.open]).toEqual([now, acknowledged, decisionWindow(record, new Date(now)).open]);
        expect([now, acknowledged, row!.resubmit]).toEqual([now, acknowledged, canResubmitOnTime({ date, timeZone: zone, now: new Date(now), record })]);
        expect(row!.until.toISOString()).toBe(resubmitUntil(date, zone, decided).toISOString());
      }
    }
    for (const status of ['upcoming', 'open', 'due', 'pending', 'late_pending', 'success', 'fail', 'rejected', 'missed'] as const) {
      for (const open of [true, false]) {
        const [row] = await sql<{ s: string }>('select app.peer_status($1, $2) as s', [status, open]);
        expect([status, open, row!.s]).toEqual([status, open, peerVisibleStatus(status, open)]);
      }
    }
  });
});

describe('targets and values', () => {
  it('meets_target matches, including the inclusive 120-minute boundary', async () => {
    const cases: [Comparator, number, number][] = [
      ['lte', 120, 119], ['lte', 120, 120], ['lte', 120, 121], ['lte', 120, 0],
      ['gte', 20, 19], ['gte', 20, 20], ['gte', 50, 51], ['gte', 2.5, 2.49],
      ['bool', 1, 0], ['bool', 1, 1],
    ];
    for (const [comparator, target, value] of cases) {
      const [row] = await sql<{ ok: boolean }>('select app.meets_target($1, $2, $3) as ok', [comparator, target, value]);
      expect([comparator, target, value, row!.ok]).toEqual([comparator, target, value, meetsTarget(comparator, target, value)]);
    }
  });

  it('the habit catalog is identical', async () => {
    const rows = await sql<Record<string, unknown>>('select * from app.habits order by habit_type');
    expect(rows.map((r) => r.habit_type).sort()).toEqual([...HABIT_TYPES].sort());
    for (const row of rows) {
      const def = HABITS[row.habit_type as HabitType];
      expect({
        comparator: row.default_comparator,
        minTarget: Number(row.min_target),
        maxTarget: Number(row.max_target),
        maxDailyValue: Number(row.max_daily_value),
        evidenceMandatory: row.evidence_mandatory,
        usesIncrements: row.uses_increments,
        requiresFinishedDay: row.requires_finished_day,
        privateDetail: row.private_detail,
      }).toEqual({
        comparator: def.comparator,
        minTarget: def.minTarget,
        maxTarget: def.maxTarget,
        maxDailyValue: def.maxDailyValue,
        evidenceMandatory: def.evidenceMandatory,
        usesIncrements: def.usesIncrements,
        requiresFinishedDay: def.requiresFinishedDay,
        privateDetail: def.privateDetail,
      });
    }
  });

  it('daily value validation matches', async () => {
    const cases: [HabitType, Comparator, number][] = [
      ['screen_time', 'lte', 0], ['screen_time', 'lte', 1440], ['screen_time', 'lte', 1441], ['screen_time', 'lte', 95.5],
      ['prayer', 'bool', 0], ['prayer', 'bool', 1], ['prayer', 'bool', 2],
      ['pushups', 'gte', 100000], ['pushups', 'gte', 100001], ['pushups', 'gte', 12.5],
      ['custom', 'gte', 2.5], ['custom', 'gte', 2.555], ['custom', 'bool', 1],
      ['reading', 'gte', 1440], ['reading', 'gte', 1441],
    ];
    for (const [habit, comparator, value] of cases) {
      const [row] = await sql<{ ok: boolean }>('select app.valid_daily_value($1, $2, $3) as ok', [habit, comparator, value]);
      expect([habit, comparator, value, row!.ok]).toEqual([habit, comparator, value, isValidDailyValue(habit, comparator, value)]);
    }
  });

  it('invite codes normalize the same way', async () => {
    for (const input of [' k7m2-9xqp-4tla ', 'O0o-iIl', 'abc def', 'K7M29XQP4T1A']) {
      const [row] = await sql<{ code: string }>('select app.normalize_invite_code($1) as code', [input]);
      expect(row!.code).toBe(normalizeInviteCode(input));
    }
  });

  it('adding days never drifts across a year', () => {
    // Guards the helper the comparisons above rely on.
    expect(addDays('2026-01-01', 364)).toBe('2026-12-31');
  });
});
