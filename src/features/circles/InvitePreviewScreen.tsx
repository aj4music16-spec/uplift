import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { Banner, HabitBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Clock, FlaskConical, Users } from '@/components/icons';
import { NavHeader, Screen, TitleBlock } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { Text } from '@/components/Text';
import { useToast } from '@/components/Toast';
import { useApp } from '@/data/AppProvider';
import { useAction, useInvitePreview, useNow, useProfile } from '@/data/hooks';
import type { InvitePreview, RedeemResult } from '@/data/types';
import { describeError, toAppError, type ErrorCode } from '@/domain/errors';
import { formatDateRange, formatRelative, pluralize } from '@/domain/format';
import { describeGoal, HABITS } from '@/domain/habits';
import { formatInviteCode, isWellFormedInviteCode, normalizeInviteCode } from '@/domain/invites';
import { colors, space } from '@/theme/tokens';

/** Invite failures that get their own friendly screen instead of a toast. */
const INVITE_STATES: Partial<Record<ErrorCode, { emoji: string; retry: boolean }>> = {
  INVITE_EXPIRED: { emoji: '⏳', retry: false },
  INVITE_INVALID: { emoji: '🔍', retry: false },
  RATE_LIMITED: { emoji: '🐢', retry: true },
};

/** Public route: shows a limited summary and gates acceptance behind an account. */
export function InvitePreviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const raw = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = raw ? normalizeInviteCode(raw) : '';
  const wellFormed = isWellFormedInviteCode(code);
  const { phase, mode, demo, setPendingInvite } = useApp();
  const signedIn = phase === 'signed_in';
  const preview = useInvitePreview(wellFormed && phase !== 'loading' ? code : undefined);
  const [redeemError, setRedeemError] = useState<unknown>(null);

  // Keep the invitation through sign-up, verification and profile setup.
  useEffect(() => {
    if (wellFormed && phase === 'signed_out') setPendingInvite(code);
  }, [wellFormed, phase, code, setPendingInvite]);

  const leave = () => {
    setPendingInvite(null);
    router.replace('/');
  };

  const header = <NavHeader leading="close" onLeading={() => (router.canGoBack() ? router.back() : router.replace('/'))} />;

  if (!wellFormed) return <InviteProblem header={header} code="INVITE_INVALID" onDone={leave} />;
  const problem = redeemError ?? (preview.data ? null : preview.error);
  if (problem) {
    const appCode = toAppError(problem).code;
    if (INVITE_STATES[appCode]) {
      return (
        <InviteProblem
          header={header}
          code={appCode}
          onDone={leave}
          onRetry={
            INVITE_STATES[appCode]?.retry
              ? () => {
                  setRedeemError(null);
                  void preview.refetch();
                }
              : undefined
          }
        />
      );
    }
    if (!preview.data) {
      return (
        <Screen header={header}>
          <ErrorState error={problem} onRetry={() => void preview.refetch()} />
        </Screen>
      );
    }
  }
  if (phase === 'loading' || !preview.data) {
    return (
      <Screen header={header}>
        <LoadingState variant="detail" />
      </Screen>
    );
  }

  const data = preview.data;
  if (!signedIn) {
    return (
      <Screen
        header={header}
        footer={
          mode === 'demo' ? (
            <Button label="Explore the demo" disabled={!demo} disabledReason="The sample data is still loading" onPress={() => demo?.enter('aj')} testID="invite-explore-demo" />
          ) : (
            <>
              <Button label="Create account" onPress={() => router.push('/sign-up')} testID="invite-create-account" />
              <Button label="Sign in" variant="ghost" size="md" onPress={() => router.push('/sign-in')} testID="invite-sign-in" />
            </>
          )
        }>
        <InviteSummary preview={data} code={code} />
        <Banner
          icon={mode === 'demo' ? FlaskConical : Users}
          message={
            mode === 'demo'
              ? 'Demo Mode has no accounts. Explore the demo as a sample person to open this invitation.'
              : 'Sign in or create an account to accept. We’ll keep this invitation for you while you do.'
          }
        />
      </Screen>
    );
  }
  return <SignedInInvite preview={data} code={code} onDecline={leave} onRedeemError={setRedeemError} />;
}

