import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Banner, StatusBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { SwitchRow, TextField } from '@/components/Fields';
import { Check, CircleX, Copy, FileText, Flag, Hourglass, Pencil, ShieldCheck, TriangleAlert } from '@/components/icons';
import { PillTabs } from '@/components/Pills';
import { NavHeader, Screen, SectionHeading, TitleBlock } from '@/components/Screen';
import { ConfirmationSheet, Sheet } from '@/components/Sheet';
import { EmptyState, LoadingState } from '@/components/States';
import { Text } from '@/components/Text';
import { useAction, useChallenge, useReviewQueue } from '@/data/hooks';
import type { ChallengeDetail, ReviewItem, ReviewQueue, RulesView } from '@/data/types';
import { applicableRuleVersion, formatDateKey, formatValue, LIMITS, meetsTarget } from '@/domain';
import { AmountField, DataError } from '@/features/checkins/common';
import { ServerEvidence } from '@/features/checkins/EvidenceImage';
import { formatInstant } from '@/features/checkins/logic';
import { space } from '@/theme/tokens';

const QUICK_REASONS = ['Date isn’t visible', 'Total isn’t visible', 'Weekly view, not the Day view', 'Wrong date', 'Unreadable'] as const;

type SheetState =
  | { kind: 'reject'; item: ReviewItem; preset?: string }
  | { kind: 'correct'; item: ReviewItem }
  | { kind: 'approveOwn'; item: ReviewItem }
  | { kind: 'late'; item: ReviewItem; accept: boolean }
  | null;

export function ReviewQueueScreen() {
  const { challengeId } = useLocalSearchParams<{ challengeId: string }>();
  const challenge = useChallenge(challengeId);
  const isAdmin = !!challenge.data?.viewer.isAdmin;
  const queue = useReviewQueue(challengeId, isAdmin);
  const header = <NavHeader title={challenge.data?.name ?? 'Review'} />;

  if (!challenge.data) {
    return <Screen header={header}>{challenge.isPending ? <LoadingState variant="list" /> : <DataError error={challenge.error} onRetry={() => void challenge.refetch()} />}</Screen>;
  }
  if (!isAdmin) {
    return (
      <Screen header={header}>
        <EmptyState emoji="🔒" title="Only this challenge’s admins can review" message="Proof is private to each player and the challenge admins. Ask an admin if something needs a second look." />
      </Screen>
    );
  }
  if (!queue.data) {
    return <Screen header={header}>{queue.isPending ? <LoadingState variant="cards" /> : <DataError error={queue.error} onRetry={() => void queue.refetch()} />}</Screen>;
  }
  return <QueueBody detail={challenge.data} queue={queue.data} refreshing={queue.isRefetching} onRefresh={() => void queue.refetch()} />;
}

function ruleFor(detail: ChallengeDetail, date: string): RulesView {
  return applicableRuleVersion(detail.ruleVersions, date) ?? detail.rules;
}

