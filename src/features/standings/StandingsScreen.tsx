import { useLocalSearchParams } from 'expo-router';

import { NavHeader, Screen, TitleBlock } from '@/components/Screen';
import { useChallenge } from '@/data/hooks';

import { StandingsList } from './StandingsList';

export function StandingsScreen() {
  const { challengeId } = useLocalSearchParams<{ challengeId: string }>();
  const challenge = useChallenge(challengeId);
  return (
    <Screen header={<NavHeader title={challenge.data?.name} />} refreshing={challenge.isRefetching} onRefresh={() => void challenge.refetch()}>
      <TitleBlock title="Standings" subtitle={challenge.data?.name} />
      {challengeId ? <StandingsList challengeId={challengeId} /> : null}
    </Screen>
  );
}
