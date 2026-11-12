import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Banner, DemoRewardBadge, HabitBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChoiceRow, SelectField, Stepper, SwitchRow, TextField } from '@/components/Fields';
import { Clock, FlaskConical, Globe, Lock, ShieldCheck, Users } from '@/components/icons';
import { PillTabs } from '@/components/Pills';
import { NavHeader, Screen, SectionHeading, TitleBlock } from '@/components/Screen';
import { ConfirmationSheet, Sheet } from '@/components/Sheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { Text } from '@/components/Text';
import { useApp } from '@/data/AppProvider';
import { useAction, useChallenge, useHome, useNow } from '@/data/hooks';
import type { Repository } from '@/data/repository';
import type { ChallengeDetail, CircleSummary, DraftInput } from '@/data/types';
import { toAppError } from '@/domain/errors';
import { formatDateKey, formatDateRange, timeZoneAbbreviation, timeZoneCity } from '@/domain/format';
import { HABITS, describeGoal, formatMinutes, formatNumber, verificationLabel } from '@/domain/habits';
import { computeRewardPreview, DEMO_REWARD_LABEL, formatBps, formatCents, ILLUSTRATIVE_FEE_BPS, ILLUSTRATIVE_FEE_LABEL } from '@/domain/rewards';
import { allowedVerifications, defaultTerms, validateName, validateTerms, validateTimeZone, type ValidationIssue } from '@/domain/rules';
import { addDays, dateKeyAt, durationDays } from '@/domain/time';
import { HABIT_TYPES, LIMITS, type Comparator, type HabitType, type RewardMode, type Verification } from '@/domain/types';
import { colors, radius, space } from '@/theme/tokens';

import { RulesSummary, deadlineSentence } from './RulesSummary';

/* ------------------------------------------------------------------ model */

interface Form {
  circleId: string;
  name: string;
  description: string;
  habitType: HabitType;
  metricUnit: string;
  target: number;
  comparator: Comparator;
  verification: Verification;
  startDate: string;
  endDate: string;
  requiredDays: number;
}

interface DraftRef {
  id: string;
  revision: number;
  rewardMode: RewardMode;
}

type Step = 1 | 2 | 3 | 4 | 5;
const STEPS: { step: Step; label: string }[] = [
  { step: 1, label: 'Habit' },
  { step: 2, label: 'Goal' },
  { step: 3, label: 'Dates' },
  { step: 4, label: 'Proof' },
  { step: 5, label: 'Review' },
];

const STEP_FIELDS: Record<Step, ValidationIssue['field'][]> = {
  1: ['name', 'description', 'habitType'],
  2: ['target', 'metricUnit', 'comparator'],
  3: ['startDate', 'endDate', 'requiredDays', 'timezone'],
  4: ['verification'],
  5: [],
};

const NAME_PLACEHOLDER: Record<HabitType, string> = {
  screen_time: 'Screen Time Showdown',
  reading: 'Read Before Bed',
  prayer: 'Morning Prayer',
  pushups: 'Pushup Club',
  custom: 'Water Week',
};

const MAX_START_AHEAD_DAYS = 60;

function clampStep(value: number): Step {
  return Math.min(5, Math.max(1, Math.trunc(value) || 1)) as Step;
}

function formFromDraft(detail: ChallengeDetail): Form {
  return {
    circleId: detail.circleId,
    name: detail.name,
    description: detail.description,
    habitType: detail.habitType,
    metricUnit: detail.metricUnit,
    target: detail.rules.target,
    comparator: detail.rules.comparator,
    verification: detail.rules.verification,
    startDate: detail.rules.startDate,
    endDate: detail.rules.endDate,
    requiredDays: detail.rules.requiredDays,
  };
}

function freshForm(circle: CircleSummary, now: Date, habitType: HabitType = 'screen_time'): Form {
  const terms = defaultTerms(habitType, dateKeyAt(now, circle.timezone));
  return {
    circleId: circle.id,
    name: '',
    description: '',
    habitType,
    metricUnit: terms.metricUnit,
    target: terms.target,
    comparator: terms.comparator,
    verification: terms.verification,
    startDate: terms.startDate,
    endDate: terms.endDate,
    requiredDays: terms.requiredDays,
  };
}

/* ------------------------------------------------------------- pieces */

