import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Banner, ChallengeStatusBadge, DemoRewardBadge, HabitBadge, StatusBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { CircleAlert, CircleCheck, Clock, Gift, Hourglass, RotateCcw, Scale, ShieldCheck } from '@/components/icons';
import { NavHeader, Screen, SectionHeading } from '@/components/Screen';
import { ConfirmationSheet } from '@/components/Sheet';
import { LoadingState, QueryBoundary } from '@/components/States';
import { Text } from '@/components/Text';
import { useApp } from '@/data/AppProvider';
import { useAction, useChallenge, useNow } from '@/data/hooks';
import type { BlockerView, ChallengeDetail, StandingView } from '@/data/types';
import { describeError } from '@/domain/errors';
import { formatDateKey, formatDateRange, formatDateTime, pluralize } from '@/domain/format';
import { finalSubmissionDeadline } from '@/domain/lifecycle';
import { ordinal } from '@/domain/scoring';
import { dateKeyAt, durationDays } from '@/domain/time';
import { colors, radius, space } from '@/theme/tokens';

export function ResultsScreen() {
  const { challengeId } = useLocalSearchParams<{ challengeId: string }>();
  const query = useChallenge(challengeId);
  return (
    <QueryBoundary
      query={query}
      loading={
        <Screen header={<NavHeader title="Results" />}>
          <LoadingState variant="detail" />
        </Screen>
      }>
      {(challenge) => <ResultsContent challenge={challenge} />}
    </QueryBoundary>
  );
}

function blockerText(blocker: BlockerView, timeZone: string): string {
  const until = blocker.until ? formatDateTime(blocker.until, timeZone) : null;
  switch (blocker.code) {
    case 'NOT_IN_REVIEW':
      return 'The challenge is still running.';
    case 'DEADLINE_NOT_REACHED':
      return until ? `Check-ins for the last day are open until ${until}.` : 'Check-ins for the last day are still open.';
    case 'REVIEW_PENDING':
      return `${pluralize(blocker.count, 'submission')} ${blocker.count === 1 ? 'is' : 'are'} awaiting review.`;
    case 'DISPUTE_OPEN':
      return `${pluralize(blocker.count, 'open dispute')} ${blocker.count === 1 ? 'needs' : 'need'} an admin’s decision.`;
    case 'DISPUTE_WINDOW_OPEN':
      return `${pluralize(blocker.count, 'dispute window')} ${blocker.count === 1 ? 'is' : 'are'} still open${until ? ` until ${until}` : ''}.`;
  }
}

const BLOCKER_ICON = {
  NOT_IN_REVIEW: Clock,
  DEADLINE_NOT_REACHED: Clock,
  REVIEW_PENDING: Hourglass,
  DISPUTE_OPEN: Scale,
  DISPUTE_WINDOW_OPEN: Scale,
} as const;