function QueueBody({ detail, queue, refreshing, onRefresh }: { detail: ChallengeDetail; queue: ReviewQueue; refreshing: boolean; onRefresh: () => void }) {
  const router = useRouter();
  const [person, setPerson] = useState('all');
  const [date, setDate] = useState('all');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [resolving, setResolving] = useState<ReviewQueue['disputes'][number] | null>(null);

  const fmt = (rule: RulesView, value: number) => formatValue(detail.habitType, rule.comparator, detail.metricUnit, value);
  const review = useAction((repo, input: Parameters<typeof repo.reviewSubmission>[0]) => repo.reviewSubmission(input), { onSuccess: () => setSheet(null) });
  const late = useAction((repo, input: { submissionId: string; accept: boolean; reason: string }) => repo.acceptLateSubmission(input), { onSuccess: () => setSheet(null) });

  const people = Array.from(new Map([...queue.items, ...queue.disputes].map((i) => [i.participantId, i.person.displayName])).entries());
  const dates = Array.from(new Set(queue.items.map((i) => i.date))).sort();
  const items = queue.items.filter((i) => (person === 'all' || i.participantId === person) && (date === 'all' || i.date === date));
  const disputes = queue.disputes.filter((d) => person === 'all' || d.participantId === person);

  const approve = (item: ReviewItem) => {
    if (item.own) setSheet({ kind: 'approveOwn', item });
    else review.mutate({ submissionId: item.submissionId, decision: 'approve', expectedRevision: item.recordRevision });
  };

  return (
    <Screen header={<NavHeader title={detail.name} />} refreshing={refreshing} onRefresh={onRefresh}>
      <TitleBlock title="Review" subtitle={`${queue.items.length} to review · ${queue.disputes.length} open ${queue.disputes.length === 1 ? 'dispute' : 'disputes'}`} />
      {queue.items.length + queue.disputes.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <PillTabs
            value={person}
            onChange={setPerson}
            accessibilityLabel="Filter by person"
            options={[{ value: 'all', label: 'Everyone' }, ...people.map(([id, name]) => ({ value: id, label: name }))]}
            testID="review-filter-person"
          />
          {dates.length > 1 ? (
            <PillTabs
              value={date}
              onChange={setDate}
              accessibilityLabel="Filter by date"
              options={[{ value: 'all', label: 'All days' }, ...dates.map((d) => ({ value: d, label: formatDateKey(d) }))]}
              testID="review-filter-date"
            />
          ) : null}
        </View>
      ) : null}

      {queue.items.length === 0 && queue.disputes.length === 0 ? (
        <EmptyState emoji="✅" title="Nothing to review" message="New proof, late requests and disputes show up here." />
      ) : items.length === 0 && disputes.length === 0 ? (
        <EmptyState title="Nothing matches" message="Try another person or day." compact action={<Button label="Clear filters" variant="secondary" size="sm" fullWidth={false} onPress={() => { setPerson('all'); setDate('all'); }} />} />
      ) : null}

      {items.map((item) => {
        const rule = ruleFor(detail, item.date);
        const met = meetsTarget(rule.comparator, rule.target, item.enteredValue);
        const busy = (review.isPending && review.variables?.submissionId === item.submissionId) || (late.isPending && late.variables?.submissionId === item.submissionId);
        return (
          <Card key={item.submissionId} testID={`review-card-${item.submissionId}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Avatar avatar={item.person.avatar} ghost={item.person.deleted} size={44} name="" />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{item.person.displayName}</Text>
                <Text variant="caption" color="textSecondary">
                  {formatDateKey(item.date)} · sent {formatInstant(item.submittedAt, detail.timezone)}
                </Text>
              </View>
              <Text variant="score">{fmt(rule, item.enteredValue)}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
              {item.kind === 'late' ? <StatusBadge label="Late request" tone="warning" icon={Hourglass} /> : null}
              {item.duplicate ? <StatusBadge label="This file was used before in this challenge — check it" tone="info" icon={Copy} /> : null}
            </View>
            {item.own ? <Banner tone="warning" icon={ShieldCheck} message="Your own submission — will be labeled Admin self-reviewed. Another admin can review it instead." /> : null}
            {item.evidenceId ? (
              <ServerEvidence evidenceId={item.evidenceId} height={260} onUnreadable={() => undefined} testID={`review-evidence-${item.submissionId}`} />
            ) : (
              <Text variant="caption" color="textSecondary">
                No proof attached.
              </Text>
            )}
            {item.kind === 'review' ? (
              <>
                <Text variant="caption" color="textSecondary">
                  If approved as entered: {met ? 'day completed' : `verified, but ${rule.comparator === 'lte' ? 'over the limit' : 'under the goal'} → day not met`} (goal {rule.comparator === 'lte' ? 'at most' : rule.comparator === 'gte' ? 'at least' : ''} {fmt(rule, rule.target)}).
                </Text>
                <Button label="Approve" icon={Check} variant="secondary" loading={busy && review.variables?.decision === 'approve'} onPress={() => approve(item)} testID="review-approve" />
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  {rule.comparator !== 'bool' ? (
                    <Button label="Correct value" icon={Pencil} variant="ghost" size="md" fullWidth={false} style={{ flex: 1 }} onPress={() => setSheet({ kind: 'correct', item })} testID="review-correct" />
                  ) : null}
                  <Button label="Reject" icon={CircleX} variant="danger" size="md" fullWidth={false} style={{ flex: 1 }} onPress={() => setSheet({ kind: 'reject', item })} testID="review-reject" />
                </View>
                {item.evidenceId ? (
                  <Button label="Can’t read it? Reject as unreadable" variant="ghost" size="sm" onPress={() => setSheet({ kind: 'reject', item, preset: 'Unreadable' })} testID="review-reject-unreadable" />
                ) : null}
              </>
            ) : (
              <>
                <Text variant="caption" color="textSecondary">
                  Sent after the deadline. Accepting lets it be reviewed like any other proof; declining leaves the day as missed.
                </Text>
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Button label="Accept late" icon={Check} variant="secondary" size="md" fullWidth={false} style={{ flex: 1 }} onPress={() => setSheet({ kind: 'late', item, accept: true })} testID="review-late-accept" />
                  <Button label="Decline" icon={CircleX} variant="danger" size="md" fullWidth={false} style={{ flex: 1 }} onPress={() => setSheet({ kind: 'late', item, accept: false })} testID="review-late-decline" />
                </View>
              </>
            )}
            <Button label="Open day" icon={FileText} variant="ghost" size="sm" onPress={() => router.push(`/challenge/${detail.id}/day?date=${item.date}&participantId=${item.participantId}`)} />
          </Card>
        );
      })}

      {disputes.length > 0 ? (
        <>
          <SectionHeading title="Disputes" />
          {disputes.map((d) => (
            <Card key={d.disputeId} testID={`dispute-card-${d.disputeId}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <Avatar avatar={d.person.avatar} ghost={d.person.deleted} size={44} name="" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{d.person.displayName}</Text>
                  <Text variant="caption" color="textSecondary">
                    {formatDateKey(d.date)} · opened {formatInstant(d.createdAt, detail.timezone)}
                  </Text>
                </View>
                <StatusBadge label="Open" tone="warning" icon={Flag} />
              </View>
              <Text variant="callout">“{d.reason}”</Text>
              <Button label="Resolve" variant="secondary" onPress={() => setResolving(d)} testID="dispute-resolve" />
              <Button label="Open day" icon={FileText} variant="ghost" size="sm" onPress={() => router.push(`/challenge/${detail.id}/day?date=${d.date}&participantId=${d.participantId}`)} />
            </Card>
          ))}
        </>
      ) : null}

      <RejectSheet
        visible={sheet?.kind === 'reject'}
        preset={sheet?.kind === 'reject' ? sheet.preset : undefined}
        own={sheet?.item.own ?? false}
        loading={review.isPending}
        onClose={() => setSheet(null)}
        onConfirm={(reason) => sheet && review.mutate({ submissionId: sheet.item.submissionId, decision: 'reject', reason, expectedRevision: sheet.item.recordRevision })}
      />
      {sheet?.kind === 'correct' ? (
        <CorrectSheet
          detail={detail}
          item={sheet.item}
          rule={ruleFor(detail, sheet.item.date)}
          loading={review.isPending}
          onClose={() => setSheet(null)}
          onConfirm={(value, reason) => review.mutate({ submissionId: sheet.item.submissionId, decision: 'approve', correctedValue: value, reason, expectedRevision: sheet.item.recordRevision })}
        />
      ) : null}
      <ConfirmationSheet
        visible={sheet?.kind === 'approveOwn'}
        onClose={() => setSheet(null)}
        title="Approve your own proof?"
        message="This will be labeled “Admin self-reviewed”, not as an independent review. Another admin can review it instead."
        confirmLabel="Approve as self-reviewed"
        loading={review.isPending}
        onConfirm={() => sheet && review.mutate({ submissionId: sheet.item.submissionId, decision: 'approve', expectedRevision: sheet.item.recordRevision })}
        testID="review-approve-own"
      />
      <ConfirmationSheet
        visible={sheet?.kind === 'late'}
        onClose={() => setSheet(null)}
        title={sheet?.kind === 'late' && sheet.accept ? 'Accept late submission?' : 'Decline late submission?'}
        message={
          sheet?.kind === 'late' && sheet.accept
            ? 'The proof then waits for a normal review. Your reason is shown in the change history.'
            : 'The day stays missed. The player sees your reason.'
        }
        confirmLabel={sheet?.kind === 'late' && sheet.accept ? 'Accept late' : 'Decline'}
        confirmVariant={sheet?.kind === 'late' && sheet.accept ? 'primary' : 'danger'}
        reason={{ label: 'Reason', placeholder: 'For example: phone died that night', required: true }}
        loading={late.isPending}
        onConfirm={(reason) => sheet?.kind === 'late' && late.mutate({ submissionId: sheet.item.submissionId, accept: sheet.accept, reason })}
        testID="review-late-sheet"
      />
      {resolving ? <ResolveDisputeSheet detail={detail} dispute={resolving} onClose={() => setResolving(null)} /> : null}
    </Screen>
  );
}

