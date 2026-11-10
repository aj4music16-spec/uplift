import { z } from 'zod';

import {
  CHALLENGE_STATUSES,
  CIRCLE_ROLES,
  COMPARATORS,
  DAY_STATUSES,
  HABIT_TYPES,
  PROVENANCES,
  RECORD_OUTCOMES,
  REWARD_MODES,
  RULE_STATUSES,
  SUBMISSION_STATUSES,
  VERIFICATIONS,
} from '@/domain/types';
import { AVATAR_COLOR_NAMES, type AvatarColor } from '@/theme/tokens';

/**
 * Typed request/response objects shared by both repositories.
 *
 * The Supabase repository parses every server response against these schemas
 * (after converting snake_case keys), so a server/client drift fails loudly as
 * UNEXPECTED_RESPONSE instead of rendering wrong data. The demo repository
 * returns the same shapes.
 */

const iso = z.string();
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const AVATAR_ENUM = AVATAR_COLOR_NAMES as [AvatarColor, ...AvatarColor[]];

export const AvatarSchema = z.object({
  color: z.enum(AVATAR_ENUM).catch('sun'),
  face: z.number().int().min(0).catch(0),
});

export const PersonSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  avatar: AvatarSchema,
  /** The account was deleted; shown as "Deleted member". */
  deleted: z.boolean(),
});
export type Person = z.infer<typeof PersonSchema>;

export const ProfileSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  timezone: z.string(),
  avatar: AvatarSchema,
  /** False until the person has confirmed a display name and time zone. */
  onboarded: z.boolean(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const CircleSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string(),
  role: z.enum(CIRCLE_ROLES),
  memberCount: z.number().int(),
  /** Up to six people for the avatar stack. */
  members: z.array(PersonSchema),
  /** Scheduled, active and in-review challenges. */
  liveChallengeCount: z.number().int(),
});
export type CircleSummary = z.infer<typeof CircleSummarySchema>;

export const MemberSchema = PersonSchema.extend({ role: z.enum(CIRCLE_ROLES), joinedAt: iso });
export type Member = z.infer<typeof MemberSchema>;

export const RulesSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  status: z.enum(RULE_STATUSES),
  target: z.number(),
  comparator: z.enum(COMPARATORS),
  requiredDays: z.number().int(),
  verification: z.enum(VERIFICATIONS),
  startDate: dateKey,
  endDate: dateKey,
  effectiveDate: dateKey,
});
export type RulesView = z.infer<typeof RulesSchema>;

export const DayCellSchema = z.object({
  date: dateKey,
  status: z.enum(DAY_STATUSES),
  /** The result was set by an admin override ("Admin adjusted"). */
  adjusted: z.boolean(),
  /** Only present on the viewer's own days. */
  value: z.number().nullable(),
});
export type DayCell = z.infer<typeof DayCellSchema>;

const ViewerStandingSchema = z.object({
  isAdmin: z.boolean(),
  isCircleAdmin: z.boolean(),
  participantId: z.string().nullable(),
  removed: z.boolean(),
  successfulDays: z.number().int(),
  pendingDays: z.number().int(),
  rank: z.number().int().nullable(),
  tied: z.boolean(),
  qualified: z.boolean(),
});

export const ChallengeCardSchema = z.object({
  id: z.string(),
  circleId: z.string(),
  circleName: z.string(),
  name: z.string(),
  description: z.string(),
  habitType: z.enum(HABIT_TYPES),
  metricUnit: z.string(),
  timezone: z.string(),
  /** Status at the server's current time. */
  status: z.enum(CHALLENGE_STATUSES),
  startDate: dateKey,
  endDate: dateKey,
  revision: z.number().int(),
  rules: RulesSchema,
  rewardMode: z.enum(REWARD_MODES),
  participantCount: z.number().int(),
  participants: z.array(PersonSchema),
  viewer: ViewerStandingSchema,
  /** The viewer's own days, one per scheduled date. Empty when not participating. */
  myDays: z.array(DayCellSchema),
  /** Submissions waiting for this viewer as admin (0 when not an admin). */
  pendingReviewCount: z.number().int(),
  openDisputeCount: z.number().int(),
  /** A rule change is waiting for this viewer's response. */
  proposalAwaitingMe: z.boolean(),
  /** In review and nothing blocks completion. */
  readyToFinalize: z.boolean(),
  draftStep: z.number().int(),
  updatedAt: iso,
});
export type ChallengeCard = z.infer<typeof ChallengeCardSchema>;