function SignedInInvite({
  preview,
  code,
  onDecline,
  onRedeemError,
}: {
  preview: InvitePreview;
  code: string;
  onDecline: () => void;
  onRedeemError: (error: unknown) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { setPendingInvite } = useApp();
  const profile = useProfile();
  // One key per visit: a double tap or a retry after a lost response joins only once.
  const idempotencyKey = useMemo(() => randomUUID(), []);

  const open = (result: Pick<RedeemResult, 'circleId' | 'challengeId'>) => {
    setPendingInvite(null);
    router.replace(result.challengeId ? `/challenge/${result.challengeId}` : `/circle/${result.circleId}`);
  };

  const redeem = useAction((repo, input: { code: string; idempotencyKey: string }) => repo.redeemInvite(input), {
    silent: true,
    onSuccess: (result) => {
      toast.success(result.alreadyMember ? 'You’re already in' : `Welcome to ${preview.circleName}`);
      open(result);
    },
    onError: (error) => {
      const appCode = toAppError(error).code;
      if (INVITE_STATES[appCode]) onRedeemError(error);
      else if (appCode !== 'SESSION_EXPIRED') toast.error(error);
    },
  });

  const header = <NavHeader leading="close" />;

  if (preview.alreadyMember) {
    return (
      <Screen
        header={header}
        footer={
          <Button
            label={preview.challenge ? 'Open the challenge' : 'Open the Circle'}
            onPress={() => open({ circleId: preview.circleId, challengeId: preview.challenge?.id ?? null })}
            testID="invite-open"
          />
        }>
        <InviteSummary preview={preview} code={code} />
        <Banner tone="positive" icon={Users} title="You’re already a member" message={`You’re already in ${preview.circleName}, so there’s nothing to accept.`} />
      </Screen>
    );
  }

  const needsProfile = profile.data !== undefined && !profile.data?.onboarded;
  return (
    <Screen
      header={header}
      footer={
        needsProfile ? (
          <Button label="Set up your profile first" onPress={() => router.replace('/profile-setup')} testID="invite-profile-setup" />
        ) : (
          <>
            <Button
              label={preview.challenge ? 'Accept and see the challenge' : 'Accept invitation'}
              loading={redeem.isPending}
              disabled={profile.isPending}
              disabledReason="Loading your profile"
              onPress={() => redeem.mutate({ code, idempotencyKey })}
              testID="invite-accept"
            />
            <Button label="Decline" variant="ghost" size="md" onPress={onDecline} disabled={redeem.isPending} testID="invite-decline" />
          </>
        )
      }>
      <InviteSummary preview={preview} code={code} />
      {needsProfile ? (
        <Banner message="Add your name and avatar so the Circle knows who joined. We’ll bring you right back to this invitation." />
      ) : (
        <Text variant="caption" color="textSecondary">
          Joining shows your name and avatar to the members. Proof you submit stays private to you and the challenge admins.
        </Text>
      )}
    </Screen>
  );
}

function InviteSummary({ preview, code }: { preview: InvitePreview; code: string }) {
  const now = useNow();
  const expiresIn = formatRelative(preview.expiresAt, now);
  const challenge = preview.challenge;
  return (
    <>
      <TitleBlock title={`Join ${preview.circleName}`} subtitle={`${preview.inviterName} invited you to their Circle on Uplift.`} />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Users size={20} color={colors.ink} strokeWidth={2.3} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {pluralize(preview.memberCount, 'member')}
          </Text>
        </View>
        {preview.alreadyMember ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Clock size={20} color={colors.ink} strokeWidth={2.3} />
            <Text variant="body" style={{ flex: 1 }}>
              {new Date(preview.expiresAt).getTime() > now.getTime() ? `Invite expires ${expiresIn}` : 'This invite has expired'}
            </Text>
          </View>
        )}
        <Text variant="caption" color="textSecondary">
          Code {formatInviteCode(code)}
        </Text>
      </Card>
      {challenge ? (
        <Card tone="float" testID="invite-challenge">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <HabitBadge habitType={challenge.habitType} size={48} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="caption" color="textSecondary">
                Challenge · {HABITS[challenge.habitType].label}
              </Text>
              <Text variant="headline">{challenge.name}</Text>
            </View>
          </View>
          <Text variant="body">{describeGoal(challenge.habitType, challenge.comparator, challenge.target, challenge.metricUnit)}</Text>
          <Text variant="callout" color="textSecondary">
            {formatDateRange(challenge.startDate, challenge.endDate)}
          </Text>
        </Card>
      ) : null}
    </>
  );
}

function InviteProblem({ header, code, onDone, onRetry }: { header: React.ReactNode; code: ErrorCode; onDone: () => void; onRetry?: () => void }) {
  const copy = describeError(new Error(code));
  return (
    <Screen
      header={header}
      footer={
        <>
          {onRetry ? <Button label="Try again" onPress={onRetry} testID="invite-retry" /> : null}
          <Button label="Go home" variant={onRetry ? 'ghost' : 'primary'} size={onRetry ? 'md' : 'lg'} onPress={onDone} testID="invite-go-home" />
        </>
      }>
      <EmptyState emoji={INVITE_STATES[code]?.emoji} title={copy.title} message={copy.message} />
    </Screen>
  );
}
