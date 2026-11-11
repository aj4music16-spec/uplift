import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { AvatarSpec } from '@/components/Avatar';
import { AppError } from '@/domain/errors';
import type { RewardMode } from '@/domain/types';

import type { Repository } from '../repository';
import {
  AccountDeletionPlanSchema,
  AuditEventSchema,
  ChallengeCardSchema,
  ChallengeDetailSchema,
  CircleDetailSchema,
  CircleSummarySchema,
  CreatedInviteSchema,
  DayDetailSchema,
  HomeViewSchema,
  InvitePreviewSchema,
  InviteSchema,
  MessageSchema,
  NotificationSchema,
  ProfileSchema,
  RedeemResultSchema,
  ReminderSchema,
  ReviewQueueSchema,
  type AccountDeletionPlan,
  type AuditEventView,
  type ChallengeCard,
  type ChallengeDetail,
  type CircleDetail,
  type CircleSummary,
  type CreatedInvite,
  type DayDetail,
  type DraftInput,
  type EvidenceUrl,
  type HomeView,
  type InvitePreview,
  type InviteView,
  type LocalEvidence,
  type MessageView,
  type NotificationView,
  type Page,
  type Profile,
  type RedeemResult,
  type ReminderPreference,
  type ReviewQueue,
  type RuleChangeInput,
} from '../types';
import { camelize, snakeize } from './casing';
import { mapBackendError } from './errors';

const EVIDENCE_BUCKET = 'evidence';
/** Signed evidence URLs are short-lived and minted only after authorization. */
const SIGNED_URL_SECONDS = 120;

/** Reads a local file for upload. Injected because file access differs per platform. */
export type EvidenceReader = (evidence: LocalEvidence) => Promise<ArrayBuffer | Uint8Array | Blob>;

const pageOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() });
const UploadTicketSchema = z.object({ uploadId: z.string(), bucket: z.string(), path: z.string(), expiresAt: z.string() });
const EvidencePathSchema = z.object({ bucket: z.string(), path: z.string() });
const InviteStatusSchema = z.object({
  status: z.enum(['ok', 'invalid', 'expired', 'rate_limited']),
  preview: z.unknown().optional(),
  result: z.unknown().optional(),
});

/**
 * The real backend. Every mutation is one server function call that derives
 * identity from the session, validates state and returns canonical data.
 * Responses are parsed against the shared schemas, so a server/app mismatch
 * fails loudly instead of rendering wrong numbers.
 */
export class SupabaseRepository implements Repository {
  readonly mode = 'live' as const;
  private clockOffsetMs = 0;

  constructor(
    private readonly client: SupabaseClient,
    private readonly readEvidence: EvidenceReader,
  ) {}

  /** Follows the server clock (including a local test clock) so UI gating matches server gating. */
  now(): Date {
    return new Date(Date.now() + this.clockOffsetMs);
  }

  private observe<T>(value: T): T {
    const serverNow = (value as { serverNow?: unknown } | null)?.serverNow;
    if (typeof serverNow === 'string') {
      const parsed = Date.parse(serverNow);
      if (Number.isFinite(parsed)) this.clockOffsetMs = parsed - Date.now();
    }
    return value;
  }

  private async call<T extends z.ZodType>(fn: string, args: Record<string, unknown> | undefined, schema: T): Promise<z.infer<T>> {
    let data: unknown;
    try {
      const response = await this.client.rpc(fn, args);
      if (response.error) throw response.error;
      data = response.data;
    } catch (error) {
      throw mapBackendError(error);
    }
    const parsed = schema.safeParse(camelize(data));
    if (!parsed.success) {
      throw new AppError('UNEXPECTED_RESPONSE', `Unexpected response from ${fn}`, { issues: parsed.error.issues.slice(0, 5) });
    }
    return this.observe(parsed.data);
  }

  private async run(fn: string, args?: Record<string, unknown>): Promise<void> {
    try {
      const response = await this.client.rpc(fn, args);
      if (response.error) throw response.error;
    } catch (error) {
      throw mapBackendError(error);
    }
  }

  /* Profile */

  getMyProfile(): Promise<Profile | null> {
    return this.call('get_my_profile', undefined, ProfileSchema.nullable());
  }

