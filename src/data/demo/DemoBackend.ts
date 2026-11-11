import type { AvatarSpec } from '@/components/Avatar';
import {
  addDays,
  adminReminderDue,
  AppError,
  applicableRuleVersion,
  canResubmitOnTime,
  computeStandings,
  dateKeyAt,
  dayWindow,
  decisionWindow,
  deriveDayStatus,
  diffDays,
  eachDate,
  effectiveStatus,
  evaluateAccepted,
  finalizationBlockers,
  finalSubmissionDeadline,
  formatDateKey,
  HABITS,
  inviteCodeFromBytes,
  isDateKey,
  isValidDailyValue,
  isValidTimeZone,
  LIMITS,
  meetsTarget,
  normalizeInviteCode,
  peerVisibleStatus,
  REACTION_EMOJI,
  startOfDay,
  submissionGate,
  validateTerms,
  type ChallengeClock,
  type DayStatus,
  type ErrorCode,
  type FinalizationBlocker,
  type RewardMode,
} from '@/domain';
import { AVATAR_COLOR_NAMES } from '@/theme/tokens';

import type {
  AuditEventView,
  ChallengeCard,
  ChallengeDetail,
  CircleDetail,
  CircleSummary,
  CreatedInvite,
  DayCell,
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
  Person,
  Profile,
  RedeemResult,
  ReminderPreference,
  ReviewQueue,
  RuleChangeInput,
  RulesView,
  StandingView,
} from '../types';
import {
  DemoClock,
  emptyStore,
  type ChallengeRow,
  type DemoStore,
  type MessageRow,
  type ParticipantRow,
  type RecordRow,
  type RuleRow,
} from './store';

/**
 * The Demo Mode "server": an in-memory implementation of every backend
 * operation, over the same tables as the database and the same domain rules
 * (src/domain) as the real server functions. It enforces the same permissions
 * for whichever sample person is acting. It never contacts a network, never
 * moves money, and nothing it holds outlives the app session.
 *
 * tests/demo runs the shared repository journey against this class; the same
 * journey runs against the real backend in tests/integration.
 */

