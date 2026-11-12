import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { ChallengeStatusBadge, HabitBadge } from '@/components/Badges';
import { Card } from '@/components/Card';
import { NavHeader, Screen, TitleBlock } from '@/components/Screen';
import { EmptyState, LoadingState, QueryBoundary } from '@/components/States';
import { Text } from '@/components/Text';
import { useHistory } from '@/data/hooks';
import type { ChallengeCard } from '@/data/types';
import { formatDateRange } from '@/domain/format';
import { ordinal } from '@/domain/scoring';
import { durationDays } from '@/domain/time';
import { space } from '@/theme/tokens';

function summary(c: ChallengeCard): string {
  if (!c.viewer.participantId) return c.viewer.isAdmin ? 'You were an admin, not a player' : 'You didn’t play';
  if (c.status === 'canceled') return 'Canceled before results';
  const total = durationDays(c.rules.startDate, c.rules.endDate);
  const days = `${c.viewer.successfulDays} of ${total} days`;
  if (c.viewer.removed || c.viewer.rank == null) return `${days} · removed`;
  const rank = c.viewer.tied ? `Tied for ${ordinal(c.viewer.rank)}` : ordinal(c.viewer.rank);
  return `${days} · ${rank}${c.viewer.qualified ? ' · finished' : ''}`;
}

export function HistoryScreen() {
  const router = useRouter();
  const history = useHistory();
  return (
    <Screen header={<NavHeader title="History" />} refreshing={history.isRefetching} onRefresh={() => void history.refetch()} testID="history-screen">
      <TitleBlock title="History" subtitle="Finished and canceled challenges. Scores and change history are kept." />
      <QueryBoundary query={history} loading={<LoadingState variant="list" />}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState emoji="📜" title="No finished challenges yet" message="When a challenge you’re in finishes or is canceled, it shows up here." />
          ) : (
            <View style={{ gap: space.md }}>
              {items.map((c) => (
                <Card
                  key={c.id}
                  padding={space.lg}
                  onPress={() => router.push(`/challenge/${c.id}/results`)}
                  accessibilityLabel={`${c.name}, ${c.circleName}. ${formatDateRange(c.startDate, c.endDate)}. ${summary(c)}.`}
                  testID={`history-item-${c.id}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                    <HabitBadge habitType={c.habitType} size={44} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{c.name}</Text>
                      <Text variant="caption" color="textSecondary">
                        {c.circleName} · {formatDateRange(c.startDate, c.endDate)}
                      </Text>
                    </View>
                    <ChallengeStatusBadge status={c.status} />
                  </View>
                  <Text variant="callout">{summary(c)}</Text>
                </Card>
              ))}
            </View>
          )
        }
      </QueryBoundary>
    </Screen>
  );
}