  saveProfile(input: { displayName: string; timezone: string; avatar: AvatarSpec }): Promise<Profile> {
    return this.call(
      'save_profile',
      { p_display_name: input.displayName, p_timezone: input.timezone, p_avatar_color: input.avatar.color, p_avatar_face: input.avatar.face },
      ProfileSchema,
    );
  }

  /* Home */

  getHome(): Promise<HomeView> {
    return this.call('get_home', undefined, HomeViewSchema);
  }

  getHistory(): Promise<ChallengeCard[]> {
    return this.call('get_history', undefined, z.array(ChallengeCardSchema));
  }

  /* Circles */

  getCircle(circleId: string): Promise<CircleDetail> {
    return this.call('get_circle', { p_circle_id: circleId }, CircleDetailSchema);
  }

  createCircle(input: { name: string; timezone: string }): Promise<CircleSummary> {
    return this.call('create_circle', { p_name: input.name, p_timezone: input.timezone }, CircleSummarySchema);
  }

  renameCircle(input: { circleId: string; name: string }): Promise<CircleSummary> {
    return this.call('rename_circle', { p_circle_id: input.circleId, p_name: input.name }, CircleSummarySchema);
  }

  setMemberRole(input: { circleId: string; userId: string; role: 'admin' | 'member' }): Promise<CircleDetail> {
    return this.call('set_member_role', { p_circle_id: input.circleId, p_user_id: input.userId, p_role: input.role }, CircleDetailSchema);
  }

  transferOwnership(input: { circleId: string; userId: string }): Promise<CircleDetail> {
    return this.call('transfer_ownership', { p_circle_id: input.circleId, p_user_id: input.userId }, CircleDetailSchema);
  }

  removeMember(input: { circleId: string; userId: string; reason: string }): Promise<CircleDetail> {
    return this.call('remove_member', { p_circle_id: input.circleId, p_user_id: input.userId, p_reason: input.reason }, CircleDetailSchema);
  }

  leaveCircle(circleId: string): Promise<void> {
    return this.run('leave_circle', { p_circle_id: circleId });
  }

  /* Invitations */

  createInvite(input: { circleId: string; challengeId?: string | null; expiresInDays?: number; maxUses?: number }): Promise<CreatedInvite> {
    return this.call(
      'create_invite',
      {
        p_circle_id: input.circleId,
        p_challenge_id: input.challengeId ?? null,
        p_expires_in_days: input.expiresInDays ?? 7,
        p_max_uses: input.maxUses ?? 25,
      },
      CreatedInviteSchema,
    );
  }

  listInvites(circleId: string): Promise<InviteView[]> {
    return this.call('list_invites', { p_circle_id: circleId }, z.array(InviteSchema));
  }

  revokeInvite(inviteId: string): Promise<void> {
    return this.run('revoke_invite', { p_invite_id: inviteId });
  }

  private static inviteFailure(status: 'invalid' | 'expired' | 'rate_limited'): AppError {
    if (status === 'expired') return new AppError('INVITE_EXPIRED');
    if (status === 'rate_limited') return new AppError('RATE_LIMITED');
    return new AppError('INVITE_INVALID');
  }

  async previewInvite(code: string): Promise<InvitePreview> {
    const outcome = await this.call('preview_invite', { p_code: code }, InviteStatusSchema);
    if (outcome.status !== 'ok') throw SupabaseRepository.inviteFailure(outcome.status);
    const parsed = InvitePreviewSchema.safeParse(outcome.preview);
    if (!parsed.success) throw new AppError('UNEXPECTED_RESPONSE', 'Unexpected response from preview_invite');
    return parsed.data;
  }

  async redeemInvite(input: { code: string; idempotencyKey: string }): Promise<RedeemResult> {
    const outcome = await this.call('redeem_invite', { p_code: input.code, p_idempotency_key: input.idempotencyKey }, InviteStatusSchema);
    if (outcome.status !== 'ok') throw SupabaseRepository.inviteFailure(outcome.status);
    const parsed = RedeemResultSchema.safeParse(outcome.result);
    if (!parsed.success) throw new AppError('UNEXPECTED_RESPONSE', 'Unexpected response from redeem_invite');
    return parsed.data;
  }

  /* Challenges */

  getChallenge(challengeId: string): Promise<ChallengeDetail> {
    return this.call('get_challenge', { p_challenge_id: challengeId }, ChallengeDetailSchema);
  }