export const HomeViewSchema = z.object({
  circles: z.array(CircleSummarySchema),
  challenges: z.array(ChallengeCardSchema),
  unreadNotifications: z.number().int(),
  serverNow: iso,
});
export type HomeView = z.infer<typeof HomeViewSchema>;

export const CircleDetailSchema = z.object({
  circle: CircleSummarySchema,
  members: z.array(MemberSchema),
  challenges: z.array(ChallengeCardSchema),
  serverNow: iso,
});
export type CircleDetail = z.infer<typeof CircleDetailSchema>;

export const ParticipantSchema = z.object({
  id: z.string(),
  person: PersonSchema,
  joinedAt: iso,
  removedAt: iso.nullable(),
  removedReason: z.string().nullable(),
});
export type ParticipantView = z.infer<typeof ParticipantSchema>;

export const StandingSchema = z.object({
  participantId: z.string(),
  person: PersonSchema,
  successfulDays: z.number().int(),
  pendingDays: z.number().int(),
  rank: z.number().int().nullable(),
  tied: z.boolean(),
  qualified: z.boolean(),
  removed: z.boolean(),
  /** Peer-safe day statuses (evidence rejections are not shown to other players). */
  days: z.array(DayCellSchema),
});
export type StandingView = z.infer<typeof StandingSchema>;

const ProposalSchema = z.object({
  version: RulesSchema,
  reason: z.string(),
  proposedBy: PersonSchema,
  proposedAt: iso,
  responses: z.array(
    z.object({ participantId: z.string(), person: PersonSchema, decision: z.enum(['pending', 'accepted', 'declined']) }),
  ),
  myDecision: z.enum(['pending', 'accepted', 'declined']).nullable(),
});
export type ProposalView = z.infer<typeof ProposalSchema>;

const BlockerSchema = z.object({
  code: z.enum(['NOT_IN_REVIEW', 'DEADLINE_NOT_REACHED', 'REVIEW_PENDING', 'DISPUTE_OPEN', 'DISPUTE_WINDOW_OPEN']),
  count: z.number().int(),
  until: iso.nullable(),
});
export type BlockerView = z.infer<typeof BlockerSchema>;

export const RewardPreviewSchema = z.object({
  mode: z.enum(REWARD_MODES),
  grossCents: z.number().int(),
  feeBps: z.number().int(),
  currency: z.string(),
  /** Always true. There is no live reward state. */
  demoOnly: z.literal(true),
  sponsor: PersonSchema.nullable(),
});
export type RewardPreviewView = z.infer<typeof RewardPreviewSchema>;

export const ChallengeDetailSchema = ChallengeCardSchema.extend({
  creator: PersonSchema,
  admins: z.array(PersonSchema),
  allParticipants: z.array(ParticipantSchema),
  ruleVersions: z.array(RulesSchema),
  proposal: ProposalSchema.nullable(),
  standings: z.array(StandingSchema),
  finalization: z.object({ finalDeadlineAt: iso, blockers: z.array(BlockerSchema) }).nullable(),
  reward: RewardPreviewSchema.nullable(),
  canceledReason: z.string().nullable(),
  canceledAt: iso.nullable(),
  completedAt: iso.nullable(),
  publishedAt: iso.nullable(),
  rematchOfId: z.string().nullable(),
  serverNow: iso,
});
export type ChallengeDetail = z.infer<typeof ChallengeDetailSchema>;

const ReviewSchema = z.object({
  reviewer: PersonSchema,
  decision: z.enum(['approved', 'rejected', 'late_accepted', 'late_declined']),
  correctedValue: z.number().nullable(),
  reason: z.string().nullable(),
  reviewedAt: iso,
  /** The admin reviewed their own evidence. */
  selfReview: z.boolean(),
});
export type ReviewView = z.infer<typeof ReviewSchema>;

