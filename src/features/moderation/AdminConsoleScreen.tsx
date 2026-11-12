import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Banner, StatusBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Card, Divider, ListRow } from '@/components/Card';
import { DayProgress } from '@/components/DayProgress';
import { ChoiceRow, TextField } from '@/components/Fields';
import { Ban, History, ListChecks, SlidersHorizontal, Trophy, UserMinus, UserPlus } from '@/components/icons';
import { NavHeader, Screen, SectionHeading, TitleBlock } from '@/components/Screen';
import { ConfirmationSheet, Sheet } from '@/components/Sheet';
import { EmptyState, LoadingState } from '@/components/States';
import { Text } from '@/components/Text';
import { useAction, useChallenge, useCircle, useDay } from '@/data/hooks';
import type { BlockerView, ChallengeDetail, ParticipantView, Person } from '@/data/types';
import { formatDateKey, LIMITS, pluralize } from '@/domain';
import { DataError } from '@/features/checkins/common';
import { formatInstant } from '@/features/checkins/logic';
import { describeSubmission } from '@/features/checkins/SubmissionState';
import { space } from '@/theme/tokens';

import { OverrideSheet, overrideTargetFromDay } from './OverrideSheet';

function blockerSentence(blocker: BlockerView, timeZone: string): string {
  const until = blocker.until ? formatInstant(blocker.until, timeZone) : null;
  switch (blocker.code) {
    case 'NOT_IN_REVIEW':
      return 'The challenge is still running.';
    case 'DEADLINE_NOT_REACHED':
      return `Check-ins for the last day are open${until ? ` until ${until}` : ''}.`;
    case 'REVIEW_PENDING':
      return `${pluralize(blocker.count, 'submission')} still ${blocker.count === 1 ? 'needs' : 'need'} a review.`;
    case 'DISPUTE_OPEN':
      return `${pluralize(blocker.count, 'dispute')} ${blocker.count === 1 ? 'is' : 'are'} open.`;
    case 'DISPUTE_WINDOW_OPEN':
      return `${pluralize(blocker.count, 'decision')} can still be disputed${until ? ` — clears at ${until}` : ''}.`;
  }
}

export function AdminConsoleScreen() {
  const { challengeId } = useLocalSearchParams<{ challengeId: string }>();
  const challenge = useChallenge(challengeId);
  const header = <NavHeader title={challenge.data?.name ?? 'Admin'} />;
  if (!challenge.data) {
    return <Screen header={header}>{challenge.isPending ? <LoadingState variant="detail" /> : <DataError error={challenge.error} onRetry={() => void challenge.refetch()} />}</Screen>;
  }
  const detail = challenge.data;
  if (!detail.viewer.isAdmin && !detail.viewer.isCircleAdmin) {
    return (
      <Screen header={header}>
        <EmptyState emoji="🔒" title="Only this challenge’s admins can manage it" message="Ask a challenge admin or a Circle admin if something needs changing." />
      </Screen>
    );
  }
  return <ConsoleBody detail={detail} refreshing={challenge.isRefetching} onRefresh={() => void challenge.refetch()} />;
}