  saveDraft(input: DraftInput): Promise<ChallengeDetail> {
    return this.call('save_draft', { p_draft: snakeize(input) }, ChallengeDetailSchema);
  }

  deleteDraft(challengeId: string): Promise<void> {
    return this.run('delete_draft', { p_challenge_id: challengeId });
  }

  publishChallenge(input: { challengeId: string; expectedRevision: number; joinAsParticipant: boolean }): Promise<ChallengeDetail> {
    return this.call(
      'publish_challenge',
      { p_challenge_id: input.challengeId, p_expected_revision: input.expectedRevision, p_join_as_participant: input.joinAsParticipant },
      ChallengeDetailSchema,
    );
  }

  joinChallenge(input: { challengeId: string; acceptedVersionId: string }): Promise<ChallengeDetail> {
    return this.call('join_challenge', { p_challenge_id: input.challengeId, p_accepted_version_id: input.acceptedVersionId }, ChallengeDetailSchema);
  }

  updateChallengeDetails(input: { challengeId: string; name: string; description: string; expectedRevision: number }): Promise<ChallengeDetail> {
    return this.call(
      'update_challenge_details',
      { p_challenge_id: input.challengeId, p_name: input.name, p_description: input.description, p_expected_revision: input.expectedRevision },
      ChallengeDetailSchema,
    );
  }

  proposeRuleChange(input: { challengeId: string; rules: RuleChangeInput; reason: string; expectedRevision: number }): Promise<ChallengeDetail> {
    return this.call(
      'propose_rule_change',
      { p_challenge_id: input.challengeId, p_rules: snakeize(input.rules), p_reason: input.reason, p_expected_revision: input.expectedRevision },
      ChallengeDetailSchema,
    );
  }

  respondToRuleChange(input: { versionId: string; accept: boolean }): Promise<ChallengeDetail> {
    return this.call('respond_to_rule_change', { p_version_id: input.versionId, p_accept: input.accept }, ChallengeDetailSchema);
  }

  withdrawRuleChange(versionId: string): Promise<ChallengeDetail> {
    return this.call('withdraw_rule_change', { p_version_id: versionId }, ChallengeDetailSchema);
  }

  cancelChallenge(input: { challengeId: string; reason: string; expectedRevision: number }): Promise<ChallengeDetail> {
    return this.call(
      'cancel_challenge',
      { p_challenge_id: input.challengeId, p_reason: input.reason, p_expected_revision: input.expectedRevision },
      ChallengeDetailSchema,
    );
  }

  assignChallengeAdmin(input: { challengeId: string; userId: string }): Promise<ChallengeDetail> {
    return this.call('assign_challenge_admin', { p_challenge_id: input.challengeId, p_user_id: input.userId }, ChallengeDetailSchema);
  }

  revokeChallengeAdmin(input: { challengeId: string; userId: string }): Promise<ChallengeDetail> {
    return this.call('revoke_challenge_admin', { p_challenge_id: input.challengeId, p_user_id: input.userId }, ChallengeDetailSchema);
  }

  removeParticipant(input: { participantId: string; reason: string }): Promise<ChallengeDetail> {
    return this.call('remove_participant', { p_participant_id: input.participantId, p_reason: input.reason }, ChallengeDetailSchema);
  }

  finalizeChallenge(challengeId: string): Promise<ChallengeDetail> {
    return this.call('finalize_challenge', { p_challenge_id: challengeId }, ChallengeDetailSchema);
  }

  createRematch(challengeId: string): Promise<ChallengeDetail> {
    return this.call('create_rematch', { p_challenge_id: challengeId }, ChallengeDetailSchema);
  }

  setRewardPreview(input: { challengeId: string; mode: RewardMode; grossCents: number; feeBps: number }): Promise<ChallengeDetail> {
    return this.call(
      'set_reward_preview',
      { p_challenge_id: input.challengeId, p_mode: input.mode, p_gross_cents: input.grossCents, p_fee_bps: input.feeBps },
      ChallengeDetailSchema,
    );
  }

  /* Check-ins */

  getDay(input: { challengeId: string; date: string; participantId?: string }): Promise<DayDetail> {
    return this.call(
      'get_day',
      { p_challenge_id: input.challengeId, p_local_date: input.date, p_participant_id: input.participantId ?? null },
      DayDetailSchema,
    );
  }

