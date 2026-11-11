import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadow, space } from '@/theme/tokens';

import { ChevronRight, type LucideIcon } from './icons';
import { Text } from './Text';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  /** paper: warm fill, no border (default). float: white with a soft shadow. */
  tone?: 'paper' | 'float' | 'ink';
  padding?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** A soft, borderless container. Cards are fills, not outlines. */
export function Card({ children, onPress, tone = 'paper', padding = space.xl, accessibilityLabel, accessibilityHint, testID, style }: CardProps) {
  const base: ViewStyle = {
    borderRadius: radius.xl,
    padding,
    gap: space.lg,
    backgroundColor: tone === 'ink' ? colors.ink : tone === 'float' ? colors.bg : colors.surface,
  };
  if (!onPress) {
    return (
      <View style={[base, tone === 'float' ? shadow.float : null, style]} testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      style={({ pressed }) => [
        base,
        tone === 'float' ? shadow.float : null,
        pressed ? { backgroundColor: tone === 'ink' ? colors.inkPressed : tone === 'float' ? colors.surface : colors.surfaceStrong } : null,
        style,
      ]}>
      {children}
    </Pressable>
  );
}

export interface ListRowProps {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  icon?: LucideIcon;
  trailing?: ReactNode;
  /** Shows a chevron and makes the row tappable. */
  onPress?: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** Explains a disabled row instead of leaving a dead control. */
  disabledNote?: string;
  accessibilityLabel?: string;
  testID?: string;
}

/** Comfortable 56pt+ row for settings and member lists. */
export function ListRow({ title, subtitle, leading, icon: Icon, trailing, onPress, tone = 'default', disabled, disabledNote, accessibilityLabel, testID }: ListRowProps) {
  const color = disabled ? 'textTertiary' : tone === 'danger' ? 'danger' : 'ink';
  const content = (
    <>
      {leading ??
        (Icon ? (
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: tone === 'danger' ? colors.dangerSoft : colors.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={19} color={colors[color]} strokeWidth={2.2} />
          </View>
        ) : null)}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" color={color}>
          {title}
        </Text>
        {subtitle || (disabled && disabledNote) ? (
          <Text variant="caption" color="textSecondary">
            {disabled && disabledNote ? disabledNote : subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {onPress && !disabled ? <ChevronRight size={18} color={colors.textTertiary} strokeWidth={2.4} /> : null}
    </>
  );
  const style: ViewStyle = { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm };
  if (!onPress || disabled) {
    return (
      <View style={style} accessible accessibilityLabel={accessibilityLabel} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}. ${subtitle}` : title)}
      testID={testID}
      style={({ pressed }) => [style, pressed ? { opacity: 0.6 } : null]}>
      {content}
    </Pressable>
  );
}

/** Hairline used sparingly between rows inside a card. */
export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}
