import type { Comparator, HabitType, Verification } from './types';

export interface HabitDefinition {
  type: HabitType;
  label: string;
  /** Short playful marker. Decoration only: never the sole carrier of meaning. */
  emoji: string;
  /** Verb phrase used on check-in actions, e.g. "Log reading". */
  action: string;
  defaultTarget: number;
  defaultUnit: string;
  comparator: Comparator;
  /** Allowed target range for numeric habits. */
  minTarget: number;
  maxTarget: number;
  targetStep: number;
  /** Largest value a single day can hold. */
  maxDailyValue: number;
  defaultVerification: Verification;
  /** Screen time can never be self-reported. */
  evidenceMandatory: boolean;
  /** Reps are added in increments through the day (idempotent ledger). */
  usesIncrements: boolean;
  /** A maximum goal can only be judged once the whole day is over. */
  requiresFinishedDay: boolean;
  /** Completion is announced without detail (prayer). */
  privateDetail: boolean;
}

export const HABITS: Record<HabitType, HabitDefinition> = {
  screen_time: {
    type: 'screen_time',
    label: 'Screen time',
    emoji: '📱',
    action: 'Submit screenshot',
    defaultTarget: 120,
    defaultUnit: 'minutes',
    comparator: 'lte',
    minTarget: 15,
    maxTarget: 1440,
    targetStep: 15,
    maxDailyValue: 1440,
    defaultVerification: 'evidence',
    evidenceMandatory: true,
    usesIncrements: false,
    requiresFinishedDay: true,
    privateDetail: false,
  },
  reading: {
    type: 'reading',
    label: 'Reading',
    emoji: '📚',
    action: 'Log reading',
    defaultTarget: 20,
    defaultUnit: 'minutes',
    comparator: 'gte',
    minTarget: 1,
    maxTarget: 600,
    targetStep: 5,
    maxDailyValue: 1440,
    defaultVerification: 'self_report',
    evidenceMandatory: false,
    usesIncrements: false,
    requiresFinishedDay: false,
    privateDetail: false,
  },
  prayer: {
    type: 'prayer',
    label: 'Prayer',
    emoji: '🙏',
    action: 'Check in',
    defaultTarget: 1,
    defaultUnit: 'check-in',
    comparator: 'bool',
    minTarget: 1,
    maxTarget: 1,
    targetStep: 1,
    maxDailyValue: 1,
    defaultVerification: 'self_report',
    evidenceMandatory: false,
    usesIncrements: false,
    requiresFinishedDay: false,
    privateDetail: true,
  },
  pushups: {
    type: 'pushups',
    label: 'Pushups',
    emoji: '💪',
    action: 'Log reps',
    defaultTarget: 50,
    defaultUnit: 'reps',
    comparator: 'gte',
    minTarget: 1,
    maxTarget: 10000,
    targetStep: 5,
    maxDailyValue: 100000,
    defaultVerification: 'self_report',
    evidenceMandatory: false,
    usesIncrements: true,
    requiresFinishedDay: false,
    privateDetail: false,
  },
  custom: {
    type: 'custom',
    label: 'Custom',
    emoji: '⭐',
    action: 'Check in',
    defaultTarget: 1,
    defaultUnit: 'check-in',
    comparator: 'bool',
    minTarget: 1,
    maxTarget: 1_000_000,
    targetStep: 1,
    maxDailyValue: 1_000_000,
    defaultVerification: 'self_report',
    evidenceMandatory: false,
    usesIncrements: false,
    requiresFinishedDay: false,
    privateDetail: false,
  },
};

export function habit(type: HabitType): HabitDefinition {
  return HABITS[type];
}

/** "2h", "1h 30m", "45m". */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** "2 hours", "1 hour 30 minutes", "45 minutes" — for sentences and screen readers. */
export function spellMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const h = hours === 1 ? '1 hour' : `${hours} hours`;
  const m = rest === 1 ? '1 minute' : `${rest} minutes`;
  if (hours === 0) return m;
  if (rest === 0) return h;
  return `${h} ${m}`;
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

/** A recorded value, e.g. "1h 35m", "32 reps", "Yes". */
export function formatValue(type: HabitType, comparator: Comparator, unit: string, value: number): string {
  if (comparator === 'bool') return value >= 1 ? 'Yes' : 'No';
  if (unit === 'minutes') return formatMinutes(value);
  return `${formatNumber(value)} ${unit}`;
}

/**
 * The daily goal in plain words. Uses inclusive phrasing ("2 hours or less")
 * rather than the ambiguous "under 2 hours".
 */
export function describeGoal(type: HabitType, comparator: Comparator, target: number, unit: string): string {
  if (comparator === 'bool') {
    if (type === 'prayer') return 'Pray once a day';
    return 'Check in once a day';
  }
  const amount = unit === 'minutes' ? spellMinutes(target) : `${formatNumber(target)} ${unit}`;
  if (comparator === 'lte') {
    return type === 'screen_time' ? `${amount} or less of screen time a day` : `${amount} or less a day`;
  }
  if (type === 'reading') return `Read at least ${amount} a day`;
  if (type === 'pushups') return `At least ${amount} a day`;
  return `At least ${amount} a day`;
}

/** Compact goal for cards: "≤ 2h a day", "20m+ a day", "50 reps a day", "Daily check-in". */
export function shortGoal(type: HabitType, comparator: Comparator, target: number, unit: string): string {
  if (comparator === 'bool') return 'Daily check-in';
  const amount = unit === 'minutes' ? formatMinutes(target) : `${formatNumber(target)} ${unit}`;
  if (comparator === 'lte') return `${amount} or less a day`;
  return `${amount} a day`;
}

export function verificationLabel(type: HabitType, verification: Verification): string {
  if (verification === 'self_report') return 'Self-reported';
  return type === 'screen_time' ? 'Screenshot reviewed by admin' : 'Photo proof reviewed by admin';
}
