import { HABITS } from './habits';
import { dayWindow, MS_PER_HOUR, type DateKey } from './time';
import {
  LIMITS,
  type Comparator,
  type DayStatus,
  type HabitType,
  type Provenance,
  type RecordOutcome,
} from './types';

/**
 * Scoring uses completed successful days, never invented points.
 *  - Minimum targets:      value >= target
 *  - Screen-time maximum:  value <= target (inclusive: exactly 120 minutes passes a 120-minute goal)
 *  - Yes/no goals:         the check-in is "yes"
 */
export function meetsTarget(comparator: Comparator, target: number, value: number): boolean {
  switch (comparator) {
    case 'lte':
      return value <= target;
    case 'gte':
      return value >= target;
    case 'bool':
      return value >= 1;
  }
}

/**
 * The outcome of a value that has been accepted (self-reported, or evidence
 * approved by an admin). Approving evidence and meeting the target are
 * separate: a verified screenshot showing 150 minutes is a failed day for a
 * 120-minute goal.
 */
export function evaluateAccepted(comparator: Comparator, target: number, value: number): 'success' | 'fail' {
  return meetsTarget(comparator, target, value) ? 'success' : 'fail';
}

/**
 * Outcome to store for a self-reported value. A value below a minimum target
 * stays "open" while the day can still be added to; it only becomes a missed
 * day once the deadline passes (see deriveDayStatus).
 */
export function selfReportOutcome(comparator: Comparator, target: number, value: number): 'success' | 'open' {
  return meetsTarget(comparator, target, value) ? 'success' : 'open';
}

export function isValidDailyValue(habitType: HabitType, comparator: Comparator, value: number): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  if (comparator === 'bool') return value === 0 || value === 1;
  if (value > HABITS[habitType].maxDailyValue) return false;
  // Two decimal places at most. Compared with a tolerance: 2.2 * 100 is 220.00000000000003 in floating point.
  if (habitType === 'custom') return Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
  return Number.isInteger(value);
}

export interface RecordState {
  outcome: RecordOutcome;
  provenance?: Provenance | null;
  /** When an admin last decided this day (review decision or override). */
  decidedAt?: string | null;
  /** When the participant acknowledged the latest decision, waiving the rest of the dispute window. */
  acknowledgedAt?: string | null;
}

/** What a day looks like at `now`. A missing day is never "missed" before its deadline. */
export function deriveDayStatus(input: {
  date: DateKey;
  timeZone: string;
  now: Date;
  record?: RecordState | null;
}): DayStatus {
  const outcome = input.record?.outcome;
  if (outcome && outcome !== 'open') return outcome;
  const window = dayWindow(input.date, input.timeZone);
  const now = input.now.getTime();
  if (now < window.startsAt.getTime()) return 'upcoming';
  if (now < window.endsAt.getTime()) return 'open';
  if (now < window.deadlineAt.getTime()) return 'due';
  return 'missed';
}

export interface DecisionWindow {
  /** Whether the participant can still dispute (or, if rejected, resubmit on time). */
  open: boolean;
  closesAt: Date | null;
}

/** The 24-hour window after a review decision or admin override. */
export function decisionWindow(record: Pick<RecordState, 'decidedAt' | 'acknowledgedAt'>, now: Date): DecisionWindow {
  if (!record.decidedAt) return { open: false, closesAt: null };
  const decidedAt = new Date(record.decidedAt).getTime();
  const closesAt = new Date(decidedAt + LIMITS.disputeWindowHours * MS_PER_HOUR);
  const acknowledged = record.acknowledgedAt != null && new Date(record.acknowledgedAt).getTime() >= decidedAt;
  return { open: !acknowledged && now.getTime() < closesAt.getTime(), closesAt };
}

/**
 * Until when a rejected entry can be resubmitted as an ordinary (not late)
 * submission: the original deadline or the end of the decision window,
 * whichever is later.
 */
export function resubmitUntil(date: DateKey, timeZone: string, decidedAt: string | null | undefined): Date {
  const deadline = dayWindow(date, timeZone).deadlineAt;
  if (!decidedAt) return deadline;
  const windowEnd = new Date(new Date(decidedAt).getTime() + LIMITS.disputeWindowHours * MS_PER_HOUR);
  return windowEnd.getTime() > deadline.getTime() ? windowEnd : deadline;
}

