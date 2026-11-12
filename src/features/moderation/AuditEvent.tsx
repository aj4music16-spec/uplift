import { View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { StatusBadge } from '@/components/Badges';
import { Eye, Flag, History, ShieldCheck, SlidersHorizontal } from '@/components/icons';
import { Text } from '@/components/Text';
import type { AuditEventView, Person } from '@/data/types';
import { diffRules, formatDateKey, formatValue, verificationLabel, type Comparator, type HabitType, type Rules } from '@/domain';
import { formatInstant, outcomeWord } from '@/features/checkins/logic';
import { colors, space } from '@/theme/tokens';

export interface AuditContext {
  viewerId: string | null;
  habitType: HabitType;
  comparator: Comparator;
  unit: string;
  timeZone: string;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRules(value: unknown): value is Rules {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.target === 'number' && typeof v.comparator === 'string' && typeof v.startDate === 'string';
}

function name(person: Person | null, ctx: AuditContext, fallback = 'Uplift'): string {
  if (!person) return fallback;
  if (person.userId === ctx.viewerId) return 'You';
  return person.deleted ? 'A deleted member' : person.displayName;
}

/** "Ben’s", "your" (after the actor), or "their own" when actor and subject are the same. */
function possessive(subject: Person | null, actor: Person | null, ctx: AuditContext): string {
  if (!subject) return 'a';
  if (subject.userId === ctx.viewerId) return 'your';
  if (actor && subject.userId === actor.userId) return 'their own';
  return `${subject.deleted ? 'a deleted member' : subject.displayName}’s`;
}

function describeRules(before: Rules, after: Rules, ctx: AuditContext): string {
  const fields = diffRules(before, after);
  const fmt = (r: Rules, v: number) => formatValue(ctx.habitType, r.comparator, ctx.unit, v);
  const parts = fields.map((field) => {
    switch (field) {
      case 'target':
        return `goal ${fmt(before, before.target)} → ${fmt(after, after.target)}`;
      case 'requiredDays':
        return `required days ${before.requiredDays} → ${after.requiredDays}`;
      case 'verification':
        return `${verificationLabel(ctx.habitType, before.verification)} → ${verificationLabel(ctx.habitType, after.verification)}`;
      case 'startDate':
        return `start ${formatDateKey(before.startDate)} → ${formatDateKey(after.startDate)}`;
      case 'endDate':
        return `end ${formatDateKey(before.endDate)} → ${formatDateKey(after.endDate)}`;
      default:
        return String(field);
    }
  });
  return parts.length > 0 ? `: ${parts.join(', ')}` : '';
}

/** A plain sentence for one audit event. */
export function auditSentence(event: AuditEventView, ctx: AuditContext): string {
  const a = name(event.actor, ctx);
  const s = event.subject ? name(event.subject, ctx) : 'someone';
  const sPoss = possessive(event.subject, event.actor, ctx);
  const on = event.localDate ? ` for ${formatDateKey(event.localDate, { weekday: false })}` : '';
  const val = (v: unknown) => {
    const n = num(v);
    return n == null ? '' : ` (${formatValue(ctx.habitType, ctx.comparator, ctx.unit, n)})`;
  };
  const before = event.before ?? {};
  const after = event.after ?? {};

  switch (event.action) {
    case 'day.overridden':
      return `${a} adjusted ${sPoss} result${on}: ${outcomeWord(str(before.outcome))}${val(before.value)} → ${outcomeWord(str(after.outcome))}${val(after.value)}`;
    case 'review.value_corrected':
      return `${a} corrected ${sPoss} value${on}:${val(before.value)} →${val(after.value)}, ${outcomeWord(str(after.outcome)).toLowerCase()}`;
    case 'review.approved':
      return `${a} approved ${sPoss} proof${on} → ${outcomeWord(str(after.outcome))}${val(after.value)}`;
    case 'review.rejected':
      return `${a} rejected ${sPoss} proof${on}`;
    case 'late.accepted':
      return `${a} accepted ${sPoss} late submission${on}`;
    case 'late.declined':
      return `${a} declined ${sPoss} late submission${on}`;
    case 'checkin.submitted':
      return `${s} sent a check-in${on}${val(after.value)}`;
    case 'checkin.submitted_late':
      return `${s} sent a late check-in${on}${val(after.value)}`;
    case 'rules.proposed':
      return `${a} proposed new rules${isRules(before) && isRules(after) ? describeRules(before, after, ctx) : ''}`;
    case 'rules.activated':
      return `New rules took effect${event.localDate ? ` from ${formatDateKey(event.localDate, { weekday: false })}` : ''}${isRules(before) && isRules(after) ? describeRules(before, after, ctx) : ''}`;
    case 'rules.declined':
      return `${a} declined the proposed rules, so the current rules stay`;
    case 'rules.withdrawn':
      return `${a} withdrew the proposed rules`;
    case 'participant.joined':
      return `${s} joined the challenge`;
    case 'participant.removed':
      return `${a} removed ${s === 'You' ? 'you' : s} from the challenge`;
    case 'admin.assigned':
      return `${a} made ${s === 'You' ? 'you' : s} a challenge admin`;
    case 'admin.revoked':
      return `${a} removed ${s === 'You' ? 'you' : s} as a challenge admin`;
    case 'challenge.published':
      return `${a} published the challenge`;
    case 'challenge.started':
      return 'The challenge started';
    case 'challenge.ended':
      return 'The last day ended; results are in review';
    case 'challenge.completed':
      return `${a} finalized the results`;
    case 'challenge.canceled':
      return `${a} canceled the challenge`;
    case 'challenge.details_updated':
      return `${a} updated the name or description${str(after.name) && after.name !== before.name ? `: “${String(before.name)}” → “${String(after.name)}”` : ''}`;
    case 'challenge.rematch_created':
      return `${a} started a rematch`;
    case 'reward_preview.set':
      return `${a} changed the demo reward preview (no money collected)`;
    case 'evidence.viewed':
      return `${a} viewed ${sPoss} proof${on}`;
    case 'dispute.opened':
      return `${s} disputed the decision${on}`;
    case 'dispute.resolved':
      return `${a} ${str(after.status) === 'upheld' ? 'upheld' : 'denied'} ${sPoss} dispute${on}`;
    default:
      return `${a}: ${event.action.replace(/[._]/g, ' ')}${on}`;
  }
}

function ActionIcon({ action }: { action: string }) {
  const props = { size: 17, color: colors.ink, strokeWidth: 2.4 };
  if (action === 'day.overridden' || action === 'review.value_corrected') return <SlidersHorizontal {...props} />;
  if (action.startsWith('review.') || action.startsWith('late.')) return <ShieldCheck {...props} />;
  if (action === 'evidence.viewed') return <Eye {...props} />;
  if (action.startsWith('dispute.')) return <Flag {...props} />;
  return <History {...props} />;
}

/** One row of the change history: who did what, why, and when. */
export function AuditEvent({ event, context }: { event: AuditEventView; context: AuditContext }) {
  const sentence = auditSentence(event, context);
  const adjusted = event.action === 'day.overridden';
  return (
    <View style={{ flexDirection: 'row', gap: space.md, paddingVertical: space.md, minHeight: 56 }} accessible accessibilityLabel={`${sentence}.${event.reason ? ` Reason: ${event.reason}.` : ''} ${formatInstant(event.createdAt, context.timeZone)}`}>
      {event.actor ? (
        <Avatar avatar={event.actor.avatar} ghost={event.actor.deleted} size={36} name="" />
      ) : (
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <ActionIcon action={event.action} />
        </View>
      )}
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="calloutStrong">{sentence}</Text>
        {adjusted ? <StatusBadge label="Admin adjusted" icon={SlidersHorizontal} /> : null}
        {event.action === 'review.approved' && event.after?.selfReview === true ? <StatusBadge label="Admin self-reviewed" tone="warning" icon={ShieldCheck} /> : null}
        {event.reason ? (
          <Text variant="callout" color="textSecondary">
            “{event.reason}”
          </Text>
        ) : null}
        <Text variant="caption" color="textSecondary">
          {formatInstant(event.createdAt, context.timeZone)}
        </Text>
      </View>
    </View>
  );
}