function ConsoleBody({ detail, refreshing, onRefresh }: { detail: ChallengeDetail; refreshing: boolean; onRefresh: () => void }) {
  const router = useRouter();
  const full = detail.viewer.isAdmin;
  const closed = detail.status === 'completed' || detail.status === 'canceled';
  const base = `/challenge/${detail.id}`;
  const [cancelOpen, setCancelOpen] = useState(false);
  const finalize = useAction((repo, id: string) => repo.finalizeChallenge(id), { onSuccess: () => router.push(`${base}/results`) });
  const cancel = useAction((repo, reason: string) => repo.cancelChallenge({ challengeId: detail.id, reason, expectedRevision: detail.revision }), { onSuccess: () => setCancelOpen(false) });

  const footer =
    full && detail.status === 'review' ? (
      <Button
        label="Finalize results"
        icon={Trophy}
        disabled={!detail.readyToFinalize}
        disabledReason="Clear everything listed under Finalization first"
        loading={finalize.isPending}
        onPress={() => finalize.mutate(detail.id)}
        testID="admin-finalize"
      />
    ) : undefined;

  return (
    <Screen header={<NavHeader title={detail.name} />} footer={footer} refreshing={refreshing} onRefresh={onRefresh}>
      <TitleBlock title="Admin" subtitle={full ? 'Review proof, fix results and manage this challenge.' : 'As a Circle admin you can appoint challenge admins.'} />
      {closed ? <Banner message={detail.status === 'canceled' ? `This challenge was canceled${detail.canceledReason ? `: “${detail.canceledReason}”` : ''}. Nothing can be changed.` : 'This challenge is finished. Results are final and can’t be changed.'} /> : null}

      {full ? (
        <>
          <Card>
            <ListRow
              title="Review queue"
              subtitle={`${pluralize(detail.pendingReviewCount, 'item')} to review · ${pluralize(detail.openDisputeCount, 'open dispute')}`}
              icon={ListChecks}
              onPress={() => router.push(`${base}/review`)}
              testID="admin-review-link"
            />
            <Divider />
            <ListRow title="Change history" subtitle="Every review, correction and change, with reasons" icon={History} onPress={() => router.push(`${base}/history`)} testID="admin-history-link" />
            <Divider />
            <ListRow
              title="Change the rules"
              subtitle={detail.status === 'scheduled' || detail.status === 'draft' ? 'Edit the goal, days and proof' : 'Propose a change everyone must accept'}
              icon={SlidersHorizontal}
              onPress={() => router.push(`${base}/rules`)}
              disabled={closed}
              disabledNote="Closed challenges can’t change"
              testID="admin-rules-link"
            />
          </Card>

          {detail.status === 'review' && detail.finalization ? <Finalization detail={detail} /> : null}
          <EditDetails detail={detail} disabled={closed} />
          <Participants detail={detail} disabled={closed} />
        </>
      ) : null}

      <Admins detail={detail} disabled={closed} />

      {full && !closed ? (
        <>
          <SectionHeading title="Danger zone" />
          <Card>
            <Text variant="callout" color="textSecondary">
              Canceling ends the challenge for everyone. Days and history are kept; no results are declared.
            </Text>
            <Button label="Cancel challenge" icon={Ban} variant="danger" onPress={() => setCancelOpen(true)} testID="admin-cancel" />
          </Card>
          <ConfirmationSheet
            visible={cancelOpen}
            onClose={() => setCancelOpen(false)}
            title="Cancel this challenge?"
            message="Everyone is notified with your reason. This can’t be undone."
            confirmLabel="Cancel challenge"
            confirmVariant="danger"
            cancelLabel="Keep it running"
            reason={{ label: 'Reason', placeholder: 'For example: we’re rescheduling after the holidays', required: true }}
            loading={cancel.isPending}
            onConfirm={(reason) => cancel.mutate(reason)}
            testID="cancel-sheet"
          />
        </>
      ) : null}
      <Text variant="caption" color="textSecondary">
        Pausing a challenge isn’t available yet.
      </Text>
    </Screen>
  );
}

function Finalization({ detail }: { detail: ChallengeDetail }) {
  const blockers = detail.finalization?.blockers ?? [];
  return (
    <>
      <SectionHeading title="Finalization" />
      <Card>
        {detail.readyToFinalize ? (
          <Text variant="bodyStrong">Nothing is blocking the results. You can finalize now.</Text>
        ) : (
          <View style={{ gap: space.sm }}>
            <Text variant="bodyStrong">Results can be finalized once these clear:</Text>
            {blockers.map((b) => (
              <Text key={b.code} variant="callout" color="textSecondary">
                • {blockerSentence(b, detail.timezone)}
              </Text>
            ))}
          </View>
        )}
        <Text variant="caption" color="textSecondary">
          Nothing is approved or rejected automatically. Final deadline: {detail.finalization ? formatInstant(detail.finalization.finalDeadlineAt, detail.timezone) : '—'}.
        </Text>
      </Card>
    </>
  );
}

function EditDetails({ detail, disabled }: { detail: ChallengeDetail; disabled: boolean }) {
  const [name, setName] = useState(detail.name);
  const [description, setDescription] = useState(detail.description);
  const save = useAction((repo, input: { name: string; description: string }) => repo.updateChallengeDetails({ challengeId: detail.id, ...input, expectedRevision: detail.revision }));
  const changed = name.trim() !== detail.name || description.trim() !== detail.description;
  const nameOk = name.trim().length >= 2 && name.trim().length <= LIMITS.maxNameLength;
  return (
    <>
      <SectionHeading title="Details" />
      <Card>
        <TextField label="Name" value={name} onChangeText={setName} maxLength={LIMITS.maxNameLength} editable={!disabled} error={nameOk ? undefined : 'Use 2 to 60 characters.'} testID="admin-name" />
        <TextField label="Description" value={description} onChangeText={setDescription} multiline maxLength={LIMITS.maxDescriptionLength} editable={!disabled} helper="Changes to the name and description apply right away." testID="admin-description" />
        <Button
          label="Save details"
          variant="secondary"
          disabled={disabled || !changed || !nameOk}
          disabledReason={disabled ? 'Closed challenges can’t change' : 'Change something first'}
          loading={save.isPending}
          onPress={() => save.mutate({ name: name.trim(), description: description.trim() })}
          testID="admin-save-details"
        />
      </Card>
    </>
  );
}

