import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadow, space, touch } from '@/theme/tokens';

import type { LucideIcon } from './icons';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'floating' | 'danger' | 'ghost';
export type ButtonSize = 'lg' | 'md' | 'sm';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  trailing?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  /** Shown to screen readers when the button is disabled, to explain why. */
  disabledReason?: string;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const HEIGHT: Record<ButtonSize, number> = { lg: 56, md: 48, sm: 40 };

const PALETTE: Record<ButtonVariant, { bg: string; pressed: string; fg: 'onInk' | 'ink' | 'danger' }> = {
  primary: { bg: colors.ink, pressed: colors.inkPressed, fg: 'onInk' },
  secondary: { bg: colors.surface, pressed: colors.surfaceStrong, fg: 'ink' },
  floating: { bg: colors.bg, pressed: colors.surface, fg: 'ink' },
  danger: { bg: colors.dangerSoft, pressed: '#F9D2CD', fg: 'danger' },
  ghost: { bg: colors.transparent, pressed: colors.surface, fg: 'ink' },
};

/**
 * Pill button. The primary action on a screen is always the black one; there
 * is never more than one primary per view.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon: Icon,
  trailing,
  loading = false,
  disabled = false,
  disabledReason,
  fullWidth = true,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const palette = PALETTE[variant];
  const inactive = disabled || loading;
  const fg = disabled ? 'textTertiary' : palette.fg;
  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={disabled && disabledReason ? disabledReason : accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      testID={testID}
      hitSlop={size === 'sm' ? { top: (touch - HEIGHT.sm) / 2, bottom: (touch - HEIGHT.sm) / 2 } : undefined}
      style={({ pressed }) => [
        {
          minHeight: HEIGHT[size],
          borderRadius: radius.pill,
          paddingHorizontal: size === 'sm' ? space.lg : space.xxl,
          paddingVertical: space.sm,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          backgroundColor: disabled ? colors.surfaceStrong : pressed ? palette.pressed : palette.bg,
        },
        variant === 'floating' && !disabled ? shadow.soft : null,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={colors[fg]} />
      ) : Icon ? (
        <Icon size={size === 'sm' ? 16 : 19} color={colors[fg]} strokeWidth={2.4} />
      ) : null}
      <Text variant={size === 'sm' ? 'labelSmall' : 'label'} color={fg} align="center" style={{ flexShrink: 1 }}>
        {label}
      </Text>
      {trailing ? <View>{trailing}</View> : null}
    </Pressable>
  );
}

export interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onPress?: () => void;
  /** float: white circle with a soft shadow (the reference's close button). */
  variant?: 'float' | 'surface' | 'ink' | 'plain';
  size?: number;
  disabled?: boolean;
  badge?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({ icon: Icon, label, onPress, variant = 'float', size = 44, disabled, badge, testID, style }: IconButtonProps) {
  const bg = variant === 'ink' ? colors.ink : variant === 'surface' ? colors.surface : variant === 'plain' ? colors.transparent : colors.bg;
  const fg = variant === 'ink' ? colors.onInk : disabled ? colors.textTertiary : colors.ink;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      hitSlop={size < touch ? (touch - size) / 2 : 4}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed && variant !== 'ink' ? colors.surfaceStrong : bg,
          opacity: pressed && variant === 'ink' ? 0.85 : 1,
        },
        variant === 'float' ? shadow.soft : null,
        style,
      ]}>
      <Icon size={Math.round(size * 0.45)} color={fg} strokeWidth={2.4} />
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: size * 0.16,
            right: size * 0.18,
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: colors.signal,
            borderWidth: 2,
            borderColor: bg === colors.transparent ? colors.bg : bg,
          }}
        />
      ) : null}
    </Pressable>
  );
}
