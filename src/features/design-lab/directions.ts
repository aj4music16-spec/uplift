/**
 * The three visual directions explored on 2026-11-10 after the purple/lime
 * brand kit was rejected. They are kept so the alternatives stay reviewable
 * (Profile → Design lab). Only "crew" is used by the app; its real tokens live
 * in src/theme and are mirrored here for the side-by-side comparison.
 */
export type DirectionId = 'crew' | 'almanac' | 'sticker';

export interface Direction {
  id: DirectionId;
  letter: 'A' | 'B' | 'C';
  name: string;
  chosen: boolean;
  summary: string;
  /** What it borrows from the "Friday crew" reference. */
  strengths: string[];
  risks: string[];
  fonts: { heading: string; body: string; bodyStrong: string; headingTracking: number };
  colors: {
    bg: string;
    surface: string;
    ink: string;
    secondary: string;
    primaryBg: string;
    primaryFg: string;
    selectedBg: string;
    selectedFg: string;
    done: string;
    doneFg: string;
    empty: string;
    habitTile: string;
    hairline: string;
  };
  radius: { card: number; control: number; tile: number };
  card: 'fill' | 'outline' | 'block';
  tabs: 'pill' | 'underline' | 'chunky';
  avatar: 'face' | 'initials' | 'squircle';
  wordmark: 'lifted-dot' | 'serif' | 'tilted';
}

export const DIRECTIONS: Direction[] = [
  {
    id: 'crew',
    letter: 'A',
    name: 'Crew',
    chosen: true,
    summary: 'Ink on warm white. Black is the only “brand color”; real color belongs to people and habits.',
    strengths: [
      'Closest to the reference: big tight black headings, black selected pills, soft floating white controls.',
      'People are the most colorful thing on screen, so standings and chat feel social, not like a dashboard.',
      'Highest contrast of the three (ink on white is 18.9:1) and nothing depends on color alone.',
      'Rewards stay visually secondary: there is no accent color for them to borrow.',
    ],
    risks: ['Can feel stark if a screen has no people or habit color on it — empty states need a playful detail.'],
    fonts: { heading: 'InterTight_800ExtraBold', body: 'Inter_400Regular', bodyStrong: 'Inter_600SemiBold', headingTracking: -1.2 },
    colors: {
      bg: '#FFFFFF',
      surface: '#F6F4F0',
      ink: '#111111',
      secondary: '#625E57',
      primaryBg: '#111111',
      primaryFg: '#FFFFFF',
      selectedBg: '#111111',
      selectedFg: '#FFFFFF',
      done: '#111111',
      doneFg: '#FFFFFF',
      empty: '#E4E0D8',
      habitTile: '#DDEBFF',
      hairline: 'transparent',
    },
    radius: { card: 28, control: 999, tile: 20 },
    card: 'fill',
    tabs: 'pill',
    avatar: 'face',
    wordmark: 'lifted-dot',
  },
  {
    id: 'almanac',
    letter: 'B',
    name: 'Almanac',
    chosen: false,
    summary: 'Editorial and calm. A soft serif, ivory paper, hairlines, one evergreen accent.',
    strengths: [
      'Warm and family-friendly; reads like a shared journal.',
      'The serif gives Uplift an identity no other habit app has.',
    ],
    risks: [
      'Drifts toward the “soft wellness” look that was already rejected.',
      'Loses the strong black selected states and the playful, competitive energy of the reference.',
      'Hairlines and underlines add the borders the brief asked to avoid.',
    ],
    fonts: { heading: 'Fraunces_600SemiBold', body: 'Inter_400Regular', bodyStrong: 'Inter_600SemiBold', headingTracking: -0.6 },
    colors: {
      bg: '#FFFFFF',
      surface: '#FBF8F1',
      ink: '#1C1917',
      secondary: '#6B645A',
      primaryBg: '#14532D',
      primaryFg: '#FFFFFF',
      selectedBg: 'transparent',
      selectedFg: '#14532D',
      done: '#14532D',
      doneFg: '#FFFFFF',
      empty: '#EDE7DA',
      habitTile: '#EAF1E4',
      hairline: '#E4DCCB',
    },
    radius: { card: 14, control: 12, tile: 10 },
    card: 'outline',
    tabs: 'underline',
    avatar: 'initials',
    wordmark: 'serif',
  },
  {
    id: 'sticker',
    letter: 'C',
    name: 'Sticker',
    chosen: false,
    summary: 'Loud and playful. Color-blocked cards, chunky outlines, hard shadows, a cobalt action.',
    strengths: ['Maximum personality; every habit owns a color.', 'Feels like a game the moment it opens.'],
    risks: [
      'Outlines on everything: the opposite of “avoid excessive card borders”.',
      'Color is spent on chrome, so people and states compete with the interface.',
      'Hard shadows and blocks are the reverse of the soft layers in the reference.',
    ],
    fonts: { heading: 'BricolageGrotesque_800ExtraBold', body: 'Inter_400Regular', bodyStrong: 'Inter_600SemiBold', headingTracking: -1 },
    colors: {
      bg: '#FFFFFF',
      surface: '#F3F4F6',
      ink: '#0B0B0F',
      secondary: '#4B5563',
      primaryBg: '#2F5BFF',
      primaryFg: '#FFFFFF',
      selectedBg: '#FFD84D',
      selectedFg: '#0B0B0F',
      done: '#2F5BFF',
      doneFg: '#FFFFFF',
      empty: '#FFFFFF',
      habitTile: '#FFFFFF',
      hairline: '#0B0B0F',
    },
    radius: { card: 22, control: 16, tile: 14 },
    card: 'block',
    tabs: 'chunky',
    avatar: 'squircle',
    wordmark: 'tilted',
  },
];

export const CHOSEN_RATIONALE =
  'Crew is the strongest translation of the reference: confident black type, black selected states, soft white layers, and color that belongs to people instead of the interface. It keeps the competitive, social feel without esports styling, stays far from the rejected wellness look, has the best measured contrast, and leaves reward previews visually quiet.';
