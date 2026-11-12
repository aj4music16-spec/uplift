import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/Button';
import { TextField } from '@/components/Fields';
import { ArrowLeft } from '@/components/icons';
import { ErrorState } from '@/components/States';
import { Text } from '@/components/Text';
import { describeError, formatMinutes, type HabitType } from '@/domain';
import { space } from '@/theme/tokens';

import { parseAmount, parseHoursMinutes } from './logic';

/**
 * Error state for data screens. Lost permission (FORBIDDEN / NOT_FOUND)
 * can't be fixed by retrying, so it explains and offers to go back instead.
 */
export function DataError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const router = useRouter();
  const code = describeError(error).code;
  const lost = code === 'FORBIDDEN' || code === 'NOT_FOUND';
  return (
    <View style={{ gap: space.md }}>
      <ErrorState error={error} onRetry={lost ? undefined : onRetry} />
      {lost ? (
        <Button
          label="Go back"
          icon={ArrowLeft}
          variant="secondary"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          testID="lost-access-back"
        />
      ) : null}
    </View>
  );
}

export interface AmountFieldProps {
  label: string;
  unit: string;
  habitType: HabitType;
  value: number | null;
  onChange: (value: number | null) => void;
  helper?: string;
  testID?: string;
}

/** A value entry for a numeric goal: hours + minutes for minute goals, a number otherwise. */
export function AmountField({ label, unit, habitType, value, onChange, helper, testID }: AmountFieldProps) {
  const minutesMode = unit === 'minutes';
  const [hours, setHours] = useState(value != null && minutesMode ? String(Math.floor(value / 60)) : '');
  const [mins, setMins] = useState(value != null && minutesMode ? String(value % 60) : '');
  const [text, setText] = useState(value != null && !minutesMode ? String(value) : '');

  // Follow outside changes (quick-add buttons, a reset after success) without an effect.
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    if (minutesMode) {
      if (parseHoursMinutes(hours, mins) !== value) {
        setHours(value == null ? '' : String(Math.floor(value / 60)));
        setMins(value == null ? '' : String(value % 60));
      }
    } else if (parseAmount(text, habitType === 'custom') !== value) {
      setText(value == null ? '' : String(value));
    }
  }

  if (minutesMode) {
    const parsed = parseHoursMinutes(hours, mins);
    const invalid = (hours !== '' || mins !== '') && parsed == null;
    return (
      <View style={{ gap: space.sm }}>
        <Text variant="calloutStrong">{label}</Text>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <TextField
              label="Hours"
              value={hours}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="0"
              onChangeText={(next) => {
                setHours(next);
                onChange(parseHoursMinutes(next, mins));
              }}
              testID={testID ? `${testID}-hours` : undefined}
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label="Minutes"
              value={mins}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="0"
              onChangeText={(next) => {
                setMins(next);
                onChange(parseHoursMinutes(hours, next));
              }}
              testID={testID ? `${testID}-minutes` : undefined}
            />
          </View>
        </View>
        {invalid ? (
          <Text variant="caption" color="danger" accessibilityRole="alert">
            Enter whole hours and 0–59 minutes, up to 24 hours in total.
          </Text>
        ) : (
          <Text variant="caption" color="textSecondary">
            {parsed != null ? `Total: ${formatMinutes(parsed)}. ` : ''}
            {helper ?? ''}
          </Text>
        )}
      </View>
    );
  }
  const parsed = parseAmount(text, habitType === 'custom');
  return (
    <TextField
      label={label}
      value={text}
      keyboardType={habitType === 'custom' ? 'decimal-pad' : 'number-pad'}
      maxLength={9}
      placeholder={`Amount in ${unit}`}
      onChangeText={(next) => {
        setText(next);
        onChange(parseAmount(next, habitType === 'custom'));
      }}
      error={text !== '' && parsed == null ? 'Enter a number of zero or more.' : undefined}
      helper={helper ?? `In ${unit}`}
      testID={testID}
    />
  );
}
