import { useRouter } from 'expo-router';
import { Fragment, useMemo } from 'react';
import { View } from 'react-native';

import { HabitBadge, StatusBadge } from '@/components/Badges';
import { Wordmark } from '@/components/brand/Wordmark';
import { Button, IconButton } from '@/components/Button';
import { Card, Divider, ListRow } from '@/components/Card';
import { Bell, Clock, Plus, Users } from '@/components/icons';
import { Screen, SectionHeading, TitleBlock } from '@/components/Screen';
import { EmptyState, QueryBoundary } from '@/components/States';
import { Text } from '@/components/Text';
import { useHome, useNow, useProfile } from '@/data/hooks';
import type { ChallengeCard as ChallengeCardData, HomeView } from '@/data/types';
import { deriveActions, groupChallenges } from '@/features/challenges/actions';
import { ChallengeCard } from '@/features/challenges/ChallengeCard';
import { avatarColors, colors, space } from '@/theme/tokens';

function Group({ title, cards, now }: { title: string; cards: ChallengeCardData[]; now: Date }) {
  if (cards.length === 0) return null;
  return (
    <View style={{ gap: space.md }}>
      <SectionHeading title={title} />
      {cards.map((card) => (
        <ChallengeCard key={card.id} card={card} now={now} showCircle />
      ))}
    </View>
  );
}

function HomeContent({ data, now }: { data: HomeView; now: Date }) {
  const router = useRouter();
  const actions = useMemo(() => deriveActions(data.challenges, now), [data.challenges, now]);
  const groups = useMemo(() => groupChallenges(data.challenges), [data.challenges]);
  const habitFor = (challengeId: string) => data.challenges.find((c) => c.id === challengeId)?.habitType ?? 'custom';

  if (data.circles.length === 0) {
    return (
      <EmptyState
        emoji="👋"
        title="Create or join a Circle"
        message="Circles are your private groups of friends or family. Start one, or join with an invite code, then create your first challenge."
        action={<Button label="Go to Circles" icon={Users} fullWidth={false} onPress={() => router.navigate('/circles')} testID="home-go-circles" />}
      />
    );
  }

  return (
    <>
      <TitleBlock
        title="Your next win."
        subtitle={actions.length === 0 ? 'Nothing waiting on you right now.' : `${actions.length} ${actions.length === 1 ? 'thing' : 'things'} to do`}
        size="display"
      />

      <View style={{ gap: space.md }}>
        <SectionHeading title="Today" />
        {actions.length === 0 ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Text style={{ fontSize: 28, lineHeight: 34 }} accessibilityElementsHidden importantForAccessibility="no">
                ✅
              </Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">You’re all caught up</Text>
                <Text variant="caption" color="textSecondary">
                  New check-ins and reviews show up here as days end.
                </Text>
              </View>
            </View>
          </Card>
        ) : (
          <Card padding={space.lg} style={{ gap: space.xs }} testID="home-actions">
            {actions.map((action, index) => (
              <Fragment key={action.key}>
                {index > 0 ? <Divider /> : null}
                <ListRow
                  title={action.title}
                  subtitle={action.subtitle}
                  leading={<HabitBadge habitType={habitFor(action.challengeId)} size={40} />}
                  trailing={action.urgent ? <StatusBadge label="Due" tone="warning" icon={Clock} /> : undefined}
                  onPress={() => router.push(action.href)}
                  testID={`home-action-${action.key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}
                />
              </Fragment>
            ))}
          </Card>
        )}
      </View>

      {data.challenges.length === 0 ? (
        <EmptyState
          compact
          emoji="🌱"
          title="No challenges yet"
          message="Pick a habit, set a daily goal and invite your Circle to play along."
        />
      ) : (
        <>
          <Group title="Live now" cards={groups.live} now={now} />
          <Group title="Starting soon" cards={groups.scheduled} now={now} />
          <Group title="Drafts" cards={groups.drafts} now={now} />
          <Group title="Recently finished" cards={groups.finished} now={now} />
        </>
      )}

      <Button label="Create challenge" icon={Plus} onPress={() => router.push('/challenge/new')} testID="home-create-challenge" />
    </>
  );
}

export function HomeScreen() {
  const router = useRouter();
  const home = useHome();
  const profile = useProfile();
  const now = useNow();
  const unread = home.data?.unreadNotifications ?? 0;
  const dotColor = profile.data ? (avatarColors[profile.data.avatar.color] ?? colors.signal) : colors.signal;

  return (
    <Screen tabBarInset refreshing={home.isRefetching} onRefresh={() => void home.refetch()} testID="home-screen">
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
        <Wordmark height={26} dotColor={dotColor} />
        <IconButton
          icon={Bell}
          label={unread > 0 ? `Activity, ${unread} unread` : 'Activity'}
          badge={unread > 0}
          onPress={() => router.navigate('/activity')}
          testID="home-activity"
        />
      </View>
      <QueryBoundary query={home}>{(data) => <HomeContent data={data} now={now} />}</QueryBoundary>
    </Screen>
  );
}