const fail = (code: ErrorCode, message?: string): never => {
  throw new AppError(code, message);
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const HOUR = 3_600_000;

export class DemoBackend {
  readonly store: DemoStore = emptyStore();
  readonly clock: DemoClock;
  /** Mirrors the server flag: reward previews exist only where a demo flag allows them. */
  demoRewards = true;
  private counter = 0;
  private seq = 0;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(clock: DemoClock = new DemoClock()) {
    this.clock = clock;
  }

  /* ---------------------------------------------------------------- basics */

  private id(): string {
    this.counter += 1;
    return `d0000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`;
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private iso(): string {
    return this.clock.now().toISOString();
  }

  /** Creates a sample person. Only the demo and tests call this; there are no credentials. */
  createUser(displayName: string, avatar: AvatarSpec, timezone: string, onboarded = true): string {
    const id = this.id();
    this.store.profiles.push({ id, displayName, timezone, avatar, onboarded, deletedAt: null });
    return id;
  }

  private requireUser(uid: string): void {
    const profile = this.store.profiles.find((p) => p.id === uid);
    if (!profile || profile.deletedAt) fail('AUTH_REQUIRED');
  }

  private person(uid: string): Person {
    const p = this.store.profiles.find((x) => x.id === uid);
    if (!p) return { userId: uid, displayName: 'Deleted member', avatar: { color: 'sand', face: 0 }, deleted: true };
    return {
      userId: p.id,
      displayName: p.deletedAt ? 'Deleted member' : p.displayName.trim() === '' ? 'New member' : p.displayName,
      avatar: p.avatar,
      deleted: !!p.deletedAt,
    };
  }

  private personOrNull(uid: string | null): Person | null {
    return uid ? this.person(uid) : null;
  }

  private name(uid: string): string {
    return this.person(uid).displayName;
  }

  private role(circleId: string, uid: string) {
    const circle = this.store.circles.find((c) => c.id === circleId);
    if (!circle || circle.archivedAt) return null;
    return this.store.members.find((m) => m.circleId === circleId && m.userId === uid && !m.removedAt)?.role ?? null;
  }

  private isCircleAdmin(circleId: string, uid: string): boolean {
    const role = this.role(circleId, uid);
    return role === 'owner' || role === 'admin';
  }

  private challengeRow(id: string): ChallengeRow | undefined {
    return this.store.challenges.find((c) => c.id === id);
  }

  private isChallengeAdmin(ch: ChallengeRow, uid: string): boolean {
    return this.store.admins.some((a) => a.challengeId === ch.id && a.userId === uid && !a.revokedAt) && this.role(ch.circleId, uid) !== null;
  }

  private canView(ch: ChallengeRow, uid: string): boolean {
    return this.role(ch.circleId, uid) !== null && (ch.status !== 'draft' || this.isChallengeAdmin(ch, uid));
  }

  /** The challenge, or NOT_FOUND for anyone who may not see it (same answer as "does not exist"). */
  private visibleChallenge(id: string, uid: string): ChallengeRow {
    const ch = this.challengeRow(id);
    if (!ch || !this.canView(ch, uid)) return fail('NOT_FOUND');
    return ch;
  }

  private clockOf(ch: ChallengeRow): ChallengeClock {
    return { status: ch.status, startDate: ch.startDate, endDate: ch.endDate, timeZone: ch.timezone };
  }

  private status(ch: ChallengeRow) {
    return effectiveStatus(this.clockOf(ch), this.clock.now());
  }

  private rule(id: string): RuleRow {
    const rule = this.store.rules.find((r) => r.id === id);
    if (!rule) throw new AppError('UNKNOWN', 'Missing rule version');
    return rule;
  }

  private ruleFor(ch: ChallengeRow, date: string): RuleRow {
    return applicableRuleVersion(
      this.store.rules.filter((r) => r.challengeId === ch.id),
      date,
    ) ?? this.rule(ch.currentRuleVersionId);
  }

  private rulesView(rule: RuleRow): RulesView {
    return {
      id: rule.id,
      version: rule.version,
      status: rule.status,
      target: rule.target,
      comparator: rule.comparator,
      requiredDays: rule.requiredDays,
      verification: rule.verification,
      startDate: rule.startDate,
      endDate: rule.endDate,
      effectiveDate: rule.effectiveDate,
    };
  }

  private payload(ch: ChallengeRow): Record<string, unknown> {
    return {
      circleId: ch.circleId,
      circleName: this.store.circles.find((c) => c.id === ch.circleId)?.name ?? '',
      challengeId: ch.id,
      challengeName: ch.name,
      habitType: ch.habitType,
    };
  }

  /* ---------------------------------------------------------- side effects */

  private audit(input: {
    circleId: string;
    challengeId?: string | null;
    actorId: string | null;
    subjectUserId?: string | null;
    action: string;
    localDate?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    reason?: string | null;
    visibility?: 'members' | 'restricted';
  }): string {
    const id = this.id();
    this.store.audit.push({
      id,
      seq: this.nextSeq(),
      circleId: input.circleId,
      challengeId: input.challengeId ?? null,
      actorId: input.actorId,
      subjectUserId: input.subjectUserId ?? null,
      action: input.action,
      localDate: input.localDate ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      reason: input.reason ?? null,
      visibility: input.visibility ?? 'members',
      createdAt: this.iso(),
    });
    return id;
  }

  private notify(recipientId: string, type: string, payload: Record<string, unknown>, dedupeKey: string): void {
    const profile = this.store.profiles.find((p) => p.id === recipientId);
    if (!profile || profile.deletedAt) return;
    if (this.store.notifications.some((n) => n.recipientId === recipientId && n.dedupeKey === dedupeKey)) return;
    this.store.notifications.push({ id: this.id(), seq: this.nextSeq(), recipientId, type, payload, dedupeKey, createdAt: this.iso(), readAt: null });
  }

  private systemMessage(circleId: string, text: string, event: Record<string, unknown>): void {
    this.store.messages.push({
      id: this.id(),
      seq: this.nextSeq(),
      circleId,
      authorId: null,
      text: text.slice(0, LIMITS.maxMessageLength),
      type: 'system',
      event,
      clientId: null,
      createdAt: this.iso(),
      deletedAt: null,
    });
    this.emit(circleId);
  }

  private emit(circleId: string): void {
    for (const listener of this.listeners.get(circleId) ?? []) {
      // Realtime is only a hint to re-read; deliver it off the current call stack.
      setTimeout(listener, 0);
    }
  }

  subscribe(circleId: string, listener: () => void): () => void {
    const set = this.listeners.get(circleId) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(circleId, set);
    return () => {
      set.delete(listener);
    };
  }

  private requireReason(reason: string | null | undefined): string {
    const text = (reason ?? '').trim();
    if (text.length < LIMITS.minReasonLength) fail('VALIDATION', 'Add a short reason so everyone understands the change.');
    if (text.length > LIMITS.maxReasonLength) fail('VALIDATION', `Keep the reason under ${LIMITS.maxReasonLength} characters.`);
    return text;
  }

  private bump(ch: ChallengeRow): void {
    ch.revision += 1;
    ch.updatedAt = this.iso();
  }

  /* -------------------------------------------------------------- lifecycle */

  private blockers(ch: ChallengeRow): FinalizationBlocker[] {
    const participants = this.store.participants.filter((p) => p.challengeId === ch.id);
    const byId = new Map(participants.map((p) => [p.id, p]));
    const records = this.store.records.filter((r) => byId.has(r.participantId));
    const liveRecordIds = new Set(records.filter((r) => !byId.get(r.participantId)?.removedAt).map((r) => r.id));
    return finalizationBlockers({
      challenge: this.clockOf(ch),
      now: this.clock.now(),
      records: records.map((r) => ({
        outcome: r.outcome,
        decidedAt: r.decidedAt,
        acknowledgedAt: r.acknowledgedAt,
        date: r.localDate,
        participantRemoved: !!byId.get(r.participantId)?.removedAt,
      })),
      openDisputes: this.store.disputes.filter((d) => d.status === 'open' && liveRecordIds.has(d.recordId)).length,
    });
  }

  /** Persists clock-driven status changes and sends the 48-hour admin reminder. */
  private sync(ch: ChallengeRow) {
    const now = this.clock.now();
    const status = effectiveStatus(this.clockOf(ch), now);
    if (status !== ch.status) {
      const previous = ch.status;
      ch.status = status;
      ch.updatedAt = this.iso();
      if (previous === 'scheduled') this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: null, action: 'challenge.started', localDate: ch.startDate });
      if (status === 'review') {
        for (const rule of this.store.rules) if (rule.challengeId === ch.id && rule.status === 'proposed') rule.status = 'withdrawn';
        this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: null, action: 'challenge.ended', localDate: ch.endDate });
        this.systemMessage(ch.circleId, `${ch.name} has ended. Results are final once reviews are done.`, { ...this.payload(ch), type: 'challenge_ended' });
      }
    }
    if (status === 'review' && !ch.finalizeReminderSentAt && adminReminderDue(this.clockOf(ch), now, this.blockers(ch))) {
      ch.finalizeReminderSentAt = this.iso();
      for (const admin of this.store.admins) {
        if (admin.challengeId === ch.id && !admin.revokedAt) this.notify(admin.userId, 'finalize_reminder', this.payload(ch), `finalize_reminder:${ch.id}`);
      }
    }
    return status;
  }

  /* ------------------------------------------------------------ read models */

  private dayStatus(record: RecordRow | undefined, date: string, tz: string): DayStatus {
    return deriveDayStatus({ date, timeZone: tz, now: this.clock.now(), record: record ?? null });
  }

  private standings(ch: ChallengeRow, viewer: string): StandingView[] {
    const now = this.clock.now();
    const viewerAdmin = this.isChallengeAdmin(ch, viewer);
    const dates = eachDate(ch.startDate, ch.endDate);
    const participants = this.store.participants.filter((p) => p.challengeId === ch.id);
    const cells = new Map<string, { truth: DayStatus[]; shown: DayCell[] }>();
    for (const p of participants) {
      const truth: DayStatus[] = [];
      const shown: DayCell[] = [];
      for (const date of dates) {
        const record = this.store.records.find((r) => r.participantId === p.id && r.localDate === date);
        const status = this.dayStatus(record, date, ch.timezone);
        truth.push(status);
        const mine = p.userId === viewer;
        const visible =
          mine || viewerAdmin
            ? status
            : peerVisibleStatus(status, record ? canResubmitOnTime({ date, timeZone: ch.timezone, now, record }) : false);
        shown.push({ date, status: visible, adjusted: record?.provenance === 'admin_adjusted', value: mine ? (record?.effectiveValue ?? null) : null });
      }
      cells.set(p.id, { truth, shown });
    }
    const rows = computeStandings(
      participants.map((p) => ({ participantId: p.id, removed: !!p.removedAt, days: cells.get(p.id)?.truth ?? [] })),
      this.rule(ch.currentRuleVersionId).requiredDays,
    );
    return rows.map((row) => {
      const p = participants.find((x) => x.id === row.participantId)!;
      return {
        participantId: row.participantId,
        person: this.person(p.userId),
        successfulDays: row.successfulDays,
        pendingDays: row.pendingDays,
        rank: row.rank,
        tied: row.tied,
        qualified: row.qualified,
        removed: row.removed,
        days: cells.get(p.id)?.shown ?? [],
      };
    });
  }

  private card(ch: ChallengeRow, viewer: string, standings = this.standings(ch, viewer)): ChallengeCard {
    const status = this.status(ch);
    const isAdmin = this.isChallengeAdmin(ch, viewer);
    const participant = this.store.participants.find((p) => p.challengeId === ch.id && p.userId === viewer);
    const mine = participant ? standings.find((s) => s.participantId === participant.id) : undefined;
    const active = this.store.participants.filter((p) => p.challengeId === ch.id && !p.removedAt);
    const activeIds = new Set(active.map((p) => p.id));
    const recordIds = new Set(this.store.records.filter((r) => activeIds.has(r.participantId)).map((r) => r.id));
    const showAdminCounts = isAdmin && (status === 'active' || status === 'review');
    return {
      id: ch.id,
      circleId: ch.circleId,
      circleName: this.store.circles.find((c) => c.id === ch.circleId)?.name ?? '',
      name: ch.name,
      description: ch.description,
      habitType: ch.habitType,
      metricUnit: ch.metricUnit,
      timezone: ch.timezone,
      status,
      startDate: ch.startDate,
      endDate: ch.endDate,
      revision: ch.revision,
      rules: this.rulesView(this.rule(ch.currentRuleVersionId)),
      rewardMode: ch.rewardMode,
      participantCount: active.length,
      participants: active.slice(0, 6).map((p) => this.person(p.userId)),
      viewer: {
        isAdmin,
        isCircleAdmin: this.isCircleAdmin(ch.circleId, viewer),
        participantId: participant?.id ?? null,
        removed: !!participant?.removedAt,
        successfulDays: mine?.successfulDays ?? 0,
        pendingDays: mine?.pendingDays ?? 0,
        rank: mine?.rank ?? null,
        tied: mine?.tied ?? false,
        qualified: mine?.qualified ?? false,
      },
      myDays: mine?.days ?? [],
      pendingReviewCount: showAdminCounts ? this.store.submissions.filter((s) => recordIds.has(s.recordId) && (s.status === 'pending' || s.status === 'late')).length : 0,
      openDisputeCount: showAdminCounts ? this.store.disputes.filter((d) => d.status === 'open' && recordIds.has(d.recordId)).length : 0,
      proposalAwaitingMe:
        !!participant &&
        !participant.removedAt &&
        this.store.rules.some(
          (r) => r.challengeId === ch.id && r.status === 'proposed' && !this.store.acceptances.some((a) => a.versionId === r.id && a.participantId === participant.id),
        ),
      readyToFinalize: status === 'review' && this.blockers(ch).length === 0,
      draftStep: ch.draftStep,
      updatedAt: ch.updatedAt,
    };
  }

  private detail(ch: ChallengeRow, viewer: string): ChallengeDetail {
    const standings = this.standings(ch, viewer);
    const status = this.status(ch);
    const participant = this.store.participants.find((p) => p.challengeId === ch.id && p.userId === viewer);
    const proposed = this.store.rules.find((r) => r.challengeId === ch.id && r.status === 'proposed');
    const reward = this.store.rewards.find((r) => r.challengeId === ch.id);
    return {
      ...this.card(ch, viewer, standings),
      creator: this.person(ch.creatorId),
      admins: this.store.admins.filter((a) => a.challengeId === ch.id && !a.revokedAt).map((a) => this.person(a.userId)),
      allParticipants: this.store.participants
        .filter((p) => p.challengeId === ch.id)
        .map((p) => ({ id: p.id, person: this.person(p.userId), joinedAt: p.joinedAt, removedAt: p.removedAt, removedReason: p.removedReason })),
      ruleVersions: this.store.rules
        .filter((r) => r.challengeId === ch.id)
        .sort((a, b) => a.version - b.version)
        .map((r) => this.rulesView(r)),
      proposal: proposed
        ? {
            version: this.rulesView(proposed),
            reason: proposed.reason ?? '',
            proposedBy: this.person(proposed.proposedBy ?? ch.creatorId),
            proposedAt: proposed.createdAt,
            responses: this.store.participants
              .filter((p) => p.challengeId === ch.id && !p.removedAt)
              .map((p) => ({
                participantId: p.id,
                person: this.person(p.userId),
                decision: this.store.acceptances.find((a) => a.versionId === proposed.id && a.participantId === p.id)?.decision ?? ('pending' as const),
              })),
            myDecision:
              participant && !participant.removedAt
                ? (this.store.acceptances.find((a) => a.versionId === proposed.id && a.participantId === participant.id)?.decision ?? 'pending')
                : null,
          }
        : null,
      standings,
      finalization:
        status === 'review'
          ? {
              finalDeadlineAt: finalSubmissionDeadline(ch.endDate, ch.timezone).toISOString(),
              blockers: this.blockers(ch).map((b) => ({ code: b.code, count: b.count, until: b.until ? b.until.toISOString() : null })),
            }
          : null,
      reward: reward
        ? { mode: reward.mode, grossCents: reward.grossCents, feeBps: reward.feeBps, currency: 'USD', demoOnly: true, sponsor: this.personOrNull(reward.sponsorId) }
        : null,
      canceledReason: ch.canceledReason,
      canceledAt: ch.canceledAt,
      completedAt: ch.completedAt,
      publishedAt: ch.publishedAt,
      rematchOfId: ch.rematchOfId,
      serverNow: this.iso(),
    };
  }

  private isDuplicateEvidence(evidenceId: string, ch: ChallengeRow, recordId: string): boolean {
    const evidence = this.store.evidence.find((e) => e.id === evidenceId);
    if (!evidence) return false;
    const participantIds = new Set(this.store.participants.filter((p) => p.challengeId === ch.id).map((p) => p.id));
    return this.store.evidence.some((other) => {
      if (other.id === evidence.id || other.fingerprint !== evidence.fingerprint) return false;
      const submission = this.store.submissions.find((s) => s.id === other.submissionId);
      const record = submission ? this.store.records.find((r) => r.id === submission.recordId) : undefined;
      return !!record && record.id !== recordId && participantIds.has(record.participantId);
    });
  }

  private day(participant: ParticipantRow, date: string, viewer: string): DayDetail {
    const ch = this.challengeRow(participant.challengeId)!;
    const record = this.store.records.find((r) => r.participantId === participant.id && r.localDate === date);
    const rule = record ? this.rule(record.ruleVersionId) : this.ruleFor(ch, date);
    return {
      challengeId: ch.id,
      challengeName: ch.name,
      circleId: ch.circleId,
      habitType: ch.habitType,
      metricUnit: ch.metricUnit,
      timezone: ch.timezone,
      challengeStatus: this.status(ch),
      startDate: ch.startDate,
      endDate: ch.endDate,
      participantId: participant.id,
      person: this.person(participant.userId),
      date,
      rule: this.rulesView(rule),
      status: this.dayStatus(record, date, ch.timezone),
      record: record
        ? {
            id: record.id,
            outcome: record.outcome,
            effectiveValue: record.effectiveValue,
            provenance: record.provenance,
            revision: record.revision,
            decidedAt: record.decidedAt,
            acknowledgedAt: record.acknowledgedAt,
          }
        : null,
      submissions: record
        ? this.store.submissions
            .filter((s) => s.recordId === record.id)
            .sort((a, b) => b.version - a.version)
            .map((s) => {
              const evidence = this.store.evidence.find((e) => e.submissionId === s.id);
              return {
                id: s.id,
                version: s.version,
                enteredValue: s.enteredValue,
                submittedAt: s.submittedAt,
                status: s.status,
                isLate: s.isLate,
                evidence: evidence
                  ? {
                      id: evidence.id,
                      mime: evidence.mime,
                      byteSize: evidence.byteSize,
                      duplicate: this.isDuplicateEvidence(evidence.id, ch, record.id),
                      available: !evidence.purgedAt,
                    }
                  : null,
                reviews: this.store.reviews
                  .filter((r) => r.submissionId === s.id)
                  .map((r) => ({
                    reviewer: this.person(r.reviewerId),
                    decision: r.decision,
                    correctedValue: r.correctedValue,
                    reason: r.reason,
                    reviewedAt: r.reviewedAt,
                    selfReview: r.selfReview,
                  })),
              };
            })
        : [],
      increments: record
        ? this.store.increments
            .filter((i) => i.recordId === record.id)
            .map((i) => ({ id: i.id, amount: i.amount, kind: i.kind, createdAt: i.createdAt }))
            .reverse()
        : [],
      overrides: record
        ? this.store.overrides
            .filter((o) => o.recordId === record.id)
            .map((o) => ({
              id: o.id,
              actor: this.person(o.actorId),
              priorOutcome: o.priorOutcome,
              priorValue: o.priorValue,
              newOutcome: o.newOutcome,
              newValue: o.newValue,
              reason: o.reason,
              createdAt: o.createdAt,
            }))
            .reverse()
        : [],
      disputes: record
        ? this.store.disputes
            .filter((d) => d.recordId === record.id)
            .map((d) => ({
              id: d.id,
              raisedBy: this.person(d.raisedBy),
              reason: d.reason,
              status: d.status,
              createdAt: d.createdAt,
              resolver: this.personOrNull(d.resolverId),
              resolution: d.resolution,
              resolvedAt: d.resolvedAt,
            }))
            .reverse()
        : [],
      viewer: { isOwner: participant.userId === viewer, isAdmin: this.isChallengeAdmin(ch, viewer) },
      serverNow: this.iso(),
    };
  }

  private circleSummary(circleId: string, viewer: string): CircleSummary {
    const circle = this.store.circles.find((c) => c.id === circleId)!;
    const members = this.store.members.filter((m) => m.circleId === circleId && !m.removedAt);
    return {
      id: circle.id,
      name: circle.name,
      timezone: circle.timezone,
      role: this.role(circleId, viewer) ?? 'member',
      memberCount: members.length,
      members: members.slice(0, 6).map((m) => this.person(m.userId)),
      liveChallengeCount: this.store.challenges.filter((c) => c.circleId === circleId && ['scheduled', 'active', 'review'].includes(this.status(c))).length,
    };
  }

  private messageView(message: MessageRow, viewer: string): MessageView {
    const reactions = this.store.reactions.filter((r) => r.messageId === message.id).sort((a, b) => a.seq - b.seq);
    const grouped: { emoji: string; count: number; mine: boolean }[] = [];
    for (const reaction of reactions) {
      const existing = grouped.find((g) => g.emoji === reaction.emoji);
      if (existing) {
        existing.count += 1;
        existing.mine = existing.mine || reaction.userId === viewer;
      } else grouped.push({ emoji: reaction.emoji, count: 1, mine: reaction.userId === viewer });
    }
    return {
      id: message.id,
      circleId: message.circleId,
      kind: message.type,
      author: this.personOrNull(message.authorId),
      text: message.text,
      event: message.event,
      clientId: message.clientId,
      createdAt: message.createdAt,
      reactions: grouped,
    };
  }

  private page<T extends { seq: number; createdAt: string; id: string }, V>(rows: T[], before: string | null | undefined, limit: number | undefined, map: (row: T) => V): Page<V> {
    const size = Math.min(Math.max(limit ?? 30, 1), 100);
    const sorted = [...rows].sort((a, b) => b.seq - a.seq);
    let start = 0;
    if (before) {
      const cursorId = before.split('|')[1];
      const index = sorted.findIndex((row) => row.id === cursorId);
      if (index < 0) fail('VALIDATION', 'Bad paging cursor.');
      start = index + 1;
    }
    const shown = sorted.slice(start, start + size);
    const last = shown[shown.length - 1];
    return { items: shown.map(map), nextCursor: sorted.length > start + size && last ? `${last.createdAt}|${last.id}` : null };
  }

  /* ---------------------------------------------------------------- profile */

  getMyProfile(uid: string): Profile | null {
    const p = this.store.profiles.find((x) => x.id === uid && !x.deletedAt);
    return p ? clone({ id: p.id, displayName: p.displayName, timezone: p.timezone, avatar: p.avatar, onboarded: p.onboarded }) : null;
  }

  saveProfile(uid: string, input: { displayName: string; timezone: string; avatar: AvatarSpec }): Profile {
    this.requireUser(uid);
    const name = input.displayName.trim();
    if (name.length < 1 || name.length > 40) fail('VALIDATION', 'Choose a display name between 1 and 40 characters.');
    if (!isValidTimeZone(input.timezone)) fail('VALIDATION', 'Choose a valid time zone.');
    if (!AVATAR_COLOR_NAMES.includes(input.avatar.color)) fail('VALIDATION', 'Choose an avatar color.');
    if (!Number.isInteger(input.avatar.face) || input.avatar.face < 0 || input.avatar.face > 9) fail('VALIDATION', 'Choose an avatar face.');
    const p = this.store.profiles.find((x) => x.id === uid)!;
    p.displayName = name;
    p.timezone = input.timezone;
    p.avatar = { ...input.avatar };
    p.onboarded = true;
    return this.getMyProfile(uid)!;
  }

  /* ------------------------------------------------------------------ home */

  getHome(uid: string): HomeView {
    this.requireUser(uid);
    const now = this.clock.now().getTime();
    for (const ch of this.store.challenges) {
      if (['scheduled', 'active', 'review'].includes(ch.status) && this.role(ch.circleId, uid)) this.sync(ch);
    }
    const mine = (ch: ChallengeRow) => this.isChallengeAdmin(ch, uid) || this.store.participants.some((p) => p.challengeId === ch.id && p.userId === uid);
    const challenges = this.store.challenges
      .filter((ch) => this.canView(ch, uid))
      .filter((ch) => {
        if (['draft', 'scheduled', 'active', 'review'].includes(ch.status)) return true;
        const closedAt = ch.completedAt ?? ch.canceledAt;
        return !!closedAt && Date.parse(closedAt) > now - 14 * 24 * HOUR && mine(ch);
      })
      .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.id < b.id ? -1 : 1));
    return clone({
      circles: this.store.members
        .filter((m) => m.userId === uid && !m.removedAt && this.role(m.circleId, uid))
        .map((m) => this.circleSummary(m.circleId, uid)),
      challenges: challenges.map((ch) => this.card(ch, uid)),
      unreadNotifications: this.store.notifications.filter((n) => n.recipientId === uid && !n.readAt).length,
      serverNow: this.iso(),
    });
  }

  getHistory(uid: string): ChallengeCard[] {
    this.requireUser(uid);
    return clone(
      this.store.challenges
        .filter((ch) => ['completed', 'canceled'].includes(ch.status) && this.canView(ch, uid))
        .filter((ch) => this.isChallengeAdmin(ch, uid) || this.store.participants.some((p) => p.challengeId === ch.id && p.userId === uid))
        .sort((a, b) => Date.parse(b.completedAt ?? b.canceledAt ?? '') - Date.parse(a.completedAt ?? a.canceledAt ?? ''))
        .slice(0, 50)
        .map((ch) => this.card(ch, uid)),
    );
  }

  /* --------------------------------------------------------------- circles */

  getCircle(uid: string, circleId: string): CircleDetail {
    this.requireUser(uid);
    if (!this.role(circleId, uid)) fail('NOT_FOUND');
    for (const ch of this.store.challenges) if (ch.circleId === circleId && ['scheduled', 'active', 'review'].includes(ch.status)) this.sync(ch);
    const order: Record<string, number> = { active: 0, review: 1, scheduled: 2, draft: 3, completed: 4, canceled: 5 };
    const roleOrder: Record<string, number> = { owner: 0, admin: 1, member: 2 };
    return clone({
      circle: this.circleSummary(circleId, uid),
      members: this.store.members
        .filter((m) => m.circleId === circleId && !m.removedAt)
        .sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) || Date.parse(a.joinedAt) - Date.parse(b.joinedAt) || (a.id < b.id ? -1 : 1))
        .map((m) => ({ ...this.person(m.userId), role: m.role, joinedAt: m.joinedAt })),
      challenges: this.store.challenges
        .filter((ch) => ch.circleId === circleId && this.canView(ch, uid))
        .sort((a, b) => (order[this.status(a)] ?? 9) - (order[this.status(b)] ?? 9) || (a.startDate > b.startDate ? -1 : a.startDate < b.startDate ? 1 : 0) || (a.id < b.id ? -1 : 1))
        .map((ch) => this.card(ch, uid)),
      serverNow: this.iso(),
    });
  }

  createCircle(uid: string, input: { name: string; timezone: string }): CircleSummary {
    this.requireUser(uid);
    const name = input.name.trim();
    if (name.length < 2 || name.length > 60) fail('VALIDATION', 'Give your Circle a name between 2 and 60 characters.');
    if (!isValidTimeZone(input.timezone)) fail('VALIDATION', 'Choose a valid time zone.');
    if (this.store.members.filter((m) => m.userId === uid && !m.removedAt && this.role(m.circleId, uid)).length >= 20) fail('LIMIT_REACHED', 'You can be in up to 20 Circles.');
    const id = this.id();
    this.store.circles.push({ id, name, ownerId: uid, timezone: input.timezone, archivedAt: null, createdAt: this.iso() });
    this.store.members.push({ id: this.id(), circleId: id, userId: uid, role: 'owner', joinedAt: this.iso(), removedAt: null, removedReason: null });
    this.audit({ circleId: id, actorId: uid, action: 'circle.created', after: { name, timezone: input.timezone } });
    return clone(this.circleSummary(id, uid));
  }

  renameCircle(uid: string, input: { circleId: string; name: string }): CircleSummary {
    this.requireUser(uid);
    if (!this.isCircleAdmin(input.circleId, uid)) fail('FORBIDDEN');
    const name = input.name.trim();
    if (name.length < 2 || name.length > 60) fail('VALIDATION', 'Give your Circle a name between 2 and 60 characters.');
    const circle = this.store.circles.find((c) => c.id === input.circleId)!;
    if (circle.name !== name) {
      this.audit({ circleId: circle.id, actorId: uid, action: 'circle.renamed', before: { name: circle.name }, after: { name } });
      circle.name = name;
    }
    return clone(this.circleSummary(circle.id, uid));
  }

  setMemberRole(uid: string, input: { circleId: string; userId: string; role: 'admin' | 'member' }): CircleDetail {
    this.requireUser(uid);
    if (this.role(input.circleId, uid) !== 'owner') fail('FORBIDDEN');
    if (input.role !== 'admin' && input.role !== 'member') fail('VALIDATION', 'Choose admin or member.');
    if (input.userId === uid) fail('VALIDATION', 'Transfer ownership to change your own role.');
    const member = this.store.members.find((m) => m.circleId === input.circleId && m.userId === input.userId && !m.removedAt);
    if (!member) return fail('NOT_FOUND');
    if (member.role !== input.role) {
      this.audit({ circleId: input.circleId, actorId: uid, subjectUserId: input.userId, action: 'member.role_changed', before: { role: member.role }, after: { role: input.role } });
      member.role = input.role;
      const circle = this.store.circles.find((c) => c.id === input.circleId)!;
      this.notify(input.userId, 'role_changed', { circleId: circle.id, circleName: circle.name, role: input.role }, `role_changed:${circle.id}:${input.role}:${this.nextSeq()}`);
    }
    return this.getCircle(uid, input.circleId);
  }

  transferOwnership(uid: string, input: { circleId: string; userId: string }): CircleDetail {
    this.requireUser(uid);
    if (this.role(input.circleId, uid) !== 'owner') fail('FORBIDDEN');
    if (input.userId === uid) fail('VALIDATION', 'You already own this Circle.');
    const target = this.store.members.find((m) => m.circleId === input.circleId && m.userId === input.userId && !m.removedAt);
    if (!target) return fail('NOT_FOUND');
    const me = this.store.members.find((m) => m.circleId === input.circleId && m.userId === uid && !m.removedAt)!;
    me.role = 'admin';
    target.role = 'owner';
    const circle = this.store.circles.find((c) => c.id === input.circleId)!;
    circle.ownerId = input.userId;
    this.audit({ circleId: circle.id, actorId: uid, subjectUserId: input.userId, action: 'circle.ownership_transferred', before: { ownerId: uid }, after: { ownerId: input.userId } });
    this.notify(input.userId, 'ownership_received', { circleId: circle.id, circleName: circle.name, actorName: this.name(uid) }, `ownership_received:${circle.id}:${this.nextSeq()}`);
    return this.getCircle(uid, input.circleId);
  }

  private detachMember(circleId: string, userId: string, actorId: string, reason: string, left: boolean): void {
    const live = (ch: ChallengeRow) => ch.circleId === circleId && ['scheduled', 'active', 'review'].includes(ch.status);
    const blocking = this.store.challenges.filter(
      (ch) =>
        live(ch) &&
        this.store.admins.some((a) => a.challengeId === ch.id && a.userId === userId && !a.revokedAt) &&
        !this.store.admins.some((a) => a.challengeId === ch.id && a.userId !== userId && !a.revokedAt && this.role(circleId, a.userId)),
    );
    if (blocking.length > 0) fail('LAST_ADMIN', `Appoint another admin first for: ${blocking.map((c) => c.name).join(', ')}.`);

    this.store.challenges = this.store.challenges.filter(
      (ch) =>
        !(
          ch.circleId === circleId &&
          ch.status === 'draft' &&
          this.store.admins.some((a) => a.challengeId === ch.id && a.userId === userId && !a.revokedAt) &&
          !this.store.admins.some((a) => a.challengeId === ch.id && a.userId !== userId && !a.revokedAt)
        ),
    );
    const now = this.iso();
    for (const admin of this.store.admins) {
      const ch = this.challengeRow(admin.challengeId);
      if (ch && ch.circleId === circleId && admin.userId === userId && !admin.revokedAt && !['completed', 'canceled'].includes(ch.status)) admin.revokedAt = now;
    }
    for (const p of this.store.participants) {
      const ch = this.challengeRow(p.challengeId);
      if (ch && live(ch) && p.userId === userId && !p.removedAt) {
        p.removedAt = now;
        p.removedReason = left ? 'Left the Circle' : 'Removed from the Circle';
      }
    }
    const member = this.store.members.find((m) => m.circleId === circleId && m.userId === userId && !m.removedAt);
    if (member) {
      member.removedAt = now;
      member.removedReason = reason;
    }
    for (const rule of this.store.rules.filter((r) => r.status === 'proposed' && this.challengeRow(r.challengeId)?.circleId === circleId)) this.maybeActivate(rule);
    void actorId;
  }

  removeMember(uid: string, input: { circleId: string; userId: string; reason: string }): CircleDetail {
    this.requireUser(uid);
    const actorRole = this.role(input.circleId, uid);
    if (actorRole !== 'owner' && actorRole !== 'admin') fail('FORBIDDEN');
    if (input.userId === uid) fail('VALIDATION', 'Use “Leave Circle” to remove yourself.');
    const reason = this.requireReason(input.reason);
    const targetRole = this.role(input.circleId, input.userId);
    if (!targetRole) return fail('NOT_FOUND');
    if (targetRole === 'owner' || (targetRole === 'admin' && actorRole !== 'owner')) fail('FORBIDDEN');
    this.detachMember(input.circleId, input.userId, uid, reason, false);
    this.audit({ circleId: input.circleId, actorId: uid, subjectUserId: input.userId, action: 'member.removed', before: { role: targetRole }, reason });
    const circle = this.store.circles.find((c) => c.id === input.circleId)!;
    this.notify(input.userId, 'removed_from_circle', { circleName: circle.name, reason }, `removed_from_circle:${circle.id}:${this.nextSeq()}`);
    return this.getCircle(uid, input.circleId);
  }

  leaveCircle(uid: string, circleId: string): void {
    this.requireUser(uid);
    const role = this.role(circleId, uid);
    if (!role) return fail('NOT_FOUND');
    const others = this.store.members.filter((m) => m.circleId === circleId && !m.removedAt && m.userId !== uid).length;
    if (role === 'owner' && others > 0) fail('LAST_OWNER');
    const circle = this.store.circles.find((c) => c.id === circleId)!;
    if (others === 0) {
      const now = this.iso();
      for (const ch of this.store.challenges) {
        if (ch.circleId === circleId && ['scheduled', 'active', 'review'].includes(ch.status)) {
          ch.status = 'canceled';
          ch.canceledAt = now;
          ch.canceledReason = 'The Circle was closed.';
        }
      }
      this.store.challenges = this.store.challenges.filter((ch) => !(ch.circleId === circleId && ch.status === 'draft'));
      const member = this.store.members.find((m) => m.circleId === circleId && m.userId === uid && !m.removedAt)!;
      member.removedAt = now;
      member.removedReason = 'Left the Circle';
      circle.archivedAt = now;
      this.audit({ circleId, actorId: uid, subjectUserId: uid, action: 'circle.archived', reason: 'The last member left.' });
      return;
    }
    this.detachMember(circleId, uid, uid, 'Left the Circle', true);
    this.audit({ circleId, actorId: uid, subjectUserId: uid, action: 'member.left', before: { role } });
    this.systemMessage(circleId, `${this.name(uid)} left the Circle.`, { type: 'member_left', userId: uid, name: this.name(uid) });
  }

  /* ------------------------------------------------------------ invitations */

  private inviteView(id: string): InviteView {
    const i = this.store.invites.find((x) => x.id === id)!;
    return {
      id: i.id,
      circleId: i.circleId,
      challengeId: i.challengeId,
      createdBy: this.person(i.createdBy),
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      maxUses: i.maxUses,
      useCount: i.useCount,
      revokedAt: i.revokedAt,
    };
  }

  createInvite(uid: string, input: { circleId: string; challengeId?: string | null; expiresInDays?: number; maxUses?: number }): CreatedInvite {
    this.requireUser(uid);
    if (!this.isCircleAdmin(input.circleId, uid)) fail('FORBIDDEN');
    const days = input.expiresInDays ?? LIMITS.inviteDefaultExpiryDays;
    const uses = input.maxUses ?? LIMITS.inviteDefaultMaxUses;
    if (days < 1 || days > LIMITS.inviteMaxExpiryDays) fail('VALIDATION', 'Invites can last between 1 and 30 days.');
    if (uses < 1 || uses > LIMITS.inviteMaxUses) fail('VALIDATION', 'An invite can be used between 1 and 50 times.');
    if (input.challengeId) {
      const ch = this.challengeRow(input.challengeId);
      if (!ch || ch.circleId !== input.circleId || this.status(ch) !== 'scheduled') fail('VALIDATION', 'That challenge isn’t open for joining.');
    }
    const bytes = new Uint8Array(12);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    const code = inviteCodeFromBytes(bytes);
    const id = this.id();
    this.store.invites.push({
      id,
      circleId: input.circleId,
      challengeId: input.challengeId ?? null,
      code,
      expiresAt: new Date(this.clock.now().getTime() + days * 24 * HOUR).toISOString(),
      maxUses: uses,
      useCount: 0,
      revokedAt: null,
      createdBy: uid,
      createdAt: this.iso(),
    });
    this.audit({ circleId: input.circleId, challengeId: input.challengeId ?? null, actorId: uid, action: 'invite.created', after: { maxUses: uses, expiresInDays: days }, visibility: 'restricted' });
    return clone({ invite: this.inviteView(id), code });
  }

  listInvites(uid: string, circleId: string): InviteView[] {
    this.requireUser(uid);
    if (!this.isCircleAdmin(circleId, uid)) fail('FORBIDDEN');
    return clone(
      this.store.invites
        .filter((i) => i.circleId === circleId)
        .sort((a, b) => (a.id < b.id ? 1 : -1))
        .slice(0, 50)
        .map((i) => this.inviteView(i.id)),
    );
  }

  revokeInvite(uid: string, inviteId: string): void {
    this.requireUser(uid);
    const invite = this.store.invites.find((i) => i.id === inviteId);
    if (!invite || !this.isCircleAdmin(invite.circleId, uid)) return fail('NOT_FOUND');
    if (!invite.revokedAt) {
      invite.revokedAt = this.iso();
      this.audit({ circleId: invite.circleId, challengeId: invite.challengeId, actorId: uid, action: 'invite.revoked', visibility: 'restricted' });
    }
  }

  private findInvite(code: string) {
    const normalized = normalizeInviteCode(code);
    const invite = this.store.invites.find((i) => i.code === normalized);
    if (!invite || invite.revokedAt) return fail('INVITE_INVALID');
    const circle = this.store.circles.find((c) => c.id === invite.circleId);
    if (!circle || circle.archivedAt) return fail('INVITE_INVALID');
    return invite;
  }

  /** `uid` may be null: an invite can be previewed before signing in. */
  previewInvite(uid: string | null, code: string): InvitePreview {
    const invite = this.findInvite(code);
    const member = !!uid && !!this.role(invite.circleId, uid);
    if (!member) {
      if (Date.parse(invite.expiresAt) <= this.clock.now().getTime()) fail('INVITE_EXPIRED');
      if (invite.useCount >= invite.maxUses) fail('INVITE_INVALID');
    }
    const ch = invite.challengeId ? this.challengeRow(invite.challengeId) : undefined;
    const rule = ch && this.status(ch) === 'scheduled' ? this.rule(ch.currentRuleVersionId) : undefined;
    return clone({
      circleId: invite.circleId,
      circleName: this.store.circles.find((c) => c.id === invite.circleId)?.name ?? '',
      memberCount: this.store.members.filter((m) => m.circleId === invite.circleId && !m.removedAt).length,
      inviterName: this.name(invite.createdBy),
      expiresAt: invite.expiresAt,
      alreadyMember: member,
      challenge:
        ch && rule
          ? { id: ch.id, name: ch.name, habitType: ch.habitType, metricUnit: ch.metricUnit, target: rule.target, comparator: rule.comparator, startDate: ch.startDate, endDate: ch.endDate }
          : null,
    });
  }

  redeemInvite(uid: string, input: { code: string; idempotencyKey: string }): RedeemResult {
    this.requireUser(uid);
    const invite = this.findInvite(input.code);
    const ch = invite.challengeId ? this.challengeRow(invite.challengeId) : undefined;
    const challengeId = ch && this.status(ch) === 'scheduled' ? ch.id : null;
    // Someone who is already a member never consumes another use.
    if (this.role(invite.circleId, uid)) return { circleId: invite.circleId, challengeId, alreadyMember: true };
    if (Date.parse(invite.expiresAt) <= this.clock.now().getTime()) fail('INVITE_EXPIRED');
    if (invite.useCount >= invite.maxUses) fail('INVITE_INVALID');
    if (this.store.members.filter((m) => m.circleId === invite.circleId && !m.removedAt).length >= LIMITS.maxCircleMembers) fail('LIMIT_REACHED', 'This Circle is full (50 members).');

    const existing = this.store.members.find((m) => m.circleId === invite.circleId && m.userId === uid);
    if (existing) {
      existing.role = 'member';
      existing.joinedAt = this.iso();
      existing.removedAt = null;
      existing.removedReason = null;
    } else {
      this.store.members.push({ id: this.id(), circleId: invite.circleId, userId: uid, role: 'member', joinedAt: this.iso(), removedAt: null, removedReason: null });
    }
    invite.useCount += 1;
    const name = this.name(uid);
    const circle = this.store.circles.find((c) => c.id === invite.circleId)!;
    this.audit({ circleId: circle.id, actorId: uid, subjectUserId: uid, action: 'member.joined', after: { role: 'member' } });
    this.systemMessage(circle.id, `${name} joined the Circle.`, { type: 'member_joined', userId: uid, name });
    for (const m of this.store.members) {
      if (m.circleId === circle.id && !m.removedAt && (m.role === 'owner' || m.role === 'admin') && m.userId !== uid) {
        this.notify(m.userId, 'member_joined', { circleId: circle.id, circleName: circle.name, actorName: name }, `member_joined:${circle.id}:${uid}:${this.nextSeq()}`);
      }
    }
    for (const open of this.store.challenges) {
      if (open.circleId === circle.id && this.status(open) === 'scheduled') this.notify(uid, 'challenge_invite', this.payload(open), `challenge_invite:${open.id}`);
    }
    return { circleId: invite.circleId, challengeId, alreadyMember: false };
  }

  /* ------------------------------------------------------------- challenges */

  getChallenge(uid: string, challengeId: string): ChallengeDetail {
    this.requireUser(uid);
    const ch = this.visibleChallenge(challengeId, uid);
    this.sync(ch);
    return clone(this.detail(ch, uid));
  }

  saveDraft(uid: string, input: DraftInput): ChallengeDetail {
    this.requireUser(uid);
    const name = input.name.trim();
    const description = input.description.trim();
    const unit = input.metricUnit.trim();
    if (name.length < 2 || name.length > LIMITS.maxNameLength) fail('VALIDATION', 'Give it a name between 2 and 60 characters.');
    if (description.length > LIMITS.maxDescriptionLength) fail('VALIDATION', 'Keep the description under 280 characters.');
    if (!HABITS[input.habitType]) fail('VALIDATION', 'Choose a habit.');
    if (unit.length < 1 || unit.length > LIMITS.maxUnitLength) fail('VALIDATION', 'Name the unit in 20 characters or fewer.');
    if (!isValidTimeZone(input.timezone)) fail('VALIDATION', 'Choose a valid time zone.');
    if (!Number.isFinite(input.target) || input.target <= 0 || input.target > 1_000_000) fail('VALIDATION', 'Set a daily target above zero.');
    if (!['lte', 'gte', 'bool'].includes(input.comparator)) fail('VALIDATION', 'Choose a goal type.');
    if (input.comparator === 'bool' && input.target !== 1) fail('VALIDATION', 'A yes/no goal is one check-in a day.');
    if (!['evidence', 'self_report'].includes(input.verification)) fail('VALIDATION', 'Choose how check-ins are verified.');
    if (!isDateKey(input.startDate) || !isDateKey(input.endDate)) fail('VALIDATION', 'Choose dates between 1 and 30 days apart.');
    const span = diffDays(input.startDate, input.endDate);
    if (span < 0 || span >= LIMITS.maxDurationDays) fail('VALIDATION', 'Choose dates between 1 and 30 days apart.');
    if (!Number.isInteger(input.requiredDays) || input.requiredDays < 1 || input.requiredDays > span + 1) {
      fail('VALIDATION', 'Required days must be between 1 and the number of scheduled days.');
    }
    const step = Math.min(5, Math.max(1, Math.trunc(input.draftStep || 1)));
    const now = this.iso();

    let ch: ChallengeRow;
    if (!input.id) {
      if (!this.role(input.circleId, uid)) fail('FORBIDDEN');
      const drafts = this.store.challenges.filter((d) => d.circleId === input.circleId && d.status === 'draft' && this.isChallengeAdmin(d, uid));
      if (drafts.length >= 10) fail('LIMIT_REACHED', 'Publish or delete a draft before starting another.');
      const id = this.id();
      const ruleId = this.id();
      ch = {
        id,
        circleId: input.circleId,
        creatorId: uid,
        name,
        description,
        habitType: input.habitType,
        metricUnit: unit,
        timezone: input.timezone,
        startDate: input.startDate,
        endDate: input.endDate,
        status: 'draft',
        currentRuleVersionId: ruleId,
        revision: 1,
        rewardMode: 'none',
        draftStep: step,
        rematchOfId: null,
        publishedAt: null,
        completedAt: null,
        canceledAt: null,
        canceledReason: null,
        finalizeReminderSentAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.store.challenges.push(ch);
      this.store.rules.push({
        id: ruleId,
        challengeId: id,
        version: 1,
        status: 'draft',
        target: input.target,
        comparator: input.comparator,
        requiredDays: input.requiredDays,
        verification: input.verification,
        startDate: input.startDate,
        endDate: input.endDate,
        effectiveDate: input.startDate,
        reason: null,
        proposedBy: null,
        createdAt: now,
      });
      this.store.admins.push({ id: this.id(), challengeId: id, userId: uid, assignedBy: uid, assignedAt: now, revokedAt: null });
    } else {
      const existing = this.challengeRow(input.id);
      if (!existing || !this.isChallengeAdmin(existing, uid)) return fail('NOT_FOUND');
      ch = existing;
      if (ch.status !== 'draft') fail('CHALLENGE_CLOSED', 'Published challenges change through a rule-change proposal.');
      if (ch.revision !== input.expectedRevision) fail('REVISION_CONFLICT');
      if (input.circleId !== ch.circleId && !this.role(input.circleId, uid)) fail('FORBIDDEN');
      Object.assign(ch, {
        circleId: input.circleId,
        name,
        description,
        habitType: input.habitType,
        metricUnit: unit,
        timezone: input.timezone,
        startDate: input.startDate,
        endDate: input.endDate,
        draftStep: step,
      });
      this.bump(ch);
      Object.assign(this.rule(ch.currentRuleVersionId), {
        target: input.target,
        comparator: input.comparator,
        requiredDays: input.requiredDays,
        verification: input.verification,
        startDate: input.startDate,
        endDate: input.endDate,
        effectiveDate: input.startDate,
      });
    }
    return clone(this.detail(ch, uid));
  }

  deleteDraft(uid: string, challengeId: string): void {
    this.requireUser(uid);
    const ch = this.challengeRow(challengeId);
    if (!ch || !this.isChallengeAdmin(ch, uid)) return fail('NOT_FOUND');
    if (ch.status !== 'draft') fail('CHALLENGE_CLOSED', 'Only drafts can be deleted. Cancel a published challenge instead.');
    this.store.challenges = this.store.challenges.filter((c) => c.id !== ch.id);
    this.store.rules = this.store.rules.filter((r) => r.challengeId !== ch.id);
    this.store.admins = this.store.admins.filter((a) => a.challengeId !== ch.id);
  }

  publishChallenge(uid: string, input: { challengeId: string; expectedRevision: number; joinAsParticipant: boolean }): ChallengeDetail {
    this.requireUser(uid);
    const ch = this.challengeRow(input.challengeId);
    if (!ch || !this.isChallengeAdmin(ch, uid)) return fail('NOT_FOUND');
    if (ch.status !== 'draft' || ch.revision !== input.expectedRevision) fail('REVISION_CONFLICT');
    const rule = this.rule(ch.currentRuleVersionId);
    const issues = validateTerms(
      { ...rule, habitType: ch.habitType, metricUnit: ch.metricUnit },
      { today: dateKeyAt(this.clock.now(), ch.timezone), phase: 'publish' },
    );
    if (issues[0]) fail('VALIDATION', issues[0].message);

    const now = this.iso();
    rule.status = 'active';
    rule.effectiveDate = rule.startDate;
    ch.status = 'scheduled';
    ch.publishedAt = now;
    ch.startDate = rule.startDate;
    ch.endDate = rule.endDate;
    this.bump(ch);
    if (input.joinAsParticipant) {
      const pid = this.id();
      this.store.participants.push({ id: pid, challengeId: ch.id, userId: uid, joinedAt: now, acceptedVersionId: rule.id, removedAt: null, removedReason: null });
      this.store.acceptances.push({ versionId: rule.id, participantId: pid, decision: 'accepted', decidedAt: now });
    }
    this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: uid, action: 'challenge.published', after: this.rulesView(rule) });
    this.systemMessage(ch.circleId, `${this.name(uid)} published ${ch.name}. Review the rules to join.`, {
      ...this.payload(ch),
      type: 'challenge_published',
      actorName: this.name(uid),
    });
    for (const m of this.store.members) {
      if (m.circleId === ch.circleId && !m.removedAt && m.userId !== uid) {
        this.notify(m.userId, 'challenge_invite', { ...this.payload(ch), actorName: this.name(uid) }, `challenge_invite:${ch.id}`);
      }
    }
    return clone(this.detail(ch, uid));
  }

  joinChallenge(uid: string, input: { challengeId: string; acceptedVersionId: string }): ChallengeDetail {
    this.requireUser(uid);
    const ch = this.challengeRow(input.challengeId);
    if (!ch || ch.status === 'draft' || !this.role(ch.circleId, uid)) return fail('NOT_FOUND');
    const status = this.sync(ch);
    if (status === 'completed' || status === 'canceled') fail('CHALLENGE_CLOSED');
    const existing = this.store.participants.find((p) => p.challengeId === ch.id && p.userId === uid);
    if (existing) {
      if (existing.removedAt) fail('FORBIDDEN', 'You were removed from this challenge.');
      return clone(this.detail(ch, uid));
    }
    if (status !== 'scheduled') fail('CHALLENGE_STARTED');
    if (input.acceptedVersionId !== ch.currentRuleVersionId) fail('RULES_CHANGED');
    if (this.store.participants.filter((p) => p.challengeId === ch.id && !p.removedAt).length >= LIMITS.maxParticipants) fail('LIMIT_REACHED', 'This challenge is full (50 players).');

    const now = this.iso();
    const pid = this.id();
    this.store.participants.push({ id: pid, challengeId: ch.id, userId: uid, joinedAt: now, acceptedVersionId: ch.currentRuleVersionId, removedAt: null, removedReason: null });
    this.store.acceptances.push({ versionId: ch.currentRuleVersionId, participantId: pid, decision: 'accepted', decidedAt: now });
    const name = this.name(uid);
    this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: uid, subjectUserId: uid, action: 'participant.joined', after: { acceptedVersion: this.rule(ch.currentRuleVersionId).version } });
    this.systemMessage(ch.circleId, `${name} is in for ${ch.name}.`, { ...this.payload(ch), type: 'participant_joined', userId: uid, name });
    return clone(this.detail(ch, uid));
  }

  updateChallengeDetails(uid: string, input: { challengeId: string; name: string; description: string; expectedRevision: number }): ChallengeDetail {
    this.requireUser(uid);
    const ch = this.visibleChallenge(input.challengeId, uid);
    if (!this.isChallengeAdmin(ch, uid)) fail('FORBIDDEN');
    if (ch.status === 'completed' || ch.status === 'canceled') fail('CHALLENGE_CLOSED');
    if (ch.revision !== input.expectedRevision) fail('REVISION_CONFLICT');
    const name = input.name.trim();
    const description = input.description.trim();
    if (name.length < 2 || name.length > LIMITS.maxNameLength) fail('VALIDATION', 'Give it a name between 2 and 60 characters.');
    if (description.length > LIMITS.maxDescriptionLength) fail('VALIDATION', 'Keep the description under 280 characters.');
    if (name !== ch.name || description !== ch.description) {
      this.audit({
        circleId: ch.circleId,
        challengeId: ch.id,
        actorId: uid,
        action: 'challenge.details_updated',
        before: { name: ch.name, description: ch.description },
        after: { name, description },
      });
      ch.name = name;
      ch.description = description;
      this.bump(ch);
    }
    return clone(this.detail(ch, uid));
  }

  /* ----------------------------------------------------------- rule changes */

  private activate(rule: RuleRow): void {
    const ch = this.challengeRow(rule.challengeId)!;
    const status = this.status(ch);
    const today = dateKeyAt(this.clock.now(), ch.timezone);
    const effective = status === 'scheduled' ? rule.startDate : addDays(today, 1);
    if ((status !== 'scheduled' && status !== 'active') || (status === 'active' && effective > rule.endDate)) {
      rule.status = 'withdrawn';
      return;
    }
    const previous = this.rule(ch.currentRuleVersionId);
    for (const other of this.store.rules) if (other.challengeId === ch.id && other.status === 'active') other.status = 'superseded';
    rule.status = 'active';
    rule.effectiveDate = effective;
    ch.currentRuleVersionId = rule.id;
    ch.startDate = rule.startDate;
    ch.endDate = rule.endDate;
    this.bump(ch);
    for (const p of this.store.participants) if (p.challengeId === ch.id && !p.removedAt) p.acceptedVersionId = rule.id;
    this.audit({
      circleId: ch.circleId,
      challengeId: ch.id,
      actorId: rule.proposedBy,
      action: 'rules.activated',
      localDate: effective,
      before: this.rulesView(previous),
      after: this.rulesView(rule),
      reason: rule.reason,
    });
    this.systemMessage(ch.circleId, `New rules for ${ch.name} are in effect.`, { ...this.payload(ch), type: 'rule_change_activated', effectiveDate: effective });
    for (const p of this.store.participants) {
      if (p.challengeId === ch.id && !p.removedAt) this.notify(p.userId, 'rule_change_activated', { ...this.payload(ch), effectiveDate: effective }, `rule_change_activated:${rule.id}`);
    }
  }

  private maybeActivate(rule: RuleRow): boolean {
    if (rule.status !== 'proposed') return false;
    const waiting = this.store.participants.some(
      (p) =>
        p.challengeId === rule.challengeId &&
        !p.removedAt &&
        !this.store.acceptances.some((a) => a.versionId === rule.id && a.participantId === p.id && a.decision === 'accepted'),
    );
    if (waiting) return false;
    this.activate(rule);
    return true;
  }

  proposeRuleChange(uid: string, input: { challengeId: string; rules: RuleChangeInput; reason: string; expectedRevision: number }): ChallengeDetail {
    this.requireUser(uid);
    const ch = this.visibleChallenge(input.challengeId, uid);
    if (!this.isChallengeAdmin(ch, uid)) fail('FORBIDDEN');
    const status = this.sync(ch);
    if (status !== 'scheduled' && status !== 'active') fail('CHALLENGE_CLOSED');
    if (ch.revision !== input.expectedRevision) fail('REVISION_CONFLICT');
    if (this.store.rules.some((r) => r.challengeId === ch.id && r.status === 'proposed')) fail('PROPOSAL_PENDING');
    const reason = this.requireReason(input.reason);
    const current = this.rule(ch.currentRuleVersionId);
    const today = dateKeyAt(this.clock.now(), ch.timezone);
    const next = input.rules;
    if (next.comparator !== current.comparator) fail('VALIDATION', 'The goal type can’t change after publishing.');
    const issues = validateTerms(
      { ...next, habitType: ch.habitType, metricUnit: ch.metricUnit },
      { today, phase: 'change', started: status === 'active', currentStartDate: current.startDate },
    );
    if (issues[0]) fail('VALIDATION', issues[0].message);
    if (
      next.target === current.target &&
      next.requiredDays === current.requiredDays &&
      next.verification === current.verification &&
      next.startDate === current.startDate &&
      next.endDate === current.endDate
    ) {
      fail('VALIDATION', 'Change at least one rule.');
    }

    const rule: RuleRow = {
      id: this.id(),
      challengeId: ch.id,
      version: Math.max(...this.store.rules.filter((r) => r.challengeId === ch.id).map((r) => r.version)) + 1,
      status: 'proposed',
      target: next.target,
      comparator: next.comparator,
      requiredDays: next.requiredDays,
      verification: next.verification,
      startDate: next.startDate,
      endDate: next.endDate,
      effectiveDate: status === 'scheduled' ? next.startDate : addDays(today, 1),
      reason,
      proposedBy: uid,
      createdAt: this.iso(),
    };
    this.store.rules.push(rule);
    this.bump(ch);
    const me = this.store.participants.find((p) => p.challengeId === ch.id && p.userId === uid && !p.removedAt);
    if (me) this.store.acceptances.push({ versionId: rule.id, participantId: me.id, decision: 'accepted', decidedAt: this.iso() });
    this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: uid, action: 'rules.proposed', before: this.rulesView(current), after: this.rulesView(rule), reason });
    if (!this.maybeActivate(rule)) {
      this.systemMessage(ch.circleId, `${this.name(uid)} proposed a rule change for ${ch.name}. It needs everyone’s OK.`, {
        ...this.payload(ch),
        type: 'rule_change_proposed',
        actorName: this.name(uid),
      });
      for (const p of this.store.participants) {
        if (p.challengeId === ch.id && !p.removedAt && p.userId !== uid) {
          this.notify(p.userId, 'rule_change_proposed', { ...this.payload(ch), actorName: this.name(uid), reason }, `rule_change_proposed:${rule.id}`);
        }
      }
    }
    return clone(this.detail(ch, uid));
  }

  respondToRuleChange(uid: string, input: { versionId: string; accept: boolean }): ChallengeDetail {
    this.requireUser(uid);
    const rule = this.store.rules.find((r) => r.id === input.versionId);
    if (!rule) return fail('NOT_FOUND');
    const ch = this.visibleChallenge(rule.challengeId, uid);
    const me = this.store.participants.find((p) => p.challengeId === ch.id && p.userId === uid && !p.removedAt);
    if (!me) return fail('FORBIDDEN', 'Only current players respond to rule changes.');
    this.sync(ch);
    if (rule.status !== 'proposed') fail('ALREADY_DECIDED');
    const existing = this.store.acceptances.find((a) => a.versionId === rule.id && a.participantId === me.id);
    const decision = input.accept ? 'accepted' : 'declined';
    if (existing) Object.assign(existing, { decision, decidedAt: this.iso() });
    else this.store.acceptances.push({ versionId: rule.id, participantId: me.id, decision, decidedAt: this.iso() });

    if (input.accept) this.maybeActivate(rule);
    else {
      rule.status = 'declined';
      this.bump(ch);
      this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: uid, action: 'rules.declined', after: this.rulesView(rule) });
      this.systemMessage(ch.circleId, `The proposed rule change for ${ch.name} was declined. The original rules stay.`, { ...this.payload(ch), type: 'rule_change_declined' });
      const recipients = new Set([
        ...this.store.admins.filter((a) => a.challengeId === ch.id && !a.revokedAt).map((a) => a.userId),
        ...this.store.participants.filter((p) => p.challengeId === ch.id && !p.removedAt).map((p) => p.userId),
      ]);
      for (const recipient of recipients) if (recipient !== uid) this.notify(recipient, 'rule_change_declined', this.payload(ch), `rule_change_declined:${rule.id}`);
    }
    return clone(this.detail(ch, uid));
  }

  withdrawRuleChange(uid: string, versionId: string): ChallengeDetail {
    this.requireUser(uid);
    const rule = this.store.rules.find((r) => r.id === versionId);
    if (!rule) return fail('NOT_FOUND');
    const ch = this.visibleChallenge(rule.challengeId, uid);
    if (!this.isChallengeAdmin(ch, uid)) fail('FORBIDDEN');
    if (rule.status !== 'proposed') fail('ALREADY_DECIDED');
    rule.status = 'withdrawn';
    this.bump(ch);
    this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: uid, action: 'rules.withdrawn', after: this.rulesView(rule) });
    return clone(this.detail(ch, uid));
  }

  /* --------------------------------------------- cancel, admins, participants */

  cancelChallenge(uid: string, input: { challengeId: string; reason: string; expectedRevision: number }): ChallengeDetail {
    this.requireUser(uid);
    const ch = this.visibleChallenge(input.challengeId, uid);
    if (!this.isChallengeAdmin(ch, uid)) fail('FORBIDDEN');
    if (ch.status === 'draft') fail('VALIDATION', 'Delete the draft instead.');
    if (ch.status === 'completed' || ch.status === 'canceled') fail('CHALLENGE_CLOSED');
    if (ch.revision !== input.expectedRevision) fail('REVISION_CONFLICT');
    const reason = this.requireReason(input.reason);
    for (const rule of this.store.rules) if (rule.challengeId === ch.id && rule.status === 'proposed') rule.status = 'withdrawn';
    const before = ch.status;
    ch.status = 'canceled';
    ch.canceledAt = this.iso();
    ch.canceledReason = reason;
    this.bump(ch);
    this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: uid, action: 'challenge.canceled', before: { status: before }, after: { status: 'canceled' }, reason });
    this.systemMessage(ch.circleId, `${ch.name} was canceled.`, { ...this.payload(ch), type: 'challenge_canceled', reason });
    const recipients = new Set([
      ...this.store.admins.filter((a) => a.challengeId === ch.id && !a.revokedAt).map((a) => a.userId),
      ...this.store.participants.filter((p) => p.challengeId === ch.id && !p.removedAt).map((p) => p.userId),
    ]);
    for (const recipient of recipients) if (recipient !== uid) this.notify(recipient, 'challenge_canceled', { ...this.payload(ch), reason }, `challenge_canceled:${ch.id}`);
    return clone(this.detail(ch, uid));
  }

  assignChallengeAdmin(uid: string, input: { challengeId: string; userId: string }): ChallengeDetail {
    this.requireUser(uid);
    const ch = this.visibleChallenge(input.challengeId, uid);
    if (!(this.isChallengeAdmin(ch, uid) || this.isCircleAdmin(ch.circleId, uid))) fail('FORBIDDEN');
    if (ch.status === 'completed' || ch.status === 'canceled') fail('CHALLENGE_CLOSED');
    if (!this.role(ch.circleId, input.userId)) fail('VALIDATION', 'Only current Circle members can be challenge admins.');
    const existing = this.store.admins.find((a) => a.challengeId === ch.id && a.userId === input.userId);
    let changed = false;
    if (existing) {
      if (existing.revokedAt) {
        Object.assign(existing, { revokedAt: null, assignedBy: uid, assignedAt: this.iso() });
        changed = true;
      }
    } else {
      this.store.admins.push({ id: this.id(), challengeId: ch.id, userId: input.userId, assignedBy: uid, assignedAt: this.iso(), revokedAt: null });
      changed = true;
    }
    if (changed) {
      this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: uid, subjectUserId: input.userId, action: 'admin.assigned' });
      if (input.userId !== uid) this.notify(input.userId, 'admin_assigned', { ...this.payload(ch), actorName: this.name(uid) }, `admin_assigned:${ch.id}:${this.nextSeq()}`);
    }
    return clone(this.detail(ch, uid));
  }

  revokeChallengeAdmin(uid: string, input: { challengeId: string; userId: string }): ChallengeDetail {
    this.requireUser(uid);
    const ch = this.visibleChallenge(input.challengeId, uid);
    if (!(this.isChallengeAdmin(ch, uid) || this.isCircleAdmin(ch.circleId, uid))) fail('FORBIDDEN');
    if (ch.status === 'completed' || ch.status === 'canceled') fail('CHALLENGE_CLOSED');
    const target = this.store.admins.find((a) => a.challengeId === ch.id && a.userId === input.userId && !a.revokedAt);
    if (!target) return clone(this.detail(ch, uid));
    if (!this.store.admins.some((a) => a.challengeId === ch.id && a.userId !== input.userId && !a.revokedAt && this.role(ch.circleId, a.userId))) fail('LAST_ADMIN');
    target.revokedAt = this.iso();
    this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: uid, subjectUserId: input.userId, action: 'admin.revoked' });
    return clone(this.detail(ch, uid));
  }

  removeParticipant(uid: string, input: { participantId: string; reason: string }): ChallengeDetail {
    this.requireUser(uid);
    const p = this.store.participants.find((x) => x.id === input.participantId);
    if (!p) return fail('NOT_FOUND');
    const ch = this.visibleChallenge(p.challengeId, uid);
    if (!this.isChallengeAdmin(ch, uid)) fail('FORBIDDEN');
    if (ch.status === 'completed' || ch.status === 'canceled') fail('CHALLENGE_CLOSED');
    if (p.removedAt) return clone(this.detail(ch, uid));
    const reason = this.requireReason(input.reason);
    p.removedAt = this.iso();
    p.removedReason = reason;
    this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: uid, subjectUserId: p.userId, action: 'participant.removed', reason });
    this.notify(p.userId, 'removed_from_challenge', { ...this.payload(ch), reason }, `removed_from_challenge:${p.id}`);
    for (const rule of this.store.rules.filter((r) => r.challengeId === ch.id && r.status === 'proposed')) this.maybeActivate(rule);
    return clone(this.detail(ch, uid));
  }

  /* -------------------------------------------------- finalization, rematch */

  finalizeChallenge(uid: string, challengeId: string): ChallengeDetail {
    this.requireUser(uid);
    const ch = this.visibleChallenge(challengeId, uid);
    if (ch.status === 'completed') return clone(this.detail(ch, uid));
    if (ch.status === 'canceled' || ch.status === 'draft') fail('CHALLENGE_CLOSED');
    this.sync(ch);
    const first = this.blockers(ch)[0];
    if (first) {
      if (first.code === 'NOT_IN_REVIEW') fail('NOT_STARTED', 'This challenge hasn’t ended yet.');
      fail(first.code as ErrorCode);
    }
    ch.status = 'completed';
    ch.completedAt = this.iso();
    this.bump(ch);
    this.audit({
      circleId: ch.circleId,
      challengeId: ch.id,
      actorId: uid,
      action: 'challenge.completed',
      localDate: ch.endDate,
      after: {
        standings: this.standings(ch, uid).map((s) => ({ userId: s.person.userId, successfulDays: s.successfulDays, rank: s.rank, qualified: s.qualified, removed: s.removed })),
      },
    });
    this.systemMessage(ch.circleId, `${ch.name} is complete. The results are in.`, { ...this.payload(ch), type: 'challenge_finished' });
    const recipients = new Set([
      ...this.store.admins.filter((a) => a.challengeId === ch.id && !a.revokedAt).map((a) => a.userId),
      ...this.store.participants.filter((p) => p.challengeId === ch.id && !p.removedAt).map((p) => p.userId),
    ]);
    for (const recipient of recipients) this.notify(recipient, 'challenge_completed', this.payload(ch), `challenge_completed:${ch.id}`);
    return clone(this.detail(ch, uid));
  }

  createRematch(uid: string, challengeId: string): ChallengeDetail {
    this.requireUser(uid);
    const source = this.visibleChallenge(challengeId, uid);
    if (source.status !== 'completed' && source.status !== 'canceled') fail('VALIDATION', 'A rematch is available once the challenge is finished.');
    if (!(this.isChallengeAdmin(source, uid) || this.store.participants.some((p) => p.challengeId === source.id && p.userId === uid))) fail('FORBIDDEN');
    const rule = this.rule(source.currentRuleVersionId);
    const start = addDays(dateKeyAt(this.clock.now(), source.timezone), 1);
    const end = addDays(start, diffDays(rule.startDate, rule.endDate));
    const now = this.iso();
    const id = this.id();
    const ruleId = this.id();
    const ch: ChallengeRow = {
      ...source,
      id,
      creatorId: uid,
      startDate: start,
      endDate: end,
      status: 'draft',
      currentRuleVersionId: ruleId,
      revision: 1,
      rewardMode: 'none',
      draftStep: 5,
      rematchOfId: source.id,
      publishedAt: null,
      completedAt: null,
      canceledAt: null,
      canceledReason: null,
      finalizeReminderSentAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.challenges.push(ch);
    this.store.rules.push({ ...rule, id: ruleId, challengeId: id, version: 1, status: 'draft', startDate: start, endDate: end, effectiveDate: start, reason: null, proposedBy: null, createdAt: now });
    this.store.admins.push({ id: this.id(), challengeId: id, userId: uid, assignedBy: uid, assignedAt: now, revokedAt: null });
    this.audit({ circleId: ch.circleId, challengeId: id, actorId: uid, action: 'challenge.rematch_created', after: { rematchOf: source.id } });
    return clone(this.detail(ch, uid));
  }

  setRewardPreview(uid: string, input: { challengeId: string; mode: RewardMode; grossCents: number; feeBps: number }): ChallengeDetail {
    this.requireUser(uid);
    if (!this.demoRewards) fail('LIVE_PAYMENTS_DISABLED');
    if (!['none', 'demo_sponsor', 'demo_pot'].includes(input.mode)) fail('LIVE_PAYMENTS_DISABLED');
    const ch = this.visibleChallenge(input.challengeId, uid);
    if (!this.isChallengeAdmin(ch, uid)) fail('FORBIDDEN');
    const status = this.sync(ch);
    if (status !== 'draft' && status !== 'scheduled') fail('CHALLENGE_STARTED', 'A reward preview can only change before the challenge starts.');
    const before = ch.rewardMode;
    this.store.rewards = this.store.rewards.filter((r) => r.challengeId !== ch.id);
    if (input.mode !== 'none') {
      if (!Number.isInteger(input.grossCents) || input.grossCents < 1 || input.grossCents > 100_000_000) fail('VALIDATION', 'Enter a preview amount between $0.01 and $1,000,000.');
      if (!Number.isInteger(input.feeBps) || input.feeBps < 0 || input.feeBps > 2000) fail('VALIDATION', 'The illustrative fee must be between 0% and 20%.');
      this.store.rewards.push({ challengeId: ch.id, mode: input.mode, grossCents: input.grossCents, feeBps: input.feeBps, sponsorId: input.mode === 'demo_sponsor' ? uid : null });
    }
    ch.rewardMode = input.mode;
    this.bump(ch);
    this.audit({
      circleId: ch.circleId,
      challengeId: ch.id,
      actorId: uid,
      action: 'reward_preview.set',
      before: { mode: before },
      after: { mode: input.mode, grossCents: input.grossCents, feeBps: input.feeBps, demoOnly: true },
    });
    return clone(this.detail(ch, uid));
  }

  /* -------------------------------------------------------------- check-ins */

  private participantFor(ch: ChallengeRow, uid: string): ParticipantRow {
    const p = this.store.participants.find((x) => x.challengeId === ch.id && x.userId === uid);
    if (!p || p.removedAt) return fail('FORBIDDEN');
    return p;
  }

  getDay(uid: string, input: { challengeId: string; date: string; participantId?: string }): DayDetail {
    this.requireUser(uid);
    const ch = this.visibleChallenge(input.challengeId, uid);
    this.sync(ch);
    let participant: ParticipantRow | undefined;
    if (!input.participantId) {
      participant = this.store.participants.find((p) => p.challengeId === ch.id && p.userId === uid);
      if (!participant) return fail('FORBIDDEN', 'You’re not playing in this challenge.');
    } else {
      participant = this.store.participants.find((p) => p.id === input.participantId && p.challengeId === ch.id);
      if (!participant) return fail('NOT_FOUND');
      if (participant.userId !== uid && !this.isChallengeAdmin(ch, uid)) fail('FORBIDDEN');
    }
    if (!isDateKey(input.date) || input.date < ch.startDate || input.date > ch.endDate) fail('VALIDATION', 'That date isn’t part of this challenge.');
    return clone(this.day(participant, input.date, uid));
  }

  private gate(ch: ChallengeRow, participant: ParticipantRow, date: string) {
    const record = this.store.records.find((r) => r.participantId === participant.id && r.localDate === date);
    const rule = record ? this.rule(record.ruleVersionId) : this.ruleFor(ch, date);
    const gate = submissionGate({
      challenge: this.clockOf(ch),
      habitType: ch.habitType,
      comparator: rule.comparator,
      verification: rule.verification,
      date,
      now: this.clock.now(),
      record: record ?? null,
    });
    if (!gate.ok) return fail(gate.code);
    return { record, rule, late: gate.late };
  }

  private ensureRecord(participant: ParticipantRow, date: string, rule: RuleRow, existing: RecordRow | undefined): RecordRow {
    if (existing) return existing;
    const record: RecordRow = {
      id: this.id(),
      participantId: participant.id,
      localDate: date,
      ruleVersionId: rule.id,
      effectiveValue: null,
      outcome: 'open',
      provenance: null,
      revision: 1,
      decidedAt: null,
      acknowledgedAt: null,
      successAnnounced: false,
    };
    this.store.records.push(record);
    return record;
  }

  private announce(record: RecordRow, type: string): void {
    if (record.outcome !== 'success' || record.successAnnounced) return;
    record.successAnnounced = true;
    const p = this.store.participants.find((x) => x.id === record.participantId)!;
    const ch = this.challengeRow(p.challengeId)!;
    const name = this.name(p.userId);
    this.systemMessage(
      ch.circleId,
      HABITS[ch.habitType].privateDetail ? `${name} completed the daily goal.` : `${name} hit the goal for ${formatDateKey(record.localDate, { weekday: false })}.`,
      { ...this.payload(ch), type, userId: p.userId, name, localDate: record.localDate },
    );
  }

  private reconcileLedger(record: RecordRow, actorId: string, total: number, key: string): void {
    const sum = this.store.increments.filter((i) => i.recordId === record.id).reduce((acc, i) => acc + i.amount, 0);
    if (total !== sum && !this.store.increments.some((i) => i.actorId === actorId && i.idempotencyKey === key)) {
      this.store.increments.push({ id: this.id(), recordId: record.id, actorId, amount: total - sum, kind: 'correction', idempotencyKey: key, createdAt: this.iso() });
    }
  }

  submitCheckin(
    uid: string,
    input: { challengeId: string; date: string; value: number; evidence?: LocalEvidence | null; idempotencyKey: string; late?: boolean },
  ): DayDetail {
    this.requireUser(uid);
    if (!input.idempotencyKey || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 100) fail('VALIDATION', 'Missing request id.');
    const ch = this.visibleChallenge(input.challengeId, uid);
    const participant = this.participantFor(ch, uid);
    this.sync(ch);

    // A retried request returns the stored result; it never creates another version.
    const existingRecord = this.store.records.find((r) => r.participantId === participant.id && r.localDate === input.date);
    if (
      (existingRecord && this.store.submissions.some((s) => s.recordId === existingRecord.id && s.idempotencyKey === input.idempotencyKey)) ||
      this.store.increments.some((i) => i.actorId === uid && i.idempotencyKey === input.idempotencyKey)
    ) {
      return clone(this.day(participant, input.date, uid));
    }

    const { record: found, rule, late } = this.gate(ch, participant, input.date);
    if (late && !input.late) fail('DEADLINE_PASSED');
    if (!isValidDailyValue(ch.habitType, rule.comparator, input.value)) fail('VALIDATION', 'Enter a valid amount for this goal.');
    if (rule.verification === 'evidence') {
      if (!input.evidence) fail('EVIDENCE_REQUIRED');
      const evidence = input.evidence!;
      if (!evidence.uri) fail('UPLOAD_INCOMPLETE');
      if (!['image/jpeg', 'image/png'].includes(evidence.mime) || evidence.byteSize < 1 || evidence.byteSize > LIMITS.maxEvidenceBytes) {
        fail('VALIDATION', 'Proof must be a JPEG or PNG image up to 10 MB.');
      }
    } else if (input.evidence) fail('VALIDATION', 'This challenge doesn’t take proof uploads.');

    const record = this.ensureRecord(participant, input.date, rule, found);
    const prior = record.outcome;
    const now = this.iso();

    if (HABITS[ch.habitType].usesIncrements && rule.verification === 'self_report' && !late) {
      this.reconcileLedger(record, uid, input.value, input.idempotencyKey);
      record.effectiveValue = input.value;
      record.outcome = meetsTarget(rule.comparator, rule.target, input.value) ? 'success' : 'open';
      record.provenance = 'self_reported';
      record.revision += 1;
      this.announce(record, 'goal_completed');
      return clone(this.day(participant, input.date, uid));
    }

    const versions = this.store.submissions.filter((s) => s.recordId === record.id);
    const waiting = versions.filter((s) => s.status === 'pending' || s.status === 'late').sort((a, b) => b.version - a.version)[0];
    for (const s of versions) if (s.status === 'pending' || s.status === 'late') s.status = 'superseded';
    const status = late ? 'late' : rule.verification === 'evidence' ? 'pending' : 'accepted';
    const submissionId = this.id();
    const version = versions.reduce((max, s) => Math.max(max, s.version), 0) + 1;
    this.store.submissions.push({
      id: submissionId,
      recordId: record.id,
      version,
      enteredValue: input.value,
      submittedAt: now,
      status,
      supersedesId: waiting?.id ?? null,
      idempotencyKey: input.idempotencyKey,
      isLate: late,
      priorOutcome: prior,
    });
    if (rule.verification === 'evidence' && input.evidence) {
      this.store.evidence.push({
        id: this.id(),
        submissionId,
        uri: input.evidence.uri,
        mime: input.evidence.mime,
        byteSize: input.evidence.byteSize,
        fingerprint: `${input.evidence.uri}|${input.evidence.byteSize}`,
        uploadedBy: uid,
        purgedAt: null,
      });
    }

    if (late) {
      record.outcome = 'late_pending';
      record.provenance = null;
    } else if (rule.verification === 'evidence') {
      record.outcome = 'pending';
      record.effectiveValue = input.value;
      record.provenance = null;
      record.decidedAt = null;
      record.acknowledgedAt = null;
    } else {
      record.effectiveValue = input.value;
      record.outcome = meetsTarget(rule.comparator, rule.target, input.value) ? 'success' : 'open';
      record.provenance = 'self_reported';
      this.announce(record, 'goal_completed');
    }
    record.revision += 1;

    if (status !== 'accepted') {
      for (const admin of this.store.admins) {
        if (admin.challengeId === ch.id && !admin.revokedAt && admin.userId !== uid) {
          this.notify(
            admin.userId,
            late ? 'late_submission' : 'review_needed',
            { ...this.payload(ch), actorName: this.name(uid), localDate: input.date, participantId: participant.id },
            `review_needed:${submissionId}`,
          );
        }
      }
    }
    this.audit({
      circleId: ch.circleId,
      challengeId: ch.id,
      actorId: uid,
      subjectUserId: uid,
      action: late ? 'checkin.submitted_late' : 'checkin.submitted',
      localDate: input.date,
      after: { version, value: input.value, hasEvidence: rule.verification === 'evidence' },
      visibility: 'restricted',
    });
    return clone(this.day(participant, input.date, uid));
  }

  addReps(uid: string, input: { challengeId: string; date: string; amount: number; idempotencyKey: string }): DayDetail {
    this.requireUser(uid);
    if (!input.idempotencyKey || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 100) fail('VALIDATION', 'Missing request id.');
    const ch = this.visibleChallenge(input.challengeId, uid);
    const participant = this.participantFor(ch, uid);
    this.sync(ch);
    // A retried request can never add reps twice.
    if (this.store.increments.some((i) => i.actorId === uid && i.idempotencyKey === input.idempotencyKey)) return clone(this.day(participant, input.date, uid));
    const habit = HABITS[ch.habitType];
    if (!habit.usesIncrements) fail('VALIDATION', 'This goal isn’t logged in increments.');
    if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > 10_000) fail('VALIDATION', 'Add between 1 and 10,000 at a time.');
    const { record: found, rule, late } = this.gate(ch, participant, input.date);
    if (late) fail('DEADLINE_PASSED');
    if (found && (found.outcome === 'pending' || found.outcome === 'rejected')) fail('REVIEW_PENDING');
    const record = this.ensureRecord(participant, input.date, rule, found);
    const sum = this.store.increments.filter((i) => i.recordId === record.id).reduce((acc, i) => acc + i.amount, 0);
    if (sum + input.amount > habit.maxDailyValue) fail('VALIDATION', 'That’s more than a day can hold.');
    this.store.increments.push({ id: this.id(), recordId: record.id, actorId: uid, amount: input.amount, kind: 'add', idempotencyKey: input.idempotencyKey, createdAt: this.iso() });
    const total = sum + input.amount;
    record.effectiveValue = total;
    if (rule.verification === 'self_report') {
      record.outcome = meetsTarget(rule.comparator, rule.target, total) ? 'success' : 'open';
      record.provenance = 'self_reported';
      this.announce(record, 'goal_completed');
    }
    record.revision += 1;
    return clone(this.day(participant, input.date, uid));
  }

  getEvidenceUrl(uid: string, evidenceId: string): EvidenceUrl {
    this.requireUser(uid);
    const evidence = this.store.evidence.find((e) => e.id === evidenceId);
    const submission = evidence ? this.store.submissions.find((s) => s.id === evidence.submissionId) : undefined;
    const record = submission ? this.store.records.find((r) => r.id === submission.recordId) : undefined;
    const participant = record ? this.store.participants.find((p) => p.id === record.participantId) : undefined;
    const ch = participant ? this.challengeRow(participant.challengeId) : undefined;
    if (!evidence || !record || !participant || !ch) return fail('NOT_FOUND');
    // Only the participant (while still a member) and assigned challenge admins.
    const owner = participant.userId === uid && !!this.role(ch.circleId, uid);
    if (!owner && !this.isChallengeAdmin(ch, uid)) return fail('NOT_FOUND');
    if (evidence.purgedAt) return fail('NOT_FOUND', 'This proof was removed under the retention policy.');
    if (participant.userId !== uid) {
      this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: uid, subjectUserId: participant.userId, action: 'evidence.viewed', localDate: record.localDate, visibility: 'restricted' });
    }
    return { url: evidence.uri, expiresAt: new Date(this.clock.now().getTime() + 120_000).toISOString() };
  }

  /* -------------------------------------------------------------- moderation */

  private reviewContext(uid: string, submissionId: string) {
    const submission = this.store.submissions.find((s) => s.id === submissionId);
    const record = submission ? this.store.records.find((r) => r.id === submission.recordId) : undefined;
    const participant = record ? this.store.participants.find((p) => p.id === record.participantId) : undefined;
    const ch = participant ? this.challengeRow(participant.challengeId) : undefined;
    if (!submission || !record || !participant || !ch || !this.canView(ch, uid)) return fail('NOT_FOUND');
    if (!this.isChallengeAdmin(ch, uid)) return fail('FORBIDDEN');
    const status = this.sync(ch);
    if (status !== 'active' && status !== 'review') return fail('CHALLENGE_CLOSED');
    return { submission, record, participant, ch };
  }

  getReviewQueue(uid: string, challengeId: string): ReviewQueue {
    this.requireUser(uid);
    const ch = this.visibleChallenge(challengeId, uid);
    if (!this.isChallengeAdmin(ch, uid)) fail('FORBIDDEN');
    this.sync(ch);
    const participants = this.store.participants.filter((p) => p.challengeId === ch.id && !p.removedAt);
    const items: ReviewQueue['items'] = [];
    const disputes: ReviewQueue['disputes'] = [];
    for (const p of participants) {
      for (const record of this.store.records.filter((r) => r.participantId === p.id)) {
        for (const s of this.store.submissions.filter((x) => x.recordId === record.id && (x.status === 'pending' || x.status === 'late'))) {
          const evidence = this.store.evidence.find((e) => e.submissionId === s.id);
          items.push({
            submissionId: s.id,
            recordId: record.id,
            recordRevision: record.revision,
            participantId: p.id,
            person: this.person(p.userId),
            date: record.localDate,
            enteredValue: s.enteredValue,
            submittedAt: s.submittedAt,
            kind: s.status === 'late' ? 'late' : 'review',
            evidenceId: evidence?.id ?? null,
            duplicate: evidence ? this.isDuplicateEvidence(evidence.id, ch, record.id) : false,
            own: p.userId === uid,
          });
        }
        for (const d of this.store.disputes.filter((x) => x.recordId === record.id && x.status === 'open')) {
          disputes.push({ disputeId: d.id, recordId: record.id, participantId: p.id, person: this.person(p.userId), date: record.localDate, reason: d.reason, createdAt: d.createdAt });
        }
      }
    }
    items.sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt) || (a.submissionId < b.submissionId ? -1 : 1));
    disputes.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    return clone({ challengeId: ch.id, items, disputes, serverNow: this.iso() });
  }

  reviewSubmission(
    uid: string,
    input: { submissionId: string; decision: 'approve' | 'reject'; correctedValue?: number | null; reason?: string | null; expectedRevision: number },
  ): DayDetail {
    this.requireUser(uid);
    const { submission, record, participant, ch } = this.reviewContext(uid, input.submissionId);
    if (record.revision !== input.expectedRevision) fail('REVISION_CONFLICT');
    if (submission.status !== 'pending') fail('ALREADY_DECIDED');
    const rule = this.rule(record.ruleVersionId);
    const self = participant.userId === uid;
    const now = this.iso();
    const actor = this.name(uid);
    const name = this.name(participant.userId);

    if (input.decision === 'reject') {
      const reason = this.requireReason(input.reason);
      submission.status = 'rejected';
      const before = record.outcome;
      Object.assign(record, { outcome: 'rejected', provenance: null, decidedAt: now, acknowledgedAt: null, revision: record.revision + 1 });
      this.store.reviews.push({ id: this.id(), submissionId: submission.id, reviewerId: uid, decision: 'rejected', correctedValue: null, reason, selfReview: self, reviewedAt: now });
      // Private: the reason reaches the participant and admins, not the group.
      this.audit({
        circleId: ch.circleId,
        challengeId: ch.id,
        actorId: uid,
        subjectUserId: participant.userId,
        action: 'review.rejected',
        localDate: record.localDate,
        before: { outcome: before, value: submission.enteredValue },
        after: { outcome: 'rejected' },
        reason,
        visibility: 'restricted',
      });
      this.notify(participant.userId, 'review_rejected', { ...this.payload(ch), localDate: record.localDate, reason, participantId: participant.id }, `review:${submission.id}`);
    } else if (input.decision === 'approve') {
      const corrected = input.correctedValue != null && input.correctedValue !== submission.enteredValue;
      const value = input.correctedValue ?? submission.enteredValue;
      const reason = corrected ? this.requireReason(input.reason) : (input.reason ?? '').trim() || null;
      if (!isValidDailyValue(ch.habitType, rule.comparator, value)) fail('VALIDATION', 'Enter a valid amount for this goal.');
      // Approving the evidence and meeting the target are separate questions.
      const outcome = evaluateAccepted(rule.comparator, rule.target, value);
      const before = record.outcome;
      submission.status = 'accepted';
      if (HABITS[ch.habitType].usesIncrements) this.reconcileLedger(record, uid, value, `review:${submission.id}`);
      Object.assign(record, {
        effectiveValue: value,
        outcome,
        provenance: self ? 'admin_self_reviewed' : 'evidence_reviewed',
        decidedAt: now,
        acknowledgedAt: null,
        revision: record.revision + 1,
      });
      this.store.reviews.push({ id: this.id(), submissionId: submission.id, reviewerId: uid, decision: 'approved', correctedValue: corrected ? value : null, reason, selfReview: self, reviewedAt: now });
      this.audit({
        circleId: ch.circleId,
        challengeId: ch.id,
        actorId: uid,
        subjectUserId: participant.userId,
        action: 'review.approved',
        localDate: record.localDate,
        before: { outcome: before },
        after: { outcome, value, selfReview: self },
        reason,
        visibility: 'restricted',
      });
      if (corrected) {
        this.audit({
          circleId: ch.circleId,
          challengeId: ch.id,
          actorId: uid,
          subjectUserId: participant.userId,
          action: 'review.value_corrected',
          localDate: record.localDate,
          before: { value: submission.enteredValue },
          after: { value, outcome },
          reason,
        });
        this.systemMessage(ch.circleId, `${actor} corrected ${name}’s result for ${formatDateKey(record.localDate, { weekday: false })}.`, {
          ...this.payload(ch),
          type: 'admin_corrected',
          actorName: actor,
          name,
          userId: participant.userId,
          localDate: record.localDate,
        });
      }
      this.notify(participant.userId, 'review_approved', { ...this.payload(ch), localDate: record.localDate, outcome, corrected, participantId: participant.id }, `review:${submission.id}`);
      this.announce(record, 'checkin_approved');
    } else fail('VALIDATION', 'Choose approve or reject.');
    return clone(this.day(participant, record.localDate, uid));
  }

  acceptLateSubmission(uid: string, input: { submissionId: string; accept: boolean; reason: string }): DayDetail {
    this.requireUser(uid);
    const { submission, record, participant, ch } = this.reviewContext(uid, input.submissionId);
    if (submission.status !== 'late') fail('ALREADY_DECIDED');
    const reason = this.requireReason(input.reason);
    const rule = this.rule(record.ruleVersionId);
    const now = this.iso();
    const self = participant.userId === uid;
    if (!input.accept) {
      submission.status = 'declined';
      Object.assign(record, {
        outcome: submission.priorOutcome === 'rejected' ? 'rejected' : 'open',
        provenance: null,
        decidedAt: now,
        acknowledgedAt: null,
        revision: record.revision + 1,
      });
      this.store.reviews.push({ id: this.id(), submissionId: submission.id, reviewerId: uid, decision: 'late_declined', correctedValue: null, reason, selfReview: self, reviewedAt: now });
      this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: uid, subjectUserId: participant.userId, action: 'late.declined', localDate: record.localDate, reason, visibility: 'restricted' });
      this.notify(participant.userId, 'late_declined', { ...this.payload(ch), localDate: record.localDate, reason, participantId: participant.id }, `late:${submission.id}`);
    } else {
      this.store.reviews.push({ id: this.id(), submissionId: submission.id, reviewerId: uid, decision: 'late_accepted', correctedValue: null, reason, selfReview: self, reviewedAt: now });
      this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: uid, subjectUserId: participant.userId, action: 'late.accepted', localDate: record.localDate, reason });
      if (rule.verification === 'evidence') {
        submission.status = 'pending';
        Object.assign(record, { outcome: 'pending', effectiveValue: submission.enteredValue, provenance: null, decidedAt: null, acknowledgedAt: null, revision: record.revision + 1 });
      } else {
        submission.status = 'accepted';
        if (HABITS[ch.habitType].usesIncrements) this.reconcileLedger(record, uid, submission.enteredValue, `late:${submission.id}`);
        Object.assign(record, {
          effectiveValue: submission.enteredValue,
          outcome: meetsTarget(rule.comparator, rule.target, submission.enteredValue) ? 'success' : 'open',
          provenance: 'self_reported',
          revision: record.revision + 1,
        });
        this.announce(record, 'goal_completed');
      }
      this.notify(participant.userId, 'late_accepted', { ...this.payload(ch), localDate: record.localDate, participantId: participant.id }, `late:${submission.id}`);
    }
    return clone(this.day(participant, record.localDate, uid));
  }

  /** State change, override row and audit event together. Provenance is always admin_adjusted. */
  private applyOverride(record: RecordRow, actorId: string, outcome: 'success' | 'fail', value: number | null | undefined, reason: string): void {
    const participant = this.store.participants.find((p) => p.id === record.participantId)!;
    const ch = this.challengeRow(participant.challengeId)!;
    const rule = this.rule(record.ruleVersionId);
    if (value != null && !isValidDailyValue(ch.habitType, rule.comparator, value)) fail('VALIDATION', 'Enter a valid amount for this goal.');
    const nextValue = value ?? record.effectiveValue;
    const prior = this.dayStatus(record, record.localDate, ch.timezone);
    const priorValue = record.effectiveValue;
    for (const s of this.store.submissions) if (s.recordId === record.id && (s.status === 'pending' || s.status === 'late')) s.status = 'superseded';
    Object.assign(record, {
      outcome,
      effectiveValue: nextValue,
      provenance: 'admin_adjusted',
      decidedAt: this.iso(),
      acknowledgedAt: null,
      successAnnounced: record.successAnnounced || outcome === 'success',
      revision: record.revision + 1,
    });
    const overrideId = this.id();
    this.store.overrides.push({ id: overrideId, recordId: record.id, actorId, priorOutcome: prior, priorValue, newOutcome: outcome, newValue: nextValue, reason, createdAt: this.iso() });
    this.audit({
      circleId: ch.circleId,
      challengeId: ch.id,
      actorId,
      subjectUserId: participant.userId,
      action: 'day.overridden',
      localDate: record.localDate,
      before: { outcome: prior, value: priorValue },
      after: { outcome, value: nextValue },
      reason,
    });
    const actor = this.name(actorId);
    const name = this.name(participant.userId);
    this.systemMessage(ch.circleId, `${actor} adjusted ${name}’s result for ${formatDateKey(record.localDate, { weekday: false })}.`, {
      ...this.payload(ch),
      type: 'admin_corrected',
      actorName: actor,
      name,
      userId: participant.userId,
      localDate: record.localDate,
    });
    this.notify(
      participant.userId,
      'day_overridden',
      { ...this.payload(ch), localDate: record.localDate, outcome, reason, actorName: actor, participantId: participant.id },
      `override:${overrideId}`,
    );
  }

  overrideDay(
    uid: string,
    input: { participantId: string; date: string; outcome: 'success' | 'fail'; value?: number | null; reason: string; expectedRevision: number },
  ): DayDetail {
    this.requireUser(uid);
    const participant = this.store.participants.find((p) => p.id === input.participantId);
    if (!participant) return fail('NOT_FOUND');
    const ch = this.visibleChallenge(participant.challengeId, uid);
    if (!this.isChallengeAdmin(ch, uid)) fail('FORBIDDEN');
    const status = this.sync(ch);
    if (status !== 'active' && status !== 'review') fail('CHALLENGE_CLOSED');
    if (participant.removedAt) fail('VALIDATION', 'This player was removed from the challenge.');
    if (input.outcome !== 'success' && input.outcome !== 'fail') fail('VALIDATION', 'Choose success or not counted.');
    const reason = this.requireReason(input.reason);
    if (!isDateKey(input.date) || input.date < ch.startDate || input.date > ch.endDate) fail('VALIDATION', 'That date isn’t part of this challenge.');
    if (this.clock.now().getTime() < startOfDay(input.date, ch.timezone).getTime()) fail('DAY_NOT_STARTED');
    const existing = this.store.records.find((r) => r.participantId === participant.id && r.localDate === input.date);
    if (existing ? existing.revision !== input.expectedRevision : (input.expectedRevision ?? 0) !== 0) fail('REVISION_CONFLICT');
    const record = this.ensureRecord(participant, input.date, this.ruleFor(ch, input.date), existing);
    this.applyOverride(record, uid, input.outcome, input.value, reason);
    return clone(this.day(participant, input.date, uid));
  }

  openDispute(uid: string, input: { recordId: string; reason: string }): DayDetail {
    this.requireUser(uid);
    const record = this.store.records.find((r) => r.id === input.recordId);
    const participant = record ? this.store.participants.find((p) => p.id === record.participantId) : undefined;
    const ch = participant ? this.challengeRow(participant.challengeId) : undefined;
    if (!record || !participant || !ch || !this.canView(ch, uid)) return fail('NOT_FOUND');
    // Only the participant can dispute their own day.
    if (participant.userId !== uid || participant.removedAt) fail('FORBIDDEN');
    const status = this.sync(ch);
    if (status !== 'active' && status !== 'review') fail('CHALLENGE_CLOSED');
    const disputes = this.store.disputes.filter((d) => d.recordId === record.id);
    if (disputes.some((d) => d.status === 'open')) fail('DISPUTE_OPEN');
    if (!record.decidedAt) fail('VALIDATION', 'Only an admin decision can be disputed.');
    if (disputes.some((d) => Date.parse(d.createdAt) >= Date.parse(record.decidedAt!))) fail('ALREADY_DECIDED');
    if (!decisionWindow(record, this.clock.now()).open) fail('DISPUTE_WINDOW_CLOSED');
    const reason = this.requireReason(input.reason);
    const id = this.id();
    this.store.disputes.push({ id, recordId: record.id, raisedBy: uid, reason, status: 'open', resolverId: null, resolution: null, resolvedAt: null, createdAt: this.iso() });
    this.audit({ circleId: ch.circleId, challengeId: ch.id, actorId: uid, subjectUserId: uid, action: 'dispute.opened', localDate: record.localDate, reason, visibility: 'restricted' });
    for (const admin of this.store.admins) {
      if (admin.challengeId === ch.id && !admin.revokedAt && admin.userId !== uid) {
        this.notify(admin.userId, 'dispute_opened', { ...this.payload(ch), actorName: this.name(uid), localDate: record.localDate, participantId: participant.id }, `dispute:${id}`);
      }
    }
    return clone(this.day(participant, record.localDate, uid));
  }

  resolveDispute(
    uid: string,
    input: { disputeId: string; upheld: boolean; resolution: string; override?: { outcome: 'success' | 'fail'; value?: number | null } | null },
  ): DayDetail {
    this.requireUser(uid);
    const dispute = this.store.disputes.find((d) => d.id === input.disputeId);
    const record = dispute ? this.store.records.find((r) => r.id === dispute.recordId) : undefined;
    const participant = record ? this.store.participants.find((p) => p.id === record.participantId) : undefined;
    const ch = participant ? this.challengeRow(participant.challengeId) : undefined;
    if (!dispute || !record || !participant || !ch || !this.canView(ch, uid)) return fail('NOT_FOUND');
    if (!this.isChallengeAdmin(ch, uid)) fail('FORBIDDEN');
    const status = this.sync(ch);
    if (status !== 'active' && status !== 'review') fail('CHALLENGE_CLOSED');
    if (dispute.status !== 'open') fail('ALREADY_DECIDED');
    const resolution = this.requireReason(input.resolution);
    if (input.override && input.override.outcome !== 'success' && input.override.outcome !== 'fail') fail('VALIDATION', 'Choose success or not counted.');
    Object.assign(dispute, { status: input.upheld ? 'upheld' : 'denied', resolverId: uid, resolution, resolvedAt: this.iso() });
    this.audit({
      circleId: ch.circleId,
      challengeId: ch.id,
      actorId: uid,
      subjectUserId: participant.userId,
      action: 'dispute.resolved',
      localDate: record.localDate,
      after: { status: dispute.status },
      reason: resolution,
      visibility: 'restricted',
    });
    if (input.override) this.applyOverride(record, uid, input.override.outcome, input.override.value, resolution);
    this.notify(
      participant.userId,
      'dispute_resolved',
      { ...this.payload(ch), localDate: record.localDate, upheld: input.upheld, resolution, participantId: participant.id },
      `dispute_resolved:${dispute.id}`,
    );
    return clone(this.day(participant, record.localDate, uid));
  }

  acknowledgeDecision(uid: string, recordId: string): DayDetail {
    this.requireUser(uid);
    const record = this.store.records.find((r) => r.id === recordId);
    const participant = record ? this.store.participants.find((p) => p.id === record.participantId) : undefined;
    const ch = participant ? this.challengeRow(participant.challengeId) : undefined;
    if (!record || !participant || !ch || !this.canView(ch, uid)) return fail('NOT_FOUND');
    if (participant.userId !== uid) fail('FORBIDDEN');
    if (ch.status === 'completed' || ch.status === 'canceled') fail('CHALLENGE_CLOSED');
    if (record.decidedAt && (!record.acknowledgedAt || Date.parse(record.acknowledgedAt) < Date.parse(record.decidedAt))) {
      // Never earlier than the decision it acknowledges, even on a clock that was just set.
      record.acknowledgedAt = new Date(Math.max(this.clock.now().getTime(), Date.parse(record.decidedAt))).toISOString();
    }
    return clone(this.day(participant, record.localDate, uid));
  }

  listAudit(uid: string, input: { challengeId?: string; circleId?: string; before?: string | null; limit?: number }): Page<AuditEventView> {
    this.requireUser(uid);
    let circleId = input.circleId;
    if (input.challengeId) circleId = this.visibleChallenge(input.challengeId, uid).circleId;
    else if (circleId) {
      if (!this.role(circleId, uid)) fail('NOT_FOUND');
    } else fail('VALIDATION', 'Choose a Circle or a challenge.');
    const rows = this.store.audit.filter((a) => {
      if (a.circleId !== circleId) return false;
      if (input.challengeId && a.challengeId !== input.challengeId) return false;
      const ch = a.challengeId ? this.challengeRow(a.challengeId) : undefined;
      if (a.challengeId && (!ch || !this.canView(ch, uid))) return false;
      return a.visibility === 'members' || a.subjectUserId === uid || (ch ? this.isChallengeAdmin(ch, uid) : this.isCircleAdmin(a.circleId, uid));
    });
    return clone(
      this.page(rows, input.before, input.limit, (a) => ({
        id: a.id,
        action: a.action,
        actor: this.personOrNull(a.actorId),
        subject: this.personOrNull(a.subjectUserId),
        circleId: a.circleId,
        challengeId: a.challengeId,
        localDate: a.localDate,
        before: a.before,
        after: a.after,
        reason: a.reason,
        createdAt: a.createdAt,
      })),
    );
  }

  /* ------------------------------------------------------------------- chat */

  listMessages(uid: string, input: { circleId: string; before?: string | null; limit?: number }): Page<MessageView> {
    this.requireUser(uid);
    if (!this.role(input.circleId, uid)) fail('NOT_FOUND');
    const rows = this.store.messages.filter((m) => m.circleId === input.circleId && !m.deletedAt);
    return clone(this.page(rows, input.before, input.limit, (m) => this.messageView(m, uid)));
  }

  sendMessage(uid: string, input: { circleId: string; text: string; clientId: string }): MessageView {
    this.requireUser(uid);
    if (!this.role(input.circleId, uid)) fail('NOT_FOUND');
    if (!input.clientId || input.clientId.length < 8 || input.clientId.length > 100) fail('VALIDATION', 'Missing message id.');
    const text = input.text.trim();
    if (text.length < 1) fail('VALIDATION', 'Write a message first.');
    if (text.length > LIMITS.maxMessageLength) fail('VALIDATION', 'Messages can be up to 2,000 characters.');
    // Retried sends are deduplicated by the client's message id.
    const existing = this.store.messages.find((m) => m.authorId === uid && m.clientId === input.clientId);
    if (existing) return clone(this.messageView(existing, uid));
    const message: MessageRow = { id: this.id(), seq: this.nextSeq(), circleId: input.circleId, authorId: uid, text, type: 'user', event: null, clientId: input.clientId, createdAt: this.iso(), deletedAt: null };
    this.store.messages.push(message);
    const circle = this.store.circles.find((c) => c.id === input.circleId)!;
    for (const m of this.store.members) {
      if (m.circleId === input.circleId && !m.removedAt && m.userId !== uid) {
        const name = this.store.profiles.find((p) => p.id === m.userId)?.displayName.trim() ?? '';
        if (name && text.toLowerCase().includes(`@${name.toLowerCase()}`)) {
          this.notify(m.userId, 'mention', { circleId: circle.id, circleName: circle.name, actorName: this.name(uid) }, `mention:${message.id}`);
        }
      }
    }
    this.emit(input.circleId);
    return clone(this.messageView(message, uid));
  }

  toggleReaction(uid: string, input: { messageId: string; emoji: string }): MessageView {
    this.requireUser(uid);
    const message = this.store.messages.find((m) => m.id === input.messageId && !m.deletedAt);
    if (!message || !this.role(message.circleId, uid)) return fail('NOT_FOUND');
    if (!(REACTION_EMOJI as readonly string[]).includes(input.emoji)) fail('VALIDATION', 'That reaction isn’t available.');
    const index = this.store.reactions.findIndex((r) => r.messageId === message.id && r.userId === uid && r.emoji === input.emoji);
    if (index >= 0) this.store.reactions.splice(index, 1);
    else this.store.reactions.push({ messageId: message.id, userId: uid, emoji: input.emoji, seq: this.nextSeq() });
    this.emit(message.circleId);
    return clone(this.messageView(message, uid));
  }

  /* ---------------------------------------------------------- notifications */

  listNotifications(uid: string, input: { before?: string | null; limit?: number }): Page<NotificationView> {
    this.requireUser(uid);
    const rows = this.store.notifications.filter((n) => n.recipientId === uid);
    return clone(this.page(rows, input.before, input.limit, (n) => ({ id: n.id, type: n.type, payload: n.payload, createdAt: n.createdAt, readAt: n.readAt })));
  }

  acknowledgeNotification(uid: string, notificationId: string): void {
    this.requireUser(uid);
    const notification = this.store.notifications.find((n) => n.id === notificationId && n.recipientId === uid);
    if (!notification) return fail('NOT_FOUND');
    notification.readAt ??= this.iso();
  }

  acknowledgeAllNotifications(uid: string): void {
    this.requireUser(uid);
    for (const n of this.store.notifications) if (n.recipientId === uid && !n.readAt) n.readAt = this.iso();
  }

  /* -------------------------------------------------------------- reminders */

  listReminders(uid: string): ReminderPreference[] {
    this.requireUser(uid);
    return clone(this.store.reminders.filter((r) => r.userId === uid).map((r) => ({ challengeId: r.challengeId, enabled: r.enabled, localTime: r.localTime })));
  }

  setReminder(uid: string, input: ReminderPreference): ReminderPreference {
    this.requireUser(uid);
    const ch = this.visibleChallenge(input.challengeId, uid);
    if (!this.store.participants.some((p) => p.challengeId === ch.id && p.userId === uid && !p.removedAt)) fail('FORBIDDEN', 'Reminders are for challenges you’re playing in.');
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(input.localTime)) fail('VALIDATION', 'Choose a reminder time.');
    const existing = this.store.reminders.find((r) => r.userId === uid && r.challengeId === ch.id);
    if (existing) Object.assign(existing, { enabled: input.enabled, localTime: input.localTime });
    else this.store.reminders.push({ userId: uid, challengeId: ch.id, enabled: input.enabled, localTime: input.localTime });
    return { challengeId: ch.id, enabled: input.enabled, localTime: input.localTime };
  }

  /** Demo helper used by fixtures and the clock control. */
  deadlineFor(date: string, timezone: string): Date {
    return dayWindow(date, timezone).deadlineAt;
  }
}
