import type { AvatarSpec } from '@/components/Avatar';
import type {
  ChallengeStatus,
  CircleRole,
  Comparator,
  HabitType,
  Provenance,
  RecordOutcome,
  RewardMode,
  RuleStatus,
  SubmissionStatus,
  Verification,
} from '@/domain/types';

/**
 * In-memory tables for Demo Mode. They mirror the database schema
 * (supabase/migrations) so the demo behaves like the real backend rather than
 * like a separate, simpler product. Nothing here is persisted or sent anywhere.
 */

export interface ProfileRow {
  id: string;
  displayName: string;
  timezone: string;
  avatar: AvatarSpec;
  onboarded: boolean;
  deletedAt: string | null;
}

export interface CircleRow {
  id: string;
  name: string;
  ownerId: string;
  timezone: string;
  archivedAt: string | null;
  createdAt: string;
}

export interface MemberRow {
  id: string;
  circleId: string;
  userId: string;
  role: CircleRole;
  joinedAt: string;
  removedAt: string | null;
  removedReason: string | null;
}

export interface InviteRow {
  id: string;
  circleId: string;
  challengeId: string | null;
  /** Normalized code. The real backend stores only a hash; the demo never leaves the device. */
  code: string;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ChallengeRow {
  id: string;
  circleId: string;
  creatorId: string;
  name: string;
  description: string;
  habitType: HabitType;
  metricUnit: string;
  timezone: string;
  startDate: string;
  endDate: string;
  status: ChallengeStatus;
  currentRuleVersionId: string;
  revision: number;
  rewardMode: RewardMode;
  draftStep: number;
  rematchOfId: string | null;
  publishedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  canceledReason: string | null;
  finalizeReminderSentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRow {
  id: string;
  challengeId: string;
  userId: string;
  assignedBy: string;
  assignedAt: string;
  revokedAt: string | null;
}

export interface RuleRow {
  id: string;
  challengeId: string;
  version: number;
  status: RuleStatus;
  target: number;
  comparator: Comparator;
  requiredDays: number;
  verification: Verification;
  startDate: string;
  endDate: string;
  effectiveDate: string;
  reason: string | null;
  proposedBy: string | null;
  createdAt: string;
}

export interface ParticipantRow {
  id: string;
  challengeId: string;
  userId: string;
  joinedAt: string;
  acceptedVersionId: string;
  removedAt: string | null;
  removedReason: string | null;
}

export interface AcceptanceRow {
  versionId: string;
  participantId: string;
  decision: 'accepted' | 'declined';
  decidedAt: string;
}

export interface RecordRow {
  id: string;
  participantId: string;
  localDate: string;
  ruleVersionId: string;
  effectiveValue: number | null;
  outcome: RecordOutcome;
  provenance: Provenance | null;
  revision: number;
  decidedAt: string | null;
  acknowledgedAt: string | null;
  successAnnounced: boolean;
}

export interface SubmissionRow {
  id: string;
  recordId: string;
  version: number;
  enteredValue: number;
  submittedAt: string;
  status: SubmissionStatus;
  supersedesId: string | null;
  idempotencyKey: string;
  isLate: boolean;
  priorOutcome: RecordOutcome;
}

export interface IncrementRow {
  id: string;
  recordId: string;
  actorId: string;
  amount: number;
  kind: 'add' | 'correction';
  idempotencyKey: string;
  createdAt: string;
}

export interface EvidenceRow {
  id: string;
  submissionId: string;
  uri: string;
  mime: string;
  byteSize: number;
  /** Stands in for the content hash: equal values flag a repeat for a human. */
  fingerprint: string;
  uploadedBy: string;
  purgedAt: string | null;
}

export interface ReviewRow {
  id: string;
  submissionId: string;
  reviewerId: string;
  decision: 'approved' | 'rejected' | 'late_accepted' | 'late_declined';
  correctedValue: number | null;
  reason: string | null;
  selfReview: boolean;
  reviewedAt: string;
}

export interface OverrideRow {
  id: string;
  recordId: string;
  actorId: string;
  priorOutcome: string;
  priorValue: number | null;
  newOutcome: 'success' | 'fail';
  newValue: number | null;
  reason: string;
  createdAt: string;
}

export interface DisputeRow {
  id: string;
  recordId: string;
  raisedBy: string;
  reason: string;
  status: 'open' | 'upheld' | 'denied';
  resolverId: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  seq: number;
  circleId: string;
  challengeId: string | null;
  actorId: string | null;
  subjectUserId: string | null;
  action: string;
  localDate: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  visibility: 'members' | 'restricted';
  createdAt: string;
}

export interface MessageRow {
  id: string;
  seq: number;
  circleId: string;
  authorId: string | null;
  text: string;
  type: 'user' | 'system';
  event: Record<string, unknown> | null;
  clientId: string | null;
  createdAt: string;
  deletedAt: string | null;
}

export interface ReactionRow {
  messageId: string;
  userId: string;
  emoji: string;
  seq: number;
}

export interface NotificationRow {
  id: string;
  seq: number;
  recipientId: string;
  type: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  createdAt: string;
  readAt: string | null;
}

export interface RewardRow {
  challengeId: string;
  mode: Exclude<RewardMode, 'none'>;
  grossCents: number;
  feeBps: number;
  sponsorId: string | null;
}

export interface ReminderRow {
  userId: string;
  challengeId: string;
  enabled: boolean;
  localTime: string;
}

export interface DemoStore {
  profiles: ProfileRow[];
  circles: CircleRow[];
  members: MemberRow[];
  invites: InviteRow[];
  challenges: ChallengeRow[];
  admins: AdminRow[];
  rules: RuleRow[];
  participants: ParticipantRow[];
  acceptances: AcceptanceRow[];
  records: RecordRow[];
  submissions: SubmissionRow[];
  increments: IncrementRow[];
  evidence: EvidenceRow[];
  reviews: ReviewRow[];
  overrides: OverrideRow[];
  disputes: DisputeRow[];
  audit: AuditRow[];
  messages: MessageRow[];
  reactions: ReactionRow[];
  notifications: NotificationRow[];
  rewards: RewardRow[];
  reminders: ReminderRow[];
}

export function emptyStore(): DemoStore {
  return {
    profiles: [],
    circles: [],
    members: [],
    invites: [],
    challenges: [],
    admins: [],
    rules: [],
    participants: [],
    acceptances: [],
    records: [],
    submissions: [],
    increments: [],
    evidence: [],
    reviews: [],
    overrides: [],
    disputes: [],
    audit: [],
    messages: [],
    reactions: [],
    notifications: [],
    rewards: [],
    reminders: [],
  };
}

/** A clock that can be set and then keeps ticking. Demo Mode and tests inject it everywhere. */
export class DemoClock {
  private base: number;
  private setAt: number;

  constructor(start: Date = new Date()) {
    this.base = start.getTime();
    this.setAt = Date.now();
  }

  now(): Date {
    return new Date(this.base + (Date.now() - this.setAt));
  }

  set(instant: Date): void {
    this.base = instant.getTime();
    this.setAt = Date.now();
  }

  advance(ms: number): void {
    this.set(new Date(this.now().getTime() + ms));
  }
}
