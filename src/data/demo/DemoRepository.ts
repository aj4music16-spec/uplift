import type { AvatarSpec } from '@/components/Avatar';
import { AppError, toAppError } from '@/domain/errors';
import type { RewardMode } from '@/domain/types';

import type { Repository } from '../repository';
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
} from '../types';
import type { DemoBackend } from './DemoBackend';

/**
 * Demo Mode's Repository: one sample person acting on the in-memory demo
 * backend. Calls are asynchronous (with an optional small delay) so screens
 * exercise the same loading and error states as with the real backend.
 */
export class DemoRepository implements Repository {
  readonly mode = 'demo' as const;

  constructor(
    private readonly backend: DemoBackend,
    /** Null means "signed out": only an invite preview is possible. */
    private readonly userId: string | null,
    private readonly latencyMs = 0,
  ) {}

  now(): Date {
    return this.backend.clock.now();
  }

  private async run<T>(operation: (uid: string) => T): Promise<T> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    if (!this.userId) throw new AppError('AUTH_REQUIRED');
    try {
      return operation(this.userId);
    } catch (error) {
      throw toAppError(error);
    }
  }

  getMyProfile(): Promise<Profile | null> {
    return this.run((uid) => this.backend.getMyProfile(uid));
  }
  saveProfile(input: { displayName: string; timezone: string; avatar: AvatarSpec }): Promise<Profile> {
    return this.run((uid) => this.backend.saveProfile(uid, input));
  }
  getHome(): Promise<HomeView> {
    return this.run((uid) => this.backend.getHome(uid));
  }
  getHistory(): Promise<ChallengeCard[]> {
    return this.run((uid) => this.backend.getHistory(uid));
  }
  getCircle(circleId: string): Promise<CircleDetail> {
    return this.run((uid) => this.backend.getCircle(uid, circleId));
  }
  createCircle(input: { name: string; timezone: string }): Promise<CircleSummary> {
    return this.run((uid) => this.backend.createCircle(uid, input));
  }
  renameCircle(input: { circleId: string; name: string }): Promise<CircleSummary> {
    return this.run((uid) => this.backend.renameCircle(uid, input));
  }
  setMemberRole(input: { circleId: string; userId: string; role: 'admin' | 'member' }): Promise<CircleDetail> {
    return this.run((uid) => this.backend.setMemberRole(uid, input));
  }
  transferOwnership(input: { circleId: string; userId: string }): Promise<CircleDetail> {
    return this.run((uid) => this.backend.transferOwnership(uid, input));
  }
  removeMember(input: { circleId: string; userId: string; reason: string }): Promise<CircleDetail> {
    return this.run((uid) => this.backend.removeMember(uid, input));
  }
  leaveCircle(circleId: string): Promise<void> {
    return this.run((uid) => this.backend.leaveCircle(uid, circleId));
  }
  createInvite(input: { circleId: string; challengeId?: string | null; expiresInDays?: number; maxUses?: number }): Promise<CreatedInvite> {
    return this.run((uid) => this.backend.createInvite(uid, input));
  }
  listInvites(circleId: string): Promise<InviteView[]> {
    return this.run((uid) => this.backend.listInvites(uid, circleId));
  }
  revokeInvite(inviteId: string): Promise<void> {
    return this.run((uid) => this.backend.revokeInvite(uid, inviteId));
  }
  async previewInvite(code: string): Promise<InvitePreview> {
    try {
      return this.backend.previewInvite(this.userId, code);
    } catch (error) {
      throw toAppError(error);
    }
  }
  redeemInvite(input: { code: string; idempotencyKey: string }): Promise<RedeemResult> {
    return this.run((uid) => this.backend.redeemInvite(uid, input));
  }
  getChallenge(challengeId: string): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.getChallenge(uid, challengeId));
  }
  saveDraft(input: DraftInput): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.saveDraft(uid, input));
  }
  deleteDraft(challengeId: string): Promise<void> {
    return this.run((uid) => this.backend.deleteDraft(uid, challengeId));
  }
  publishChallenge(input: { challengeId: string; expectedRevision: number; joinAsParticipant: boolean }): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.publishChallenge(uid, input));
  }
  joinChallenge(input: { challengeId: string; acceptedVersionId: string }): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.joinChallenge(uid, input));
  }
  updateChallengeDetails(input: { challengeId: string; name: string; description: string; expectedRevision: number }): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.updateChallengeDetails(uid, input));
  }
  proposeRuleChange(input: { challengeId: string; rules: RuleChangeInput; reason: string; expectedRevision: number }): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.proposeRuleChange(uid, input));
  }
  respondToRuleChange(input: { versionId: string; accept: boolean }): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.respondToRuleChange(uid, input));
  }
  withdrawRuleChange(versionId: string): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.withdrawRuleChange(uid, versionId));
  }
  cancelChallenge(input: { challengeId: string; reason: string; expectedRevision: number }): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.cancelChallenge(uid, input));
  }
  assignChallengeAdmin(input: { challengeId: string; userId: string }): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.assignChallengeAdmin(uid, input));
  }
  revokeChallengeAdmin(input: { challengeId: string; userId: string }): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.revokeChallengeAdmin(uid, input));
  }
  removeParticipant(input: { participantId: string; reason: string }): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.removeParticipant(uid, input));
  }
  finalizeChallenge(challengeId: string): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.finalizeChallenge(uid, challengeId));
  }
  createRematch(challengeId: string): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.createRematch(uid, challengeId));
  }
  setRewardPreview(input: { challengeId: string; mode: RewardMode; grossCents: number; feeBps: number }): Promise<ChallengeDetail> {
    return this.run((uid) => this.backend.setRewardPreview(uid, input));
  }
  getDay(input: { challengeId: string; date: string; participantId?: string }): Promise<DayDetail> {
    return this.run((uid) => this.backend.getDay(uid, input));
  }
  submitCheckin(input: {
    challengeId: string;
    date: string;
    value: number;
    evidence?: LocalEvidence | null;
    idempotencyKey: string;
    late?: boolean;
  }): Promise<DayDetail> {
    return this.run((uid) => this.backend.submitCheckin(uid, input));
  }
  addReps(input: { challengeId: string; date: string; amount: number; idempotencyKey: string }): Promise<DayDetail> {
    return this.run((uid) => this.backend.addReps(uid, input));
  }
  getEvidenceUrl(evidenceId: string): Promise<EvidenceUrl> {
    return this.run((uid) => this.backend.getEvidenceUrl(uid, evidenceId));
  }
  acknowledgeDecision(recordId: string): Promise<DayDetail> {
    return this.run((uid) => this.backend.acknowledgeDecision(uid, recordId));
  }
  openDispute(input: { recordId: string; reason: string }): Promise<DayDetail> {
    return this.run((uid) => this.backend.openDispute(uid, input));
  }
  getReviewQueue(challengeId: string): Promise<ReviewQueue> {
    return this.run((uid) => this.backend.getReviewQueue(uid, challengeId));
  }
  reviewSubmission(input: {
    submissionId: string;
    decision: 'approve' | 'reject';
    correctedValue?: number | null;
    reason?: string | null;
    expectedRevision: number;
  }): Promise<DayDetail> {
    return this.run((uid) => this.backend.reviewSubmission(uid, input));
  }
  acceptLateSubmission(input: { submissionId: string; accept: boolean; reason: string }): Promise<DayDetail> {
    return this.run((uid) => this.backend.acceptLateSubmission(uid, input));
  }
  overrideDay(input: {
    participantId: string;
    date: string;
    outcome: 'success' | 'fail';
    value?: number | null;
    reason: string;
    expectedRevision: number;
  }): Promise<DayDetail> {
    return this.run((uid) => this.backend.overrideDay(uid, input));
  }
  resolveDispute(input: {
    disputeId: string;
    upheld: boolean;
    resolution: string;
    override?: { outcome: 'success' | 'fail'; value?: number | null } | null;
  }): Promise<DayDetail> {
    return this.run((uid) => this.backend.resolveDispute(uid, input));
  }
  listAudit(input: { challengeId?: string; circleId?: string; before?: string | null; limit?: number }): Promise<Page<AuditEventView>> {
    return this.run((uid) => this.backend.listAudit(uid, input));
  }
  listMessages(input: { circleId: string; before?: string | null; limit?: number }): Promise<Page<MessageView>> {
    return this.run((uid) => this.backend.listMessages(uid, input));
  }
  sendMessage(input: { circleId: string; text: string; clientId: string }): Promise<MessageView> {
    return this.run((uid) => this.backend.sendMessage(uid, input));
  }
  toggleReaction(input: { messageId: string; emoji: string }): Promise<MessageView> {
    return this.run((uid) => this.backend.toggleReaction(uid, input));
  }
  subscribeToCircle(circleId: string, onChange: () => void): () => void {
    return this.backend.subscribe(circleId, onChange);
  }
  listNotifications(input: { before?: string | null; limit?: number }): Promise<Page<NotificationView>> {
    return this.run((uid) => this.backend.listNotifications(uid, input));
  }
  acknowledgeNotification(notificationId: string): Promise<void> {
    return this.run((uid) => this.backend.acknowledgeNotification(uid, notificationId));
  }
  acknowledgeAllNotifications(): Promise<void> {
    return this.run((uid) => this.backend.acknowledgeAllNotifications(uid));
  }
  listReminders(): Promise<ReminderPreference[]> {
    return this.run((uid) => this.backend.listReminders(uid));
  }
  setReminder(input: ReminderPreference): Promise<ReminderPreference> {
    return this.run((uid) => this.backend.setReminder(uid, input));
  }
  /** Sample people are not accounts: there is nothing real to delete in Demo Mode. */
  beginAccountDeletion(): Promise<AccountDeletionPlan> {
    return Promise.reject(new AppError('FORBIDDEN', 'Account deletion isn’t available in Demo Mode. The people here are sample data.'));
  }
  deleteAccount(): Promise<void> {
    return Promise.reject(new AppError('FORBIDDEN', 'Account deletion isn’t available in Demo Mode. The people here are sample data.'));
  }
}
