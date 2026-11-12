import {
  Bell,
  CircleCheck,
  CircleX,
  Crown,
  FileText,
  Flag,
  Hourglass,
  Mail,
  MessageCircle,
  PartyPopper,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from '@/components/icons';
import type { NotificationView } from '@/data/types';
import { formatDateKey } from '@/domain/format';

/** Ends a free-text reason with exactly one period. */
const sentence = (text: string): string => (/[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

export interface NotificationCopy {
  title: string;
  body: string | null;
  icon: LucideIcon;
  /** Where tapping goes. Null when there is nothing left to open (for example after removal). */
  href: string | null;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Human copy for an in-app notification, built from its payload. These are
 * the recipient's own notifications, so a rejection reason may be shown.
 * Nothing here says a push notification was sent or delivered.
 */
export function describeNotification(n: NotificationView): NotificationCopy {
  const p = n.payload;
  const actor = str(p, 'actorName') ?? 'Someone';
  const challenge = str(p, 'challengeName') ?? 'a challenge';
  const circle = str(p, 'circleName') ?? 'your Circle';
  const challengeId = str(p, 'challengeId');
  const circleId = str(p, 'circleId');
  const localDate = str(p, 'localDate');
  const reason = str(p, 'reason');
  const date = localDate && /^\d{4}-\d{2}-\d{2}$/.test(localDate) ? formatDateKey(localDate, { weekday: false }) : 'a day';

  const challengeHref = challengeId ? `/challenge/${challengeId}` : null;
  const rulesHref = challengeId ? `/challenge/${challengeId}/rules` : null;
  const reviewHref = challengeId ? `/challenge/${challengeId}/review` : null;
  const dayHref = challengeId ? (localDate ? `/challenge/${challengeId}/day?date=${localDate}` : `/challenge/${challengeId}`) : null;
  const resultsHref = challengeId ? `/challenge/${challengeId}/results` : null;
  const chatHref = circleId ? `/circle/${circleId}?tab=chat` : null;
  const circleHref = circleId ? `/circle/${circleId}` : null;

  switch (n.type) {
    case 'challenge_invite':
      return { title: `${actor === 'Someone' ? 'You’re invited to' : `${actor} invited you to`} ${challenge}`, body: `In ${circle}. Review the rules to join.`, icon: Mail, href: challengeHref };
    case 'member_joined':
      return { title: `${actor} joined ${circle}`, body: 'Say hello in the chat.', icon: UserPlus, href: chatHref };
    case 'role_changed': {
      const role = str(p, 'role');
      return { title: `You’re now ${role === 'admin' ? 'an admin' : role === 'owner' ? 'the owner' : 'a member'} of ${circle}`, body: null, icon: ShieldCheck, href: circleHref };
    }
    case 'ownership_received':
      return { title: `${actor} made you the owner of ${circle}`, body: 'You now manage its members and admins.', icon: Crown, href: circleHref };
    case 'removed_from_circle':
      return { title: `You were removed from ${circle}`, body: reason ? `Reason: ${reason}` : null, icon: UserMinus, href: null };
    case 'removed_from_challenge':
      return { title: `You were removed from ${challenge}`, body: reason ? `Reason: ${reason}` : null, icon: UserMinus, href: null };
    case 'review_needed':
      return { title: `${actor} sent proof for ${date}`, body: `${challenge} · waiting for your review`, icon: Hourglass, href: reviewHref };
    case 'late_submission':
      return { title: `${actor} sent a late submission for ${date}`, body: `${challenge} · accept or decline it`, icon: Hourglass, href: reviewHref };
    case 'review_approved': {
      const success = str(p, 'outcome') === 'success';
      const corrected = p.corrected === true;
      const counted = success
        ? 'It counts as a successful day.'
        : 'Your proof was accepted, but the value didn’t meet the target, so the day doesn’t count.';
      return {
        title: `Proof approved for ${date}`,
        body: `${challenge}. ${corrected ? 'The admin corrected the value. ' : ''}${counted}`,
        icon: CircleCheck,
        href: dayHref,
      };
    }
    case 'review_rejected':
      return {
        title: `Proof not accepted for ${date}`,
        body: `${challenge}.${reason ? ` Reason: ${sentence(reason)}` : ''} Only you and the challenge admins see this.`,
        icon: CircleX,
        href: dayHref,
      };
    case 'late_accepted':
      return { title: `Late submission accepted for ${date}`, body: challenge, icon: CircleCheck, href: dayHref };
    case 'late_declined':
      return { title: `Late submission declined for ${date}`, body: `${challenge}.${reason ? ` Reason: ${reason}` : ''}`, icon: CircleX, href: dayHref };
    case 'day_overridden': {
      const success = str(p, 'outcome') === 'success';
      return {
        title: `${actor === 'Someone' ? 'An admin' : actor} adjusted your result for ${date}`,
        body: `Admin adjusted to ${success ? 'a successful day' : 'not successful'}.${reason ? ` Reason: ${reason}` : ''}`,
        icon: SlidersHorizontal,
        href: dayHref,
      };
    }
    case 'dispute_opened':
      return { title: `${actor} disputed a decision for ${date}`, body: `${challenge} · needs your resolution`, icon: Scale, href: reviewHref };
    case 'dispute_resolved': {
      const resolution = str(p, 'resolution');
      return {
        title: `Your dispute for ${date} was ${p.upheld === true ? 'upheld' : 'not upheld'}`,
        body: `${challenge}.${resolution ? ` ${resolution}` : ''}`,
        icon: Scale,
        href: dayHref,
      };
    }
    case 'rule_change_proposed':
      return {
        title: `${actor} proposed new rules for ${challenge}`,
        body: `${reason ? `Reason: ${sentence(reason)} ` : ''}Everyone has to accept before anything changes.`,
        icon: FileText,
        href: rulesHref,
      };
    case 'rule_change_activated': {
      const effective = str(p, 'effectiveDate');
      return {
        title: `New rules for ${challenge} are in effect`,
        body: effective && /^\d{4}-\d{2}-\d{2}$/.test(effective) ? `They apply from ${formatDateKey(effective)}. Earlier days keep their rules.` : 'Earlier days keep their rules.',
        icon: FileText,
        href: challengeHref,
      };
    }
    case 'rule_change_declined':
      return { title: `The rule change for ${challenge} was declined`, body: 'The original rules stay.', icon: FileText, href: challengeHref };
    case 'challenge_canceled':
      return { title: `${challenge} was canceled`, body: reason ? `Reason: ${reason}` : null, icon: CircleX, href: challengeHref };
    case 'challenge_completed':
      return { title: `${challenge} is complete`, body: 'See the final results.', icon: PartyPopper, href: resultsHref };
    case 'admin_assigned':
      return { title: `${actor} made you an admin of ${challenge}`, body: 'You can now review proof and correct results.', icon: ShieldCheck, href: challengeHref };
    case 'finalize_reminder':
      return { title: `${challenge} has ended`, body: 'Resolve the remaining reviews so the results can be finalized.', icon: Flag, href: reviewHref };
    case 'mention':
      return { title: `${actor} mentioned you in ${circle}`, body: 'Open the chat to read it.', icon: MessageCircle, href: chatHref };
    default:
      return { title: challengeId ? challenge : circleId ? circle : 'Update', body: null, icon: Bell, href: challengeHref ?? circleHref };
  }
}