  async submitCheckin(input: {
    challengeId: string;
    date: string;
    value: number;
    evidence?: LocalEvidence | null;
    idempotencyKey: string;
    late?: boolean;
  }): Promise<DayDetail> {
    let uploadId: string | null = null;
    if (input.evidence) {
      // 1. Stage: the server issues a scoped, unguessable destination.
      const ticket = await this.call(
        'begin_evidence_upload',
        { p_challenge_id: input.challengeId, p_local_date: input.date, p_mime: input.evidence.mime, p_byte_size: input.evidence.byteSize },
        UploadTicketSchema,
      );
      // 2. Upload. If this fails nothing was recorded against the day.
      let body: ArrayBuffer | Uint8Array | Blob;
      try {
        body = await this.readEvidence(input.evidence);
      } catch {
        throw new AppError('UPLOAD_INCOMPLETE', 'The image could not be read.');
      }
      const upload = await this.client.storage
        .from(ticket.bucket)
        .upload(ticket.path, body, { contentType: input.evidence.mime, upsert: false, cacheControl: '0' })
        .catch((error: unknown) => ({ data: null, error }));
      if (upload.error) {
        const mapped = mapBackendError(upload.error);
        throw mapped.code === 'NETWORK' ? new AppError('UPLOAD_INCOMPLETE') : mapped.code === 'UNKNOWN' ? new AppError('UPLOAD_INCOMPLETE') : mapped;
      }
      uploadId = ticket.uploadId;
    }
    // 3. Finalize: the server verifies the object and records the submission atomically.
    return this.call(
      'submit_checkin',
      {
        p_challenge_id: input.challengeId,
        p_local_date: input.date,
        p_value: input.value,
        p_upload_id: uploadId,
        p_idempotency_key: input.idempotencyKey,
        p_late: input.late ?? false,
      },
      DayDetailSchema,
    );
  }

  addReps(input: { challengeId: string; date: string; amount: number; idempotencyKey: string }): Promise<DayDetail> {
    return this.call(
      'add_reps',
      { p_challenge_id: input.challengeId, p_local_date: input.date, p_amount: input.amount, p_idempotency_key: input.idempotencyKey },
      DayDetailSchema,
    );
  }

  async getEvidenceUrl(evidenceId: string): Promise<EvidenceUrl> {
    const location = await this.call('get_evidence_path', { p_evidence_id: evidenceId }, EvidencePathSchema);
    const signed = await this.client.storage
      .from(location.bucket)
      .createSignedUrl(location.path, SIGNED_URL_SECONDS)
      .catch((error: unknown) => ({ data: null, error }));
    if (signed.error || !signed.data?.signedUrl) throw mapBackendError(signed.error ?? new Error('not found'));
    return { url: signed.data.signedUrl, expiresAt: new Date(this.now().getTime() + SIGNED_URL_SECONDS * 1000).toISOString() };
  }

  acknowledgeDecision(recordId: string): Promise<DayDetail> {
    return this.call('acknowledge_decision', { p_record_id: recordId }, DayDetailSchema);
  }

  openDispute(input: { recordId: string; reason: string }): Promise<DayDetail> {
    return this.call('open_dispute', { p_record_id: input.recordId, p_reason: input.reason }, DayDetailSchema);
  }

  /* Moderation */

  getReviewQueue(challengeId: string): Promise<ReviewQueue> {
    return this.call('get_review_queue', { p_challenge_id: challengeId }, ReviewQueueSchema);
  }

  reviewSubmission(input: {
    submissionId: string;
    decision: 'approve' | 'reject';
    correctedValue?: number | null;
    reason?: string | null;
    expectedRevision: number;
  }): Promise<DayDetail> {
    return this.call(
      'review_submission',
      {
        p_submission_id: input.submissionId,
        p_decision: input.decision,
        p_corrected_value: input.correctedValue ?? null,
        p_reason: input.reason ?? null,
        p_expected_revision: input.expectedRevision,
      },
      DayDetailSchema,
    );
  }

  acceptLateSubmission(input: { submissionId: string; accept: boolean; reason: string }): Promise<DayDetail> {
    return this.call(
      'accept_late_submission',
      { p_submission_id: input.submissionId, p_accept: input.accept, p_reason: input.reason },
      DayDetailSchema,
    );
  }