export function canResubmitOnTime(input: {
  date: DateKey;
  timeZone: string;
  now: Date;
  record: Pick<RecordState, 'outcome' | 'decidedAt' | 'acknowledgedAt'>;
}): boolean {
  if (input.record.outcome !== 'rejected') return false;
  const decidedAt = input.record.decidedAt ? new Date(input.record.decidedAt).getTime() : null;
  const acknowledged =
    decidedAt != null && input.record.acknowledgedAt != null && new Date(input.record.acknowledgedAt).getTime() >= decidedAt;
  if (acknowledged) return false;
  return input.now.getTime() < resubmitUntil(input.date, input.timeZone, input.record.decidedAt).getTime();
}

/**
 * What other players may see for a day. Evidence rejections are private to the
 * participant and admins, so a rejected day looks like one still waiting for a
 * submission, and later like a missed one. A late request looks like a pending one.
 */
export function peerVisibleStatus(status: DayStatus, resubmitOpen: boolean): DayStatus {
  if (status === 'rejected') return resubmitOpen ? 'due' : 'missed';
  if (status === 'late_pending') return 'pending';
  return status;
}

export function countsAsSuccess(status: DayStatus): boolean {
  return status === 'success';
}

export function countsAsPending(status: DayStatus): boolean {
  return status === 'pending' || status === 'late_pending';
}

export interface StandingInput {
  participantId: string;
  removed: boolean;
  days: readonly DayStatus[];
}

export interface StandingRow {
  participantId: string;
  successfulDays: number;
  /** Days awaiting review. Shown separately and never counted toward rank. */
  pendingDays: number;
  /** Competition rank (1, 1, 3). Null for removed participants. */
  rank: number | null;
  /** True when another ranked participant has the same number of successful days. */
  tied: boolean;
  /** Reached the required number of successful days. */
  qualified: boolean;
  removed: boolean;
}

/**
 * Standings ordered by successful days, descending. Equal totals share a rank
 * (competition ranking: 1, 1, 3). The secondary order by participant ID is only
 * there to keep rows from jumping around; it is not a tie-break.
 */
export function computeStandings(inputs: readonly StandingInput[], requiredDays: number): StandingRow[] {
  const rows = inputs.map((input) => {
    const successfulDays = input.days.filter(countsAsSuccess).length;
    return {
      participantId: input.participantId,
      successfulDays,
      pendingDays: input.days.filter(countsAsPending).length,
      removed: input.removed,
      qualified: !input.removed && successfulDays >= requiredDays,
    };
  });
  const ranked = rows
    .filter((row) => !row.removed)
    .sort((a, b) => b.successfulDays - a.successfulDays || (a.participantId < b.participantId ? -1 : 1));
  const removed = rows.filter((row) => row.removed).sort((a, b) => (a.participantId < b.participantId ? -1 : 1));

  const out: StandingRow[] = ranked.map((row) => {
    const higher = ranked.filter((other) => other.successfulDays > row.successfulDays).length;
    const same = ranked.filter((other) => other.successfulDays === row.successfulDays).length;
    return { ...row, rank: higher + 1, tied: same > 1 };
  });
  for (const row of removed) out.push({ ...row, rank: null, tied: false });
  return out;
}

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". */
export function ordinal(rank: number): string {
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

/**
 * The label for how a counted result was verified. An admin override is always
 * "Admin adjusted" — never "Screenshot verified" — and an admin approving their
 * own proof is never presented as an independent review.
 */
export function provenanceLabel(provenance: Provenance | null | undefined, habitType: HabitType): string | null {
  switch (provenance) {
    case 'self_reported':
      return 'Self-reported';
    case 'evidence_reviewed':
      return habitType === 'screen_time' ? 'Screenshot verified' : 'Proof verified';
    case 'admin_self_reviewed':
      return 'Admin self-reviewed';
    case 'admin_adjusted':
      return 'Admin adjusted';
    default:
      return null;
  }
}
