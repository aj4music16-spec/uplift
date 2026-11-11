import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';

import { describeError } from '@/domain/errors';
import { useReducedMotion } from '@/lib/motion';
import { colors, radius, space } from '@/theme/tokens';

import { Button } from './Button';
import { RefreshCw, WifiOff } from './icons';
import { Text } from './Text';

export interface EmptyStateProps {
  /** A single playful emoji, used sparingly. */
  emoji?: string;
  title: string;
  message?: string;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ emoji, title, message, action, compact = false }: EmptyStateProps) {
  return (
    <View style={{ alignItems: 'center', gap: space.md, paddingVertical: compact ? space.xxl : space.giant, paddingHorizontal: space.lg }}>
      {emoji ? (
        <Text style={{ fontSize: compact ? 40 : 56, lineHeight: compact ? 50 : 68 }} maxFontSizeMultiplier={1} accessibilityElementsHidden importantForAccessibility="no">
          {emoji}
        </Text>
      ) : null}
      <Text variant="headline" align="center">
        {title}
      </Text>
      {message ? (
        <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 320 }}>
          {message}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: space.sm, alignSelf: 'stretch', alignItems: 'center' }}>{action}</View> : null}
    </View>
  );
}

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}

/** Maps any failure to actionable copy. Shows an icon and an explanation, never just a color. */
export function ErrorState({ error, onRetry, compact = false }: ErrorStateProps) {
  const copy = describeError(error);
  const offline = copy.code === 'NETWORK';
  return (
    <View
      accessibilityRole="alert"
      style={{ alignItems: 'center', gap: space.md, paddingVertical: compact ? space.xxl : space.giant, paddingHorizontal: space.lg }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: offline ? colors.surface : colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
        {offline ? <WifiOff size={24} color={colors.ink} strokeWidth={2.2} /> : <Text style={{ fontSize: 26 }}>🙈</Text>}
      </View>
      <Text variant="headline" align="center">
        {copy.title}
      </Text>
      <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 320 }}>
        {copy.message}
      </Text>
      {onRetry ? <Button label="Try again" icon={RefreshCw} variant="secondary" size="md" fullWidth={false} onPress={onRetry} /> : null}
    </View>
  );
}

function SkeletonBlock({ height, width, round = radius.lg }: { height: number; width?: number | `${number}%`; round?: number }) {
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduced]);
  return <Animated.View style={{ height, width: width ?? '100%', borderRadius: round, backgroundColor: colors.surface, opacity }} />;
}

/** Skeleton placeholders shaped like the content they stand in for. */
export function LoadingState({ variant = 'cards' }: { variant?: 'cards' | 'list' | 'detail' }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading" style={{ gap: space.lg }}>
      {variant === 'detail' ? (
        <>
          <SkeletonBlock height={36} width="70%" round={12} />
          <SkeletonBlock height={18} width="45%" round={9} />
          <SkeletonBlock height={160} round={radius.xl} />
          <SkeletonBlock height={120} round={radius.xl} />
        </>
      ) : variant === 'list' ? (
        [0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <SkeletonBlock height={44} width={44} round={22} />
            <View style={{ flex: 1, gap: space.sm }}>
              <SkeletonBlock height={16} width="60%" round={8} />
              <SkeletonBlock height={12} width="35%" round={6} />
            </View>
          </View>
        ))
      ) : (
        <>
          <SkeletonBlock height={170} round={radius.xl} />
          <SkeletonBlock height={170} round={radius.xl} />
        </>
      )}
    </View>
  );
}

/** Renders loading, error or content for a query, so no screen forgets a state. */
export function QueryBoundary<T>({
  query,
  loading,
  children,
}: {
  query: { data: T | undefined; error: unknown; isPending: boolean; refetch: () => unknown };
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isPending) return <>{loading ?? <LoadingState />}</>;
  return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
}