function HabitTile({ habitType, selected, onPress }: { habitType: HabitType; selected: boolean; onPress: () => void }) {
  const definition = HABITS[habitType];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={definition.label}
      testID={`wizard-habit-${habitType.replace(/_/g, '-')}`}
      style={({ pressed }) => ({
        flexBasis: '30%',
        flexGrow: 1,
        minHeight: 104,
        borderRadius: radius.lg,
        padding: space.md,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
        backgroundColor: selected ? colors.ink : pressed ? colors.surfaceStrong : colors.surface,
      })}>
      <HabitBadge habitType={habitType} size={48} />
      <Text variant="labelSmall" color={selected ? 'onInk' : 'ink'} align="center">
        {definition.label}
      </Text>
    </Pressable>
  );
}

function DateSheet({
  visible,
  onClose,
  title,
  subtitle,
  dates,
  selected,
  describe,
  onSelect,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  dates: string[];
  selected: string;
  describe?: (date: string) => string | undefined;
  onSelect: (date: string) => void;
  testID: string;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={subtitle} testID={testID}>
      <View style={{ gap: space.sm }}>
        {dates.map((date) => (
          <ChoiceRow
            key={date}
            title={formatDateKey(date)}
            subtitle={describe?.(date)}
            selected={date === selected}
            onPress={() => {
              onSelect(date);
              onClose();
            }}
            testID={`${testID}-${date}`}
          />
        ))}
      </View>
    </Sheet>
  );
}

/* ------------------------------------------------------------- screen */

