import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AvatarStack } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChevronRight, Plus, UserPlus } from '@/components/icons';
import { Screen, TitleBlock } from '@/components/Screen';
import { EmptyState, QueryBoundary } from '@/components/States';
import { Text } from '@/components/Text';
import { useHome } from '@/data/hooks';
import type { CircleSummary } from '@/data/types';
import { pluralize } from '@/domain/format';
import { colors, space } from '@/theme/tokens';

import { CreateCircleSheet } from './CreateCircleSheet';
import { JoinCodeSheet } from './JoinCodeSheet';
import { RoleBadge, ROLE_LABEL } from './roles';

export function CircleListScreen() {
  const router = useRouter();
  const home = useHome();
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);

  return (
    <Screen tabBarInset refreshing={home.isRefetching} onRefresh={() => void home.refetch()} testID="circles-screen">
      <TitleBlock title="Circles" size="display" subtitle="Your private groups. Challenges live inside them." />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Create a Circle" icon={Plus} size="md" style={{ flex: 1 }} onPress={() => setCreating(true)} testID="circles-create" />
        <Button label="Join with a code" icon={UserPlus} variant="secondary" size="md" style={{ flex: 1 }} onPress={() => setJoining(true)} testID="circles-join" />
      </View>

      <QueryBoundary query={home}>
        {(data) =>
          data.circles.length === 0 ? (
            <EmptyState
              emoji="👋"
              title="No Circles yet"
              message="Start one for your family or friends, or join with a code someone sent you."
            />
          ) : (
            <View style={{ gap: space.md }}>
              {data.circles.map((circle) => (
                <CircleCard key={circle.id} circle={circle} onPress={() => router.push(`/circle/${circle.id}`)} />
              ))}
            </View>
          )
        }
      </QueryBoundary>

      <CreateCircleSheet visible={creating} onClose={() => setCreating(false)} />
      <JoinCodeSheet visible={joining} onClose={() => setJoining(false)} />
    </Screen>
  );
}

function CircleCard({ circle, onPress }: { circle: CircleSummary; onPress: () => void }) {
  const members = pluralize(circle.memberCount, 'member');
  const live = circle.liveChallengeCount === 0 ? 'No live challenges' : pluralize(circle.liveChallengeCount, 'live challenge');
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${circle.name}. ${members}. ${live}. You are ${ROLE_LABEL[circle.role].toLowerCase()}.`}
      accessibilityHint="Opens the Circle"
      testID={`circle-card-${circle.id}`}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text variant="headline">{circle.name}</Text>
          <Text variant="caption" color="textSecondary">
            {members} · {live}
          </Text>
        </View>
        <ChevronRight size={20} color={colors.textTertiary} strokeWidth={2.4} style={{ marginTop: 3 }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
        <AvatarStack people={circle.members} size={34} max={5} />
        <RoleBadge role={circle.role} />
      </View>
    </Card>
  );
}
