import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { colors, type ColorName } from '@/theme/tokens';
import { MAX_SCALE_DENSE, MAX_SCALE_HEADING, type as typeScale, type TypeVariant } from '@/theme/typography';

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  color?: ColorName;
  align?: TextStyle['textAlign'];
}

const DENSE: readonly TypeVariant[] = ['label', 'labelSmall', 'micro', 'score', 'number', 'captionStrong'];
const HEADINGS: readonly TypeVariant[] = ['display', 'title', 'stat'];

/**
 * All app text goes through this component so type, color and Dynamic Type
 * behavior stay consistent. Body text scales freely with the OS setting;
 * headings and dense single-line labels are capped so they do not clip.
 */
export function Text({ variant = 'body', color = 'ink', align, style, maxFontSizeMultiplier, ...rest }: TextProps) {
  const cap = maxFontSizeMultiplier ?? (HEADINGS.includes(variant) ? MAX_SCALE_HEADING : DENSE.includes(variant) ? MAX_SCALE_DENSE : 2);
  return (
    <RNText
      maxFontSizeMultiplier={cap}
      {...rest}
      style={[typeScale[variant], { color: colors[color] }, align ? { textAlign: align } : null, style]}
    />
  );
}
