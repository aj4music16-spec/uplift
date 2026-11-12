import { randomUUID } from 'expo-crypto';
import { useCallback, useRef } from 'react';

import type { DayCell, DayDetail } from '@/data/types';
import {
  dayWindow,
  decisionWindow,
  disputeGate,
  formatDateKey,
  formatDateTime,
  formatValue,
  HABITS,
  incrementGate,
  submissionGate,
  timeZoneAbbreviation,
  type ErrorCode,
  type Gate,
  type HabitType,
} from '@/domain';

/** The clock-relevant facts of a day's challenge, in the shape the domain gates expect. */
export function challengeClockOf(day: Pick<DayDetail, 'challengeStatus' | 'startDate' | 'endDate' | 'timezone'>) {
  return { status: day.challengeStatus, startDate: day.startDate, endDate: day.endDate, timeZone: day.timezone };
}

export function gateForDay(day: DayDetail, now: Date): Gate {
  return submissionGate({
    challenge: challengeClockOf(day),
    habitType: day.habitType,
    comparator: day.rule.comparator,
    verification: day.rule.verification,
    date: day.date,
    now,
    record: day.record,
  });
}

export function incrementGateForDay(day: DayDetail, now: Date): Gate {
  return incrementGate({
    challenge: challengeClockOf(day),
    habitType: day.habitType,
    comparator: day.rule.comparator,
    verification: day.rule.verification,
    date: day.date,
    now,
    record: day.record,
  });
}

export function disputeGateForDay(day: DayDetail, now: Date): Gate {
  if (!day.record) return { ok: false, code: 'VALIDATION' };
  const decidedAt = day.record.decidedAt ? Date.parse(day.record.decidedAt) : null;
  return disputeGate({
    challenge: challengeClockOf(day),
    now,
    record: day.record,
    hasOpenDispute: day.disputes.some((d) => d.status === 'open'),
    disputedSinceDecision: decidedAt != null && day.disputes.some((d) => Date.parse(d.createdAt) >= decidedAt),
  });
}

/** "Wed, Nov 11, 12:00 PM EST" */
export function formatInstant(instant: Date | string, timeZone: string): string {
  return `${formatDateTime(instant, timeZone)} ${timeZoneAbbreviation(instant, timeZone)}`;
}

/** "Due Wed, Nov 11, 12:00 PM EST" */
export function deadlineLabel(date: string, timeZone: string): string {
  return `Due ${formatInstant(dayWindow(date, timeZone).deadlineAt, timeZone)}`;
}

export function valueLabel(day: Pick<DayDetail, 'habitType' | 'metricUnit' | 'rule'>, value: number): string {
  return formatValue(day.habitType, day.rule.comparator, day.metricUnit, value);
}

/** Proof for this habit must wait until the whole day is over. */
export function needsFinishedDay(habitType: HabitType, comparator: string): boolean {
  return comparator === 'lte' || HABITS[habitType].requiresFinishedDay;
}

/** Plain copy for each blocked state of the submission gate. */
export function gateCopy(code: ErrorCode, day: DayDetail): { title: string; message: string } {
  const deadline = formatInstant(dayWindow(day.date, day.timezone).deadlineAt, day.timezone);
  switch (code) {
    case 'DAY_NOT_FINISHED':
      return day.habitType === 'screen_time'
        ? {
            title: 'This day isn’t over yet',
            message: `A screenshot can only show a full day once it has ended. Proof for ${formatDateKey(day.date)} comes available after midnight; it’s due by noon (${deadline}).`,
          }
        : { title: 'This day isn’t over yet', message: `You can check in after midnight. It’s due by ${deadline}.` };
    case 'NOT_STARTED':
      return { title: 'Not started yet', message: `Check-ins open when the challenge starts on ${formatDateKey(day.startDate)}.` };
    case 'DAY_NOT_STARTED':
      return { title: 'That day hasn’t started', message: 'You can only check in for today or a past day.' };
    case 'REVIEW_PENDING':
      return day.status === 'late_pending'
        ? { title: 'Late — waiting for the admin', message: 'Your late submission is with the admin. It only counts if they accept it.' }
        : { title: 'Waiting for review', message: 'Your proof is with the admin. It doesn’t count until they review it. If they reject it you can send a new one.' };
    case 'ALREADY_DECIDED':
      return { title: 'This day is decided', message: 'This day has a final result. If you disagree, open the day and dispute the decision.' };
    case 'CHALLENGE_CLOSED':
      return { title: 'Check-ins are closed', message: 'This challenge is finished or canceled, so days can’t be changed.' };
    case 'DEADLINE_PASSED':
      return { title: 'Deadline passed', message: `On-time check-ins closed at ${deadline}.` };
    case 'VALIDATION':
      return { title: 'Not a challenge day', message: 'That date isn’t part of this challenge.' };
    default:
      return { title: 'Not available', message: 'You can’t check in for this day right now.' };
  }
}

/**
 * The most relevant actionable day: a rejected day, else the oldest due day,
 * else today when the habit can be logged during the day, else the latest
 * day that has started.
 */
export function defaultCheckinDate(days: readonly DayCell[], habitType: HabitType, comparator: string, today: string): string | null {
  const rejected = days.find((d) => d.status === 'rejected');
  if (rejected) return rejected.date;
  const due = days.find((d) => d.status === 'due');
  if (due) return due.date;
  if (!needsFinishedDay(habitType, comparator) && days.some((d) => d.date === today)) return today;
  const started = days.filter((d) => d.status !== 'upcoming');
  return started[started.length - 1]?.date ?? days[0]?.date ?? null;
}

/**
 * One idempotency key per user intent. The key stays the same while the
 * intent (its signature) is unchanged, so retrying after a network error can
 * never create a second submission. Call `reset` after a success.
 */
export function useIntentKey() {
  const ref = useRef<{ signature: string; key: string } | null>(null);
  const keyFor = useCallback((signature: string) => {
    if (!ref.current || ref.current.signature !== signature) ref.current = { signature, key: randomUUID() };
    return ref.current.key;
  }, []);
  const reset = useCallback(() => {
    ref.current = null;
  }, []);
  return { keyFor, reset };
}

/** Text → minutes for an hours/minutes pair. Null when invalid. */
export function parseHoursMinutes(hours: string, minutes: string): number | null {
  const h = hours.trim() === '' ? 0 : Number(hours);
  const m = minutes.trim() === '' ? 0 : Number(minutes);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59) return null;
  if (hours.trim() === '' && minutes.trim() === '') return null;
  const total = h * 60 + m;
  return total > 1440 ? null : total;
}

export function parseAmount(text: string, allowDecimals: boolean): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  if (!allowDecimals && !Number.isInteger(value)) return null;
  return value;
}

/** "You can dispute until Thu, Nov 12, 2:00 PM EST" / "The dispute window closed …". */
export function decisionWindowLabel(day: DayDetail, now: Date): string {
  if (!day.record?.decidedAt) return '';
  const window = decisionWindow(day.record, now);
  if (!window.closesAt) return '';
  const when = formatInstant(window.closesAt, day.timezone);
  if (window.open) return `You can dispute this decision until ${when}.`;
  const acknowledged = day.record.acknowledgedAt != null && Date.parse(day.record.acknowledgedAt) >= Date.parse(day.record.decidedAt);
  return acknowledged ? 'You accepted this decision.' : `The dispute window closed ${when}.`;
}
