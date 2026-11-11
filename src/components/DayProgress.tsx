import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { formatDateKeyLong, weekdayInitial } from '@/domain/format';
import type { DayStatus } from '@/domain/types';
import { colors, space } from '@/theme/tokens';

import { Check, Clock, CircleAlert, Minus, SlidersHorizontal, X } from './icons';
import { Text } from './Text';

export interface DayCellLike {
  date: string;
  status: DayStatus;
  adjusted: boolean;
}

/** Words for each day state. Used for labels and screen readers. */
export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  upcoming: 'Upcoming',
  open: 'In progress',
  due: 'Check-in due',
  pending: 'Awaiting review',
  late_pending: 'Late — awaiting admin',
  success: 'Completed',
  fail: 'Not met',
  rejected: 'Proof rejected',
  missed: 'Missed',
};

function dotStyle(status: DayStatus): { bg: string; ring?: string; dashed?: boolean } {
  switch (status) {
    case 'success':
      return { bg: colors.ink };
    case 'pending':
    case 'late_pending':
      return { bg: colors.warningSoft };
    case 'rejected':
      return { bg: colors.dangerSoft };
    case 'fail':
    case 'missed':
      return { bg: colors.surfaceSunken };
    case 'open':
      return { bg: colors.bg, ring: colors.ink };
    case 'due':
      return { bg: colors.bg, ring: colors.ink, dashed: true };
    default:
      return { bg: colors.surfaceStrong };
  }
}

export interface DayDotProps {
  cell: DayCellLike;
  size?: number;
  onPress?: () => void;
  selected?: boolean;
}

/**
 * One challenge day. State is carried by a glyph (check, clock, ×, weekday
 * letter) with measured contrast, not by fill color alone. A completed day is
 * a solid black dot — the same lifted dot as the wordmark.
 */
export function DayDot({ cell, size = 34, onPress, selected = false }: DayDotProps) {
  const style = dotStyle(cell.status);
  const glyph = Math.round(size * 0.46);
  const label = `${formatDateKeyLong(cell.date)}: ${DAY_STATUS_LABEL[cell.status]}${cell.adjusted ? ', admin adjusted' : ''}`;
  const inner = (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: style.bg,
        borderWidth: style.ring ? 2 : 0,
        borderColor: style.ring,
        borderStyle: style.dashed ? 'dashed' : 'solid',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {cell.status === 'success' ? (
        <Check size={glyph} color={colors.onInk} strokeWidth={3.2} />
      ) : cell.status === 'pending' || cell.status === 'late_pending' ? (
        <Clock size={glyph} color={colors.warning} strokeWidth={2.6} />
      ) : cell.status === 'rejected' ? (
        <CircleAlert size={glyph} color={colors.danger} strokeWidth={2.6} />
      ) : cell.status === 'fail' ? (
        <X size={glyph} color={colors.textSecondary} strokeWidth={2.8} />
      ) : cell.status === 'missed' ? (
        <Minus size={glyph} color={colors.textSecondary} strokeWidth={2.8} />
      ) : (
        <Text variant="micro" color={cell.status === 'upcoming' ? 'textSecondary' : 'ink'} maxFontSizeMultiplier={1.2}>
          {weekdayInitial(cell.date)}
        </Text>
      )}
      {cell.adjusted ? (
        <View
          style={{
            position: 'absolute',
            right: -3,
            bottom: -3,
            width: Math.max(14, size * 0.42),
            height: Math.max(14, size * 0.42),
            borderRadius: size,
            backgroundColor: colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: colors.borderStrong,
          }}>
          <SlidersHorizontal size={Math.max(8, size * 0.24)} color={colors.ink} strokeWidth={2.6} />
        </View>
      ) : null}
    </View>
  );

  const ring: ViewStyle = {
    padding: 3,
    borderRadius: (size + 10) / 2,
    borderWidth: 2,
    borderColor: selected ? colors.ink : colors.transparent,
  };
  if (!onPress) {
    return (
      <View accessible accessibilityRole="image" accessibilityLabel={label}>
        {inner}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={6}
      style={({ pressed }) => [ring, pressed ? { opacity: 0.6 } : null]}>
      {inner}
    </Pressable>
  );
}

export interface DayProgressProps {
  days: readonly DayCellLike[];
  size?: number;
  onSelect?: (date: string) => void;
  selectedDate?: string | null;
  style?: StyleProp<ViewStyle>;
}

/** A row of day dots. Wraps on small screens and at large text sizes. */
export function DayProgress({ days, size = 34, onSelect, selectedDate, style }: DayProgressProps) {
  const done = days.filter((d) => d.status === 'success').length;
  const compact = days.length > 10;
  const dot = compact ? Math.min(size, 26) : size;
  return (
    <View
      accessible={!onSelect}
      accessibilityRole={onSelect ? undefined : 'image'}
      accessibilityLabel={onSelect ? undefined : `${done} of ${days.length} days completed`}
      style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: onSelect ? 2 : compact ? 5 : space.sm }, style]}>
      {days.map((cell) => (
        <DayDot key={cell.date} cell={cell} size={dot} onPress={onSelect ? () => onSelect(cell.date) : undefined} selected={selectedDate === cell.date} />
      ))}
    </View>
  );
}

/** "5 of 7 days" with the big tight number of the reference's "2 min". */
export function DayTally({ done, total, pending = 0 }: { done: number; total: number; pending?: number }) {
  return (
    <View accessible accessibilityLabel={`${done} of ${total} days completed${pending ? `, ${pending} awaiting review` : ''}`} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
      <Text variant="stat">{done}</Text>
      <Text variant="bodyStrong" color="textSecondary">
        /{total}
      </Text>
    </View>
  );
}
