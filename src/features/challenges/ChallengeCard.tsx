import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { AvatarStack } from '@/components/Avatar';
import { ChallengeStatusBadge, DemoRewardBadge, HabitBadge } from '@/components/Badges';
import { Card } from '@/components/Card';
import { DayProgress, DayTally } from '@/components/DayProgress';
import { Clock } from '@/components/icons';
import { Text } from '@/components/Text';
import type { ChallengeCard as ChallengeCardData } from '@/data/types';
import { daysLeftLabel, formatDateRange, pluralize, startsInLabel } from '@/domain/format';
import { shortGoal } from '@/domain/habits';
import { dateKeyAt } from '@/domain/time';
import { colors, gutter, layout, space } from '@/theme/tokens';

export interface ChallengeCardProps {
  card: ChallengeCardData;
  /** The repository clock (useNow()). */
  now: Date;
  /** Optional inline action, e.g. a small secondary Button. */
  action?: ReactNode;
  /** Show the Circle name (useful on Home, redundant inside a Circle). */
  showCircle?: boolean;
  testID?: string;
}

/** "3 days left", "Starts tomorrow", "Draft · step 2 of 5", "Nov 3 – Nov 9". */
export function timingLabel(card: ChallengeCardData, now: Date): string {
  const today = dateKeyAt(now, card.timezone);
  switch (card.status) {
    case 'active':
      return daysLeftLabel(today, card.endDate);
    case 'review':
      return 'Final reviews open';
    case 'scheduled':
      return startsInLabel(today, card.startDate);
    case 'draft':
      return `Draft · step ${Math.min(5, Math.max(1, card.draftStep))} of 5`;
    default:
      return formatDateRange(card.startDate, card.endDate);
  }
}

export function challengeHref(card: Pick<ChallengeCardData, 'id' | 'status'>): string {
  return card.status === 'draft' ? `/challenge/new?draftId=${card.id}` : `/challenge/${card.id}`;
}

/** A challenge at a glance. Pending proof is shown on its own line and never counted as done. */
export function ChallengeCard({ card, now, action, showCircle = false, testID }: ChallengeCardProps) {
  const router = useRouter();
  const goal = shortGoal(card.habitType, card.rules.comparator, card.rules.target, card.metricUnit);
  const timing = timingLabel(card, now);
  const participating = !!card.viewer.participantId && !card.viewer.removed && card.myDays.length > 0;
  const pending = card.viewer.pendingDays;
  const people = card.participants;
  const { width } = useWindowDimensions();
  // One row per week, sized to fit beside the tally so dots never wrap into a stray last row.
  const weeks: (typeof card.myDays)[] = [];
  for (let i = 0; i < card.myDays.length; i += 7) weeks.push(card.myDays.slice(i, i + 7));
  const dotRoom = Math.min(width, layout.maxWidth) - gutter * 2 - space.xl * 2 - space.lg - 64;
  const dotSize = Math.max(18, Math.min(30, Math.floor((dotRoom - 6 * space.sm) / 7)));

  return (
    <Card
      onPress={() => router.push(challengeHref(card))}
      accessibilityLabel={`${card.name}. ${goal}. ${timing}.${participating ? ` ${card.viewer.successfulDays} of ${card.myDays.length} days completed.` : ''}${pending ? ` ${pending} awaiting review.` : ''}`}
      accessibilityHint={card.status === 'draft' ? 'Opens the draft' : 'Opens the challenge'}
      testID={testID ?? `challenge-card-${card.id}`}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
        <HabitBadge habitType={card.habitType} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline">{card.name}</Text>
          <Text variant="caption" color="textSecondary">
            {showCircle ? `${card.circleName} · ` : ''}
            {goal} · {timing}
          </Text>
          {card.status !== 'active' ? (
            <View style={{ flexDirection: 'row', marginTop: space.xs }}>
              <ChallengeStatusBadge status={card.status} />
            </View>
          ) : null}
        </View>
      </View>

      {participating ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <View style={{ flex: 1, gap: space.sm }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {weeks.map((week) => (
              <DayProgress key={week[0]!.date} days={week} size={dotSize} />
            ))}
          </View>
          <DayTally done={card.viewer.successfulDays} total={card.myDays.length} pending={pending} />
        </View>
      ) : null}

      {pending > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Clock size={15} color={colors.warning} strokeWidth={2.6} />
          <Text variant="captionStrong" color="warning">
            {pending} awaiting review · not counted yet
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        {people.length > 0 ? <AvatarStack people={people} size={28} max={5} /> : null}
        <Text variant="caption" color="textSecondary" style={{ flex: 1 }}>
          {card.status === 'draft' ? 'Not published yet' : card.participantCount === 0 ? 'No players yet' : `${pluralize(card.participantCount, 'player')} ${card.status === 'scheduled' ? 'in' : 'competing'}`}
        </Text>
        {card.rewardMode !== 'none' ? <DemoRewardBadge compact /> : null}
      </View>

      {action ? <View>{action}</View> : null}
    </Card>
  );
}
