import type {
  AccountDeletionPlan,
  AuditEventView,
  ChallengeCard,
  ChallengeDetail,
  CircleDetail,
  CircleSummary,
  CreatedInvite,
  DayDetail,
  DraftInput,
  EvidenceUrl,
  HomeView,
  InvitePreview,
  InviteView,
  LocalEvidence,
  MessageView,
  NotificationView,
  Page,
  Profile,
  RedeemResult,
  ReminderPreference,
  ReviewQueue,
  RuleChangeInput,
} from './types';
import type { AvatarSpec } from '@/components/Avatar';
import type { RewardMode } from '@/domain/types';

/**
 * The only way screens touch data.
 *
 * Two implementations exist:
 *  - SupabaseRepository: the real backend. Every mutation is a server function
 *    that derives identity from the session and returns canonical data.
 *  - DemoRepository: deterministic local sample data behind a visible Demo
 *    Mode banner. It runs the same domain rules (src/domain); it is not a
 *    separate fake product.
 *
 * Each repository instance acts as exactly one signed-in person. Mutations
 * resolve with canonical server data or reject with an AppError carrying a
 * code from src/domain/errors.ts. Nothing here ever accepts a user id for
 * "who is acting".
 */
export interface Repository {
  readonly mode: 'live' | 'demo';
  /** The clock to use for display decisions. Follows the server clock in live mode. */
  now(): Date;

  /* Profile */
  getMyProfile(): Promise<Profile | null>;
  saveProfile(input: { displayName: string; timezone: string; avatar: AvatarSpec }): Promise<Profile>;

  /* Home */
  getHome(): Promise<HomeView>;
  getHistory(): Promise<ChallengeCard[]>;

  /* Circles */
  getCircle(circleId: string): Promise<CircleDetail>;
  createCircle(input: { name: string; timezone: string }): Promise<CircleSummary>;
  renameCircle(input: { circleId: string; name: string }): Promise<CircleSummary>;
  setMemberRole(input: { circleId: string; userId: string; role: 'admin' | 'member' }): Promise<CircleDetail>;
  transferOwnership(input: { circleId: string; userId: string }): Promise<CircleDetail>;
  removeMember(input: { circleId: string; userId: string; reason: string }): Promise<CircleDetail>;
  leaveCircle(circleId: string): Promise<void>;

  /* Invitations */
  createInvite(input: { circleId: string; challengeId?: string | null; expiresInDays?: number; maxUses?: number }): Promise<CreatedInvite>;
  listInvites(circleId: string): Promise<InviteView[]>;
  revokeInvite(inviteId: string): Promise<void>;
  /** Limited summary. Works signed out so an invite can be previewed before creating an account. */
  previewInvite(code: string): Promise<InvitePreview>;
  redeemInvite(input: { code: string; idempotencyKey: string }): Promise<RedeemResult>;

  /* Challenges */
  getChallenge(challengeId: string): Promise<ChallengeDetail>;
  saveDraft(input: DraftInput): Promise<ChallengeDetail>;
  deleteDraft(challengeId: string): Promise<void>;
  publishChallenge(input: { challengeId: string; expectedRevision: number; joinAsParticipant: boolean }): Promise<ChallengeDetail>;
  joinChallenge(input: { challengeId: string; acceptedVersionId: string }): Promise<ChallengeDetail>;
  updateChallengeDetails(input: { challengeId: string; name: string; description: string; expectedRevision: number }): Promise<ChallengeDetail>;
  proposeRuleChange(input: { challengeId: string; rules: RuleChangeInput; reason: string; expectedRevision: number }): Promise<ChallengeDetail>;
  respondToRuleChange(input: { versionId: string; accept: boolean }): Promise<ChallengeDetail>;
  withdrawRuleChange(versionId: string): Promise<ChallengeDetail>;
  cancelChallenge(input: { challengeId: string; reason: string; expectedRevision: number }): Promise<ChallengeDetail>;
  assignChallengeAdmin(input: { challengeId: string; userId: string }): Promise<ChallengeDetail>;
  revokeChallengeAdmin(input: { challengeId: string; userId: string }): Promise<ChallengeDetail>;
  removeParticipant(input: { participantId: string; reason: string }): Promise<ChallengeDetail>;
  /** Idempotent. Rejects with the blocking code while reviews, disputes or windows are open. */
  finalizeChallenge(challengeId: string): Promise<ChallengeDetail>;
  /** Copies settings into a fresh draft with no reward and no progress. Members must accept anew. */
  createRematch(challengeId: string): Promise<ChallengeDetail>;
  /** Demo previews only. Rejects with LIVE_PAYMENTS_DISABLED on a backend without the demo flag. */
  setRewardPreview(input: { challengeId: string; mode: RewardMode; grossCents: number; feeBps: number }): Promise<ChallengeDetail>;

