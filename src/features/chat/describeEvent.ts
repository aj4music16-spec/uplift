import {
  CircleCheck,
  CircleX,
  FileText,
  Flag,
  LogOut,
  Megaphone,
  PartyPopper,
  Play,
  SlidersHorizontal,
  UserPlus,
  type LucideIcon,
} from '@/components/icons';
import { formatDateKey } from '@/domain/format';

/**
 * Human text for a system message, built only from its safe structured event.
 * Falls back to the server-written text for anything unknown. Never includes
 * evidence, values or rejection reasons.
 */
export interface EventCopy {
  text: string;
  icon: LucideIcon;
}

function str(event: Record<string, unknown>, key: string): string | null {
  const value = event[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function day(event: Record<string, unknown>): string | null {
  const date = str(event, 'localDate');
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? formatDateKey(date, { weekday: false }) : null;
}

export function describeEvent(event: Record<string, unknown> | null, fallback: string): EventCopy {
  if (!event) return { text: fallback, icon: Megaphone };
  const name = str(event, 'name') ?? 'Someone';
  const actor = str(event, 'actorName') ?? 'An admin';
  const challenge = str(event, 'challengeName') ?? 'the challenge';
  const date = day(event);
  const privateDetail = str(event, 'habitType') === 'prayer';
  switch (str(event, 'type')) {
    case 'member_joined':
      return { text: `${name} joined the Circle.`, icon: UserPlus };
    case 'member_left':
      return { text: `${name} left the Circle.`, icon: LogOut };
    case 'challenge_published':
      return { text: `${actor} published ${challenge}. Review the rules to join.`, icon: Megaphone };
    case 'participant_joined':
      return { text: `${name} is in for ${challenge}.`, icon: UserPlus };
    case 'goal_completed':
    case 'checkin_approved':
      // Prayer is announced without any detail.
      if (privateDetail) return { text: `${name} completed the daily goal.`, icon: CircleCheck };
      return { text: date ? `${name} hit the goal for ${date} in ${challenge}.` : `${name} hit the daily goal in ${challenge}.`, icon: CircleCheck };
    case 'admin_corrected':
      return { text: date ? `${actor} adjusted ${name}’s result for ${date}. Admin adjusted.` : `${actor} adjusted ${name}’s result. Admin adjusted.`, icon: SlidersHorizontal };
    case 'rule_change_proposed':
      return { text: `${actor} proposed a rule change for ${challenge}. It needs everyone’s OK.`, icon: FileText };
    case 'rule_change_activated':
      return { text: `New rules for ${challenge} are in effect.`, icon: FileText };
    case 'rule_change_declined':
      return { text: `The proposed rule change for ${challenge} was declined. The original rules stay.`, icon: FileText };
    case 'challenge_ended':
      return { text: `${challenge} has ended. Results are final once reviews are done.`, icon: Flag };
    case 'challenge_finished':
      return { text: `${challenge} is complete. The results are in.`, icon: PartyPopper };
    case 'challenge_canceled':
      return { text: `${challenge} was canceled.`, icon: CircleX };
    case 'challenge_started':
      return { text: `${challenge} has started.`, icon: Play };
    default:
      return { text: fallback, icon: Megaphone };
  }
}
