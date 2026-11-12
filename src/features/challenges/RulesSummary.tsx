import { View } from 'react-native';

import { Divider } from '@/components/Card';
import { Text } from '@/components/Text';
import { formatDateRange, timeZoneCity } from '@/domain/format';
import { describeGoal, verificationLabel } from '@/domain/habits';
import { durationDays } from '@/domain/time';
import type { Comparator, HabitType, Verification } from '@/domain/types';
import { colors, radius, space } from '@/theme/tokens';

export interface RulesLike {
  habitType: HabitType;
  metricUnit: string;
  timezone: string;
  target: number;
  comparator: Comparator;
  requiredDays: number;
  verification: Verification;
  startDate: string;
  endDate: string;
}

/** The plain-language deadline rule, shown before anyone joins. */
export function deadlineSentence(habitType: HabitType, timezone: string): string {
  const city = timeZoneCity(timezone);
  const base = `Each day runs midnight to midnight, ${city} time. Check-ins for a day are due by noon the next day.`;
  return habitType === 'screen_time'
    ? `${base} A day’s screenshot can only be sent once that day is over.`
    : `${base} You can check in during the day itself.`;
}

export const SCREEN_TIME_SCOPE = 'Counts total usage on one primary phone for each calendar day — no weekly averages, no tablets.';

export function reviewSentence(habitType: HabitType, verification: Verification): string {
  if (verification === 'self_report') return 'Valid entries count right away and are labeled self-reported.';
  return `${habitType === 'screen_time' ? 'Screenshots' : 'Photos'} are reviewed by a challenge admin. Proof awaiting review never counts until it’s approved, and approving proof doesn’t mean the target was met.`;
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={{ gap: 2, paddingVertical: space.xs }}>
      <Text variant="caption" color="textSecondary">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
      {note ? (
        <Text variant="caption" color="textSecondary">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** The complete rules in plain words. Used on the detail Rules tab, in the join sheet and in the wizard review. */
export function RulesSummary({ rules, extra }: { rules: RulesLike; extra?: { label: string; value: string; note?: string }[] }) {
  const total = durationDays(rules.startDate, rules.endDate);
  const rows = [
    { label: 'Daily goal', value: describeGoal(rules.habitType, rules.comparator, rules.target, rules.metricUnit), note: rules.habitType === 'screen_time' ? SCREEN_TIME_SCOPE : undefined },
    { label: 'Dates', value: `${formatDateRange(rules.startDate, rules.endDate)} · ${total} ${total === 1 ? 'day' : 'days'}`, note: `Time zone: ${timeZoneCity(rules.timezone)} (${rules.timezone}). It never changes.` },
    { label: 'To finish', value: `Finish ${rules.requiredDays} of ${total} days` },
    { label: 'Proof', value: verificationLabel(rules.habitType, rules.verification), note: reviewSentence(rules.habitType, rules.verification) },
    { label: 'Deadline', value: 'Noon the next day', note: deadlineSentence(rules.habitType, rules.timezone) },
    ...(extra ?? []),
  ];
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.xl, gap: space.sm }} testID="rules-summary">
      {rows.map((row, index) => (
        <View key={row.label} style={{ gap: space.sm }}>
          {index > 0 ? <Divider /> : null}
          <Row {...row} />
        </View>
      ))}
    </View>
  );
}
