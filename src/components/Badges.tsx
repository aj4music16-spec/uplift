import { View, type StyleProp, type ViewStyle } from 'react-native';

import { HABITS } from '@/domain/habits';
import type { ChallengeStatus, HabitType } from '@/domain/types';
import { colors, habitTints, radius, space } from '@/theme/tokens';

import { CircleAlert, CircleCheck, Clock, FlaskConical, Hourglass, Info, SlidersHorizontal, type LucideIcon } from './icons';
import { Text } from './Text';

export type BadgeTone = 'neutral' | 'ink' | 'positive' | 'warning' | 'danger' | 'info' | 'demo';

const TONES: Record<BadgeTone, { bg: string; fg: 'ink' | 'onInk' | 'positive' | 'warning' | 'danger' | 'info' | 'textSecondary' }> = {
  neutral: { bg: colors.surfaceStrong, fg: 'textSecondary' },
  ink: { bg: colors.ink, fg: 'onInk' },
  positive: { bg: colors.positiveSoft, fg: 'positive' },
  warning: { bg: colors.warningSoft, fg: 'warning' },
  danger: { bg: colors.dangerSoft, fg: 'danger' },
  info: { bg: colors.infoSoft, fg: 'info' },
  demo: { bg: colors.warningSoft, fg: 'warning' },
};

export interface StatusBadgeProps {
  label: string;
  tone?: BadgeTone;
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
}

/** A small label chip. Always carries text (and usually an icon): never color alone. */
export function StatusBadge({ label, tone = 'neutral', icon: Icon, style }: StatusBadgeProps) {
  const t = TONES[tone];
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 5,
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: radius.pill,
          backgroundColor: t.bg,
        },
        style,
      ]}>
      {Icon ? <Icon size={13} color={colors[t.fg]} strokeWidth={2.6} /> : null}
      <Text variant="micro" color={t.fg}>
        {label}
      </Text>
    </View>
  );
}

const CHALLENGE_STATUS: Record<ChallengeStatus, { label: string; tone: BadgeTone; icon?: LucideIcon }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  scheduled: { label: 'Starting soon', tone: 'info', icon: Clock },
  active: { label: 'Live', tone: 'ink' },
  review: { label: 'In review', tone: 'warning', icon: Hourglass },
  completed: { label: 'Finished', tone: 'positive', icon: CircleCheck },
  canceled: { label: 'Canceled', tone: 'neutral', icon: CircleAlert },
};

export function ChallengeStatusBadge({ status }: { status: ChallengeStatus }) {
  const s = CHALLENGE_STATUS[status];
  return <StatusBadge label={s.label} tone={s.tone} icon={s.icon} />;
}

/** Marks a result that an admin set by hand. Never shown as verified evidence. */
export function AdjustedBadge() {
  return <StatusBadge label="Admin adjusted" tone="neutral" icon={SlidersHorizontal} />;
}

/** Sits beside every simulated amount. */
export function DemoRewardBadge({ compact = false }: { compact?: boolean }) {
  return <StatusBadge label={compact ? 'Demo reward' : 'Demo reward — no money collected'} tone="demo" icon={FlaskConical} />;
}

export function InfoBadge({ label }: { label: string }) {
  return <StatusBadge label={label} tone="neutral" icon={Info} />;
}

export interface HabitBadgeProps {
  habitType: HabitType;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The playful detail: a large emoji on a soft tinted tile. Decoration only —
 * hidden from screen readers because the habit name is always written beside it.
 */
export function HabitBadge({ habitType, size = 52, style }: HabitBadgeProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.38),
          backgroundColor: habitTints[habitType],
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}>
      <Text style={{ fontSize: Math.round(size * 0.5), lineHeight: Math.round(size * 0.62) }} maxFontSizeMultiplier={1}>
        {HABITS[habitType].emoji}
      </Text>
    </View>
  );
}

export interface BannerProps {
  title?: string;
  message: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'info' | 'positive';
  icon?: LucideIcon;
  action?: React.ReactNode;
}

/** Inline explanation: privacy notes, deadlines, demo labels, why something is unavailable. */
export function Banner({ title, message, tone = 'neutral', icon: Icon = Info, action }: BannerProps) {
  const palette = {
    neutral: { bg: colors.surface, fg: 'textSecondary' as const, title: 'ink' as const },
    warning: { bg: colors.warningSoft, fg: 'warning' as const, title: 'warning' as const },
    danger: { bg: colors.dangerSoft, fg: 'danger' as const, title: 'danger' as const },
    info: { bg: colors.infoSoft, fg: 'info' as const, title: 'info' as const },
    positive: { bg: colors.positiveSoft, fg: 'positive' as const, title: 'positive' as const },
  }[tone];
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={{ flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: palette.bg, alignItems: 'flex-start' }}>
      <Icon size={18} color={colors[palette.title]} strokeWidth={2.4} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <Text variant="calloutStrong" color={palette.title}>
            {title}
          </Text>
        ) : null}
        <Text variant="callout" color={tone === 'neutral' ? 'textSecondary' : palette.fg}>
          {message}
        </Text>
        {action ? <View style={{ marginTop: space.sm }}>{action}</View> : null}
      </View>
    </View>
  );
}
