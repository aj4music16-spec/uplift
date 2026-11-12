import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';

import { Banner, StatusBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { DayProgress } from '@/components/DayProgress';
import { ChoiceRow } from '@/components/Fields';
import { CircleAlert, CircleCheck, Clock, FileText, Pause, Pencil, Play, Plus, Square, Timer, User } from '@/components/icons';
import { NavHeader, Screen, SectionHeading, TitleBlock } from '@/components/Screen';
import { Sheet } from '@/components/Sheet';
import { EmptyState, LoadingState } from '@/components/States';
import { Text } from '@/components/Text';
import { useApp } from '@/data/AppProvider';
import { useAction, useChallenge, useDay, useNow } from '@/data/hooks';
import type { ChallengeDetail, DayDetail, LocalEvidence } from '@/data/types';
import {
  dayWindow,
  describeError,
  formatDateKey,
  formatMinutes,
  HABITS,
  resubmitUntil,
  todayKey,
  toAppError,
  validateSubmissionValue,
} from '@/domain';
import { useReducedMotion } from '@/lib/motion';
import { colors, radius, space } from '@/theme/tokens';

import { AmountField, DataError } from './common';
import { EvidenceUploader } from './EvidenceUploader';
import { deadlineLabel, defaultCheckinDate, formatInstant, gateCopy, gateForDay, incrementGateForDay, useIntentKey, valueLabel } from './logic';
import { latestRejection, SubmissionState } from './SubmissionState';

export function CheckinScreen() {
  const params = useLocalSearchParams<{ challengeId: string; date?: string }>();
  const challengeId = params.challengeId;
  const challenge = useChallenge(challengeId);
  const now = useNow();
  const [picked, setPicked] = useState<string | null>(typeof params.date === 'string' ? params.date : null);

  const detail = challenge.data;
  const today = detail ? todayKey(now, detail.timezone) : null;
  const fallback = detail && today ? defaultCheckinDate(detail.myDays, detail.habitType, detail.rules.comparator, today) : null;
  const date = picked ?? fallback;
  const playing = !!detail?.viewer.participantId && !detail.viewer.removed;
  const day = useDay(playing ? challengeId : undefined, date ?? undefined);

  const shell = (body: React.ReactNode) => (
    <Screen header={<NavHeader title={detail?.name ?? 'Check in'} />}>{body}</Screen>
  );

  if (!detail) {
    if (challenge.isPending) return shell(<LoadingState variant="detail" />);
    return shell(<DataError error={challenge.error} onRetry={() => void challenge.refetch()} />);
  }
  if (!playing) {
    return shell(
      <EmptyState
        emoji="🙈"
        title={detail.viewer.removed ? 'You were removed from this challenge' : 'You’re not playing in this challenge'}
        message={detail.viewer.removed ? 'Removed players can’t check in anymore. Your past days stay in the history.' : 'Only players can check in. Admins can review and adjust days from the admin console.'}
      />,
    );
  }
  if (!date || detail.myDays.length === 0) {
    return shell(<EmptyState emoji="🗓️" title="No days to check in" message="This challenge has no scheduled days for you yet." />);
  }

  const picker = (
    <View style={{ gap: space.sm }}>
      <Text variant="calloutStrong">Day</Text>
      <DayProgress days={detail.myDays} onSelect={setPicked} selectedDate={date} />
    </View>
  );

  if (!day.data || day.data.date !== date) {
    if (day.isPending || day.data) return shell(<>{picker}<LoadingState variant="detail" /></>);
    return shell(
      <>
        {picker}
        <DataError error={day.error} onRetry={() => void day.refetch()} />
      </>,
    );
  }
  return <CheckinBody key={date} challenge={detail} day={day.data} now={now} picker={picker} today={today ?? date} />;
}

interface BodyProps {
  challenge: ChallengeDetail;
  day: DayDetail;
  now: Date;
  picker: React.ReactNode;
  today: string;
}

function CheckinBody({ challenge, day, now, picker, today }: BodyProps) {
  const router = useRouter();
  const habit = HABITS[day.habitType];
  const gate = gateForDay(day, now);
  const late = gate.ok && gate.late;
  const needsProof = day.rule.verification === 'evidence' || habit.evidenceMandatory;
  const repsMode = habit.usesIncrements && !needsProof && !late;
  const bool = day.rule.comparator === 'bool';
  const current = day.record?.effectiveValue ?? null;

  const [value, setValue] = useState<number | null>(day.habitType === 'screen_time' ? null : current);
  const [evidence, setEvidence] = useState<LocalEvidence | null>(null);
  const [result, setResult] = useState<DayDetail | null>(null);
  const [uploadFailed, setUploadFailed] = useState(false);
  const keys = useIntentKey();

  const submit = useAction((repo, input: Parameters<typeof repo.submitCheckin>[0]) => repo.submitCheckin(input), {
    onSuccess: (next) => {
      keys.reset();
      setUploadFailed(false);
      setResult(next);
    },
    onError: (error) => setUploadFailed(toAppError(error).code === 'UPLOAD_INCOMPLETE'),
  });

  const dayDetailHref = `/challenge/${day.challengeId}/day?date=${day.date}`;

  if (result) {
    return (
      <Screen
        header={<NavHeader title={day.challengeName} />}
        footer={<Button label="Done" onPress={() => (router.canGoBack() ? router.back() : router.replace(`/challenge/${day.challengeId}`))} testID="checkin-done" />}>
        <CompletionMark positive={result.status === 'success'} />
        <TitleBlock
          title={result.status === 'success' ? 'Nice work.' : result.status === 'pending' || result.status === 'late_pending' ? 'Sent for review.' : 'Saved.'}
          subtitle={formatDateKey(result.date)}
        />
        <SubmissionState day={result} />
        {result.status === 'open' ? (
          <Text variant="callout" color="textSecondary">
            Not yet met — you can keep adding until the deadline. {deadlineLabel(result.date, result.timezone)}.
          </Text>
        ) : null}
        <Button label="See day details" icon={FileText} variant="secondary" onPress={() => router.push(dayDetailHref)} testID="checkin-see-day" />
        {repsMode || (!result.record?.provenance && result.status === 'open') ? (
          <Button label="Log more" variant="ghost" onPress={() => setResult(null)} />
        ) : null}
      </Screen>
    );
  }

  const valueValid = bool ? value === 0 || value === 1 : value != null && validateSubmissionValue(day.habitType, day.rule.comparator, value);
  const canSubmit = gate.ok && valueValid && (!needsProof || !!evidence);
  const disabledReason = !gate.ok
    ? gateCopy(gate.code, day).message
    : !valueValid
      ? bool
        ? 'Choose yes or no first'
        : 'Enter a valid amount first'
      : 'Add your proof first';

  const doSubmit = () => {
    if (value == null) return;
    const signature = `${day.date}|${value}|${evidence?.uri ?? ''}|${late}`;
    submit.mutate({ challengeId: day.challengeId, date: day.date, value, evidence: needsProof ? evidence : null, idempotencyKey: keys.keyFor(signature), late: late || undefined });
  };

  const primaryLabel = late
    ? 'Send late for the admin to consider'
    : needsProof
      ? 'Submit for review'
      : bool
        ? 'Save check-in'
        : `Save ${value != null && valueValid ? valueLabel(day, value) : ''}`.trim();

  const blockedFooter =
    !gate.ok && (gate.code === 'ALREADY_DECIDED' || gate.code === 'REVIEW_PENDING' || gate.code === 'CHALLENGE_CLOSED') ? (
      <Button label="See day details" onPress={() => router.push(dayDetailHref)} testID="checkin-see-day" />
    ) : undefined;

  const footer = repsMode ? undefined : gate.ok ? (
    <Button
      label={primaryLabel}
      onPress={doSubmit}
      loading={submit.isPending}
      disabled={!canSubmit}
      disabledReason={disabledReason}
      testID="checkin-submit"
    />
  ) : (
    blockedFooter
  );

  const rejectedReason = day.status === 'rejected' ? latestRejection(day) : null;

  return (
    <Screen header={<NavHeader title={day.challengeName} />} footer={footer}>
      <TitleBlock title={day.date === today ? 'Today' : formatDateKey(day.date)} subtitle={`${habit.label} · ${deadlineLabel(day.date, day.timezone)}`} />
      {picker}
      <SubmissionState day={day} />

      {day.status === 'rejected' ? (
        <Banner
          tone="danger"
          icon={CircleAlert}
          title="Your proof was rejected"
          message={`${rejectedReason ? `“${rejectedReason}”` : 'The admin didn’t accept this proof.'} ${
            gate.ok && !gate.late
              ? `Resubmit a new version by ${formatInstant(resubmitUntil(day.date, day.timezone, day.record?.decidedAt), day.timezone)}.`
              : 'The resubmission window has closed; you can still send a late version for the admin to consider.'
          }`}
        />
      ) : null}

      {!gate.ok ? <Banner tone={gate.code === 'REVIEW_PENDING' ? 'warning' : 'neutral'} icon={Clock} {...gateCopy(gate.code, day)} /> : null}

      {late ? (
        <Banner
          tone="warning"
          icon={Clock}
          title="The deadline has passed"
          message={`On-time check-ins for this day closed at ${formatInstant(dayWindow(day.date, day.timezone).deadlineAt, day.timezone)}. You can still send it late — it only counts if the admin accepts it.`}
        />
      ) : null}

      {gate.ok && day.status === 'pending' ? (
        <Banner message="You already sent proof for this day. Sending again replaces it with a new version for review; the old one stays in the history." />
      ) : null}

      {gate.ok ? (
        repsMode ? (
          <RepsPanel day={day} />
        ) : (
          <View style={{ gap: space.xl }}>
            {bool ? (
              <BoolInput day={day} value={value} onChange={setValue} />
            ) : day.habitType === 'reading' || (day.metricUnit === 'minutes' && day.rule.comparator === 'gte') ? (
              <ReadingInput day={day} value={value} onChange={setValue} current={current} />
            ) : (
              <AmountField
                label={day.habitType === 'screen_time' ? 'Total shown on the screenshot' : `Total for the day (${day.metricUnit})`}
                unit={day.metricUnit}
                habitType={day.habitType}
                value={value}
                onChange={setValue}
                helper={day.habitType === 'screen_time' ? 'Enter exactly what the Day view shows. The admin checks it against the screenshot.' : undefined}
                testID="checkin-value"
              />
            )}
            {needsProof ? (
              <EvidenceUploader habitType={day.habitType} date={day.date} value={evidence} onChange={setEvidence} sampleMinutes={value} disabled={submit.isPending} />
            ) : (
              <StatusBadge label="Self-reported" icon={User} />
            )}
            {uploadFailed ? (
              <Banner
                tone="danger"
                title="Upload didn’t finish"
                message="Your proof wasn’t uploaded, so nothing was submitted. Your image and total are still here — check your connection and submit again."
              />
            ) : submit.error && !uploadFailed ? (
              <Text variant="caption" color="danger" accessibilityRole="alert">
                {describeError(submit.error).message}
              </Text>
            ) : null}
          </View>
        )
      ) : null}
    </Screen>
  );
}


function BoolInput({ day, value, onChange }: { day: DayDetail; value: number | null; onChange: (value: number) => void }) {
  const prayer = day.habitType === 'prayer';
  return (
    <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
      <Text variant="calloutStrong">{prayer ? 'Did you pray today?' : 'Did you do it?'}</Text>
      <ChoiceRow title={prayer ? 'Yes, I prayed' : 'Yes, done'} selected={value === 1} onPress={() => onChange(1)} testID="checkin-yes" />
      <ChoiceRow title="Not this day" selected={value === 0} onPress={() => onChange(0)} testID="checkin-no" />
      {prayer ? (
        <Text variant="caption" color="textSecondary">
          Private: nothing else is asked, and the group only sees that you checked in.
        </Text>
      ) : null}
    </View>
  );
}

function ReadingInput({ day, value, onChange, current }: { day: DayDetail; value: number | null; onChange: (value: number | null) => void; current: number | null }) {
  const { repository } = useApp();
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [banked, setBanked] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (runningSince == null) return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [runningSince]);
  const elapsed = banked + (runningSince != null ? repository.now().getTime() - runningSince : 0);
  const seconds = Math.floor(elapsed / 1000);
  const add = (minutes: number) => onChange(Math.min(1440, (value ?? current ?? 0) + minutes));

  return (
    <View style={{ gap: space.lg }}>
      <Card>
        <Text variant="caption" color="textSecondary">
          Saved so far today
        </Text>
        <Text variant="stat">{formatMinutes(current ?? 0)}</Text>
        <Text variant="caption" color="textSecondary">
          Goal: {valueLabel(day, day.rule.target)}. Saving replaces the day’s total with the new number.
        </Text>
      </Card>
      <AmountField label="Total minutes for the day" unit="minutes" habitType={day.habitType} value={value} onChange={onChange} testID="checkin-value" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {[5, 10, 15, 30].map((m) => (
          <Button key={m} label={`+${m} min`} icon={Plus} variant="secondary" size="sm" fullWidth={false} onPress={() => add(m)} testID={`checkin-add-${m}`} />
        ))}
      </View>
      <Card tone="float">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Timer size={18} color={colors.ink} strokeWidth={2.4} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            Reading timer
          </Text>
          <Text variant="number" accessibilityLabel={`${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds`}>
            {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {runningSince == null ? (
            <Button label={banked > 0 ? 'Resume' : 'Start'} icon={Play} variant="secondary" size="md" fullWidth={false} style={{ flex: 1 }} onPress={() => setRunningSince(repository.now().getTime())} testID="timer-start" />
          ) : (
            <Button
              label="Pause"
              icon={Pause}
              variant="secondary"
              size="md"
              fullWidth={false}
              style={{ flex: 1 }}
              onPress={() => {
                setBanked(elapsed);
                setRunningSince(null);
              }}
              testID="timer-pause"
            />
          )}
          <Button
            label="Stop and add"
            icon={Square}
            variant="ghost"
            size="md"
            fullWidth={false}
            style={{ flex: 1 }}
            disabled={elapsed < 60_000}
            disabledReason="Read for at least a minute first"
            onPress={() => {
              add(Math.floor(elapsed / 60_000));
              setBanked(0);
              setRunningSince(null);
            }}
            testID="timer-stop"
          />
        </View>
        <Text variant="caption" color="textSecondary">
          Self-reported — the timer is a convenience, not verification. It only runs while this screen is open, and adds whole minutes.
        </Text>
      </Card>
    </View>
  );
}

function RepsPanel({ day }: { day: DayDetail }) {
  const now = useNow();
  const total = day.record?.effectiveValue ?? 0;
  const target = day.rule.target;
  const gate = incrementGateForDay(day, now);
  const [custom, setCustom] = useState<number | null>(null);
  const [fixOpen, setFixOpen] = useState(false);
  const [fixValue, setFixValue] = useState<number | null>(total);
  const [failed, setFailed] = useState<{ amount: number; key: string } | null>(null);
  const fixKeys = useIntentKey();
  const lastAdd = useRef<{ amount: number; key: string } | null>(null);

  const add = useAction((repo, input: { amount: number; key: string }) => repo.addReps({ challengeId: day.challengeId, date: day.date, amount: input.amount, idempotencyKey: input.key }), {
    onSuccess: () => setFailed(null),
    onError: (error) => {
      const code = toAppError(error).code;
      // Only an unanswered request is retried with the same key: it may already have been recorded.
      if (code === 'NETWORK' || code === 'UNKNOWN') setFailed(lastAdd.current);
    },
  });
  const fix = useAction((repo, value: number) => repo.submitCheckin({ challengeId: day.challengeId, date: day.date, value, idempotencyKey: fixKeys.keyFor(`${day.date}|fix|${value}`) }), {
    onSuccess: () => {
      fixKeys.reset();
      setFixOpen(false);
    },
  });

  const tap = (amount: number) => {
    lastAdd.current = { amount, key: randomUUID() };
    add.mutate(lastAdd.current);
  };
  const fraction = Math.min(1, target > 0 ? total / target : 0);
  const customValid = custom != null && Number.isInteger(custom) && custom >= 1 && custom <= 10_000;
  const fixValid = fixValue != null && validateSubmissionValue(day.habitType, day.rule.comparator, fixValue);

  return (
    <View style={{ gap: space.xl }}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }} accessible accessibilityLabel={`${total} of ${target} reps today`}>
          <Text variant="stat">{total}</Text>
          <Text variant="bodyStrong" color="textSecondary">
            / {target} today
          </Text>
        </View>
        <View style={{ height: 12, borderRadius: 6, backgroundColor: colors.surfaceStrong, overflow: 'hidden' }} accessibilityElementsHidden importantForAccessibility="no">
          <View style={{ width: `${Math.round(fraction * 100)}%`, height: '100%', borderRadius: 6, backgroundColor: colors.ink }} />
        </View>
        <Text variant="caption" color="textSecondary">
          {total >= target ? 'Goal met for today · Self-reported' : `${target - total} to go · Self-reported`}
        </Text>
      </Card>

      {!gate.ok ? <Banner {...gateCopy(gate.code, day)} /> : null}

      {failed ? (
        <Banner
          tone="warning"
          title={`Couldn’t confirm +${failed.amount} reps`}
          message="The connection dropped before we heard back. Retrying uses the same request, so reps are never added twice."
          action={<Button label="Retry" variant="secondary" size="sm" fullWidth={false} loading={add.isPending} onPress={() => {
                lastAdd.current = failed;
                add.mutate(failed);
              }} testID="reps-retry" />}
        />
      ) : null}

      <View style={{ gap: space.sm }}>
        <SectionHeading title="Add reps" />
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {[5, 10, 25].map((n) => (
            <Button
              key={n}
              label={`+${n}`}
              variant="secondary"
              size="md"
              fullWidth={false}
              style={{ flex: 1 }}
              disabled={!gate.ok || add.isPending || !!failed}
              disabledReason={failed ? 'Retry the last add first' : 'Reps can’t be added right now'}
              onPress={() => tap(n)}
              testID={`reps-add-${n}`}
            />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <AmountField label="Custom amount" unit="reps" habitType={day.habitType} value={custom} onChange={setCustom} helper="Between 1 and 10,000" testID="checkin-value" />
          </View>
        </View>
        <Button
          label={customValid ? `Add ${custom} reps` : 'Add reps'}
          icon={Plus}
          onPress={() => custom != null && tap(custom)}
          disabled={!gate.ok || !customValid || !!failed}
          disabledReason={!customValid ? 'Enter a whole number from 1 to 10,000' : 'Reps can’t be added right now'}
          loading={add.isPending}
          testID="checkin-submit"
        />
      </View>

      <Button label="Fix total" icon={Pencil} variant="ghost" onPress={() => { setFixValue(total); setFixOpen(true); }} testID="reps-fix-total" />

      <Sheet
        visible={fixOpen}
        onClose={() => setFixOpen(false)}
        title="Fix today’s total"
        subtitle="Set the correct number of reps for this day. The change is kept in the day’s history."
        footer={
          <>
            <Button label="Save total" onPress={() => fixValue != null && fix.mutate(fixValue)} disabled={!fixValid} disabledReason="Enter a whole number" loading={fix.isPending} testID="reps-fix-save" />
            <Button label="Cancel" variant="ghost" size="md" onPress={() => setFixOpen(false)} />
          </>
        }>
        <AmountField label="Correct total" unit="reps" habitType={day.habitType} value={fixValue} onChange={setFixValue} testID="reps-fix-value" />
      </Sheet>

      {day.increments.length > 0 ? (
        <View style={{ gap: space.xs }}>
          <Text variant="calloutStrong">Today’s log</Text>
          {day.increments.slice(0, 8).map((inc) => (
            <Text key={inc.id} variant="caption" color="textSecondary">
              {inc.kind === 'correction' ? 'Total corrected' : 'Added'} {inc.amount > 0 ? `+${inc.amount}` : inc.amount} · {formatInstant(inc.createdAt, day.timezone)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A small check that pops in once. Instant when Reduce Motion is on. */
function CompletionMark({ positive }: { positive: boolean }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    Animated.spring(progress, { toValue: 1, useNativeDriver: true, friction: 6, tension: 120 }).start();
  }, [progress, reduced]);
  const Icon = positive ? CircleCheck : Clock;
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        alignSelf: 'flex-start',
        width: 72,
        height: 72,
        borderRadius: radius.pill,
        backgroundColor: positive ? colors.ink : colors.warningSoft,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: progress,
        transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
      }}>
      <Icon size={34} color={positive ? colors.onInk : colors.warning} strokeWidth={2.4} />
    </Animated.View>
  );
}
