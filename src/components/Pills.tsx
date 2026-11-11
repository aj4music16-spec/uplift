import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadow, space } from '@/theme/tokens';

import { Text } from './Text';

export interface PillOption<T extends string> {
  value: T;
  label: string;
  /** Small leading number ("1 Vote") or count. */
  prefix?: string;
  /** Unread/attention count shown after the label. */
  count?: number;
  disabled?: boolean;
}

export interface PillTabsProps<T extends string> {
  options: readonly PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** tabs: switches a view (tablist). choice: selects a value (radiogroup). */
  role?: 'tabs' | 'choice';
  /** Fill the row evenly instead of hugging the labels. */
  stretch?: boolean;
  /** Unselected pills sit on white with a soft shadow, or flat on a surface. */
  surface?: 'float' | 'flat';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Rounded pill controls with a strong black selected state — the main
 * selection pattern in the app (tabs, segmented choices, wizard steps).
 */
export function PillTabs<T extends string>({
  options,
  value,
  onChange,
  role = 'tabs',
  stretch = false,
  surface = 'float',
  accessibilityLabel,
  style,
  testID,
}: PillTabsProps<T>) {
  const content = options.map((option) => {
    const selected = option.value === value;
    return (
      <Pressable
        key={option.value}
        onPress={option.disabled ? undefined : () => onChange(option.value)}
        disabled={option.disabled}
        accessibilityRole={role === 'tabs' ? 'tab' : 'radio'}
        accessibilityState={role === 'tabs' ? { selected, disabled: !!option.disabled } : { checked: selected, disabled: !!option.disabled }}
        accessibilityLabel={option.count ? `${option.label}, ${option.count} new` : option.label}
        testID={testID ? `${testID}-${option.value}` : undefined}
        style={({ pressed }) => [
          {
            minHeight: 44,
            paddingHorizontal: space.lg,
            borderRadius: radius.pill,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            flexGrow: stretch ? 1 : 0,
            flexBasis: stretch ? 0 : undefined,
            backgroundColor: selected ? colors.ink : pressed ? colors.surfaceStrong : surface === 'float' ? colors.bg : colors.surface,
            opacity: option.disabled ? 0.5 : 1,
          },
          !selected && surface === 'float' ? shadow.soft : null,
        ]}>
        {option.prefix ? (
          <Text variant="labelSmall" color={selected ? 'onInkSecondary' : 'textTertiary'}>
            {option.prefix}
          </Text>
        ) : null}
        <Text variant="labelSmall" color={selected ? 'onInk' : 'ink'} numberOfLines={1}>
          {option.label}
        </Text>
        {option.count ? (
          <View
            style={{
              minWidth: 20,
              height: 20,
              paddingHorizontal: 6,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.signal,
            }}>
            <Text variant="micro" color="ink">
              {option.count > 99 ? '99+' : option.count}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  });

  if (stretch) {
    return (
      <View accessibilityRole={role === 'tabs' ? 'tablist' : 'radiogroup'} accessibilityLabel={accessibilityLabel} style={[{ flexDirection: 'row', gap: space.sm }, style]}>
        {content}
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole={role === 'tabs' ? 'tablist' : 'radiogroup'}
      accessibilityLabel={accessibilityLabel}
      style={[{ flexGrow: 0, marginHorizontal: -space.xl }, style]}
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.xl, paddingVertical: 6 }}>
      {content}
    </ScrollView>
  );
}