export function ChallengeWizardScreen() {
  const router = useRouter();
  const { mode } = useApp();
  const params = useLocalSearchParams<{ draftId?: string; circleId?: string }>();
  const paramDraftId = typeof params.draftId === 'string' && params.draftId ? params.draftId : undefined;
  const paramCircleId = typeof params.circleId === 'string' && params.circleId ? params.circleId : undefined;
  const home = useHome();
  const draftQuery = useChallenge(paramDraftId);
  const now = useNow();

  const [form, setForm] = useState<Form | null>(null);
  const [draft, setDraft] = useState<DraftRef | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [maxStep, setMaxStep] = useState<Step>(1);
  const [attempted, setAttempted] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [reward, setReward] = useState<{ mode: RewardMode; dollars: number }>({ mode: 'none', dollars: 50 });
  const [sheet, setSheet] = useState<'start' | 'end' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [datesTouched, setDatesTouched] = useState(false);

  const circles = home.data?.circles ?? [];

  const loadDraft = (detail: ChallengeDetail) => {
    setForm(formFromDraft(detail));
    setDraft({ id: detail.id, revision: detail.revision, rewardMode: detail.rewardMode });
    const resumeAt = clampStep(detail.draftStep);
    setStep(resumeAt);
    setMaxStep(resumeAt);
    setDatesTouched(true);
    if (detail.reward && detail.reward.mode !== 'none') {
      setReward({ mode: detail.reward.mode, dollars: Math.max(5, Math.round(detail.reward.grossCents / 100)) });
    } else {
      setReward((current) => ({ ...current, mode: 'none' }));
    }
  };

  /* Initialize once (during render, guarded by `form`): from the draft being resumed, or from defaults in the chosen Circle's time zone. */
  if (!form) {
    if (paramDraftId) {
      if (draftQuery.data && draftQuery.data.status === 'draft') loadDraft(draftQuery.data);
    } else if (home.data) {
      const initial = home.data.circles.find((c) => c.id === paramCircleId) ?? home.data.circles[0];
      if (initial) setForm(freshForm(initial, now));
    }
  }

  const circle = circles.find((c) => c.id === form?.circleId);
  const timezone = circle?.timezone ?? draftQuery.data?.timezone ?? 'UTC';
  const today = dateKeyAt(now, timezone);
  const duration = form ? durationDays(form.startDate, form.endDate) : 0;

  const issues = useMemo<ValidationIssue[]>(() => {
    if (!form) return [];
    return [
      ...validateName(form.name),
      ...(form.description.trim().length > LIMITS.maxDescriptionLength
        ? [{ field: 'description' as const, message: `Keep the description under ${LIMITS.maxDescriptionLength} characters.` }]
        : []),
      ...validateTimeZone(timezone),
      ...validateTerms({ ...form, metricUnit: form.metricUnit }, { today, phase: 'publish' }),
    ];
  }, [form, timezone, today]);

  const errorFor = (field: ValidationIssue['field']) => {
    if (field === 'name' && !attempted) return undefined;
    return issues.find((issue) => issue.field === field)?.message;
  };
  const stepIssues = (s: Step) => (s === 5 ? issues : issues.filter((issue) => STEP_FIELDS[s].includes(issue.field)));

  const update = (patch: Partial<Form>) => setForm((current) => (current ? { ...current, ...patch } : current));

  /* ------------------------------------------------------- persistence */

  const remember = (saved: ChallengeDetail) => {
    setDraft({ id: saved.id, revision: saved.revision, rewardMode: saved.rewardMode });
  };

  const persist = async (repo: Repository, current: Form, draftStep: number, ref: DraftRef | null): Promise<ChallengeDetail> => {
    const input: DraftInput = {
      ...(ref ? { id: ref.id, expectedRevision: ref.revision } : {}),
      circleId: current.circleId,
      name: current.name.trim(),
      description: current.description.trim(),
      habitType: current.habitType,
      metricUnit: current.metricUnit.trim(),
      timezone,
      target: current.target,
      comparator: current.comparator,
      requiredDays: current.requiredDays,
      verification: current.verification,
      startDate: current.startDate,
      endDate: current.endDate,
      draftStep,
    };
    const saved = await repo.saveDraft(input);
    remember(saved);
    if (!ref) router.setParams({ draftId: saved.id });
    return saved;
  };

  const task = useAction((repo, job: (repo: Repository) => Promise<ChallengeDetail | null>) => job(repo), {
    onError: (error) => {
      if (toAppError(error).code === 'REVISION_CONFLICT') {
        // Someone (or another device) changed the draft: load the latest version before going on.
        void draftQuery.refetch().then((result) => {
          if (result.data && result.data.status === 'draft') loadDraft(result.data);
        });
      }
    },
  });

  const goTo = (next: Step) => {
    setStep(next);
    setMaxStep((m) => (next > m ? next : m));
  };

  const onNext = () => {
    if (!form) return;
    setAttempted(true);
    if (stepIssues(step).length > 0 || (step === 1 && !circle)) return;
    if (step < 5) {
      const next = (step + 1) as Step;
      const snapshot = form;
      const ref = draft;
      task.mutate((repo) => persist(repo, snapshot, next, ref), { onSuccess: () => goTo(next) });
      return;
    }
    const snapshot = form;
    const ref = draft;
    const rewardChoice = mode === 'demo' ? reward : { mode: 'none' as RewardMode, dollars: 0 };
    const join = playing;
    task.mutate(
      async (repo) => {
        let saved = await persist(repo, snapshot, 5, ref);
        if (mode === 'demo' && (rewardChoice.mode !== 'none' || saved.rewardMode !== 'none')) {
          saved = await repo.setRewardPreview({
            challengeId: saved.id,
            mode: rewardChoice.mode,
            grossCents: rewardChoice.mode === 'none' ? 0 : Math.round(rewardChoice.dollars * 100),
            feeBps: ILLUSTRATIVE_FEE_BPS,
          });
          remember(saved);
        }
        const published = await repo.publishChallenge({ challengeId: saved.id, expectedRevision: saved.revision, joinAsParticipant: join });
        return published;
      },
      { onSuccess: (published) => published && router.replace(`/challenge/${published.id}`) },
    );
  };

  const onSaveAndClose = () => {
    if (!form) return;
    setAttempted(true);
    if (validateName(form.name).length > 0 || !circle) return;
    const snapshot = form;
    const ref = draft;
    task.mutate((repo) => persist(repo, snapshot, step, ref), {
      onSuccess: () => (router.canGoBack() ? router.back() : router.replace('/')),
    });
  };

  const onDelete = () => {
    const ref = draft;
    if (!ref) return;
    task.mutate(
      async (repo) => {
        await repo.deleteDraft(ref.id);
        return null;
      },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          router.replace('/');
        },
      },
    );
  };

  const onBack = () => {
    if (step > 1) setStep((step - 1) as Step);
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  /* ------------------------------------------------------------- states */

  const header = <NavHeader leading={step > 1 ? 'back' : 'close'} onLeading={onBack} title="New challenge" />;

  if (paramDraftId && !form) {
    if (draftQuery.data && draftQuery.data.status !== 'draft') {
      const published = draftQuery.data;
      return (
        <Screen header={header}>
          <EmptyState
            emoji="🚀"
            title="Already published"
            message="This challenge isn’t a draft anymore. Published rules change through a rule-change proposal."
            action={<Button label="Open the challenge" fullWidth={false} onPress={() => router.replace(`/challenge/${published.id}`)} />}
          />
        </Screen>
      );
    }
    return (
      <Screen header={header}>
        {draftQuery.error ? <ErrorState error={draftQuery.error} onRetry={() => void draftQuery.refetch()} /> : <LoadingState variant="detail" />}
      </Screen>
    );
  }
  if (!form) {
    return (
      <Screen header={header}>
        {home.error ? (
          <ErrorState error={home.error} onRetry={() => void home.refetch()} />
        ) : home.data && home.data.circles.length === 0 ? (
          <EmptyState
            emoji="👋"
            title="Create a Circle first"
            message="Challenges happen inside a Circle, your private group. Create one or join with an invite code."
            action={<Button label="Go to Circles" icon={Users} fullWidth={false} onPress={() => router.replace('/circles')} />}
          />
        ) : (
          <LoadingState variant="detail" />
        )}
      </Screen>
    );
  }

  const definition = HABITS[form.habitType];
  const city = timeZoneCity(timezone);
  const blocked = stepIssues(step).length > 0 && (step !== 1 || attempted);

  const footer = (
    <>
      <Button
        label={step === 5 ? 'Publish challenge' : 'Next'}
        onPress={onNext}
        loading={task.isPending}
        disabled={blocked}
        disabledReason="Fix the highlighted details first"
        testID={step === 5 ? 'wizard-publish' : 'wizard-next'}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        <Button label="Save draft and close" variant="ghost" size="sm" fullWidth={false} onPress={onSaveAndClose} disabled={task.isPending} testID="wizard-save-close" />
        {draft ? (
          <Button label="Delete draft" variant="ghost" size="sm" fullWidth={false} onPress={() => setConfirmDelete(true)} disabled={task.isPending} testID="wizard-delete" />
        ) : null}
      </View>
    </>
  );

  /* ------------------------------------------------------------- steps */

  const stepOne = (
    <>
      <TitleBlock title="Pick a habit." subtitle="Choose the Circle that plays and what you’ll do every day." />
      <View style={{ gap: space.sm }}>
        <Text variant="calloutStrong">Circle</Text>
        {circles.length > 1 ? (
          <PillTabs
            role="choice"
            options={circles.map((c) => ({ value: c.id, label: c.name }))}
            value={form.circleId}
            onChange={(circleId) => {
              const next = circles.find((c) => c.id === circleId);
              if (!next) return;
              if (!datesTouched) {
                const fresh = freshForm(next, now, form.habitType);
                update({ circleId, startDate: fresh.startDate, endDate: fresh.endDate, requiredDays: fresh.requiredDays });
              } else update({ circleId });
            }}
            accessibilityLabel="Circle"
            testID="wizard-circle"
          />
        ) : (
          <Text variant="body">{circle?.name ?? 'This Circle'}</Text>
        )}
        {!circle ? (
          <Text variant="caption" color="danger">
            You’re no longer in this draft’s Circle. Choose another one.
          </Text>
        ) : null}
      </View>
      <View style={{ gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Habit">
        <Text variant="calloutStrong">Habit</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {HABIT_TYPES.map((type) => (
            <HabitTile
              key={type}
              habitType={type}
              selected={form.habitType === type}
              onPress={() => {
                if (type === form.habitType) return;
                const d = HABITS[type];
                update({ habitType: type, metricUnit: d.defaultUnit, target: d.defaultTarget, comparator: d.comparator, verification: d.defaultVerification });
              }}
            />
          ))}
        </View>
      </View>
      <TextField
        label="Challenge name"
        value={form.name}
        onChangeText={(name) => update({ name })}
        placeholder={NAME_PLACEHOLDER[form.habitType]}
        maxLength={LIMITS.maxNameLength}
        error={errorFor('name')}
        testID="wizard-name"
      />
      <TextField
        label="Description (optional)"
        value={form.description}
        onChangeText={(description) => update({ description })}
        placeholder="Why you’re doing this, or house rules in plain words"
        multiline
        maxLength={LIMITS.maxDescriptionLength}
        error={errorFor('description')}
        helper={`${form.description.length}/${LIMITS.maxDescriptionLength}`}
        testID="wizard-description"
      />
    </>
  );

  const targetStepper = () => {
    switch (form.habitType) {
      case 'screen_time':
        return (
          <Stepper
            label="Daily limit"
            value={form.target}
            onChange={(target) => update({ target })}
            min={definition.minTarget}
            max={definition.maxTarget}
            step={15}
            format={(v) => `${formatMinutes(v)} or less`}
            helper="Exactly on the limit counts. Over it is a missed goal, even with a verified screenshot."
            testID="wizard-target"
          />
        );
      case 'reading':
        return (
          <Stepper
            label="Minutes of reading a day"
            value={form.target}
            onChange={(target) => update({ target })}
            min={definition.minTarget}
            max={definition.maxTarget}
            step={definition.targetStep}
            format={(v) => `${formatMinutes(v)}+`}
            testID="wizard-target"
          />
        );
      case 'pushups':
        return (
          <Stepper
            label="Reps a day"
            value={form.target}
            onChange={(target) => update({ target })}
            min={definition.minTarget}
            max={definition.maxTarget}
            step={definition.targetStep}
            format={(v) => `${formatNumber(v)} reps`}
            helper="Players can add reps through the day."
            testID="wizard-target"
          />
        );
      case 'prayer':
        return <Banner title="One check-in a day" message="Prayer is a simple yes/no each day. Others only see that you checked in, never any detail." />;
      default:
        return (
          <>
            <PillTabs
              role="choice"
              stretch
              surface="flat"
              options={[
                { value: 'bool', label: 'Yes / no' },
                { value: 'gte', label: 'A number' },
              ]}
              value={form.comparator === 'gte' ? 'gte' : 'bool'}
              onChange={(value) =>
                update(value === 'bool' ? { comparator: 'bool', target: 1, metricUnit: 'check-in' } : { comparator: 'gte', target: Math.max(1, form.target), metricUnit: form.metricUnit === 'check-in' ? '' : form.metricUnit })
              }
              accessibilityLabel="Goal type"
              testID="wizard-comparator"
            />
            {form.comparator === 'gte' ? (
              <>
                <Stepper
                  label="Daily minimum"
                  value={form.target}
                  onChange={(target) => update({ target })}
                  min={1}
                  max={definition.maxTarget}
                  step={1}
                  format={(v) => `${formatNumber(v)}${form.metricUnit.trim() ? ` ${form.metricUnit.trim()}` : ''}`}
                  testID="wizard-target"
                />
                <TextField
                  label="Unit"
                  value={form.metricUnit}
                  onChangeText={(metricUnit) => update({ metricUnit })}
                  placeholder="glasses, km, pages…"
                  maxLength={LIMITS.maxUnitLength}
                  error={errorFor('metricUnit')}
                  testID="wizard-unit"
                />
              </>
            ) : (
              <Text variant="callout" color="textSecondary">
                Players check in once a day to say they did it.
              </Text>
            )}
          </>
        );
    }
  };

  const stepTwo = (
    <>
      <TitleBlock title="Set the goal." subtitle={describeGoal(form.habitType, form.comparator, form.target, form.metricUnit || 'units')} />
      {targetStepper()}
      {errorFor('target') ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {errorFor('target')}
        </Text>
      ) : null}
      {errorFor('comparator') ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {errorFor('comparator')}
        </Text>
      ) : null}
    </>
  );

  const tomorrow = addDays(today, 1);
  const startOptions = Array.from({ length: MAX_START_AHEAD_DAYS }, (_, i) => addDays(tomorrow, i));
  const endOptions = Array.from({ length: LIMITS.maxDurationDays }, (_, i) => addDays(form.startDate, i));

  const stepThree = (
    <>
      <TitleBlock title="Pick the dates." subtitle={`${formatDateRange(form.startDate, form.endDate)} · ${duration} ${duration === 1 ? 'day' : 'days'}`} />
      <SelectField label="Start date" value={formatDateKey(form.startDate)} onPress={() => setSheet('start')} error={errorFor('startDate')} testID="wizard-start" />
      <SelectField
        label="End date"
        value={formatDateKey(form.endDate)}
        onPress={() => setSheet('end')}
        error={errorFor('endDate')}
        helper={`Up to ${LIMITS.maxDurationDays} days. Every day is scheduled.`}
        testID="wizard-end"
      />
      <Card>
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
          <Globe size={20} color={colors.ink} strokeWidth={2.4} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">
              {city} time · {timeZoneAbbreviation(now, timezone)}
            </Text>
            <Text variant="caption" color="textSecondary">
              Every day runs midnight to midnight in {city} for everyone, wherever they are. It comes from the Circle and can’t change after publishing.
            </Text>
          </View>
        </View>
      </Card>
      <Stepper
        label="Successful days needed to finish"
        value={Math.min(form.requiredDays, Math.max(1, duration))}
        onChange={(requiredDays) => update({ requiredDays })}
        min={1}
        max={Math.max(1, duration)}
        format={(v) => `${v} of ${duration}`}
        testID="wizard-required"
      />
      {errorFor('requiredDays') ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {errorFor('requiredDays')}
        </Text>
      ) : null}
      <Banner icon={Clock} title="Deadline: noon the next day" message={deadlineSentence(form.habitType, timezone)} />
      <DateSheet
        visible={sheet === 'start'}
        onClose={() => setSheet(null)}
        title="Start date"
        subtitle="Starting tomorrow or later gives everyone time to read the rules and join."
        dates={startOptions}
        selected={form.startDate}
        describe={(date) => (date === tomorrow ? 'Tomorrow' : undefined)}
        onSelect={(startDate) => {
          setDatesTouched(true);
          const keep = Math.min(LIMITS.maxDurationDays, Math.max(1, duration));
          update({ startDate, endDate: addDays(startDate, keep - 1) });
        }}
        testID="wizard-start-sheet"
      />
      <DateSheet
        visible={sheet === 'end'}
        onClose={() => setSheet(null)}
        title="End date"
        dates={endOptions}
        selected={form.endDate}
        describe={(date) => {
          const n = durationDays(form.startDate, date);
          return `${n} ${n === 1 ? 'day' : 'days'}`;
        }}
        onSelect={(endDate) => {
          setDatesTouched(true);
          const next = durationDays(form.startDate, endDate);
          const allRequired = form.requiredDays === duration;
          update({ endDate, requiredDays: allRequired ? next : Math.min(form.requiredDays, next) });
        }}
        testID="wizard-end-sheet"
      />
    </>
  );

  const verifications = allowedVerifications(form.habitType);
  const stepFour = (
    <>
      <TitleBlock title="How is it checked?" subtitle="Pick what counts as proof and who looks at it." />
      {definition.evidenceMandatory ? (
        <Card testID="wizard-screenshot-required">
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
            <Lock size={20} color={colors.ink} strokeWidth={2.4} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="bodyStrong">Screenshot required</Text>
              <Text variant="callout" color="textSecondary">
                Screen time can’t be self-reported. After each day ends, players send that day’s screen-time screenshot from their primary phone, and an admin reviews it. There’s no device connection yet.
              </Text>
            </View>
          </View>
        </Card>
      ) : (
        <View style={{ gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Proof">
          {verifications.map((v) => (
            <ChoiceRow
              key={v}
              title={v === 'self_report' ? 'Self-report' : verificationLabel(form.habitType, v)}
              subtitle={v === 'self_report' ? 'Entries count right away and are labeled self-reported.' : 'Players attach a photo; it counts only after an admin approves it.'}
              selected={form.verification === v}
              onPress={() => update({ verification: v })}
              testID={`wizard-verification-${v.replace(/_/g, '-')}`}
            />
          ))}
        </View>
      )}
      {errorFor('verification') ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {errorFor('verification')}
        </Text>
      ) : null}
      <Card>
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
          <ShieldCheck size={20} color={colors.ink} strokeWidth={2.4} style={{ marginTop: 2 }} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Text variant="bodyStrong">Who reviews</Text>
            <Text variant="callout" color="textSecondary">
              You, the creator, are the first admin. You can add more admins after publishing.
            </Text>
            {form.verification === 'evidence' ? (
              <Text variant="callout" color="textSecondary">
                Proof waiting for review never counts and never turns into a pass or fail by itself. When an admin reviews their own proof, it’s labeled “Admin self-reviewed”.
              </Text>
            ) : null}
            <Text variant="callout" color="textSecondary">
              Any correction an admin makes is labeled “Admin adjusted”, needs a reason, and stays in the history.
            </Text>
          </View>
        </View>
      </Card>
    </>
  );

  const grossCents = Math.round(reward.dollars * 100);
  const preview = reward.mode === 'none' ? null : computeRewardPreview({ mode: reward.mode, grossCents, feeBps: ILLUSTRATIVE_FEE_BPS, qualifierIds: ['preview'] });
  const liveNote = 'Preview only in Demo Mode — Uplift doesn’t collect or pay out money.';
  const stepFive = (
    <>
      <TitleBlock title="Review and publish." subtitle="Members join by accepting exactly these rules." />
      <SectionHeading title="Reward" />
      <View style={{ gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Reward">
        <ChoiceRow title="No reward" subtitle="Play for the streak and the bragging rights." selected={reward.mode === 'none'} onPress={() => setReward((r) => ({ ...r, mode: 'none' }))} testID="wizard-reward-none" />
        <ChoiceRow
          title="Sponsor (demo preview)"
          subtitle={`You put up a prize for everyone who finishes. ${DEMO_REWARD_LABEL}.`}
          selected={reward.mode === 'demo_sponsor'}
          onPress={() => setReward((r) => ({ ...r, mode: 'demo_sponsor' }))}
          disabled={mode !== 'demo'}
          disabledNote={liveNote}
          leading={<FlaskConical size={18} color={reward.mode === 'demo_sponsor' ? colors.onInk : colors.warning} strokeWidth={2.4} />}
          testID="wizard-reward-sponsor"
        />
        <ChoiceRow
          title="Shared pot (demo preview)"
          subtitle={`Everyone chips in; finishers split it. ${DEMO_REWARD_LABEL}.`}
          selected={reward.mode === 'demo_pot'}
          onPress={() => setReward((r) => ({ ...r, mode: 'demo_pot' }))}
          disabled={mode !== 'demo'}
          disabledNote={liveNote}
          leading={<FlaskConical size={18} color={reward.mode === 'demo_pot' ? colors.onInk : colors.warning} strokeWidth={2.4} />}
          testID="wizard-reward-pot"
        />
      </View>
      {mode === 'demo' && preview ? (
        <Card>
          <DemoRewardBadge />
          <Stepper
            label={reward.mode === 'demo_sponsor' ? 'Simulated prize' : 'Simulated pot'}
            value={reward.dollars}
            onChange={(dollars) => setReward((r) => ({ ...r, dollars }))}
            min={5}
            max={1000}
            step={5}
            format={(v) => formatCents(v * 100)}
            testID="wizard-reward-amount"
          />
          <Text variant="callout" color="textSecondary">
            Fee {formatBps(ILLUSTRATIVE_FEE_BPS)}: {formatCents(preview.feeCents)} · {ILLUSTRATIVE_FEE_LABEL}. {formatCents(preview.netCents)} would be split among finishers. {DEMO_REWARD_LABEL}.
          </Text>
        </Card>
      ) : null}

      <SectionHeading title="Rules" />
      <RulesSummary
        rules={{ ...form, timezone }}
        extra={[
          { label: 'Circle', value: circle?.name ?? '—' },
          { label: 'Admin', value: 'You (the creator)' },
          { label: 'Name', value: form.name.trim() || '—', note: form.description.trim() || undefined },
          { label: 'Reward', value: reward.mode === 'none' || mode !== 'demo' ? 'No reward' : `${formatCents(grossCents)} · ${DEMO_REWARD_LABEL}` },
        ]}
      />
      <SwitchRow title="I’m playing too" subtitle="Join as a player as soon as it’s published. You stay an admin either way." value={playing} onValueChange={setPlaying} testID="wizard-playing" />
      {issues.length > 0 ? (
        <Banner tone="danger" title="Fix these before publishing" message={issues.map((issue) => issue.message).join(' ')} />
      ) : null}
    </>
  );

  return (
    <Screen header={header} footer={footer} testID="challenge-wizard">
      <PillTabs
        options={STEPS.map((s) => ({ value: String(s.step), label: s.label, prefix: String(s.step), disabled: s.step > maxStep }))}
        value={String(step)}
        onChange={(value) => setStep(clampStep(Number(value)))}
        accessibilityLabel="Wizard steps"
        testID="wizard-step"
      />
      {step === 1 ? stepOne : step === 2 ? stepTwo : step === 3 ? stepThree : step === 4 ? stepFour : stepFive}
      <ConfirmationSheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this draft?"
        message="It was never published, so nobody else has seen it. This can’t be undone."
        confirmLabel="Delete draft"
        confirmVariant="danger"
        loading={task.isPending}
        onConfirm={onDelete}
        testID="wizard-delete-confirm"
      />
    </Screen>
  );
}
