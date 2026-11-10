/**
 * Uplift design tokens — direction "Crew" (chosen 2026-11-10).
 *
 * Ink on warm white. Selected states and primary actions are black. Color is
 * a scarce resource reserved for people (avatars), habits (soft tiles) and
 * states that need attention. See docs/DESIGN.md.
 *
 * The purple/lime palette from the original specification is REJECTED and must
 * not come back (docs/DECISIONS.md, D-001).
 */

export const colors = {
  /** App background. White throughout. */
  bg: '#FFFFFF',
  /** Warm paper for cards, grouped areas and fields. */
  surface: '#F6F4F0',
  /** Tracks, pressed surfaces, empty progress. */
  surfaceStrong: '#ECE9E2',
  /** Empty day markers and other quiet fills that carry a glyph. */
  surfaceSunken: '#E4E0D8',

  /** Primary text, selected pills, primary buttons. */
  ink: '#111111',
  /** Pressed state of ink surfaces. */
  inkPressed: '#33302C',
  /** Secondary text. 6.4:1 on bg, 5.8:1 on surface. */
  textSecondary: '#625E57',
  /** Placeholders, disabled labels, decorative glyphs. 3.6:1 — never body text. */
  textTertiary: '#8A857C',
  /** Text on ink. */
  onInk: '#FFFFFF',
  onInkSecondary: '#B8B4AC',

  /** Hairlines, used sparingly. */
  border: '#E7E3DB',
  /** Field outlines. */
  borderStrong: '#CFC9BD',

  /** The lifted dot in the wordmark; unread markers. Ink text only on top of it. */
  signal: '#FF5C39',

  positive: '#126A3F',
  positiveSoft: '#DCF3E5',
  warning: '#7A4300',
  warningSoft: '#FFEFC7',
  danger: '#B42318',
  dangerSoft: '#FDE7E4',
  info: '#1F4FB8',
  infoSoft: '#E3ECFF',

  overlay: 'rgba(17, 17, 17, 0.42)',
  transparent: 'transparent',
} as const;

export type ColorName = keyof typeof colors;

/** Soft tile colors behind habit emoji. Decoration: the label always accompanies them. */
export const habitTints = {
  screen_time: '#DDEBFF',
  reading: '#FFEFC4',
  prayer: '#EAE2FF',
  pushups: '#FFDDD0',
  custom: '#D6F2E3',
} as const;

/** Avatar backgrounds. Vivid but soft, each readable with ink line faces. */
export const avatarColors = {
  sun: '#F9C846',
  coral: '#F2765F',
  sky: '#5FA9F5',
  mint: '#7DD3AE',
  rose: '#F5A3B7',
  iris: '#B49CF2',
  peach: '#F7A86E',
  teal: '#56C3CB',
  sage: '#A9C787',
  sand: '#DDB893',
} as const;

export type AvatarColor = keyof typeof avatarColors;
export const AVATAR_COLOR_NAMES = Object.keys(avatarColors) as AvatarColor[];

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 56,
} as const;

/** Horizontal screen padding. */
export const gutter = space.xl;

export const radius = {
  sm: 10,
  /** Fields */
  md: 16,
  /** Tiles, list rows */
  lg: 20,
  /** Cards */
  xl: 28,
  /** Bottom sheets */
  sheet: 32,
  pill: 999,
} as const;

/** Soft, wide, low-opacity shadows for floating white elements. */
export const shadow = {
  none: {},
  soft: { boxShadow: '0px 2px 8px rgba(34, 28, 14, 0.07)' },
  float: { boxShadow: '0px 6px 20px rgba(34, 28, 14, 0.11)' },
  sheet: { boxShadow: '0px -8px 32px rgba(34, 28, 14, 0.12)' },
} as const;

/** Minimum touch target (points). */
export const touch = 44;

export const motion = {
  fast: 140,
  base: 220,
  slow: 360,
} as const;

export const layout = {
  /** Content never grows wider than this on tablets and web. */
  maxWidth: 560,
  tabBarHeight: 64,
} as const;