function RejectSheet({ visible, preset, own, loading, onClose, onConfirm }: { visible: boolean; preset?: string; own: boolean; loading: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (visible) setReason(preset ?? '');
  }, [visible, preset]);
  const ok = reason.trim().length >= LIMITS.minReasonLength;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Reject proof"
      subtitle="The player sees your reason and can send a new version. The group never sees it."
      testID="reject-sheet"
      footer={
        <>
          <Button label="Reject proof" variant="danger" disabled={!ok} disabledReason="Add a short reason first" loading={loading} onPress={() => onConfirm(reason.trim())} testID="reject-confirm" />
          <Button label="Cancel" variant="ghost" size="md" onPress={onClose} />
        </>
      }>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {QUICK_REASONS.map((r) => (
          <Button key={r} label={r} variant={reason === r ? 'primary' : 'secondary'} size="sm" fullWidth={false} onPress={() => setReason(r)} />
        ))}
      </View>
      <TextField label="Reason" value={reason} onChangeText={setReason} multiline maxLength={LIMITS.maxReasonLength} helper="Required. Shown to the player and the admins only." testID="reject-reason" />
      {own ? <Text variant="caption" color="textSecondary">This is your own proof; the decision is labeled Admin self-reviewed.</Text> : null}
    </Sheet>
  );
}

