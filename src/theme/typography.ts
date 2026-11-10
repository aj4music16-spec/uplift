import type { TextStyle } from 'react-native';

/**
 * Typography for direction "Crew".
 *
 * Headings: Inter Tight, heavy and tightly tracked — the large confident
 * black headings of the reference. Body: Inter. Scores use tabular numerals
 * so columns of numbers line up.
 */
export const fonts = {
  display: 'InterTight_800ExtraBold',
  heading: 'InterTight_700Bold',
  headingMedium: 'InterTight_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
} as const;

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export const type = {
  /** Screen titles: "Your next win." */
  display: { fontFamily: fonts.display, fontSize: 34, lineHeight: 38, letterSpacing: -1.2 },
  /** Section and sheet titles. */
  title: { fontFamily: fonts.heading, fontSize: 26, lineHeight: 30, letterSpacing: -0.8 },
  headline: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 25, letterSpacing: -0.45 },
  subhead: { fontFamily: fonts.headingMedium, fontSize: 17, lineHeight: 22, letterSpacing: -0.25 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, letterSpacing: -0.1 },
  bodyStrong: { fontFamily: fonts.bodySemibold, fontSize: 16, lineHeight: 23, letterSpacing: -0.1 },
  callout: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, letterSpacing: -0.05 },
  calloutStrong: { fontFamily: fonts.bodySemibold, fontSize: 15, lineHeight: 21, letterSpacing: -0.05 },
  caption: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18 },
  captionStrong: { fontFamily: fonts.bodySemibold, fontSize: 13, lineHeight: 18 },
  micro: { fontFamily: fonts.bodySemibold, fontSize: 11, lineHeight: 14, letterSpacing: 0.1 },
  /** Buttons and pills. */
  label: { fontFamily: fonts.bodySemibold, fontSize: 16, lineHeight: 20, letterSpacing: -0.15 },
  labelSmall: { fontFamily: fonts.bodySemibold, fontSize: 14, lineHeight: 18, letterSpacing: -0.1 },
  /** Hero numbers: "5" of "5/7". */
  stat: { fontFamily: fonts.display, fontSize: 44, lineHeight: 46, letterSpacing: -1.6, ...tabular },
  /** Row scores. */
  score: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 24, letterSpacing: -0.4, ...tabular },
  number: { fontFamily: fonts.bodySemibold, fontSize: 16, lineHeight: 22, ...tabular },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

/** Cap on OS font scaling for dense single-line elements (tabs, pills, scores). Body text scales freely. */
export const MAX_SCALE_DENSE = 1.35;
export const MAX_SCALE_HEADING = 1.5;
