import { HABITS } from './habits';
import { canResubmitOnTime, decisionWindow, isValidDailyValue, type RecordState } from './scoring';
import { addDays, compareDateKeys, dayWindow, MS_PER_HOUR, startOfDay, type DateKey } from './time';
import { LIMITS, type ChallengeStatus, type Comparator, type HabitType, type Verification } from './types';
import type { ErrorCode } from './errors';

export interface ChallengeClock {
  status: ChallengeStatus;
  startDate: DateKey;
  endDate: DateKey;
  timeZone: string;
}

/**
 * The status a challenge is really in at `now`.
 *
 * scheduled -> active -> review follow the clock: start is local midnight on
 * the start date, the activity window ends at the local midnight after the end
 * date. draft, completed and canceled are only ever changed by explicit
 * server operations. "completed" in particular is never reached by time alone.
 */
export function effectiveStatus(challenge: ChallengeClock, now: Date): ChallengeStatus {
  if (challenge.status !== 'scheduled' && challenge.status !== 'active') return challenge.status;
  const t = now.getTime();
  if (t >= startOfDay(addDays(challenge.endDate, 1), challenge.timeZone).getTime()) return 'review';
  if (t >= startOfDay(challenge.startDate, challenge.timeZone).getTime()) return 'active';
  return 'scheduled';
}

/** Noon after the last challenge day: the last on-time submission moment. */
export function finalSubmissionDeadline(endDate: DateKey, timeZone: string): Date {
  return dayWindow(endDate, timeZone).deadlineAt;
}

export type FinalizationBlockerCode =
  | 'NOT_IN_REVIEW'
  | 'DEADLINE_NOT_REACHED'
  | 'REVIEW_PENDING'
  | 'DISPUTE_OPEN'
  | 'DISPUTE_WINDOW_OPEN';

export interface FinalizationBlocker {
  code: FinalizationBlockerCode;
  /** How many records/disputes are involved, where that applies. */
  count: number;
  /** When this blocker clears on its own, if it does. */
  until: Date | null;
}

export interface FinalizationRecord extends RecordState {
  /** Records of removed participants never block completion. */
  participantRemoved: boolean;
  /** Whether resubmission of a rejected entry is still possible (same 24h window). */
  date: DateKey;
}

/**
 * Everything that currently stops a challenge from completing. Completion
 * needs: the last deadline passed, no pending reviews (pending never turns
 * into success by itself), no open disputes, and every 24-hour dispute window
 * expired or waived.
 */
export function finalizationBlockers(input: {
  challenge: ChallengeClock;
  now: Date;
  records: readonly FinalizationRecord[];
  openDisputes: number;
}): FinalizationBlocker[] {
  const { challenge, now } = input;
  const blockers: FinalizationBlocker[] = [];
  const status = effectiveStatus(challenge, now);
  if (status !== 'review') {
    blockers.push({ code: 'NOT_IN_REVIEW', count: 0, until: null });
    return blockers;
  }
  const deadline = finalSubmissionDeadline(challenge.endDate, challenge.timeZone);
  if (now.getTime() < deadline.getTime()) blockers.push({ code: 'DEADLINE_NOT_REACHED', count: 0, until: deadline });

  const live = input.records.filter((record) => !record.participantRemoved);
  const pending = live.filter((record) => record.outcome === 'pending' || record.outcome === 'late_pending').length;
  if (pending > 0) blockers.push({ code: 'REVIEW_PENDING', count: pending, until: null });
  if (input.openDisputes > 0) blockers.push({ code: 'DISPUTE_OPEN', count: input.openDisputes, until: null });

  let openWindows = 0;
  let latest: Date | null = null;
  for (const record of live) {
    const window = decisionWindow(record, now);
    if (window.open && window.closesAt) {
      openWindows += 1;
      if (!latest || window.closesAt.getTime() > latest.getTime()) latest = window.closesAt;
    }
  }
  if (openWindows > 0) blockers.push({ code: 'DISPUTE_WINDOW_OPEN', count: openWindows, until: latest });
  return blockers;
}

/**
 * Admins are reminded of outstanding work 48 hours after the final submission
 * deadline. Nothing is rejected or approved automatically.
 */
export function adminReminderDue(challenge: ChallengeClock, now: Date, blockers: readonly FinalizationBlocker[]): boolean {
  if (effectiveStatus(challenge, now) !== 'review') return false;
  const outstanding = blockers.some((b) => b.code === 'REVIEW_PENDING' || b.code === 'DISPUTE_OPEN');
  if (!outstanding) return false;
  const dueAt = finalSubmissionDeadline(challenge.endDate, challenge.timeZone).getTime() + LIMITS.adminReminderHours * MS_PER_HOUR;
  return now.getTime() >= dueAt;
}

export type Gate = { ok: true; late: boolean } | { ok: false; code: ErrorCode };

export interface SubmissionContext {
  challenge: ChallengeClock;
  habitType: HabitType;
  comparator: Comparator;
  verification: Verification;
  date: DateKey;
  now: Date;
  record?: (RecordState & { outcome: RecordState['outcome'] }) | null;
}

