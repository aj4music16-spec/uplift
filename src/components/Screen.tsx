import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, gutter, layout, space } from '@/theme/tokens';

import { IconButton } from './Button';
import { ArrowLeft, X } from './icons';
import { Text } from './Text';

export interface ScreenProps {
  children: ReactNode;
  /** Fixed above the content (inside the top safe area). */
  header?: ReactNode;
  /** Fixed below the content, above the bottom safe area: the screen's main action. */
  footer?: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Tab screens leave room for the floating tab bar. */
  tabBarInset?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Screen shell: white background, safe areas, keyboard avoidance, a centered
 * max width on large screens, and an optional pinned footer action.
 */
export function Screen({ children, header, footer, scroll = true, refreshing, onRefresh, tabBarInset = false, contentStyle, testID }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = footer ? space.lg : insets.bottom + space.xxl + (tabBarInset ? layout.tabBarHeight + space.md : 0);
  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.ink} /> : undefined}
      contentContainerStyle={[{ paddingHorizontal: gutter, paddingTop: space.sm, paddingBottom: bottomPad, gap: space.xl }, contentStyle]}>
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, paddingHorizontal: gutter, paddingTop: space.sm, paddingBottom: footer ? 0 : bottomPad }, contentStyle]}>{children}</View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }} testID={testID}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center' }}>
        <View style={{ paddingTop: insets.top }}>{header}</View>
        {body}
        {footer ? (
          <View
            style={{
              paddingHorizontal: gutter,
              paddingTop: space.md,
              paddingBottom: Math.max(insets.bottom, space.lg),
              gap: space.sm,
              backgroundColor: colors.bg,
            }}>
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

export interface NavHeaderProps {
  /** Small centered title; omit when the screen has its own large heading. */
  title?: string;
  /** back: arrow. close: ×, for modal-style flows. none: no leading button. */
  leading?: 'back' | 'close' | 'none';
  onLeading?: () => void;
  right?: ReactNode;
}

/** Top bar for pushed screens: a floating circular back/close button and optional actions. */
export function NavHeader({ title, leading = 'back', onLeading, right }: NavHeaderProps) {
  const router = useRouter();
  const goBack = onLeading ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  return (
    <View style={{ minHeight: 56, paddingHorizontal: gutter, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      {leading === 'none' ? null : (
        <IconButton icon={leading === 'close' ? X : ArrowLeft} label={leading === 'close' ? 'Close' : 'Back'} onPress={goBack} testID="nav-back" />
      )}
      <View style={{ flex: 1 }}>
        {title ? (
          <Text variant="subhead" numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        ) : null}
      </View>
      {right ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>{right}</View> : null}
    </View>
  );
}

export interface TitleBlockProps {
  title: string;
  subtitle?: string;
  /** display for tab roots and hero screens, title for everything else. */
  size?: 'display' | 'title';
  right?: ReactNode;
}

/** The large confident heading with a quiet grey line under it. */
export function TitleBlock({ title, subtitle, size = 'title', right }: TitleBlockProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text variant={size} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="body" color="textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, minHeight: 28 }}>
      <Text variant="headline" accessibilityRole="header">
        {title}
      </Text>
      {action}
    </View>
  );
}
