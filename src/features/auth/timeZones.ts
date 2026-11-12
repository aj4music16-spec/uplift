import { isValidTimeZone } from '@/domain/time';

/** Used when the runtime cannot list its time zones (older Hermes / Android builds). */
const FALLBACK_ZONES = [
  'UTC',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Phoenix',
  'America/Denver',
  'America/Chicago',
  'America/Mexico_City',
  'America/New_York',
  'America/Toronto',
  'America/Halifax',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Atlantic/Reykjavik',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Lagos',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Nairobi',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Manila',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
];

let cached: string[] | null = null;

/** Every IANA zone this device knows, valid and sorted. */
export function allTimeZones(): string[] {
  if (cached) return cached;
  let zones: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: 'timeZone') => string[] };
    if (typeof intl.supportedValuesOf === 'function') zones = intl.supportedValuesOf('timeZone');
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = FALLBACK_ZONES;
  const valid = Array.from(new Set(['UTC', ...zones])).filter((zone) => isValidTimeZone(zone));
  valid.sort((a, b) => (a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b)));
  cached = valid;
  return valid;
}

/** "America/New_York" → "America / New York" for display. */
export function readableZone(zone: string): string {
  return zone.replace(/_/g, ' ').replace(/\//g, ' / ');
}
