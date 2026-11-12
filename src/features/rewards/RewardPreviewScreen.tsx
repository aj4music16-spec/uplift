import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Banner, DemoRewardBadge, StatusBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { ChoiceRow, Stepper, TextField } from '@/components/Fields';
import { FlaskConical, Info, RotateCcw } from '@/components/icons';
import { NavHeader, Screen, SectionHeading, TitleBlock } from '@/components/Screen';
import { Sheet } from '@/components/Sheet';
import { LoadingState, QueryBoundary } from '@/components/States';
import { Text } from '@/components/Text';
import { useToast } from '@/components/Toast';
import { useApp } from '@/data/AppProvider';
import { useAction, useChallenge } from '@/data/hooks';
import type { ChallengeDetail } from '@/data/types';
import {
  computeRewardPreview,
  DEMO_REWARD_LABEL,
  formatBps,
  formatCents,
  ILLUSTRATIVE_FEE_BPS,
  ILLUSTRATIVE_FEE_LABEL,
  MAX_FEE_BPS,
  MAX_GROSS_CENTS,
  SPLIT_METHOD_LABEL,
} from '@/domain/rewards';
import type { RewardMode } from '@/domain/types';
import { space } from '@/theme/tokens';

const MODE_LABEL: Record<RewardMode, string> = {
  none: 'No reward',
  demo_sponsor: 'Sponsor (demo)',
  demo_pot: 'Shared pot (demo)',
};

/** A simulated reward split. Uplift doesn’t collect, hold or pay out money. */
export function RewardPreviewScreen() {
  const { challengeId } = useLocalSearchParams<{ challengeId: string }>();
  const query = useChallenge(challengeId);
  return (
    <QueryBoundary
      query={query}
      loading={
        <Screen header={<NavHeader title="Demo reward" />}>
          <LoadingState variant="detail" />
        </Screen>
      }>
      {(challenge) => <RewardContent challenge={challenge} />}
    </QueryBoundary>
  );
}

function RewardContent({ challenge }: { challenge: ChallengeDetail }) {
  const { mode } = useApp();
  const [editing, setEditing] = useState(false);
  const reward = challenge.reward;
  const editableStatus = challenge.status === 'draft' || challenge.status === 'scheduled';
  const canEdit = mode === 'demo' && challenge.viewer.isAdmin && editableStatus;

  const editNote = !challenge.viewer.isAdmin
    ? 'Only challenge admins can change the preview.'
    : !editableStatus
      ? 'The preview can only change before the challenge starts.'
      : mode !== 'demo'
        ? 'Reward previews are only available in Demo Mode. This backend refuses them (live payments are disabled).'
        : null;

  const qualified = challenge.standings.filter((s) => s.qualified && !s.removed);
  const preview = reward
    ? computeRewardPreview({ mode: reward.mode, grossCents: reward.grossCents, feeBps: reward.feeBps, qualifierIds: qualified.map((s) => s.participantId) })
    : null;
  const nameOf = (participantId: string) => {
    const person = challenge.standings.find((s) => s.participantId === participantId)?.person;
    return person ? (person.deleted ? 'Deleted member' : person.displayName) : 'Player';
  };
  const final = challenge.status === 'completed';

  return (
    <Screen
      header={<NavHeader title="Demo reward" />}
      footer={canEdit ? <Button label={reward ? 'Change demo preview' : 'Add a demo preview'} onPress={() => setEditing(true)} testID="reward-edit" /> : undefined}
      testID="reward-screen">
      <TitleBlock title="Reward preview" subtitle={challenge.name} />
      <Banner
        tone="warning"
        icon={FlaskConical}
        title={DEMO_REWARD_LABEL}
        message="This is a simulation. Uplift doesn’t collect, hold or pay out money, and nothing here can be withdrawn."
      />

      {!reward || !preview ? (
        <Card>
          <Text variant="headline">No reward on this challenge</Text>
          <Text variant="callout" color="textSecondary">
            Challenges without a reward are the real product. Reward previews exist only in Demo Mode to illustrate a possible future feature. Live rewards would be a separate, separately approved release.
          </Text>
        </Card>
      ) : (
        <>
          <Card>
            <View style={{ gap: space.xs }}>
              <Text variant="captionStrong" color="textSecondary">
                {reward.mode === 'demo_sponsor' ? 'Sponsor' : 'Shared pot'}
              </Text>
              <Text variant="body">
                {reward.mode === 'demo_sponsor'
                  ? `Funded by ${reward.sponsor ? (reward.sponsor.deleted ? 'a former member' : reward.sponsor.displayName) : 'a sponsor'} in this demo.`
                  : 'Players would chip in to a shared pot in this demo. Nobody has paid anything.'}
              </Text>
            </View>
            <View style={{ gap: space.xs }}>
              <Text variant="stat">{formatCents(preview.grossCents)}</Text>
              <DemoRewardBadge />
            </View>
            <Divider />
            <AmountLine label={`Illustrative fee (${formatBps(preview.feeBps)})`} value={preview.state === 'allocated' ? formatCents(preview.feeCents) : formatCents(0)} note={ILLUSTRATIVE_FEE_LABEL} />
            <AmountLine label="Net to split" value={formatCents(preview.netCents)} note={DEMO_REWARD_LABEL} />
            <AmountLine label={final ? 'Eligible finishers' : 'Eligible finishers so far'} value={String(preview.eligibleFinishers)} note={`Players with at least ${challenge.rules.requiredDays} successful days${final ? '' : ' (can still change)'}.`} />
          </Card>

          <View style={{ gap: space.md }}>
            <SectionHeading title={final ? 'Simulated split' : 'Simulated split so far'} />
            {preview.state === 'refund_simulated' ? (
              <Card>
                <StatusBadge label="Simulated refund" tone="demo" icon={RotateCcw} />
                <Text variant="body">
                  Nobody has reached {challenge.rules.requiredDays} successful days{final ? '' : ' yet'}. In this demo the whole {formatCents(preview.refundCents)} would go back to{' '}
                  {reward.mode === 'demo_sponsor' ? 'the sponsor' : 'the players who chipped in'}, with no fee.
                </Text>
                <DemoRewardBadge />
              </Card>
            ) : (
              <Card>
                {preview.allocations.map((allocation) => {
                  const standing = challenge.standings.find((s) => s.participantId === allocation.participantId);
                  return (
                    <View key={allocation.participantId} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 }}>
                      {standing ? <Avatar avatar={standing.person.avatar} ghost={standing.person.deleted} size={32} name="" /> : null}
                      <Text variant="body" style={{ flex: 1 }}>
                        {nameOf(allocation.participantId)}
                      </Text>
                      <Text variant="number">{formatCents(allocation.cents)}</Text>
                    </View>
                  );
                })}
                <DemoRewardBadge />
              </Card>
            )}
            <Text variant="caption" color="textSecondary">
              {SPLIT_METHOD_LABEL} Removed players aren’t eligible.
            </Text>
          </View>
        </>
      )}

      {editNote ? <Banner icon={Info} message={editNote} /> : null}

      {editing && canEdit ? <EditSheet challenge={challenge} onClose={() => setEditing(false)} /> : null}
    </Screen>
  );
}