function ResultsContent({ challenge }: { challenge: ChallengeDetail }) {
  const router = useRouter();
  const { session } = useApp();
  const now = useNow();
  const [rematchOpen, setRematchOpen] = useState(false);
  const [finalizeError, setFinalizeError] = useState<unknown>(null);

  const finalize = useAction((repo, id: string) => repo.finalizeChallenge(id), {
    onSuccess: () => setFinalizeError(null),
    onError: (error) => setFinalizeError(error),
  });
  const rematch = useAction((repo, id: string) => repo.createRematch(id), {
    onSuccess: (draft) => {
      setRematchOpen(false);
      router.push(`/challenge/new?draftId=${draft.id}`);
    },
  });

  const tz = challenge.timezone;
  const { rules, viewer, status } = challenge;
  const totalDays = durationDays(rules.startDate, rules.endDate);
  const ranked = challenge.standings.filter((s) => !s.removed);
  const removed = challenge.standings.filter((s) => s.removed);
  const finishers = ranked.filter((s) => s.qualified);
  const everyoneTied = ranked.length > 1 && ranked.every((s) => s.successfulDays === ranked[0]?.successfulDays);
  const canRematch = (status === 'completed' || status === 'canceled') && (viewer.isAdmin || !!viewer.participantId);

  const footer =
    status === 'review' && viewer.isAdmin ? (
      <Button
        label="Finalize results"
        icon={ShieldCheck}
        disabled={!challenge.readyToFinalize}
        disabledReason="Results can be finalized once nothing below is still open"
        loading={finalize.isPending}
        onPress={() => finalize.mutate(challenge.id)}
        testID="results-finalize"
      />
    ) : canRematch ? (
      <Button label="Rematch" icon={RotateCcw} onPress={() => setRematchOpen(true)} testID="results-rematch" />
    ) : undefined;

  const standingsList = (provisional: boolean) => (
    <View style={{ gap: space.sm }}>
      {ranked.map((s) => (
        <StandingRow key={s.participantId} standing={s} totalDays={totalDays} requiredDays={rules.requiredDays} me={session?.userId ?? null} provisional={provisional} />
      ))}
      {removed.length > 0 ? (
        <>
          <Text variant="captionStrong" color="textSecondary" style={{ marginTop: space.sm }}>
            Removed from the challenge
          </Text>
          {removed.map((s) => (
            <StandingRow key={s.participantId} standing={s} totalDays={totalDays} requiredDays={rules.requiredDays} me={session?.userId ?? null} provisional={provisional} />
          ))}
        </>
      ) : null}
    </View>
  );

  return (
    <Screen header={<NavHeader title="Results" />} footer={footer} testID="results-screen">
      {status === 'completed' ? (
        <>
          <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.lg }}>
            <Text style={{ fontSize: 56, lineHeight: 68 }} maxFontSizeMultiplier={1} accessibilityElementsHidden importantForAccessibility="no">
              🏆
            </Text>
            <Text variant="display" align="center" accessibilityRole="header">
              {challenge.name}
            </Text>
            <Text variant="body" color="textSecondary" align="center">
              {challenge.completedAt ? `Finished ${formatDateKey(dateKeyAt(new Date(challenge.completedAt), tz), { year: true })}` : 'Finished'} ·{' '}
              {formatDateRange(rules.startDate, rules.endDate)}
            </Text>
            <StatusBadge label="All reviews resolved" tone="positive" icon={ShieldCheck} style={{ alignSelf: 'center' }} />
          </View>

          {ranked.length === 0 ? (
            <Banner message="Nobody was playing when this challenge finished." />
          ) : finishers.length === 0 ? (
            <Banner title={`Nobody reached ${pluralize(rules.requiredDays, 'day')} this time`} message="The scores below are final. A rematch starts everyone from zero." />
          ) : (
            <Text variant="headline">
              {finishers.length === ranked.length
                ? `Everyone reached ${pluralize(rules.requiredDays, 'successful day')}.`
                : `${finishers.length} of ${ranked.length} reached ${pluralize(rules.requiredDays, 'successful day')}.`}
            </Text>
          )}
          {everyoneTied ? (
            <Banner
              tone="info"
              title="Everyone tied"
              message={`All ${ranked.length} players finished with ${pluralize(ranked[0]?.successfulDays ?? 0, 'successful day')}. There’s no tie-break: the result is shared.`}
            />
          ) : null}

          <View style={{ gap: space.md }}>
            <SectionHeading title="Final standings" />
            {standingsList(false)}
            <Text variant="caption" color="textSecondary">
              Ranked by successful days. Equal totals share a rank; the order within a tie means nothing.
            </Text>
          </View>
        </>
      ) : status === 'review' ? (
        <>
          <View style={{ gap: space.sm }}>
            <ChallengeStatusBadge status="review" />
            <Text variant="display" accessibilityRole="header">
              Results aren’t final yet
            </Text>
            <Text variant="body" color="textSecondary">
              {challenge.name} has ended. Results become final once every check-in is reviewed and every dispute is settled.
            </Text>
          </View>
          <Card>
            {(challenge.finalization?.blockers ?? []).length === 0 ? (
              <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
                <CircleCheck size={20} color={colors.positive} strokeWidth={2.4} />
                <Text variant="body" style={{ flex: 1 }}>
                  {challenge.readyToFinalize
                    ? viewer.isAdmin
                      ? 'Everything is resolved. You can finalize the results.'
                      : 'Everything is resolved. An admin can finalize the results now.'
                    : 'Waiting for the server to confirm everything is resolved.'}
                </Text>
              </View>
            ) : (
              (challenge.finalization?.blockers ?? []).map((blocker) => {
                const Icon = BLOCKER_ICON[blocker.code];
                return (
                  <View key={blocker.code} style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
                    <Icon size={20} color={colors.warning} strokeWidth={2.4} />
                    <Text variant="body" style={{ flex: 1 }}>
                      {blockerText(blocker, tz)}
                    </Text>
                  </View>
                );
              })
            )}
          </Card>
          {viewer.isAdmin && (challenge.pendingReviewCount > 0 || challenge.openDisputeCount > 0) ? (
            <Button label="Open the review queue" variant="secondary" size="md" onPress={() => router.push(`/challenge/${challenge.id}/review`)} testID="results-open-review" />
          ) : null}
          {!viewer.isAdmin ? (
            <Text variant="callout" color="textSecondary">
              A challenge admin finalizes the results. Pending check-ins never count until they’re reviewed.
            </Text>
          ) : null}
          {finalizeError ? <Banner tone="danger" icon={CircleAlert} title={describeError(finalizeError).title} message={describeError(finalizeError).message} /> : null}
          {ranked.length > 0 ? (
            <View style={{ gap: space.md }}>
              <SectionHeading title="Standings so far" />
              <Text variant="caption" color="textSecondary">
                Not final. Days awaiting review don’t count yet.
              </Text>
              {standingsList(true)}
            </View>
          ) : null}
        </>
      ) : status === 'canceled' ? (
        <>
          <View style={{ gap: space.sm }}>
            <ChallengeStatusBadge status="canceled" />
            <Text variant="display" accessibilityRole="header">
              {challenge.name} was canceled
            </Text>
            <Text variant="body" color="textSecondary">
              {challenge.canceledAt ? `Canceled ${formatDateTime(challenge.canceledAt, tz)}. ` : ''}There are no results for a canceled challenge.
            </Text>
          </View>
          <Card>
            <Text variant="captionStrong" color="textSecondary">
              Reason
            </Text>
            <Text variant="body">{challenge.canceledReason ?? 'No reason was recorded.'}</Text>
          </Card>
        </>
      ) : (
        <>
          <View style={{ gap: space.sm }}>
            <HabitBadge habitType={challenge.habitType} />
            <Text variant="display" accessibilityRole="header">
              Results come later
            </Text>
            <Text variant="body" color="textSecondary">
              {status === 'draft'
                ? `${challenge.name} hasn’t been published yet.`
                : `${challenge.name} ${status === 'scheduled' ? 'hasn’t started' : 'is still running'}. The last day is ${formatDateKey(rules.endDate)}; its check-ins are due by ${formatDateTime(
                    finalSubmissionDeadline(rules.endDate, tz),
                    tz,
                  )}. Results are final after that, once admins have resolved every review and dispute.`}
            </Text>
          </View>
          {status === 'active' ? (
            <Button label="See current standings" variant="secondary" size="md" onPress={() => router.push(`/challenge/${challenge.id}/standings`)} testID="results-standings" />
          ) : null}
        </>
      )}

      {challenge.reward ? (
        <Card onPress={() => router.push(`/challenge/${challenge.id}/reward`)} accessibilityLabel="Demo reward preview. Demo reward, no money collected." testID="results-reward">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.lg, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Gift size={19} color={colors.ink} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="bodyStrong">Demo reward preview</Text>
              <DemoRewardBadge />
            </View>
          </View>
        </Card>
      ) : null}

      {canRematch ? (
        <Text variant="caption" color="textSecondary">
          A rematch creates a fresh draft with the same settings, no reward and no progress. Everyone has to accept the rules again to join.
        </Text>
      ) : null}

      <ConfirmationSheet
        visible={rematchOpen}
        onClose={() => setRematchOpen(false)}
        title="Start a rematch?"
        message="This creates a new draft with the same settings. It has no reward and no progress, and everyone has to accept the rules again to join. You can adjust it before publishing."
        confirmLabel="Create rematch draft"
        loading={rematch.isPending}
        onConfirm={() => rematch.mutate(challenge.id)}
        testID="results-rematch-sheet"
      />
    </Screen>
  );
}

