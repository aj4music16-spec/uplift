import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

import { WORDMARK } from './wordmark.generated';

export interface WordmarkProps {
  /** Rendered height in points. Width follows the aspect ratio. */
  height?: number;
  color?: string;
  /** The lifted dot. In the app it takes the viewer's own avatar color. */
  dotColor?: string;
}

/**
 * The Uplift wordmark: lowercase "uplift" with the dot of the "i" lifted.
 * A temporary original mark built from Inter Tight outlines (see
 * scripts/build-wordmark.mjs); there is no separate logo symbol.
 */
export function Wordmark({ height = 26, color = colors.ink, dotColor = colors.signal }: WordmarkProps) {
  const width = (WORDMARK.width / WORDMARK.height) * height;
  return (
    <Svg width={width} height={height} viewBox={WORDMARK.viewBox} accessibilityRole="image" accessibilityLabel="Uplift">
      <Path d={WORDMARK.letters} fill={color} />
      <Circle cx={WORDMARK.dot.cx} cy={WORDMARK.dot.cy} r={WORDMARK.dot.r} fill={dotColor} />
    </Svg>
  );
}
