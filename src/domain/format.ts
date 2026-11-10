import { addDays, compareDateKeys, diffDays, type DateKey } from './time';

/**
 * Presentation helpers that only depend on Intl. Date keys are formatted as
 * calendar dates (never shifted through the device time zone); instants are
 * formatted in an explicit time zone.
 */

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(options: Intl.DateTimeFormatOptions, timeZone: string): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone });
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

function keyToUtcDate(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12));
}

/** "Tue, Nov 3" */
export function formatDateKey(key: DateKey, options: { weekday?: boolean; year?: boolean } = {}): string {
  return dateFormatter(
    {
      weekday: options.weekday === false ? undefined : 'short',
      month: 'short',
      day: 'numeric',
      year: options.year ? 'numeric' : undefined,
    },
    'UTC',
  ).format(keyToUtcDate(key));
}

/** "Tuesday, November 3" — for screen readers and headings. */
export function formatDateKeyLong(key: DateKey): string {
  return dateFormatter({ weekday: 'long', month: 'long', day: 'numeric' }, 'UTC').format(keyToUtcDate(key));
}

/** "T" for Tuesday. */
export function weekdayInitial(key: DateKey): string {
  return dateFormatter({ weekday: 'narrow' }, 'UTC').format(keyToUtcDate(key));
}

export function dayOfMonth(key: DateKey): string {
  return String(Number(key.slice(8, 10)));
}

/** "Nov 3 – Nov 9" */
export function formatDateRange(start: DateKey, end: DateKey): string {
  if (start === end) return formatDateKey(start, { weekday: false });
  return `${formatDateKey(start, { weekday: false })} – ${formatDateKey(end, { weekday: false })}`;
}

/** "Today", "Yesterday", "Tomorrow", otherwise "Tue, Nov 3". */
export function relativeDay(key: DateKey, today: DateKey): string {
  const delta = diffDays(today, key);
  if (delta === 0) return 'Today';
  if (delta === -1) return 'Yesterday';
  if (delta === 1) return 'Tomorrow';
  return formatDateKey(key);
}

/** "yesterday’s", "today’s", "Nov 3" — for action labels like "Submit yesterday’s screenshot". */
export function possessiveDay(key: DateKey, today: DateKey): string {
  const delta = diffDays(today, key);
  if (delta === 0) return 'today’s';
  if (delta === -1) return 'yesterday’s';
  return `${formatDateKey(key, { weekday: false })}`;
}

/** "12:00 PM" in the given zone. */
export function formatTime(instant: Date | string, timeZone: string): string {
  return dateFormatter({ hour: 'numeric', minute: '2-digit' }, timeZone).format(new Date(instant));
}

/** "Wed, Nov 4, 12:00 PM" in the given zone. */
export function formatDateTime(instant: Date | string, timeZone: string): string {
  return dateFormatter({ weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, timeZone).format(
    new Date(instant),
  );
}

/** Short zone name such as "EST" or "GMT+2". */
export function timeZoneAbbreviation(instant: Date | string, timeZone: string): string {
  const parts = dateFormatter({ timeZoneName: 'short', hour: 'numeric' }, timeZone).formatToParts(new Date(instant));
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
}

/** "America/New_York" → "New York". */
export function timeZoneCity(timeZone: string): string {
  const last = timeZone.split('/').pop() ?? timeZone;
  return last.replace(/_/g, ' ');
}

/** "in 2h 5m", "in 3 days", "5m ago" */
export function formatRelative(target: Date | string, now: Date): string {
  const delta = new Date(target).getTime() - now.getTime();
  const abs = Math.abs(delta);
  const minutes = Math.round(abs / 60_000);
  let text: string;
  if (minutes < 1) return delta >= 0 ? 'in a moment' : 'just now';
  if (minutes < 60) text = `${minutes}m`;
  else if (minutes < 60 * 24) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    text = rest === 0 || hours >= 6 ? `${hours}h` : `${hours}h ${rest}m`;
  } else {
    const days = Math.round(minutes / (60 * 24));
    text = days === 1 ? '1 day' : `${days} days`;
  }
  return delta >= 0 ? `in ${text}` : `${text} ago`;
}

/** Days left including today, clamped at zero. "2 days left", "Last day", "Ended". */
export function daysLeftLabel(today: DateKey, endDate: DateKey): string {
  const left = diffDays(today, endDate) + 1;
  if (left <= 0) return 'Ended';
  if (left === 1) return 'Last day';
  return `${left} days left`;
}

export function startsInLabel(today: DateKey, startDate: DateKey): string {
  const delta = diffDays(today, startDate);
  if (delta <= 0) return 'Started';
  if (delta === 1) return 'Starts tomorrow';
  return `Starts in ${delta} days`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Initials for avatar fallbacks and labels: "Dad" → "D", "Mia Chen" → "MC". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

export function isPastDateKey(key: DateKey, today: DateKey): boolean {
  return compareDateKeys(key, today) < 0;
}

export function tomorrowKey(today: DateKey): DateKey {
  return addDays(today, 1);
}
