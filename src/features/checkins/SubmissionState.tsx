import { View } from 'react-native';

import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Hourglass,
  Minus,
  SlidersHorizontal,
  type LucideIcon,
} from '@/components/icons';
import { Text } from '@/components/Text';
import type { DayDetail } from '@/data/types';
import { formatValue, provenanceLabel, shortGoal } from '@/domain';
import { colors, radius, space } from '@/theme/tokens';

import { deadlineLabel } from './logic';

type Tone = 'positive' | 'warning' | 'danger' | 'neutral' | 'info';

export interface SubmissionCopy {
  label: string;
  explanation: string | null;
  tone: Tone;
  icon: LucideIcon;
}

const TONE: Record<Tone, { bg: string; fg: 'positive' | 'warning' | 'danger' | 'textSecondary' | 'info' }> = {
  positive: { bg: colors.positiveSoft, fg: 'positive' },
  warning: { bg: colors.warningSoft, fg: 'warning' },
  danger: { bg: colors.dangerSoft, fg: 'danger' },
  neutral: { bg: colors.surfaceStrong, fg: 'textSecondary' },
  info: { bg: colors.infoSoft, fg: 'info' },
};

/** The latest rejection reason, shown only to the participant and admins (the DTO is only served to them). */
export function latestRejection(day: DayDetail): string | null {
  for (const submission of day.submissions) {
    const review = submission.reviews.find((r) => r.decision === 'rejected' || r.decision === 'late_declined');
    if (review) return review.reason;
  }
  return null;
}

/**
 * Status, provenance and value of a day in words. Approving proof and meeting
 * the target are separate: a verified over-limit day reads "Not met · Screenshot verified".
 */
export function describeSubmission(day: DayDetail): SubmissionCopy {
  const { rule, habitType, metricUnit } = day;
  const value = day.record?.effectiveValue ?? null;
  const fmt = (v: number) => formatValue(habitType, rule.comparator, metricUnit, v);
  const provenance = provenanceLabel(day.record?.provenance, habitType);
  const override = day.overrides[0];
  const adjusted = day.record?.provenance === 'admin_adjusted';
  const target = fmt(rule.target);
  switch (day.status) {
    case 'pending':
      return {
        label: 'Awaiting review — doesn’t count yet',
        explanation: `${value != null ? `You entered ${fmt(value)}. ` : ''}An admin checks the proof; the day only counts once it’s reviewed.`,
        tone: 'warning',
        icon: Clock,
      };
    case 'late_pending':
      return { label: 'Late — waiting for the admin', explanation: 'Sent after the deadline. It only counts if the admin accepts it.', tone: 'warning', icon: Hourglass };
    case 'success':
      return {
        label: `Completed${provenance ? ` · ${provenance}` : ''}`,
        explanation: adjusted
          ? `Set by ${override?.actor.displayName ?? 'an admin'}${override ? `: “${override.reason}”` : ''}`
          : value != null && rule.comparator !== 'bool'
            ? `${fmt(value)} — goal: ${shortGoal(habitType, rule.comparator, rule.target, metricUnit)}`
            : null,
        tone: 'positive',
        icon: adjusted ? SlidersHorizontal : CircleCheck,
      };
    case 'fail': {
      let why: string | null = null;
      if (adjusted) why = `Set by ${override?.actor.displayName ?? 'an admin'}${override ? `: “${override.reason}”` : ''}`;
      else if (value != null && rule.comparator === 'lte') why = `${fmt(value)} is over the ${target} limit`;
      else if (value != null && rule.comparator === 'gte') why = `${fmt(value)} is under the ${target} goal`;
      else if (rule.comparator === 'bool') why = 'Checked in as “no”.';
      return {
        label: `Not met${provenance ? ` · ${provenance}` : ''}${!adjusted && why && rule.comparator !== 'bool' ? ` — ${why}` : ''}`,
        explanation: adjusted || rule.comparator === 'bool' ? why : null,
        tone: 'neutral',
        icon: adjusted ? SlidersHorizontal : CircleX,
      };
    }
    case 'rejected': {
      const reason = latestRejection(day);
      return {
        label: 'Proof rejected',
        explanation: reason ? `Reason: ${reason}` : 'The admin rejected this proof. You can send a new version.',
        tone: 'danger',
        icon: CircleAlert,
      };
    }
    case 'missed':
      return { label: 'Missed', explanation: 'No counted check-in before the deadline.', tone: 'neutral', icon: Minus };
    case 'due':
      return { label: 'Check-in due', explanation: deadlineLabel(day.date, day.timezone), tone: 'info', icon: Clock };
    case 'open':
      return {
        label: 'In progress',
        explanation:
          value != null && rule.comparator !== 'bool'
            ? `${fmt(value)} so far${provenance ? ` · ${provenance}` : ''}. ${deadlineLabel(day.date, day.timezone)}`
            : habitType === 'screen_time'
              ? 'The day is still going. Proof opens after midnight.'
              : deadlineLabel(day.date, day.timezone),
        tone: 'neutral',
        icon: CircleDashed,
      };
    case 'upcoming':
    default:
      return { label: 'Upcoming', explanation: 'This day hasn’t started yet.', tone: 'neutral', icon: CircleDashed };
  }
}

/** Compact status line for a day: icon + label + explanation (never color alone). */
export function SubmissionState({ day, compact = false }: { day: DayDetail; compact?: boolean }) {
  const copy = describeSubmission(day);
  const tone = TONE[copy.tone];
  const Icon = copy.icon;
  return (
    <View
      accessible
      accessibilityLabel={`${copy.label}${copy.explanation ? `. ${copy.explanation}` : ''}`}
      testID="submission-state"
      style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: compact ? 0 : space.lg, borderRadius: radius.lg, backgroundColor: compact ? undefined : colors.surface }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: tone.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={18} color={colors[tone.fg]} strokeWidth={2.6} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{copy.label}</Text>
        {copy.explanation ? (
          <Text variant="caption" color="textSecondary">
            {copy.explanation}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