function CorrectSheet({ detail, item, rule, loading, onClose, onConfirm }: { detail: ChallengeDetail; item: ReviewItem; rule: RulesView; loading: boolean; onClose: () => void; onConfirm: (value: number, reason: string) => void }) {
  const [value, setValue] = useState<number | null>(item.enteredValue);
  const [reason, setReason] = useState('');
  const fmt = (v: number) => formatValue(detail.habitType, rule.comparator, detail.metricUnit, v);
  const valid = value != null && value >= 0;
  const ok = valid && reason.trim().length >= LIMITS.minReasonLength && value !== item.enteredValue;
  const met = value != null ? meetsTarget(rule.comparator, rule.target, value) : null;
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Approve with a correction"
      subtitle={`${item.person.displayName} entered ${fmt(item.enteredValue)} for ${formatDateKey(item.date)}.`}
      footer={
        <>
          <Button
            label="Approve corrected value"
            disabled={!ok}
            disabledReason={value === item.enteredValue ? 'Change the value, or use Approve' : 'Enter a value and a short reason'}
            loading={loading}
            onPress={() => value != null && onConfirm(value, reason.trim())}
            testID="correct-confirm"
          />
          <Button label="Cancel" variant="ghost" size="md" onPress={onClose} />
        </>
      }>
      <AmountField label="Value shown in the proof" unit={detail.metricUnit} habitType={detail.habitType} value={value} onChange={setValue} testID="correct-value" />
      {met != null && value != null ? (
        <Banner
          tone={met ? 'positive' : 'warning'}
          icon={met ? Check : TriangleAlert}
          message={met ? `Verified at ${fmt(value)} → day completed.` : `Verified, but ${rule.comparator === 'lte' ? 'over the limit' : 'under the goal'} (${fmt(value)} vs ${fmt(rule.target)}) → day not met.`}
        />
      ) : null}
      <TextField label="Reason" value={reason} onChangeText={setReason} multiline maxLength={LIMITS.maxReasonLength} placeholder="For example: screenshot shows 2h 10m" helper="Required. Shown in the change history." testID="correct-reason" />
      {item.own ? <Text variant="caption" color="textSecondary">Your own proof: labeled Admin self-reviewed.</Text> : null}
    </Sheet>
  );
}

