import type { DateKey } from './time';

export const HABIT_TYPES = ['screen_time', 'reading', 'prayer', 'pushups', 'custom'] as const;
export type HabitType = (typeof HABIT_TYPES)[number];

/**
 * How a daily value is compared to the target.
 *  - lte:  value must be at most the target (screen time maximum)
 *  - gte:  value must be at least the target (reading minutes, reps)
 *  - bool: a yes/no check-in; success is a "yes"
 */
export const COMPARATORS = ['lte', 'gte', 'bool'] as const;
export type Comparator = (typeof COMPARATORS)[number];

/**
 *  - evidence:    a screenshot/photo is required and an admin reviews it
 *  - self_report: the server accepts a valid entry automatically, labeled self-reported
 */
export const VERIFICATIONS = ['evidence', 'self_report'] as const;
export type Verification = (typeof VERIFICATIONS)[number];

export const CHALLENGE_STATUSES = ['draft', 'scheduled', 'active', 'review', 'completed', 'canceled'] as const;
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];

export const RULE_STATUSES = ['draft', 'active', 'superseded', 'proposed', 'declined', 'withdrawn'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/**
 * Stored state of a daily record.
 *  - open:         a record exists (reps logged, a below-target entry) but nothing final yet
 *  - pending:      evidence submitted, awaiting admin review. Adds no score.
 *  - late_pending: submitted after the deadline, awaiting an admin's decision to accept it
 *  - success/fail: evaluated against the rules, or set by an admin override
 *  - rejected:     evidence rejected; a new version may be submitted
 */
export const RECORD_OUTCOMES = ['open', 'pending', 'late_pending', 'success', 'fail', 'rejected'] as const;
export type RecordOutcome = (typeof RECORD_OUTCOMES)[number];

/** Where a counted result came from. Shown separately from the outcome. */
export const PROVENANCES = ['self_reported', 'evidence_reviewed', 'admin_self_reviewed', 'admin_adjusted'] as const;
export type Provenance = (typeof PROVENANCES)[number];

/**
 * What a day looks like right now, derived from the stored record and the clock.
 *  - upcoming: the day has not started
 *  - open:     the day is in progress and nothing final is recorded
 *  - due:      the day is over and a submission is still possible before the deadline
 *  - missed:   the deadline passed without a counted submission (a failed day)
 */
export const DAY_STATUSES = [
  'upcoming',
  'open',
  'due',
  'pending',
  'late_pending',
  'success',
  'fail',
  'rejected',
  'missed',
] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

export const SUBMISSION_STATUSES = ['pending', 'late', 'accepted', 'rejected', 'declined', 'superseded'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const REWARD_MODES = ['none', 'demo_sponsor', 'demo_pot'] as const;
export type RewardMode = (typeof REWARD_MODES)[number];

export const CIRCLE_ROLES = ['owner', 'admin', 'member'] as const;
export type CircleRole = (typeof CIRCLE_ROLES)[number];

/** The substantive, versioned terms of a challenge. */
export interface Rules {
  target: number;
  comparator: Comparator;
  requiredDays: number;
  verification: Verification;
  startDate: DateKey;
  endDate: DateKey;
}

export interface RuleVersionLike extends Rules {
  id: string;
  version: number;
  status: RuleStatus;
  /** First challenge date this version applies to. */
  effectiveDate: DateKey;
}

export const LIMITS = {
  maxCircleMembers: 50,
  maxParticipants: 50,
  minDurationDays: 1,
  maxDurationDays: 30,
  maxMessageLength: 2000,
  maxReasonLength: 500,
  minReasonLength: 3,
  maxNameLength: 60,
  maxDescriptionLength: 280,
  maxUnitLength: 20,
  maxEvidenceBytes: 10 * 1024 * 1024,
  inviteDefaultExpiryDays: 7,
  inviteMaxExpiryDays: 30,
  inviteDefaultMaxUses: 25,
  inviteMaxUses: 50,
  disputeWindowHours: 24,
  adminReminderHours: 48,
  evidenceRetentionDays: 30,
} as const;

export const EVIDENCE_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
export type EvidenceMime = (typeof EVIDENCE_MIME_TYPES)[number];

export const REACTION_EMOJI = ['👏', '🔥', '💪', '🙌', '😂', '❤️'] as const;
