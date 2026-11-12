import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { Avatar, AvatarStack } from '@/components/Avatar';
import { Banner, ChallengeStatusBadge, HabitBadge } from '@/components/Badges';
import { Button, IconButton } from '@/components/Button';
import { Card, Divider, ListRow } from '@/components/Card';
import { DayProgress, DayTally } from '@/components/DayProgress';
import { ChoiceRow } from '@/components/Fields';
import { CircleAlert, Clock, Ellipsis, FlaskConical, History, House, Scale, Trophy } from '@/components/icons';
import { PillTabs } from '@/components/Pills';
import { NavHeader, Screen, SectionHeading, TitleBlock } from '@/components/Screen';
import { Sheet } from '@/components/Sheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { Text } from '@/components/Text';
import { useAction, useChallenge, useNow } from '@/data/hooks';
import type { ChallengeDetail } from '@/data/types';
import { describeError, toAppError } from '@/domain/errors';
import { formatCents } from '@/domain/rewards';
import { formatDateKey, formatDateTime, pluralize } from '@/domain/format';
import { shortGoal } from '@/domain/habits';
import { ordinal } from '@/domain/scoring';
import { compareDateKeys, dateKeyAt, diffDays, durationDays } from '@/domain/time';
import { StandingsList } from '@/features/standings/StandingsList';
import { colors, space } from '@/theme/tokens';

import { deriveActions } from './actions';
import { RulesSummary } from './RulesSummary';

type Tab = 'progress' | 'rules' | 'standings';
const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'progress', label: 'Progress' },
  { value: 'rules', label: 'Rules' },
  { value: 'standings', label: 'Standings' },
];

