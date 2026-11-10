/**
 * Time-zone aware calendar math for challenges.
 *
 * Product rules implemented here (docs/UPLIFT_SPEC.md, "Time and challenge lifecycle"):
 *  - A challenge has one immutable IANA time zone. Every daily occurrence is a
 *    date key ("YYYY-MM-DD") in that zone; device time zones never matter.
 *  - A day starts at local midnight and ends at the next local midnight.
 *  - The submission deadline for a day is 12:00 (noon) on the following local date.
 *  - Never add 24h of milliseconds to move between days: days are 23 or 25
 *    hours long across daylight-saving transitions.
 *
 * Everything is derived from `Intl.DateTimeFormat`, so there is no time-zone
 * database to ship or keep in sync. The same rules are implemented in SQL in
 * supabase/migrations (app.day_start / app.day_deadline) and the two are
 * checked against each other by supabase/tests/conformance.test.ts.
 */

/** A calendar date in a challenge's time zone, formatted YYYY-MM-DD. */
export type DateKey = string;

export const MS_PER_DAY = 86_400_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_MINUTE = 60_000;

/** Local hour (on the following date) at which a day's submissions are due. */
export const SUBMISSION_DEADLINE_HOUR = 12;

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string') return false;
  const match = DATE_KEY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** Milliseconds of the date key treated as a UTC date. Used only as a calendar proxy. */
function proxyUtc(key: DateKey): number {
  const match = DATE_KEY_RE.exec(key);
  if (!match) throw new RangeError(`Invalid date key: ${String(key)}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function fromProxyUtc(ms: number): DateKey {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

/** Calendar addition. UTC has no daylight saving, so this never drifts. */
export function addDays(key: DateKey, days: number): DateKey {
  return fromProxyUtc(proxyUtc(key) + Math.trunc(days) * MS_PER_DAY);
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: DateKey, to: DateKey): number {
  return Math.round((proxyUtc(to) - proxyUtc(from)) / MS_PER_DAY);
}

export function compareDateKeys(a: DateKey, b: DateKey): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every date from start to end, inclusive. Empty when end is before start. */
export function eachDate(start: DateKey, end: DateKey): DateKey[] {
  const count = diffDays(start, end) + 1;
  const out: DateKey[] = [];
  for (let i = 0; i < count; i += 1) out.push(addDays(start, i));
  return out;
}

/** Inclusive number of days in a range. */
export function durationDays(start: DateKey, end: DateKey): number {
  return diffDays(start, end) + 1;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

function toMs(instant: Date | number): number {
  return typeof instant === 'number' ? instant : instant.getTime();
}

/** Wall-clock fields of an instant in a time zone. */
export function zonedParts(instant: Date | number, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(toMs(instant)));
  const out: ZonedParts = { year: 0, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  for (const part of parts) {
    switch (part.type) {
      case 'year':
        out.year = Number(part.value);
        break;
      case 'month':
        out.month = Number(part.value);
        break;
      case 'day':
        out.day = Number(part.value);
        break;
      case 'hour':
        // Some engines print 24 for midnight even with hourCycle h23.
        out.hour = Number(part.value) % 24;
        break;
      case 'minute':
        out.minute = Number(part.value);
        break;
      case 'second':
        out.second = Number(part.value);
        break;
      default:
        break;
    }
  }
  return out;
}

/** UTC offset (ms, positive east of Greenwich) in force at an instant. */
export function offsetMs(instant: Date | number, timeZone: string): number {
  const ms = Math.floor(toMs(instant) / 1000) * 1000;
  const p = zonedParts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}

/** The local calendar date of an instant in a time zone. */
export function dateKeyAt(instant: Date | number, timeZone: string): DateKey {
  const p = zonedParts(instant, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month, 2)}-${pad(p.day, 2)}`;
}

/**
 * The instant at which a wall-clock time occurs in a zone.
 *
 * Matches PostgreSQL's `timestamp AT TIME ZONE zone`:
 *  - a wall time skipped by a spring-forward gap resolves to the instant the
 *    same reading would have had before the jump (i.e. it lands after the gap);
 *  - a wall time repeated by a fall-back resolves to the later (standard time)
 *    occurrence.
 */
export function zonedTimeToUtc(key: DateKey, hour: number, minute: number, timeZone: string): Date {
  const wall = proxyUtc(key) + hour * MS_PER_HOUR + minute * MS_PER_MINUTE;
  const candidates = [wall - offsetMs(wall - MS_PER_DAY, timeZone), wall - offsetMs(wall + MS_PER_DAY, timeZone)];
  const valid = candidates.filter((candidate) => candidate + offsetMs(candidate, timeZone) === wall);
  return new Date(Math.max(...(valid.length > 0 ? valid : candidates)));
}

/** First instant of a local date. */
export function startOfDay(key: DateKey, timeZone: string): Date {
  return zonedTimeToUtc(key, 0, 0, timeZone);
}

export interface DayWindow {
  /** Local midnight at the start of the date. */
  startsAt: Date;
  /** Local midnight at the end of the date (start of the next date). */
  endsAt: Date;
  /** Noon on the following local date: last moment for an on-time submission. */
  deadlineAt: Date;
}

export function dayWindow(key: DateKey, timeZone: string): DayWindow {
  const next = addDays(key, 1);
  return {
    startsAt: startOfDay(key, timeZone),
    endsAt: startOfDay(next, timeZone),
    deadlineAt: zonedTimeToUtc(next, SUBMISSION_DEADLINE_HOUR, 0, timeZone),
  };
}

export function todayKey(now: Date | number, timeZone: string): DateKey {
  return dateKeyAt(now, timeZone);
}

/** Minutes since local midnight for an instant, used for reminder scheduling. */
export function minutesIntoDay(instant: Date | number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return p.hour * 60 + p.minute;
}
