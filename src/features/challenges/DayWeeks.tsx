import { useWindowDimensions, View } from 'react-native';

import { DayProgress, type DayCellLike } from '@/components/DayProgress';
import { gutter, layout, space } from '@/theme/tokens';

export interface DayWeeksProps {
  days: readonly DayCellLike[];
  /** Horizontal space taken inside the screen gutter (card padding, a tally beside the dots…). */
  inset?: number;
  /** Largest dot size; the dots shrink to fit seven on a row. */
  maxSize?: number;
  onSelect?: (date: string) => void;
  selectedDate?: string | null;
}

/**
 * Day dots laid out one row per week, sized so seven always fit on a row.
 * A plain wrapping row leaves a stray dot or two on a line of their own on
 * narrow phones; a week per row keeps every challenge length readable.
 */
export function DayWeeks({ days, inset = 0, maxSize = 34, onSelect, selectedDate }: DayWeeksProps) {
  const { width } = useWindowDimensions();
  const room = Math.min(width, layout.maxWidth) - gutter * 2 - inset;
  // Tappable dots carry a 5pt selection ring on each side and sit 2pt apart; plain dots sit 8pt apart.
  const fit = onSelect ? Math.floor((room - 6 * 2) / 7) - 10 : Math.floor((room - 6 * space.sm) / 7);
  const size = Math.max(onSelect ? 22 : 18, Math.min(maxSize, fit));
  const weeks: DayCellLike[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  const done = days.filter((d) => d.status === 'success').length;
  return (
    <View
      accessible={!onSelect}
      accessibilityRole={onSelect ? undefined : 'image'}
      accessibilityLabel={onSelect ? undefined : `${done} of ${days.length} days completed`}
      style={{ gap: onSelect ? 0 : space.sm }}>
      {weeks.map((week) => (
        <DayProgress key={week[0]?.date ?? 'empty'} days={week} size={size} onSelect={onSelect} selectedDate={selectedDate} />
      ))}
    </View>
  );
}