  overrideDay(input: {
    participantId: string;
    date: string;
    outcome: 'success' | 'fail';
    value?: number | null;
    reason: string;
    expectedRevision: number;
  }): Promise<DayDetail> {
    return this.call(
      'override_day',
      {
        p_participant_id: input.participantId,
        p_local_date: input.date,
        p_outcome: input.outcome,
        p_value: input.value ?? null,
        p_reason: input.reason,
        p_expected_revision: input.expectedRevision,
      },
      DayDetailSchema,
    );
  }

  resolveDispute(input: {
    disputeId: string;
    upheld: boolean;
    resolution: string;
    override?: { outcome: 'success' | 'fail'; value?: number | null } | null;
  }): Promise<DayDetail> {
    return this.call(
      'resolve_dispute',
      {
        p_dispute_id: input.disputeId,
        p_upheld: input.upheld,
        p_resolution: input.resolution,
        p_override_outcome: input.override?.outcome ?? null,
        p_override_value: input.override?.value ?? null,
      },
      DayDetailSchema,
    );
  }

  listAudit(input: { challengeId?: string; circleId?: string; before?: string | null; limit?: number }): Promise<Page<AuditEventView>> {
    return this.call(
      'list_audit',
      { p_challenge_id: input.challengeId ?? null, p_circle_id: input.circleId ?? null, p_before: input.before ?? null, p_limit: input.limit ?? 30 },
      pageOf(AuditEventSchema),
    );
  }

  /* Chat */

  listMessages(input: { circleId: string; before?: string | null; limit?: number }): Promise<Page<MessageView>> {
    return this.call(
      'list_messages',
      { p_circle_id: input.circleId, p_before: input.before ?? null, p_limit: input.limit ?? 30 },
      pageOf(MessageSchema),
    );
  }

  sendMessage(input: { circleId: string; text: string; clientId: string }): Promise<MessageView> {
    return this.call('send_message', { p_circle_id: input.circleId, p_text: input.text, p_client_id: input.clientId }, MessageSchema);
  }

  toggleReaction(input: { messageId: string; emoji: string }): Promise<MessageView> {
    return this.call('toggle_reaction', { p_message_id: input.messageId, p_emoji: input.emoji }, MessageSchema);
  }

  subscribeToCircle(circleId: string, onChange: () => void): () => void {
    let subscribedOnce = false;
    const channel = this.client
      .channel(`circle:${circleId}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `circle_id=eq.${circleId}` }, () => onChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions', filter: `circle_id=eq.${circleId}` }, () => onChange())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // After a reconnect, recover anything missed while offline.
          if (subscribedOnce) onChange();
          subscribedOnce = true;
        }
      });
    return () => {
      void this.client.removeChannel(channel);
    };
  }

  /* Notifications */

  listNotifications(input: { before?: string | null; limit?: number }): Promise<Page<NotificationView>> {
    return this.call('list_notifications', { p_before: input.before ?? null, p_limit: input.limit ?? 30 }, pageOf(NotificationSchema));
  }

  acknowledgeNotification(notificationId: string): Promise<void> {
    return this.run('acknowledge_notification', { p_notification_id: notificationId });
  }

  acknowledgeAllNotifications(): Promise<void> {
    return this.run('acknowledge_all_notifications');
  }

  /* Reminders */

  listReminders(): Promise<ReminderPreference[]> {
    return this.call('list_reminders', undefined, z.array(ReminderSchema));
  }

  setReminder(input: ReminderPreference): Promise<ReminderPreference> {
    return this.call(
      'set_reminder',
      { p_challenge_id: input.challengeId, p_enabled: input.enabled, p_local_time: input.localTime },
      ReminderSchema,
    );
  }

  /* Account */

  beginAccountDeletion(): Promise<AccountDeletionPlan> {
    return this.call('begin_account_deletion', undefined, AccountDeletionPlanSchema);
  }

  async deleteAccount(): Promise<void> {
    const plan = await this.beginAccountDeletion();
    // Remove owned private evidence through the storage service first.
    for (let i = 0; i < plan.evidencePaths.length; i += 50) {
      const chunk = plan.evidencePaths.slice(i, i + 50);
      const removed = await this.client.storage
        .from(EVIDENCE_BUCKET)
        .remove(chunk)
        .catch((error: unknown) => ({ data: null, error }));
      if (removed.error) throw mapBackendError(removed.error);
    }
    await this.run('complete_account_deletion');
    await this.client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
}