function ResolveDisputeSheet({ detail, dispute, onClose }: { detail: ChallengeDetail; dispute: ReviewQueue['disputes'][number]; onClose: () => void }) {
  const rule = ruleFor(detail, dispute.date);
  const [upheld, setUpheld] = useState<'uphold' | 'deny'>('uphold');
  const [resolution, setResolution] = useState('');
  const [adjust, setAdjust] = useState(false);
  const [outcome, setOutcome] = useState<'success' | 'fail'>('success');
  const [value, setValue] = useState<number | null>(null);
  const action = useAction((repo, input: Parameters<typeof repo.resolveDispute>[0]) => repo.resolveDispute(input), { onSuccess: onClose });
  const ok = resolution.trim().length >= LIMITS.minReasonLength;
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Resolve dispute"
      subtitle={`${dispute.person.displayName} · ${formatDateKey(dispute.date)}: “${dispute.reason}”`}
      testID="resolve-sheet"
      footer={
        <>
          <Button
            label={upheld === 'uphold' ? 'Uphold dispute' : 'Deny dispute'}
            disabled={!ok}
            disabledReason="Add a short explanation first"
            loading={action.isPending}
            onPress={() =>
              action.mutate({
                disputeId: dispute.disputeId,
                upheld: upheld === 'uphold',
                resolution: resolution.trim(),
                override: adjust ? { outcome, value: rule.comparator === 'bool' ? null : value } : null,
              })
            }
            testID="resolve-confirm"
          />
          <Button label="Cancel" variant="ghost" size="md" onPress={onClose} />
        </>
      }>
      <PillTabs
        role="choice"
        stretch
        surface="flat"
        value={upheld}
        onChange={setUpheld}
        options={[
          { value: 'uphold', label: 'Uphold' },
          { value: 'deny', label: 'Deny' },
        ]}
        accessibilityLabel="Decision"
      />
      <TextField label="Explanation" value={resolution} onChangeText={setResolution} multiline maxLength={LIMITS.maxReasonLength} helper="Required. The player sees it." testID="resolve-reason" />
      <SwitchRow title="Also adjust the result" subtitle="Shown as Admin adjusted, with your explanation as the reason." value={adjust} onValueChange={setAdjust} />
      {adjust ? (
        <View style={{ gap: space.md }}>
          <PillTabs
            role="choice"
            stretch
            surface="flat"
            value={outcome}
            onChange={setOutcome}
            options={[
              { value: 'success', label: 'Counts' },
              { value: 'fail', label: 'Doesn’t count' },
            ]}
            accessibilityLabel="Adjusted result"
          />
          {rule.comparator !== 'bool' ? (
            <AmountField label="Corrected value (optional)" unit={detail.metricUnit} habitType={detail.habitType} value={value} onChange={setValue} testID="resolve-value" />
          ) : null}
        </View>
      ) : null}
    </Sheet>
  );
}