/**
 * Whether a participant may submit (or revise) a check-in for a date right now.
 * The server enforces the same rules in public.submit_checkin; the client uses
 * this only to explain what is possible before a request is made.
 */
export function submissionGate(context: SubmissionContext): Gate {
  const { challenge, date, now, record } = context;
  const status = effectiveStatus(challenge, now);
  if (status === 'draft' || status === 'scheduled') return { ok: false, code: 'NOT_STARTED' };
  if (status === 'completed' || status === 'canceled') return { ok: false, code: 'CHALLENGE_CLOSED' };
  if (compareDateKeys(date, challenge.startDate) < 0 || compareDateKeys(date, challenge.endDate) > 0) {
    return { ok: false, code: 'VALIDATION' };
  }
  const window = dayWindow(date, challenge.timeZone);
  const t = now.getTime();
  if (t < window.startsAt.getTime()) return { ok: false, code: 'DAY_NOT_STARTED' };
  // A maximum goal (screen time) can't be proven until the whole day is over.
  const needsFinishedDay = context.comparator === 'lte' || HABITS[context.habitType].requiresFinishedDay;
  if (needsFinishedDay && t < window.endsAt.getTime()) return { ok: false, code: 'DAY_NOT_FINISHED' };

  const pastDeadline = t >= window.deadlineAt.getTime();
  if (record) {
    if (record.outcome === 'late_pending') return { ok: false, code: 'REVIEW_PENDING' };
    if (record.provenance === 'admin_adjusted') return { ok: false, code: 'ALREADY_DECIDED' };
    if (record.outcome === 'rejected') {
      const onTime = canResubmitOnTime({ date, timeZone: challenge.timeZone, now, record });
      return { ok: true, late: !onTime };
    }
    if (record.outcome === 'pending') return pastDeadline ? { ok: false, code: 'REVIEW_PENDING' } : { ok: true, late: false };
    if (
      (record.outcome === 'success' || record.outcome === 'fail') &&
      (record.provenance === 'evidence_reviewed' || record.provenance === 'admin_self_reviewed')
    ) {
      return { ok: false, code: 'ALREADY_DECIDED' };
    }
    // A counted self-reported day is final once its deadline has passed.
    if (record.outcome === 'success' && pastDeadline) return { ok: false, code: 'ALREADY_DECIDED' };
  }
  return { ok: true, late: pastDeadline };
}

export function validateSubmissionValue(habitType: HabitType, comparator: Comparator, value: number): boolean {
  return isValidDailyValue(habitType, comparator, value);
}

/** Whether rep increments can be added for a date right now. Increments are never accepted late. */
export function incrementGate(context: SubmissionContext): Gate {
  if (!HABITS[context.habitType].usesIncrements) return { ok: false, code: 'VALIDATION' };
  const gate = submissionGate(context);
  if (!gate.ok) return gate;
  if (gate.late) return { ok: false, code: 'DEADLINE_PASSED' };
  if (context.record?.outcome === 'pending' || context.record?.outcome === 'rejected') {
    return { ok: false, code: 'REVIEW_PENDING' };
  }
  return gate;
}

/** A dispute can be opened by the participant during the 24h window after a decision. */
export function disputeGate(input: {
  challenge: ChallengeClock;
  now: Date;
  record: RecordState;
  hasOpenDispute: boolean;
  disputedSinceDecision: boolean;
}): Gate {
  const status = effectiveStatus(input.challenge, input.now);
  if (status !== 'active' && status !== 'review') return { ok: false, code: 'CHALLENGE_CLOSED' };
  if (input.hasOpenDispute) return { ok: false, code: 'DISPUTE_OPEN' };
  if (!input.record.decidedAt) return { ok: false, code: 'VALIDATION' };
  if (input.disputedSinceDecision) return { ok: false, code: 'ALREADY_DECIDED' };
  if (!decisionWindow(input.record, input.now).open) return { ok: false, code: 'DISPUTE_WINDOW_CLOSED' };
  return { ok: true, late: false };
}

/** Joining is only possible before the challenge starts, against the current rule version. */
export function joinGate(input: {
  challenge: ChallengeClock;
  now: Date;
  currentVersionId: string;
  acceptedVersionId: string;
  participantCount: number;
}): Gate {
  const status = effectiveStatus(input.challenge, input.now);
  if (status === 'draft') return { ok: false, code: 'NOT_FOUND' };
  if (status === 'canceled' || status === 'completed') return { ok: false, code: 'CHALLENGE_CLOSED' };
  if (status !== 'scheduled') return { ok: false, code: 'CHALLENGE_STARTED' };
  if (input.acceptedVersionId !== input.currentVersionId) return { ok: false, code: 'RULES_CHANGED' };
  if (input.participantCount >= LIMITS.maxParticipants) return { ok: false, code: 'LIMIT_REACHED' };
  return { ok: true, late: false };
}