function StandingRow({
  standing,
  totalDays,
  requiredDays,
  me,
  provisional,
}: {
  standing: StandingView;
  totalDays: number;
  requiredDays: number;
  me: string | null;
  provisional: boolean;
}) {
  const own = !!me && standing.person.userId === me;
  const name = standing.person.deleted ? 'Deleted member' : standing.person.displayName;
  const rankLabel = standing.removed || standing.rank == null ? 'Removed' : standing.tied ? `Tied for ${ordinal(standing.rank)}` : ordinal(standing.rank);
  const days = `${standing.successfulDays} of ${totalDays} days`;
  const pending = standing.pendingDays > 0 ? ` · ${standing.pendingDays} awaiting review` : '';
  return (
    <View
      accessible
      accessibilityLabel={`${rankLabel}. ${name}${own ? ' (you)' : ''}. ${days} successful${pending}. ${standing.qualified ? `Reached ${requiredDays} days` : `Didn’t reach ${requiredDays} days`}.`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.md,
        borderRadius: radius.lg,
        backgroundColor: own ? colors.surfaceStrong : colors.surface,
        opacity: standing.removed ? 0.7 : 1,
      }}>
      <View style={{ minWidth: 64 }}>
        <Text variant={standing.tied ? 'captionStrong' : 'score'}>{rankLabel}</Text>
      </View>
      <Avatar avatar={standing.person.avatar} ghost={standing.person.deleted} size={36} name="" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">
          {name}
          {own ? ' (you)' : ''}
        </Text>
        <Text variant="caption" color="textSecondary">
          {days}
          {pending}
        </Text>
      </View>
      {standing.removed ? null : standing.qualified ? (
        <StatusBadge label={provisional ? `Reached ${requiredDays}` : 'Finished'} tone="positive" icon={CircleCheck} />
      ) : (
        <StatusBadge label={`Under ${requiredDays}`} tone="neutral" />
      )}
    </View>
  );
}
