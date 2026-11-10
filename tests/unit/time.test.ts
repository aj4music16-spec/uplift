import {
  addDays,
  dateKeyAt,
  dayWindow,
  diffDays,
  durationDays,
  eachDate,
  isDateKey,
  isValidTimeZone,
  offsetMs,
  startOfDay,
  zonedTimeToUtc,
  MS_PER_HOUR,
} from '@/domain';

const NY = 'America/New_York';

describe('date keys', () => {
  it('validates real calendar dates only', () => {
    expect(isDateKey('2026-11-10')).toBe(true);
    expect(isDateKey('2026-02-29')).toBe(false);
    expect(isDateKey('2028-02-29')).toBe(true);
    expect(isDateKey('2026-13-01')).toBe(false);
    expect(isDateKey('2026-1-1')).toBe(false);
    expect(isDateKey(20261110)).toBe(false);
  });

  it('adds and diffs calendar days across month, year and DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-03-07', '2026-03-09')).toBe(2);
    expect(diffDays('2026-11-10', '2026-11-03')).toBe(-7);
    expect(durationDays('2026-11-03', '2026-11-09')).toBe(7);
    expect(eachDate('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(eachDate('2026-11-02', '2026-11-01')).toEqual([]);
  });
});

describe('time zones', () => {
  it('recognises valid IANA zones', () => {
    expect(isValidTimeZone(NY)).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('finds the local date of an instant', () => {
    // 03:30 UTC on Nov 10 is still Nov 9 in New York (UTC-5) and already Nov 10 in Istanbul (UTC+3).
    const instant = new Date('2026-11-10T03:30:00Z');
    expect(dateKeyAt(instant, NY)).toBe('2026-11-09');
    expect(dateKeyAt(instant, 'Europe/Istanbul')).toBe('2026-11-10');
    expect(dateKeyAt(instant, 'UTC')).toBe('2026-11-10');
  });

  it('a device time zone change does not change the challenge date', () => {
    // The same instant always maps to the same date in the challenge zone,
    // whatever zone the device is in.
    const instant = new Date('2026-07-04T02:00:00Z');
    expect(dateKeyAt(instant, NY)).toBe('2026-07-03');
    expect(dateKeyAt(instant, 'Asia/Tokyo')).toBe('2026-07-04');
  });

  it('computes offsets on both sides of a transition', () => {
    expect(offsetMs(new Date('2026-01-15T12:00:00Z'), NY)).toBe(-5 * MS_PER_HOUR);
    expect(offsetMs(new Date('2026-07-15T12:00:00Z'), NY)).toBe(-4 * MS_PER_HOUR);
  });
});

describe('day windows and deadlines', () => {
  it('starts at local midnight and is due at noon the next local date', () => {
    const window = dayWindow('2026-11-10', NY);
    expect(window.startsAt.toISOString()).toBe('2026-11-10T05:00:00.000Z');
    expect(window.endsAt.toISOString()).toBe('2026-11-11T05:00:00.000Z');
    expect(window.deadlineAt.toISOString()).toBe('2026-11-11T17:00:00.000Z');
  });

  it('handles the 23-hour spring-forward day', () => {
    // US DST starts 2026-03-08 at 02:00 local.
    const window = dayWindow('2026-03-08', NY);
    expect(window.startsAt.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(window.endsAt.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect((window.endsAt.getTime() - window.startsAt.getTime()) / MS_PER_HOUR).toBe(23);
    // Noon the next day is in daylight time (UTC-4).
    expect(window.deadlineAt.toISOString()).toBe('2026-03-09T16:00:00.000Z');
  });

  it('handles the 25-hour fall-back day', () => {
    // US DST ends 2026-11-01 at 02:00 local.
    const window = dayWindow('2026-11-01', NY);
    expect(window.startsAt.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(window.endsAt.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect((window.endsAt.getTime() - window.startsAt.getTime()) / MS_PER_HOUR).toBe(25);
    expect(window.deadlineAt.toISOString()).toBe('2026-11-02T17:00:00.000Z');
  });

  it('the deadline of the day before a transition uses the new offset', () => {
    // Saturday Mar 7 is due Sunday Mar 8 at noon EDT, not noon EST.
    expect(dayWindow('2026-03-07', NY).deadlineAt.toISOString()).toBe('2026-03-08T16:00:00.000Z');
    expect(dayWindow('2026-10-31', NY).deadlineAt.toISOString()).toBe('2026-11-01T17:00:00.000Z');
  });

  it('resolves a wall time inside a spring-forward gap to after the gap', () => {
    // 02:30 does not exist on 2026-03-08 in New York; it resolves like PostgreSQL to 03:30 EDT.
    expect(zonedTimeToUtc('2026-03-08', 2, 30, NY).toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });

  it('resolves an ambiguous fall-back wall time to the later (standard) occurrence', () => {
    expect(zonedTimeToUtc('2026-11-01', 1, 30, NY).toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });

  it('starts the day at the first existing instant when midnight is skipped', () => {
    // Egypt springs forward at midnight: 2026-04-24 00:00 -> 01:00 local.
    const start = startOfDay('2026-04-24', 'Africa/Cairo');
    expect(start.toISOString()).toBe('2026-04-23T22:00:00.000Z');
    expect(dateKeyAt(start, 'Africa/Cairo')).toBe('2026-04-24');
    expect(dateKeyAt(start.getTime() - 1, 'Africa/Cairo')).toBe('2026-04-23');
  });

  it('works for zones east of UTC and half-hour offsets', () => {
    expect(dayWindow('2026-11-10', 'Asia/Kolkata').startsAt.toISOString()).toBe('2026-11-09T18:30:00.000Z');
    expect(dayWindow('2026-11-10', 'Asia/Kolkata').deadlineAt.toISOString()).toBe('2026-11-11T06:30:00.000Z');
    expect(dayWindow('2026-11-10', 'Pacific/Auckland').startsAt.toISOString()).toBe('2026-11-09T11:00:00.000Z');
  });

  it('every day in a DST month starts on its own date', () => {
    for (const zone of [NY, 'Europe/London', 'Australia/Sydney', 'Africa/Cairo', 'America/Santiago']) {
      for (const date of eachDate('2026-03-01', '2026-04-30')) {
        const window = dayWindow(date, zone);
        expect(dateKeyAt(window.startsAt, zone)).toBe(date);
        expect(dateKeyAt(window.startsAt.getTime() - 1, zone)).toBe(addDays(date, -1));
        expect(dateKeyAt(window.endsAt, zone)).toBe(addDays(date, 1));
        expect(dateKeyAt(window.deadlineAt, zone)).toBe(addDays(date, 1));
      }
    }
  });
});