  /* Check-ins */
  getDay(input: { challengeId: string; date: string; participantId?: string }): Promise<DayDetail>;
  /**
   * Stages and uploads evidence (when given), then finalizes the submission in
   * one server transaction. A failed upload never leaves a pending record
   * claiming evidence exists.
   */
  submitCheckin(input: {
    challengeId: string;
    date: string;
    value: number;
    evidence?: LocalEvidence | null;
    idempotencyKey: string;
    /** Send a submission after the deadline for the admin to consider. */
    late?: boolean;
  }): Promise<DayDetail>;
  addReps(input: { challengeId: string; date: string; amount: number; idempotencyKey: string }): Promise<DayDetail>;
  /** Short-lived signed URL, only issued to the participant and assigned challenge admins. */
  getEvidenceUrl(evidenceId: string): Promise<EvidenceUrl>;
  acknowledgeDecision(recordId: string): Promise<DayDetail>;
  openDispute(input: { recordId: string; reason: string }): Promise<DayDetail>;

  /* Moderation (assigned challenge admins only) */
  getReviewQueue(challengeId: string): Promise<ReviewQueue>;
  reviewSubmission(input: {
    submissionId: string;
    decision: 'approve' | 'reject';
    correctedValue?: number | null;
    reason?: string | null;
    expectedRevision: number;
  }): Promise<DayDetail>;
  acceptLateSubmission(input: { submissionId: string; accept: boolean; reason: string }): Promise<DayDetail>;
  overrideDay(input: {
    participantId: string;
    date: string;
    outcome: 'success' | 'fail';
    value?: number | null;
    reason: string;
    /** Revision of the existing daily record, or 0 when the day has no record yet. */
    expectedRevision: number;
  }): Promise<DayDetail>;
  resolveDispute(input: {
    disputeId: string;
    upheld: boolean;
    resolution: string;
    override?: { outcome: 'success' | 'fail'; value?: number | null } | null;
  }): Promise<DayDetail>;
  listAudit(input: { challengeId?: string; circleId?: string; before?: string | null; limit?: number }): Promise<Page<AuditEventView>>;

  /* Chat */
  listMessages(input: { circleId: string; before?: string | null; limit?: number }): Promise<Page<MessageView>>;
  sendMessage(input: { circleId: string; text: string; clientId: string }): Promise<MessageView>;
  toggleReaction(input: { messageId: string; emoji: string }): Promise<MessageView>;
  /** Realtime is an accelerator; rows are the source of truth. Returns an unsubscribe function. */
  subscribeToCircle(circleId: string, onChange: () => void): () => void;

  /* Notifications */
  listNotifications(input: { before?: string | null; limit?: number }): Promise<Page<NotificationView>>;
  acknowledgeNotification(notificationId: string): Promise<void>;
  acknowledgeAllNotifications(): Promise<void>;

  /* Reminders (preferences only; scheduling is local to the device) */
  listReminders(): Promise<ReminderPreference[]>;
  setReminder(input: ReminderPreference): Promise<ReminderPreference>;

  /* Account */
  beginAccountDeletion(): Promise<AccountDeletionPlan>;
  /** Removes owned evidence, anonymizes shared references and deletes the account. */
  deleteAccount(): Promise<void>;
}

/** Authentication is separate from data so Demo Mode can never reach a real account. */
export interface AuthSession {
  userId: string;
  email: string | null;
}

export interface AuthService {
  readonly mode: 'live' | 'demo';
  getSession(): Promise<AuthSession | null>;
  onChange(listener: (session: AuthSession | null, event: 'signed_in' | 'signed_out' | 'refreshed' | 'expired' | 'recovery') => void): () => void;
  /** Resolves with needsVerification when a confirmation email was sent. */
  signUp(input: { email: string; password: string }): Promise<{ needsVerification: boolean }>;
  signIn(input: { email: string; password: string }): Promise<void>;
  resendVerification(email: string): Promise<void>;
  /** Confirms the emailed code (verification or password recovery). */
  verifyCode(input: { email: string; code: string; purpose: 'signup' | 'recovery' }): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
}
