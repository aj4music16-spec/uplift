import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AvatarStack } from '@/components/Avatar';
import { Button, IconButton } from '@/components/Button';
import { Plus, Users } from '@/components/icons';
import { PillTabs } from '@/components/Pills';
import { NavHeader, Screen, SectionHeading, TitleBlock } from '@/components/Screen';
import { EmptyState, QueryBoundary } from '@/components/States';
import { useCircle, useNow } from '@/data/hooks';
import type { ChallengeCard as ChallengeCardData, CircleDetail } from '@/data/types';
import { groupChallenges } from '@/features/challenges/actions';
import { ChallengeCard } from '@/features/challenges/ChallengeCard';
import { CircleChat } from '@/features/chat/CircleChat';
import { StandingsList } from '@/features/standings/StandingsList';
import { compareDateKeys } from '@/domain/time';
import { pluralize } from '@/domain/format';
import { space } from '@/theme/tokens';

type Tab = 'challenges' | 'standings' | 'chat';
const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'challenges', label: 'Challenges' },
  { value: 'standings', label: 'Standings' },
  { value: 'chat', label: 'Chat' },
];

function isTab(value: unknown): value is Tab {
  return value === 'challenges' || value === 'standings' || value === 'chat';
}

function Group({ title, cards, now }: { title: string; cards: ChallengeCardData[]; now: Date }) {
  if (cards.length === 0) return null;
  return (
    <View style={{ gap: space.md }}>
      <SectionHeading title={title} />
      {cards.map((card) => (
        <ChallengeCard key={card.id} card={card} now={now} />
      ))}
    </View>
  );
}

function ChallengesTab({ detail, now }: { detail: CircleDetail; now: Date }) {
  const groups = useMemo(() => groupChallenges(detail.challenges), [detail.challenges]);
  if (detail.challenges.length === 0) {
    return (
      <EmptyState
        emoji="🌱"
        title="No challenges here yet"
        message="Start one for this Circle with Create challenge below: pick a habit, a daily goal and the dates. Members join by accepting the rules."
      />
    );
  }
  return (
    <View style={{ gap: space.xl }}>
      <Group title="Live now" cards={groups.live} now={now} />
      <Group title="Starting soon" cards={groups.scheduled} now={now} />
      <Group title="Drafts" cards={groups.drafts} now={now} />
      <Group title="Finished" cards={groups.finished} now={now} />
    </View>
  );
}

function StandingsTab({ detail }: { detail: CircleDetail }) {
  const options = useMemo(() => {
    const order: Record<string, number> = { active: 0, review: 1, scheduled: 2, completed: 3, canceled: 4 };
    return detail.challenges
      .filter((c) => c.status !== 'draft')
      .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || compareDateKeys(b.startDate, a.startDate));
  }, [detail.challenges]);
  const [selected, setSelected] = useState<string | null>(null);
  const current = options.find((c) => c.id === selected) ?? options[0];
  if (!current) {
    return <EmptyState emoji="🏁" title="No standings yet" message="Standings appear once a challenge in this Circle is published." />;
  }
  return (
    <View style={{ gap: space.lg }}>
      {options.length > 1 ? (
        <PillTabs
          role="choice"
          options={options.map((c) => ({ value: c.id, label: c.name }))}
          value={current.id}
          onChange={setSelected}
          accessibilityLabel="Challenge"
          testID="circle-standings-challenge"
        />
      ) : null}
      <StandingsList challengeId={current.id} />
    </View>
  );
}

export function CircleOverviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ circleId: string; tab?: string }>();
  const circleId = typeof params.circleId === 'string' ? params.circleId : undefined;
  const circle = useCircle(circleId);
  const now = useNow();
  const [tab, setTab] = useState<Tab>(isTab(params.tab) ? params.tab : 'challenges');
  // Follow ?tab= when it changes (adjusting state during render, not in an effect).
  const [seenTabParam, setSeenTabParam] = useState(params.tab);
  if (params.tab !== seenTabParam) {
    setSeenTabParam(params.tab);
    if (isTab(params.tab)) setTab(params.tab);
  }

  const create = () => router.push(`/challenge/new?circleId=${circleId ?? ''}`);
  const header = (
    <NavHeader
      right={
        circleId ? <IconButton icon={Users} label="Members and invites" onPress={() => router.push(`/circle/${circleId}/members`)} testID="circle-members" /> : null
      }
    />
  );

  const pinned = useMemo(() => {
    const active = (circle.data?.challenges ?? []).filter((c) => c.status === 'active');
    return active.sort((a, b) => compareDateKeys(a.endDate, b.endDate))[0] ?? null;
  }, [circle.data?.challenges]);

  const top = (detail: CircleDetail) => (
    <View style={{ gap: space.lg }}>
      <TitleBlock
        title={detail.circle.name}
        subtitle={pluralize(detail.circle.memberCount, 'member')}
        right={<AvatarStack people={detail.members.length > 0 ? detail.members : detail.circle.members} size={32} max={4} />}
      />
      <PillTabs options={TABS} value={tab} onChange={(next) => setTab(next)} stretch accessibilityLabel="Circle sections" testID="circle-tab" />
    </View>
  );

  if (tab === 'chat' && circle.data && circleId) {
    return (
      <Screen header={header} scroll={false} contentStyle={{ gap: space.lg }} testID="circle-overview">
        {top(circle.data)}
        <View style={{ flex: 1 }}>
          <CircleChat circleId={circleId} pinned={pinned} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      header={header}
      refreshing={circle.isRefetching}
      onRefresh={() => void circle.refetch()}
      footer={tab === 'challenges' && circle.data ? <Button label="Create challenge" icon={Plus} onPress={create} testID="circle-create-challenge" /> : undefined}
      testID="circle-overview">
      <QueryBoundary query={circle}>
        {(detail) => (
          <>
            {top(detail)}
            {tab === 'challenges' ? <ChallengesTab detail={detail} now={now} /> : null}
            {tab === 'standings' ? <StandingsTab detail={detail} /> : null}
          </>
        )}
      </QueryBoundary>
    </Screen>
  );
}