function AmountLine({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
        <Text variant="body" style={{ flex: 1 }}>
          {label}
        </Text>
        <Text variant="number">{value}</Text>
      </View>
      <Text variant="caption" color="textSecondary">
        {note}
      </Text>
    </View>
  );
}

function parseDollars(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function EditSheet({ challenge, onClose }: { challenge: ChallengeDetail; onClose: () => void }) {
  const toast = useToast();
  const current = challenge.reward;
  const [mode, setMode] = useState<RewardMode>(current?.mode ?? 'demo_sponsor');
  const [amount, setAmount] = useState(current ? (current.grossCents / 100).toFixed(2).replace(/\.00$/, '') : '100');
  const [feeBps, setFeeBps] = useState(current?.feeBps ?? ILLUSTRATIVE_FEE_BPS);
  const cents = parseDollars(amount);
  const amountError =
    mode === 'none' ? undefined : cents == null ? 'Enter an amount like 100 or 25.50.' : cents < 1 || cents > MAX_GROSS_CENTS ? `Enter an amount between $0.01 and ${formatCents(MAX_GROSS_CENTS)}.` : undefined;

  const save = useAction(
    (repo, input: { mode: RewardMode; grossCents: number; feeBps: number }) => repo.setRewardPreview({ challengeId: challenge.id, ...input }),
    {
      onSuccess: () => {
        toast.success('Demo preview updated', DEMO_REWARD_LABEL);
        onClose();
      },
    },
  );

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Demo reward preview"
      subtitle={`${DEMO_REWARD_LABEL}. Nothing is charged, held or paid out.`}
      testID="reward-edit-sheet"
      footer={
        <>
          <Button
            label="Save preview"
            loading={save.isPending}
            disabled={!!amountError}
            disabledReason={amountError}
            onPress={() => save.mutate({ mode, grossCents: mode === 'none' ? 0 : (cents ?? 0), feeBps: mode === 'none' ? 0 : feeBps })}
            testID="reward-save"
          />
          <Button label="Not now" variant="ghost" size="md" onPress={onClose} />
        </>
      }>
      <View style={{ gap: space.sm }}>
        {(['demo_sponsor', 'demo_pot', 'none'] as const).map((option) => (
          <ChoiceRow
            key={option}
            title={MODE_LABEL[option]}
            subtitle={option === 'demo_sponsor' ? 'You fund it, in this demo.' : option === 'demo_pot' ? 'Players chip in, in this demo.' : 'Remove the preview.'}
            selected={mode === option}
            onPress={() => setMode(option)}
            testID={`reward-mode-${option}`}
          />
        ))}
      </View>
      {mode !== 'none' ? (
        <>
          <TextField
            label="Simulated amount (USD)"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            helper={DEMO_REWARD_LABEL}
            error={amountError}
            testID="reward-amount"
          />
          <Stepper
            label="Illustrative fee"
            value={feeBps}
            onChange={setFeeBps}
            min={0}
            max={MAX_FEE_BPS}
            step={50}
            format={formatBps}
            helper={ILLUSTRATIVE_FEE_LABEL}
            testID="reward-fee"
          />
        </>
      ) : null}
    </Sheet>
  );
}