function Participants({ detail, disabled }: { detail: ChallengeDetail; disabled: boolean }) {
  const router = useRouter();
  const [removing, setRemoving] = useState<ParticipantView | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const remove = useAction((repo, input: { participantId: string; reason: string }) => repo.removeParticipant(input), { onSuccess: () => setRemoving(null) });
  const standing = (id: string) => detail.standings.find((s) => s.participantId === id);

  return (
    <>
      <SectionHeading title="Players" />
      {detail.allParticipants.length === 0 ? (
        <EmptyState title="No players yet" message="Share an invite from the Circle to get people in." compact />
      ) : (
        <Card>
          {detail.allParticipants.map((p, i) => {
            const row = standing(p.id);
            return (
              <View key={p.id} style={{ gap: space.sm }}>
                {i > 0 ? <Divider /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <Avatar avatar={p.person.avatar} ghost={p.person.deleted || !!p.removedAt} size={40} name="" />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong">{p.person.displayName}</Text>
                    {p.removedAt ? (
                      <Text variant="caption" color="textSecondary">
                        Removed{p.removedReason ? `: “${p.removedReason}”` : ''}
                      </Text>
                    ) : row ? (
                      <Text variant="caption" color="textSecondary">
                        {row.successfulDays} completed{row.pendingDays ? ` · ${row.pendingDays} awaiting review` : ''}
                      </Text>
                    ) : null}
                  </View>
                  {p.removedAt ? (
                    <StatusBadge label="Removed" icon={UserMinus} />
                  ) : (
                    <Button label="Remove" variant="ghost" size="sm" fullWidth={false} disabled={disabled} onPress={() => setRemoving(p)} testID={`admin-remove-${p.id}`} />
                  )}
                </View>
                {row && row.days.length > 0 ? (
                  <DayProgress days={row.days} size={26} onSelect={(date) => router.push(`/challenge/${detail.id}/day?date=${date}&participantId=${p.id}`)} />
                ) : null}
              </View>
            );
          })}
          <Text variant="caption" color="textSecondary">
            Tap a day to open it.
          </Text>
          <Button label="Adjust a day" icon={SlidersHorizontal} variant="secondary" disabled={disabled} disabledReason="Closed challenges can’t change" onPress={() => setAdjustOpen(true)} testID="admin-adjust-day" />
        </Card>
      )}
      <ConfirmationSheet
        visible={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.person.displayName ?? 'player'}?`}
        message="They lose access to this challenge and are unranked. Their past days and the history are kept."
        confirmLabel="Remove player"
        confirmVariant="danger"
        reason={{ label: 'Reason', required: true }}
        loading={remove.isPending}
        onConfirm={(reason) => removing && remove.mutate({ participantId: removing.id, reason })}
        testID="remove-sheet"
      />
      {adjustOpen ? <AdjustDayFlow detail={detail} onClose={() => setAdjustOpen(false)} /> : null}
    </>
  );
}

/** Pick a player and a date, load that day, then adjust it. */
function AdjustDayFlow({ detail, onClose }: { detail: ChallengeDetail; onClose: () => void }) {
  const active = detail.standings.filter((s) => !s.removed);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const day = useDay(confirmed && participantId ? detail.id : undefined, confirmed ? (date ?? undefined) : undefined, participantId ?? undefined);
  const row = active.find((s) => s.participantId === participantId);
  const days = (row?.days ?? []).filter((d) => d.status !== 'upcoming');

  if (confirmed && day.data) {
    return <OverrideSheet visible onClose={onClose} target={overrideTargetFromDay(day.data, describeSubmission(day.data).label)} />;
  }
  return (
    <Sheet
      visible
      onClose={onClose}
      title="Adjust a day"
      subtitle="Choose a player and a day."
      footer={
        <>
          <Button label="Continue" disabled={!participantId || !date} disabledReason="Choose a player and a day" loading={confirmed && day.isPending} onPress={() => setConfirmed(true)} testID="adjust-continue" />
          <Button label="Cancel" variant="ghost" size="md" onPress={onClose} />
        </>
      }>
      {active.map((s) => (
        <ChoiceRow
          key={s.participantId}
          title={s.person.displayName}
          selected={participantId === s.participantId}
          onPress={() => {
            setParticipantId(s.participantId);
            setDate(null);
            setConfirmed(false);
          }}
          leading={<Avatar avatar={s.person.avatar} size={32} name="" />}
        />
      ))}
      {participantId ? (
        days.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <Text variant="calloutStrong">Day{date ? `: ${formatDateKey(date)}` : ''}</Text>
            <DayProgress days={days} onSelect={(d) => { setDate(d); setConfirmed(false); }} selectedDate={date} />
          </View>
        ) : (
          <Text variant="callout" color="textSecondary">No days have started yet.</Text>
        )
      ) : null}
      {confirmed && day.error ? <DataError error={day.error} onRetry={() => void day.refetch()} /> : null}
    </Sheet>
  );
}

function Admins({ detail, disabled }: { detail: ChallengeDetail; disabled: boolean }) {
  const circle = useCircle(detail.circleId);
  const [appointOpen, setAppointOpen] = useState(false);
  const [revoking, setRevoking] = useState<Person | null>(null);
  const assign = useAction((repo, userId: string) => repo.assignChallengeAdmin({ challengeId: detail.id, userId }), { onSuccess: () => setAppointOpen(false) });
  const revoke = useAction((repo, userId: string) => repo.revokeChallengeAdmin({ challengeId: detail.id, userId }), { onSuccess: () => setRevoking(null) });
  const adminIds = new Set(detail.admins.map((a) => a.userId));
  const candidates = (circle.data?.members ?? []).filter((m) => !adminIds.has(m.userId) && !m.deleted);
  const last = detail.admins.length <= 1;

  return (
    <>
      <SectionHeading title="Challenge admins" />
      <Card>
        {detail.admins.map((a, i) => (
          <View key={a.userId} style={{ gap: space.sm }}>
            {i > 0 ? <Divider /> : null}
            <ListRow
              title={a.displayName}
              leading={<Avatar avatar={a.avatar} ghost={a.deleted} size={40} name="" />}
              subtitle={a.userId === detail.creator.userId ? 'Created the challenge' : 'Admin'}
              trailing={
                <Button
                  label="Revoke"
                  variant="ghost"
                  size="sm"
                  fullWidth={false}
                  disabled={disabled || last}
                  disabledReason={last ? 'Every challenge needs at least one admin. Appoint another admin first.' : undefined}
                  onPress={() => setRevoking(a)}
                  testID={`admin-revoke-${a.userId}`}
                />
              }
            />
          </View>
        ))}
        {last ? (
          <Text variant="caption" color="textSecondary">
            Every challenge needs at least one admin. Appoint another admin before removing this one.
          </Text>
        ) : null}
        <Button label="Appoint an admin" icon={UserPlus} variant="secondary" disabled={disabled} disabledReason="Closed challenges can’t change" onPress={() => setAppointOpen(true)} testID="admin-appoint" />
      </Card>
      <Sheet visible={appointOpen} onClose={() => setAppointOpen(false)} title="Appoint an admin" subtitle="Admins review proof, fix results and see private proof. The change is logged.">
        {circle.isPending ? (
          <LoadingState variant="list" />
        ) : circle.error ? (
          <DataError error={circle.error} onRetry={() => void circle.refetch()} />
        ) : candidates.length === 0 ? (
          <EmptyState title="Everyone is already an admin" message="Invite more people to the Circle first." compact />
        ) : (
          candidates.map((m) => (
            <ListRow
              key={m.userId}
              title={m.displayName}
              subtitle={m.role === 'owner' ? 'Circle owner' : m.role === 'admin' ? 'Circle admin' : 'Member'}
              leading={<Avatar avatar={m.avatar} size={40} name="" />}
              trailing={<Button label="Appoint" variant="secondary" size="sm" fullWidth={false} loading={assign.isPending && assign.variables === m.userId} onPress={() => assign.mutate(m.userId)} testID={`appoint-${m.userId}`} />}
            />
          ))
        )}
      </Sheet>
      <ConfirmationSheet
        visible={!!revoking}
        onClose={() => setRevoking(null)}
        title={`Remove ${revoking?.displayName ?? ''} as admin?`}
        message="They keep playing if they’re a player, but can no longer review or see others’ proof. The change is logged."
        confirmLabel="Revoke admin"
        confirmVariant="danger"
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.userId)}
        testID="revoke-sheet"
      />
    </>
  );
}