const EvidenceSchema = z.object({
  id: z.string(),
  mime: z.string(),
  byteSize: z.number().int(),
  /** The same file hash was used elsewhere in this challenge. A flag for a human, not proof of anything. */
  duplicate: z.boolean(),
  /** False once the retention policy has removed the file. */
  available: z.boolean(),
});

const SubmissionSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  enteredValue: z.number(),
  submittedAt: iso,
  status: z.enum(SUBMISSION_STATUSES),
  isLate: z.boolean(),
  evidence: EvidenceSchema.nullable(),
  reviews: z.array(ReviewSchema),
});
export type SubmissionView = z.infer<typeof SubmissionSchema>;

const OverrideSchema = z.object({
  id: z.string(),
  actor: PersonSchema,
  priorOutcome: z.string().nullable(),
  priorValue: z.number().nullable(),
  newOutcome: z.enum(['success', 'fail']),
  newValue: z.number().nullable(),
  reason: z.string(),
  createdAt: iso,
});
export type OverrideView = z.infer<typeof OverrideSchema>;

const DisputeSchema = z.object({
  id: z.string(),
  raisedBy: PersonSchema,
  reason: z.string(),
  status: z.enum(['open', 'upheld', 'denied']),
  createdAt: iso,
  resolver: PersonSchema.nullable(),
  resolution: z.string().nullable(),
  resolvedAt: iso.nullable(),
});
export type DisputeView = z.infer<typeof DisputeSchema>;

export const DayDetailSchema = z.object({
  challengeId: z.string(),
  challengeName: z.string(),
  circleId: z.string(),
  habitType: z.enum(HABIT_TYPES),
  metricUnit: z.string(),
  timezone: z.string(),
  challengeStatus: z.enum(CHALLENGE_STATUSES),
  startDate: dateKey,
  endDate: dateKey,
  participantId: z.string(),
  person: PersonSchema,
  date: dateKey,
  /** The rule version that governs this date. */
  rule: RulesSchema,
  status: z.enum(DAY_STATUSES),
  record: z
    .object({
      id: z.string(),
      outcome: z.enum(RECORD_OUTCOMES),
      effectiveValue: z.number().nullable(),
      provenance: z.enum(PROVENANCES).nullable(),
      revision: z.number().int(),
      decidedAt: iso.nullable(),
      acknowledgedAt: iso.nullable(),
    })
    .nullable(),
  submissions: z.array(SubmissionSchema),
  increments: z.array(z.object({ id: z.string(), amount: z.number(), kind: z.enum(['add', 'correction']), createdAt: iso })),
  overrides: z.array(OverrideSchema),
  disputes: z.array(DisputeSchema),
  viewer: z.object({ isOwner: z.boolean(), isAdmin: z.boolean() }),
  serverNow: iso,
});
export type DayDetail = z.infer<typeof DayDetailSchema>;

const ReviewItemSchema = z.object({
  submissionId: z.string(),
  recordId: z.string(),
  recordRevision: z.number().int(),
  participantId: z.string(),
  person: PersonSchema,
  date: dateKey,
  enteredValue: z.number(),
  submittedAt: iso,
  /** review: evidence to approve or reject. late: a late request to accept or decline. */
  kind: z.enum(['review', 'late']),
  evidenceId: z.string().nullable(),
  duplicate: z.boolean(),
  /** The viewer's own submission. Reviewing it is labeled "Admin self-reviewed". */
  own: z.boolean(),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

export const ReviewQueueSchema = z.object({
  challengeId: z.string(),
  items: z.array(ReviewItemSchema),
  disputes: z.array(
    z.object({
      disputeId: z.string(),
      recordId: z.string(),
      participantId: z.string(),
      person: PersonSchema,
      date: dateKey,
      reason: z.string(),
      createdAt: iso,
    }),
  ),
  serverNow: iso,
});
export type ReviewQueue = z.infer<typeof ReviewQueueSchema>;

export const AuditEventSchema = z.object({
  id: z.string(),
  action: z.string(),
  actor: PersonSchema.nullable(),
  subject: PersonSchema.nullable(),
  circleId: z.string(),
  challengeId: z.string().nullable(),
  localDate: dateKey.nullable(),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().nullable(),
  createdAt: iso,
});
export type AuditEventView = z.infer<typeof AuditEventSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  circleId: z.string(),
  kind: z.enum(['user', 'system']),
  author: PersonSchema.nullable(),
  text: z.string(),
  /** System messages carry a safe, structured event. Never evidence. */
  event: z.record(z.string(), z.unknown()).nullable(),
  clientId: z.string().nullable(),
  createdAt: iso,
  reactions: z.array(z.object({ emoji: z.string(), count: z.number().int(), mine: z.boolean() })),
});
export type MessageView = z.infer<typeof MessageSchema>;

