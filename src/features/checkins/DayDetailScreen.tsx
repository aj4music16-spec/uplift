import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { AdjustedBadge, Banner, StatusBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { Check, Copy, Flag, RotateCcw, ShieldCheck, SlidersHorizontal } from '@/components/icons';
import { NavHeader, Screen, SectionHeading, TitleBlock } from '@/components/Screen';
import { ConfirmationSheet } from '@/components/Sheet';
import { EmptyState, LoadingState } from '@/components/States';
import { Text } from '@/components/Text';
import { useAction, useDay, useNow } from '@/data/hooks';
import type { DayDetail, ReviewView, SubmissionView } from '@/data/types';
import { formatDateKey, HABITS } from '@/domain';
import { OverrideSheet, overrideTargetFromDay } from '@/features/moderation/OverrideSheet';
import { space } from '@/theme/tokens';

import { DataError } from './common';
import { ServerEvidence } from './EvidenceImage';
import { decisionWindowLabel, disputeGateForDay, formatInstant, gateForDay, outcomeWord, valueLabel } from './logic';
import { describeSubmission, SubmissionState } from './SubmissionState';

const SUBMISSION_STATUS: Record<SubmissionView['status'], string> = {
  pending: 'Awaiting review',
  late: 'Late — waiting for the admin',
  accepted: 'Accepted',
  rejected: 'Rejected',
  declined: 'Late request declined',
  superseded: 'Replaced by a newer version',
};

export function DayDetailScreen() {
  const params = useLocalSearchParams<{ challengeId: string; date: string; participantId?: string }>();
  const participantId = typeof params.participantId === 'string' && params.participantId ? params.participantId : undefined;
  const day = useDay(params.challengeId, params.date, participantId);
  const header = <NavHeader title={day.data?.challengeName ?? 'Day'} />;
  if (!params.date) {
    return (
      <Screen header={header}>
        <EmptyState title="No day chosen" message="Open a day from the challenge to see its details." />
      </Screen>
    );
  }
  if (!day.data) {
    return (
      <Screen header={header}>{day.isPending ? <LoadingState variant="detail" /> : <DataError error={day.error} onRetry={() => void day.refetch()} />}</Screen>
    );
  }
  return <DayDetailBody day={day.data} refreshing={day.isRefetching} onRefresh={() => void day.refetch()} />;
}

function DayDetailBody({ day, refreshing, onRefresh }: { day: DayDetail; refreshing: boolean; onRefresh: () => void }) {
  const router = useRouter();
  const now = useNow();
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const owner = day.viewer.isOwner;
  const submit = gateForDay(day, now);
  const dispute = disputeGateForDay(day, now);
  const window = decisionWindowLabel(day, now);

  const openDispute = useAction((repo, reason: string) => repo.openDispute({ recordId: day.record!.id, reason }), { onSuccess: () => setDisputeOpen(false) });
  const accept = useAction((repo, recordId: string) => repo.acknowledgeDecision(recordId));

  const checkinHref = `/challenge/${day.challengeId}/checkin?date=${day.date}`;
  const canResubmit = owner && day.status === 'rejected' && submit.ok;

  const footer = canResubmit ? (
    <Button label={submit.ok && submit.late ? 'Send a late version' : 'Resubmit'} icon={RotateCcw} onPress={() => router.push(checkinHref)} testID="day-resubmit" />
  ) : day.viewer.isAdmin && day.challengeStatus !== 'completed' && day.challengeStatus !== 'canceled' ? (
    <Button label="Adjust result" icon={SlidersHorizontal} onPress={() => setOverrideOpen(true)} testID="day-adjust" />
  ) : owner && submit.ok && day.status !== 'success' ? (
    <Button label="Check in" onPress={() => router.push(checkinHref)} testID="day-checkin" />
  ) : undefined;

  return (
    <Screen header={<NavHeader title={day.challengeName} />} footer={footer} refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Avatar avatar={day.person.avatar} ghost={day.person.deleted} size={48} name="" />
        <View style={{ flex: 1 }}>
          <TitleBlock title={formatDateKey(day.date)} subtitle={`${owner ? 'Your day' : `${day.person.displayName}’s day`} · ${HABITS[day.habitType].label}`} />
        </View>
      </View>
      <SubmissionState day={day} />
      {day.record?.provenance === 'admin_adjusted' ? <AdjustedBadge /> : null}

      {owner && day.record?.decidedAt && day.status !== 'pending' && day.status !== 'late_pending' ? (
        <Card>
          <Text variant="bodyStrong">Decision</Text>
          <Text variant="callout" color="textSecondary">
            {window}
          </Text>
          {dispute.ok ? (
            <View style={{ gap: space.sm }}>
              <Button label="Dispute this decision" icon={Flag} variant="secondary" onPress={() => setDisputeOpen(true)} testID="day-dispute" />
              <Button label="Accept decision" icon={Check} variant="ghost" loading={accept.isPending} onPress={() => accept.mutate(day.record!.id)} testID="day-accept" />
              <Text variant="caption" color="textSecondary">
                Accepting ends your dispute window early so results can be finalized sooner.
              </Text>
            </View>
          ) : (
            <Text variant="caption" color="textSecondary">
              {dispute.code === 'DISPUTE_OPEN'
                ? 'Your dispute is open. An admin will respond.'
                : dispute.code === 'ALREADY_DECIDED'
                  ? 'You already disputed this decision.'
                  : dispute.code === 'CHALLENGE_CLOSED'
                    ? 'The challenge is closed, so decisions can’t be disputed.'
                    : 'The dispute window has closed.'}
            </Text>
          )}
        </Card>
      ) : null}

      {day.status === 'rejected' && owner && !submit.ok ? <Banner tone="neutral" message="The time to resubmit this day has passed." /> : null}

      <SectionHeading title="Submissions" />
      {day.submissions.length === 0 ? (
        <Text variant="callout" color="textSecondary">
          {day.habitType === 'pushups' && day.increments.length > 0 ? 'Logged in reps — see the log below.' : 'Nothing submitted for this day.'}
        </Text>
      ) : (
        day.submissions.map((s) => <SubmissionCard key={s.id} day={day} submission={s} />)
      )}

      {day.habitType === 'pushups' && day.increments.length > 0 ? (
        <>
          <SectionHeading title="Rep log" />
          <Card>
            {day.increments.map((inc, i) => (
              <View key={inc.id} style={{ gap: space.sm }}>
                {i > 0 ? <Divider /> : null}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.md }}>
                  <Text variant="callout">{inc.kind === 'correction' ? `Total corrected (${inc.amount > 0 ? '+' : ''}${inc.amount})` : `+${inc.amount} reps`}</Text>
                  <Text variant="caption" color="textSecondary">
                    {formatInstant(inc.createdAt, day.timezone)}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {day.overrides.length > 0 ? (
        <>
          <SectionHeading title="Admin adjustments" />
          {day.overrides.map((o) => (
            <Card key={o.id}>
              <AdjustedBadge />
              <Text variant="bodyStrong">
                {o.actor.displayName}: {outcomeWord(o.priorOutcome)}
                {o.priorValue != null ? ` (${valueLabel(day, o.priorValue)})` : ''} → {outcomeWord(o.newOutcome)}
                {o.newValue != null ? ` (${valueLabel(day, o.newValue)})` : ''}
              </Text>
              <Text variant="callout" color="textSecondary">
                “{o.reason}”
              </Text>
              <Text variant="caption" color="textSecondary">
                {formatInstant(o.createdAt, day.timezone)}
              </Text>
            </Card>
          ))}
        </>
      ) : null}

      {day.disputes.length > 0 ? (
        <>
          <SectionHeading title="Disputes" />
          {day.disputes.map((d) => (
            <Card key={d.id}>
              <StatusBadge
                label={d.status === 'open' ? 'Open' : d.status === 'upheld' ? 'Upheld' : 'Denied'}
                tone={d.status === 'open' ? 'warning' : d.status === 'upheld' ? 'positive' : 'neutral'}
                icon={Flag}
              />
              <Text variant="callout">
                {d.raisedBy.displayName}: “{d.reason}”
              </Text>
              <Text variant="caption" color="textSecondary">
                Opened {formatInstant(d.createdAt, day.timezone)}
              </Text>
              {d.resolution ? (
                <Text variant="callout" color="textSecondary">
                  {d.resolver?.displayName ?? 'Admin'} {d.status === 'upheld' ? 'upheld it' : 'denied it'}: “{d.resolution}”
                  {d.resolvedAt ? ` · ${formatInstant(d.resolvedAt, day.timezone)}` : ''}
                </Text>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      {day.viewer.isAdmin && !owner ? (
        <Text variant="caption" color="textSecondary">
          You see this as a challenge admin. Proof is private to {day.person.displayName} and the admins.
        </Text>
      ) : null}

      <ConfirmationSheet
        visible={disputeOpen}
        onClose={() => setDisputeOpen(false)}
        title="Dispute this decision"
        message={`Tell the admins what’s wrong with “${describeSubmission(day).label}”. They’ll respond with an explanation. ${window}`}
        confirmLabel="Send dispute"
        reason={{ label: 'What’s wrong?', placeholder: 'For example: the total includes my tablet', required: true }}
        loading={openDispute.isPending}
        onConfirm={(reason) => openDispute.mutate(reason)}
        testID="dispute-sheet"
      />
      {day.viewer.isAdmin ? (
        <OverrideSheet visible={overrideOpen} onClose={() => setOverrideOpen(false)} target={overrideTargetFromDay(day, describeSubmission(day).label)} />
      ) : null}
    </Screen>
  );
}

function reviewSentence(review: ReviewView, day: DayDetail): string {
  const who = review.reviewer.displayName;
  switch (review.decision) {
    case 'approved':
      return review.correctedValue != null ? `${who} approved with a corrected value of ${valueLabel(day, review.correctedValue)}` : `${who} approved the proof`;
    case 'rejected':
      return `${who} rejected the proof`;
    case 'late_accepted':
      return `${who} accepted it late`;
    case 'late_declined':
      return `${who} declined the late request`;
  }
}

function SubmissionCard({ day, submission }: { day: DayDetail; submission: SubmissionView }) {
  return (
    <Card testID={`submission-v${submission.version}`}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" color="textSecondary">
            Version {submission.version} · sent {formatInstant(submission.submittedAt, day.timezone)}
          </Text>
          <Text variant="headline">{valueLabel(day, submission.enteredValue)}</Text>
        </View>
        <View style={{ gap: space.xs, alignItems: 'flex-end' }}>
          <StatusBadge label={SUBMISSION_STATUS[submission.status]} tone={submission.status === 'rejected' || submission.status === 'declined' ? 'danger' : submission.status === 'accepted' ? 'positive' : submission.status === 'superseded' ? 'neutral' : 'warning'} />
          {submission.isLate ? <StatusBadge label="Late" tone="warning" /> : null}
        </View>
      </View>
      {submission.evidence ? (
        <View style={{ gap: space.sm }}>
          <ServerEvidence evidenceId={submission.evidence.id} available={submission.evidence.available} height={200} testID={`evidence-${submission.version}`} />
          {submission.evidence.duplicate ? (
            <StatusBadge label="This file was used before in this challenge — check it" tone="info" icon={Copy} />
          ) : null}
        </View>
      ) : null}
      {submission.reviews.map((review, i) => (
        <View key={`${review.reviewedAt}-${i}`} style={{ gap: space.xs }}>
          <Divider />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
            <Text variant="calloutStrong">{reviewSentence(review, day)}</Text>
            {review.selfReview ? <StatusBadge label="Admin self-reviewed" tone="warning" icon={ShieldCheck} /> : null}
          </View>
          {review.reason ? (
            <Text variant="callout" color="textSecondary">
              “{review.reason}”
            </Text>
          ) : null}
          <Text variant="caption" color="textSecondary">
            {formatInstant(review.reviewedAt, day.timezone)}
          </Text>
        </View>
      ))}
    </Card>
  );
}
