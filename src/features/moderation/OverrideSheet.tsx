import { useState } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/Badges';
import { Button } from '@/components/Button';
import { TextField } from '@/components/Fields';
import { SlidersHorizontal, TriangleAlert } from '@/components/icons';
import { PillTabs } from '@/components/Pills';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { useAction } from '@/data/hooks';
import type { DayDetail } from '@/data/types';
import { describeError, formatDateKey, formatValue, LIMITS, meetsTarget, toAppError, type Comparator, type HabitType } from '@/domain';
import { AmountField } from '@/features/checkins/common';
import { space } from '@/theme/tokens';

export interface OverrideTarget {
  participantId: string;
  personName: string;
  date: string;
  habitType: HabitType;
  comparator: Comparator;
  target: number;
  unit: string;
  /** Revision of the day's record, or 0 when the day has no record yet. */
  expectedRevision: number;
  currentLabel?: string;
}

export function overrideTargetFromDay(day: DayDetail, currentLabel?: string): OverrideTarget {
  return {
    participantId: day.participantId,
    personName: day.person.displayName,
    date: day.date,
    habitType: day.habitType,
    comparator: day.rule.comparator,
    target: day.rule.target,
    unit: day.metricUnit,
    expectedRevision: day.record?.revision ?? 0,
    currentLabel,
  };
}

export interface OverrideSheetProps {
  visible: boolean;
  onClose: () => void;
  target: OverrideTarget | null;
  onDone?: (day: DayDetail) => void;
}

/** An admin sets a day's result by hand. Always labeled "Admin adjusted", always with a reason. */
export function OverrideSheet({ visible, onClose, target, onDone }: OverrideSheetProps) {
  // The form is mounted fresh each time it opens, so it never shows a previous attempt.
  if (!visible || !target) return null;
  return <OverrideForm onClose={onClose} target={target} onDone={onDone} />;
}

function OverrideForm({ onClose, target, onDone }: { onClose: () => void; target: OverrideTarget; onDone?: (day: DayDetail) => void }) {
  const [outcome, setOutcome] = useState<'success' | 'fail'>('success');
  const [value, setValue] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [conflict, setConflict] = useState(false);

  const action = useAction((repo, input: Parameters<typeof repo.overrideDay>[0]) => repo.overrideDay(input), {
    onSuccess: (day) => {
      onDone?.(day);
      onClose();
    },
    onError: (error) => setConflict(toAppError(error).code === 'REVISION_CONFLICT'),
  });

  const bool = target.comparator === 'bool';
  const reasonOk = reason.trim().length >= LIMITS.minReasonLength;
  const mismatch = value != null && !bool && meetsTarget(target.comparator, target.target, value) !== (outcome === 'success');
  const fmt = (v: number) => formatValue(target.habitType, target.comparator, target.unit, v);
  const errorCopy = action.error && !conflict ? describeError(action.error) : null;

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Adjust result"
      subtitle={`${target.personName} · ${formatDateKey(target.date)}${target.currentLabel ? ` · now: ${target.currentLabel}` : ''}`}
      testID="override-sheet"
      footer={
        <>
          <Button
            label="Adjust result"
            icon={SlidersHorizontal}
            onPress={() =>
              action.mutate({
                participantId: target.participantId,
                date: target.date,
                outcome,
                value: bool ? null : value,
                reason: reason.trim(),
                expectedRevision: target.expectedRevision,
              })
            }
            disabled={!reasonOk}
            disabledReason="Add a short reason first"
            loading={action.isPending}
            testID="override-submit"
          />
          <Button label="Cancel" variant="ghost" size="md" onPress={onClose} />
        </>
      }>
      <View style={{ gap: space.sm }}>
        <Text variant="calloutStrong">Result</Text>
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
          accessibilityLabel="Result"
          testID="override-outcome"
        />
      </View>
      {bool ? null : (
        <AmountField
          label="Corrected value (optional)"
          unit={target.unit}
          habitType={target.habitType}
          value={value}
          onChange={setValue}
          helper={`Goal: ${target.comparator === 'lte' ? 'at most' : 'at least'} ${fmt(target.target)}`}
          testID="override-value"
        />
      )}
      {mismatch && value != null ? (
        <Banner
          tone="warning"
          icon={TriangleAlert}
          message={`${fmt(value)} would ${meetsTarget(target.comparator, target.target, value) ? 'meet' : 'not meet'} the goal, but you chose “${outcome === 'success' ? 'Counts' : 'Doesn’t count'}”. That’s allowed — say why in the reason.`}
        />
      ) : null}
      <TextField
        label="Reason"
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={LIMITS.maxReasonLength}
        placeholder="For example: showed me the Day view in person"
        helper="Required. Shown with the result and in the change history."
        testID="override-reason"
      />
      <Banner
        icon={SlidersHorizontal}
        message={`This is shown as “Admin adjusted” with your reason — never as verified proof. It’s recorded in the change history, and ${target.personName} is notified.`}
      />
      {conflict ? (
        <Banner tone="warning" title="Someone else changed this day" message="We’ve loaded the latest version. Check the current result, then adjust it again if it’s still needed." />
      ) : errorCopy ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {errorCopy.message}
        </Text>
      ) : null}
    </Sheet>
  );
}