export const NotificationSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: iso,
  readAt: iso.nullable(),
});
export type NotificationView = z.infer<typeof NotificationSchema>;

export const InvitePreviewSchema = z.object({
  circleId: z.string(),
  circleName: z.string(),
  memberCount: z.number().int(),
  inviterName: z.string(),
  expiresAt: iso,
  alreadyMember: z.boolean(),
  challenge: z
    .object({
      id: z.string(),
      name: z.string(),
      habitType: z.enum(HABIT_TYPES),
      metricUnit: z.string(),
      target: z.number(),
      comparator: z.enum(COMPARATORS),
      startDate: dateKey,
      endDate: dateKey,
    })
    .nullable(),
});
export type InvitePreview = z.infer<typeof InvitePreviewSchema>;

export const InviteSchema = z.object({
  id: z.string(),
  circleId: z.string(),
  challengeId: z.string().nullable(),
  createdBy: PersonSchema,
  createdAt: iso,
  expiresAt: iso,
  maxUses: z.number().int(),
  useCount: z.number().int(),
  revokedAt: iso.nullable(),
});
export type InviteView = z.infer<typeof InviteSchema>;

export const CreatedInviteSchema = z.object({ invite: InviteSchema, code: z.string() });
export type CreatedInvite = z.infer<typeof CreatedInviteSchema>;

export const RedeemResultSchema = z.object({
  circleId: z.string(),
  challengeId: z.string().nullable(),
  alreadyMember: z.boolean(),
});
export type RedeemResult = z.infer<typeof RedeemResultSchema>;

export const ReminderSchema = z.object({
  challengeId: z.string(),
  enabled: z.boolean(),
  /** "HH:MM" in the person's own time zone. */
  localTime: z.string().regex(/^\d{2}:\d{2}$/),
});
export type ReminderPreference = z.infer<typeof ReminderSchema>;

export const EvidenceUrlSchema = z.object({ url: z.string(), expiresAt: iso });
export type EvidenceUrl = z.infer<typeof EvidenceUrlSchema>;

export const AccountDeletionPlanSchema = z.object({
  /** Private evidence objects owned by this account that must be removed first. */
  evidencePaths: z.array(z.string()),
});
export type AccountDeletionPlan = z.infer<typeof AccountDeletionPlanSchema>;

/* ---------- Requests ---------- */

export interface DraftInput {
  /** Omit to create a new draft. */
  id?: string;
  /** Required when updating. */
  expectedRevision?: number;
  circleId: string;
  name: string;
  description: string;
  habitType: (typeof HABIT_TYPES)[number];
  metricUnit: string;
  timezone: string;
  target: number;
  comparator: (typeof COMPARATORS)[number];
  requiredDays: number;
  verification: (typeof VERIFICATIONS)[number];
  startDate: string;
  endDate: string;
  /** Wizard step to resume at (1-5). */
  draftStep: number;
}

export interface RuleChangeInput {
  target: number;
  comparator: (typeof COMPARATORS)[number];
  requiredDays: number;
  verification: (typeof VERIFICATIONS)[number];
  startDate: string;
  endDate: string;
}

/** A local image that has already been normalized (JPEG/PNG, <= 10 MB, metadata stripped). */
export interface LocalEvidence {
  uri: string;
  mime: 'image/jpeg' | 'image/png';
  byteSize: number;
  width?: number;
  height?: number;
}

export interface Page<T> {
  items: T[];
  /** Pass as `before` to load the next (older) page. Null when there is nothing older. */
  nextCursor: string | null;
}