function Stat({ value, unit }: { value: string; unit: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${value} ${unit}`}>
      <Text variant="title">{value}</Text>
      <Text variant="caption" color="textSecondary">
        {unit}
      </Text>
    </View>
  );
}

function rulesOf(detail: ChallengeDetail) {
  return {
    habitType: detail.habitType,
    metricUnit: detail.metricUnit,
    timezone: detail.timezone,
    target: detail.rules.target,
    comparator: detail.rules.comparator,
    requiredDays: detail.rules.requiredDays,
    verification: detail.rules.verification,
    startDate: detail.rules.startDate,
    endDate: detail.rules.endDate,
  };
}

/* ------------------------------------------------------------- join sheet */

function JoinSheet({ detail, visible, onClose, onRefresh }: { detail: ChallengeDetail; visible: boolean; onClose: () => void; onRefresh: () => Promise<unknown> }) {
  const [accepted, setAccepted] = useState(false);
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null);
  const join = useAction((repo, input: { challengeId: string; acceptedVersionId: string }) => repo.joinChallenge(input), {
    silent: true,
    onSuccess: () => {
      setAccepted(false);
      setProblem(null);
      onClose();
    },
    onError: (error) => {
      const code = toAppError(error).code;
      setAccepted(false);
      if (code === 'RULES_CHANGED') {
        setProblem({ title: 'The rules just changed', message: 'An admin updated the rules while you were reading. Here’s the latest version — please read it and accept again.' });
        void onRefresh();
      } else if (code === 'CHALLENGE_STARTED') {
        setProblem({ title: 'It already started', message: 'This challenge began at midnight, so it’s closed to new players. Ask an admin for a rematch next time.' });
        void onRefresh();
      } else {
        const copy = describeError(error);
        setProblem({ title: copy.title, message: copy.message });
      }
    },
  });
  const started = problem?.title === 'It already started';
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`Join ${detail.name}`}
      subtitle={`Rules version ${detail.rules.version}. Starts ${formatDateKey(detail.startDate)}.`}
      testID="join-sheet"
      footer={
        <>
          <Button
            label="Accept rules and join"
            onPress={() => join.mutate({ challengeId: detail.id, acceptedVersionId: detail.rules.id })}
            loading={join.isPending}
            disabled={!accepted || started}
            disabledReason={started ? 'This challenge has started' : 'Accept the rules first'}
            testID="join-confirm"
          />
          <Button label="Not now" variant="ghost" size="md" onPress={onClose} />
        </>
      }>
      {problem ? <Banner tone={started ? 'danger' : 'warning'} title={problem.title} message={problem.message} /> : null}
      <RulesSummary rules={rulesOf(detail)} />
      {detail.description ? (
        <Text variant="callout" color="textSecondary">
          {detail.description}
        </Text>
      ) : null}
      <ChoiceRow
        title="I’ve read the rules and agree to play by them"
        subtitle="Including the noon-next-day deadline and how proof is reviewed."
        selected={accepted}
        onPress={() => setAccepted((a) => !a)}
        disabled={started}
        testID="join-accept"
      />
    </Sheet>
  );
}

/* ------------------------------------------------------------- tabs */

function ProgressTab({ detail, today }: { detail: ChallengeDetail; today: string }) {
  const router = useRouter();
  const v = detail.viewer;
  const participating = !!v.participantId && !v.removed;
  const me = detail.allParticipants.find((p) => p.id === v.participantId);
  return (
    <View style={{ gap: space.xl }}>
      {participating && detail.myDays.length > 0 ? (
        <Card testID="challenge-my-progress">
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="headline">Your progress</Text>
              <Text variant="caption" color="textSecondary">
                Finish {detail.rules.requiredDays} of {detail.myDays.length} to qualify{v.rank ? ` · ${v.tied ? 'tied ' : ''}${ordinal(v.rank)}` : ''}
              </Text>
            </View>
            <DayTally done={v.successfulDays} total={detail.myDays.length} pending={v.pendingDays} />
          </View>
          <DayProgress
            days={detail.myDays}
            onSelect={(date) => {
              if (compareDateKeys(date, today) <= 0) router.push(`/challenge/${detail.id}/day?date=${date}`);
            }}
          />
          <Text variant="caption" color="textSecondary">
            Tap a past day or today to see its details.
          </Text>
          {v.pendingDays > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Clock size={15} color={colors.warning} strokeWidth={2.6} />
              <Text variant="captionStrong" color="warning">
                {v.successfulDays} successful · {v.pendingDays} awaiting review (not counted yet)
              </Text>
            </View>
          ) : null}
        </Card>
      ) : v.removed ? (
        <Banner tone="danger" icon={CircleAlert} title="You were removed from this challenge" message={me?.removedReason ? `Reason: ${me.removedReason}` : 'An admin removed you. Your past days stay in the history.'} />
      ) : (
        <Banner
          message={
            detail.status === 'scheduled'
              ? 'You haven’t joined yet. Read the rules and accept them to play.'
              : v.isAdmin
                ? 'You’re an admin of this challenge but not a player.'
                : 'You’re not playing in this challenge.'
          }
        />
      )}

      <View style={{ gap: space.md }}>
        <SectionHeading title={detail.admins.length === 1 ? 'Admin' : 'Admins'} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <AvatarStack people={detail.admins} size={32} />
          <Text variant="body" style={{ flex: 1 }}>
            {detail.admins.map((p) => (p.deleted ? 'Deleted member' : p.displayName)).join(', ')}
          </Text>
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <SectionHeading title={`Players · ${detail.participantCount}`} />
        {detail.allParticipants.length === 0 ? (
          <Text variant="callout" color="textSecondary">
            Nobody has joined yet.
          </Text>
        ) : (
          detail.allParticipants.map((p, index) => (
            <View key={p.id}>
              {index > 0 ? <Divider /> : null}
              <ListRow
                title={p.person.deleted ? 'Deleted member' : p.person.displayName}
                subtitle={p.removedAt ? `Removed${p.removedReason ? ` — ${p.removedReason}` : ''}` : p.id === v.participantId ? 'You' : undefined}
                leading={<Avatar avatar={p.person.avatar} ghost={p.person.deleted || !!p.removedAt} size={40} name="" />}
                testID={`participant-${p.id}`}
              />
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function RulesTab({ detail }: { detail: ChallengeDetail }) {
  const router = useRouter();
  return (
    <View style={{ gap: space.lg }}>
      {detail.description ? <Text variant="body">{detail.description}</Text> : null}
      <RulesSummary rules={rulesOf(detail)} extra={[{ label: 'Rules version', value: `Version ${detail.rules.version}` }]} />
      <Button label="View full rules & history" icon={History} variant="secondary" onPress={() => router.push(`/challenge/${detail.id}/rules`)} testID="challenge-rules-history" />
    </View>
  );
}

/* ------------------------------------------------------------- screen */

export function ChallengeDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ challengeId: string }>();
  const challengeId = typeof params.challengeId === 'string' ? params.challengeId : undefined;
  const query = useChallenge(challengeId);
  const now = useNow();
  const [tab, setTab] = useState<Tab>('progress');
  const [joining, setJoining] = useState(false);
  const detail = query.data;

  const action = useMemo(() => (detail ? deriveActions([detail], now)[0] : undefined), [detail, now]);

  const header = (
    <NavHeader
      right={
        detail?.viewer.isAdmin ? (
          <IconButton icon={Ellipsis} label="Admin tools" onPress={() => router.push(`/challenge/${detail.id}/admin`)} testID="challenge-admin" />
        ) : null
      }
    />
  );

  if (!detail) {
    if (query.isPending) {
      return (
        <Screen header={header}>
          <LoadingState variant="detail" />
        </Screen>
      );
    }
    const code = toAppError(query.error).code;
    return (
      <Screen header={header}>
        {code === 'NOT_FOUND' || code === 'FORBIDDEN' ? (
          <EmptyState
            emoji="🔒"
            title="This challenge isn’t available"
            message="Your access may have changed — you might have left the Circle or been removed — or it was deleted."
            action={<Button label="Go home" icon={House} fullWidth={false} onPress={() => router.replace('/')} testID="challenge-go-home" />}
          />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </Screen>
    );
  }

  const today = dateKeyAt(now, detail.timezone);
  const total = durationDays(detail.startDate, detail.endDate);
  const v = detail.viewer;
  const joined = !!v.participantId && !v.removed;
  const closed = detail.status === 'completed' || detail.status === 'canceled';

  let third: { value: string; unit: string };
  if (detail.status === 'scheduled') {
    const n = diffDays(today, detail.startDate);
    third = n <= 1 ? { value: n <= 0 ? 'Now' : '1', unit: n <= 0 ? 'starting' : 'day to start' } : { value: String(n), unit: 'days to start' };
  } else if (detail.status === 'active') {
    const left = Math.max(0, diffDays(today, detail.endDate) + 1);
    third = left === 1 ? { value: 'Last', unit: 'day' } : { value: String(left), unit: 'days left' };
  } else if (detail.status === 'review') third = { value: 'Review', unit: 'final checks' };
  else if (detail.status === 'draft') third = { value: 'Draft', unit: 'not published' };
  else third = { value: 'Done', unit: detail.status === 'canceled' ? 'canceled' : 'finished' };

  let footer: React.ReactNode = null;
  if (detail.status === 'draft' && v.isAdmin) {
    footer = <Button label="Continue draft" onPress={() => router.replace(`/challenge/new?draftId=${detail.id}`)} testID="challenge-continue-draft" />;
  } else if (action?.kind === 'join') {
    footer = <Button label="Review rules and join" onPress={() => setJoining(true)} testID="challenge-join" />;
  } else if (action) {
    footer = <Button label={action.title} onPress={() => router.push(action.href)} testID={`challenge-action-${action.kind.replace(/_/g, '-')}`} />;
  } else if (closed) {
    footer = <Button label="See results" icon={Trophy} onPress={() => router.push(`/challenge/${detail.id}/results`)} testID="challenge-results" />;
  }

  return (
    <Screen header={header} footer={footer} refreshing={query.isRefetching} onRefresh={() => void query.refetch()} testID="challenge-detail">
      <View style={{ gap: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <HabitBadge habitType={detail.habitType} size={56} />
          <ChallengeStatusBadge status={detail.status} />
        </View>
        <TitleBlock title={detail.name} subtitle={`${detail.circleName} · ${shortGoal(detail.habitType, detail.rules.comparator, detail.rules.target, detail.metricUnit)}`} />
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Stat value={String(detail.participantCount)} unit={detail.participantCount === 1 ? 'player' : 'players'} />
          <Stat value={String(total)} unit={total === 1 ? 'day' : 'days'} />
          <Stat value={third.value} unit={third.unit} />
        </View>
      </View>

      {detail.proposalAwaitingMe ? (
        <Banner
          tone="info"
          icon={Scale}
          title="A rule change needs your answer"
          message="Nothing changes for you until you accept or decline."
          action={<Button label="Review the change" size="sm" variant="secondary" fullWidth={false} onPress={() => router.push(`/challenge/${detail.id}/rules`)} testID="challenge-proposal" />}
        />
      ) : null}
      {detail.status === 'scheduled' && joined ? (
        <Banner tone="positive" title={`You’re in. Starts ${formatDateKey(detail.startDate)}`} message="Check-ins open at midnight on the first day." />
      ) : null}
      {detail.status === 'canceled' ? (
        <Banner tone="neutral" icon={CircleAlert} title="Canceled" message={`${detail.canceledReason ? `Reason: ${detail.canceledReason}` : 'An admin canceled this challenge.'}${detail.canceledAt ? ` · ${formatDateTime(detail.canceledAt, detail.timezone)}` : ''} History is kept.`} />
      ) : null}
      {closed && footer && action ? (
        <ListRow title="See results" icon={Trophy} onPress={() => router.push(`/challenge/${detail.id}/results`)} testID="challenge-results-row" />
      ) : null}
      {detail.reward ? (
        <ListRow
          title="Demo reward — no money collected"
          subtitle={`${detail.reward.mode === 'demo_sponsor' ? 'Sponsor' : 'Shared pot'} · ${formatCents(detail.reward.grossCents)} simulated`}
          icon={FlaskConical}
          onPress={() => router.push(`/challenge/${detail.id}/reward`)}
          testID="challenge-reward"
        />
      ) : null}

      <PillTabs options={TABS} value={tab} onChange={setTab} stretch accessibilityLabel="Challenge sections" testID="challenge-tab" />
      {tab === 'progress' ? <ProgressTab detail={detail} today={today} /> : null}
      {tab === 'rules' ? <RulesTab detail={detail} /> : null}
      {tab === 'standings' ? (
        detail.status === 'draft' ? (
          <EmptyState compact title="No standings yet" message="Standings appear once the challenge is published." />
        ) : (
          <StandingsList challengeId={detail.id} />
        )
      ) : null}
      {detail.status === 'scheduled' && !joined && !v.removed ? (
        <Text variant="caption" color="textSecondary">
          {pluralize(detail.participantCount, 'player')} in so far. Joining closes when it starts.
        </Text>
      ) : null}

      <JoinSheet detail={detail} visible={joining} onClose={() => setJoining(false)} onRefresh={() => query.refetch()} />
    </Screen>
  );
}
