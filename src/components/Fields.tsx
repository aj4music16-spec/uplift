import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, Switch, TextInput, View, type KeyboardTypeOptions, type TextInputProps } from 'react-native';

import { colors, radius, space } from '@/theme/tokens';
import { fonts } from '@/theme/typography';

import { Check, ChevronDown, CircleAlert, Minus, Plus } from './icons';
import { Text } from './Text';

export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  helper?: string;
  error?: string;
  multiline?: boolean;
  maxLength?: number;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  onBlur?: () => void;
  editable?: boolean;
  trailing?: ReactNode;
  autoFocus?: boolean;
  testID?: string;
}

/** Labeled input on warm paper. Errors show an icon and a sentence, not just a red outline. */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  helper,
  error,
  multiline = false,
  maxLength,
  keyboardType,
  secureTextEntry,
  autoCapitalize,
  autoComplete,
  textContentType,
  returnKeyType,
  onSubmitEditing,
  onBlur,
  editable = true,
  trailing,
  autoFocus,
  testID,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="calloutStrong">{label}</Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          minHeight: multiline ? 96 : 52,
          borderRadius: radius.md,
          backgroundColor: editable ? colors.surface : colors.surfaceStrong,
          borderWidth: focused || error ? 2 : 1,
          borderColor: error ? colors.danger : focused ? colors.ink : colors.borderStrong,
          paddingHorizontal: focused || error ? space.lg - 1 : space.lg,
        }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          multiline={multiline}
          maxLength={maxLength}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          textContentType={textContentType}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          editable={editable}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          accessibilityLabel={label}
          accessibilityHint={error ?? helper}
          testID={testID}
          textAlignVertical={multiline ? 'top' : 'center'}
          style={{
            flex: 1,
            fontFamily: fonts.body,
            fontSize: 16,
            lineHeight: 22,
            color: colors.ink,
            paddingVertical: multiline ? space.md : 0,
            minHeight: multiline ? 92 : 48,
            // Removes the browser focus ring; the field border shows focus instead.
            ...({ outlineStyle: 'none' } as object),
          }}
        />
        {trailing}
      </View>
      {error ? (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }} accessibilityRole="alert">
          <CircleAlert size={15} color={colors.danger} strokeWidth={2.6} style={{ marginTop: 2 }} />
          <Text variant="caption" color="danger" style={{ flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : helper ? (
        <Text variant="caption" color="textSecondary">
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

export interface StepperProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  helper?: string;
  testID?: string;
}

/** Big, thumb-friendly − / + control for targets and day counts. */
export function Stepper({ label, value, onChange, min, max, step = 1, format, helper, testID }: StepperProps) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const text = format ? format(value) : String(value);
  const button = (kind: 'minus' | 'plus') => {
    const disabled = kind === 'minus' ? value <= min : value >= max;
    const Icon = kind === 'minus' ? Minus : Plus;
    return (
      <Pressable
        onPress={() => onChange(clamp(value + (kind === 'minus' ? -step : step)))}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={kind === 'minus' ? `Decrease ${label}` : `Increase ${label}`}
        accessibilityState={{ disabled }}
        testID={testID ? `${testID}-${kind}` : undefined}
        style={({ pressed }) => ({
          width: 48,
          height: 48,
          borderRadius: 24,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: disabled ? colors.surfaceStrong : pressed ? colors.inkPressed : colors.ink,
        })}>
        <Icon size={20} color={disabled ? colors.textTertiary : colors.onInk} strokeWidth={2.6} />
      </Pressable>
    );
  };
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="calloutStrong">{label}</Text>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => onChange(clamp(value + (event.nativeEvent.actionName === 'increment' ? step : -step)))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.xl, padding: space.sm }}>
        {button('minus')}
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text variant="title" testID={testID ? `${testID}-value` : undefined}>
            {text}
          </Text>
        </View>
        {button('plus')}
      </View>
      {helper ? (
        <Text variant="caption" color="textSecondary">
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

export interface SelectFieldProps {
  label: string;
  value: string;
  onPress: () => void;
  helper?: string;
  error?: string;
  disabled?: boolean;
  testID?: string;
}

/** A field that opens a sheet of choices. */
export function SelectField({ label, value, onPress, helper, error, disabled, testID }: SelectFieldProps) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="calloutStrong">{label}</Text>
      <Pressable
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        accessibilityHint="Opens a list of choices"
        testID={testID}
        style={({ pressed }) => ({
          minHeight: 52,
          borderRadius: radius.md,
          backgroundColor: disabled ? colors.surfaceStrong : pressed ? colors.surfaceStrong : colors.surface,
          borderWidth: error ? 2 : 1,
          borderColor: error ? colors.danger : colors.borderStrong,
          paddingHorizontal: space.lg,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
        })}>
        <Text variant="body" color={disabled ? 'textSecondary' : 'ink'} style={{ flex: 1 }} numberOfLines={1}>
          {value}
        </Text>
        {disabled ? null : <ChevronDown size={18} color={colors.textSecondary} strokeWidth={2.4} />}
      </Pressable>
      {error ? (
        <Text variant="caption" color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : helper ? (
        <Text variant="caption" color="textSecondary">
          {helper}
        </Text>
      ) : null}
    </View>
  );
}

export interface ChoiceRowProps {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  leading?: ReactNode;
  disabled?: boolean;
  /** Why this option cannot be chosen. Shown instead of hiding the option. */
  disabledNote?: string;
  trailing?: ReactNode;
  testID?: string;
}

/** A large selectable row (radio). Selected rows turn black, like the pills. */
export function ChoiceRow({ title, subtitle, selected, onPress, leading, disabled, disabledNote, trailing, testID }: ChoiceRowProps) {
  const fg = selected ? 'onInk' : disabled ? 'textTertiary' : 'ink';
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      accessibilityLabel={`${title}${subtitle ? `. ${subtitle}` : ''}${disabled && disabledNote ? `. ${disabledNote}` : ''}`}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: 64,
        borderRadius: radius.lg,
        padding: space.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        backgroundColor: selected ? colors.ink : pressed ? colors.surfaceStrong : colors.surface,
      })}>
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" color={fg}>
          {title}
        </Text>
        {subtitle || (disabled && disabledNote) ? (
          <Text variant="caption" color={selected ? 'onInkSecondary' : 'textSecondary'}>
            {disabled && disabledNote ? disabledNote : subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: selected ? 0 : 2,
          borderColor: disabled ? colors.surfaceSunken : colors.borderStrong,
          backgroundColor: selected ? colors.bg : colors.transparent,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {selected ? <Check size={15} color={colors.ink} strokeWidth={3.2} /> : null}
      </View>
    </Pressable>
  );
}

export interface SwitchRowProps {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}

export function SwitchRow({ title, subtitle, value, onValueChange, disabled, testID }: SwitchRowProps) {
  return (
    <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" color={disabled ? 'textTertiary' : 'ink'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={title}
        testID={testID}
        trackColor={{ false: colors.surfaceSunken, true: colors.ink }}
        thumbColor={colors.bg}
        ios_backgroundColor={colors.surfaceSunken}
      />
    </View>
  );
}
