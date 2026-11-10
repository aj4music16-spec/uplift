import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';

import { avatarColors, colors, shadow, type AvatarColor } from '@/theme/tokens';

import { Text } from './Text';

/**
 * Generated avatars: a friendly ink face on an individually colored circle.
 * They are original, need no photo permission, and make people the most
 * colorful thing on a mostly black-and-white screen.
 */
export interface AvatarSpec {
  color: AvatarColor;
  /** Index into FACES. */
  face: number;
}

export const FACE_COUNT = 10;
export const FACE_NAMES = ['Smile', 'Grin', 'Specs', 'Wink', 'Moustache', 'Lashes', 'Calm', 'Wow', 'Shades', 'Freckles'] as const;

const INK = colors.ink;
const STROKE = { stroke: INK, strokeWidth: 5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };

function Eyes() {
  return (
    <>
      <Circle cx={36} cy={45} r={4.6} fill={INK} />
      <Circle cx={64} cy={45} r={4.6} fill={INK} />
    </>
  );
}

function Face({ index }: { index: number }) {
  switch (((index % FACE_COUNT) + FACE_COUNT) % FACE_COUNT) {
    case 1: // grin
      return (
        <G>
          <Path d="M29 48 Q36 39 43 48" {...STROKE} />
          <Path d="M57 48 Q64 39 71 48" {...STROKE} />
          <Path d="M33 60 Q50 84 67 60 Z" fill={INK} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        </G>
      );
    case 2: // specs
      return (
        <G>
          <Circle cx={35} cy={46} r={10.5} {...STROKE} strokeWidth={4.5} />
          <Circle cx={65} cy={46} r={10.5} {...STROKE} strokeWidth={4.5} />
          <Line x1={45.5} y1={45} x2={54.5} y2={45} {...STROKE} strokeWidth={4.5} />
          <Circle cx={35} cy={46} r={3.2} fill={INK} />
          <Circle cx={65} cy={46} r={3.2} fill={INK} />
          <Path d="M41 68 Q50 75 59 68" {...STROKE} />
        </G>
      );
    case 3: // wink
      return (
        <G>
          <Circle cx={36} cy={45} r={4.6} fill={INK} />
          <Path d="M57 46 Q64 40 71 46" {...STROKE} />
          <Path d="M38 63 Q52 76 65 60" {...STROKE} />
        </G>
      );
    case 4: // moustache
      return (
        <G>
          <Eyes />
          <Path d="M31 63 Q40 53 50 61 Q60 53 69 63 Q59 70 50 65 Q41 70 31 63 Z" fill={INK} />
        </G>
      );
    case 5: // lashes
      return (
        <G>
          <Eyes />
          <Line x1={30} y1={40} x2={26} y2={35} {...STROKE} strokeWidth={4} />
          <Line x1={70} y1={40} x2={74} y2={35} {...STROKE} strokeWidth={4} />
          <Circle cx={26} cy={59} r={6} fill="#FFFFFF" opacity={0.5} />
          <Circle cx={74} cy={59} r={6} fill="#FFFFFF" opacity={0.5} />
          <Path d="M37 62 Q50 75 63 62" {...STROKE} />
        </G>
      );
    case 6: // calm
      return (
        <G>
          <Path d="M29 44 Q36 51 43 44" {...STROKE} />
          <Path d="M57 44 Q64 51 71 44" {...STROKE} />
          <Path d="M41 65 Q50 72 59 65" {...STROKE} />
        </G>
      );
    case 7: // wow
      return (
        <G>
          <Eyes />
          <Path d="M29 33 Q36 28 43 33" {...STROKE} strokeWidth={4} />
          <Path d="M57 33 Q64 28 71 33" {...STROKE} strokeWidth={4} />
          <Ellipse cx={50} cy={68} rx={6.5} ry={7.5} fill={INK} />
        </G>
      );
    case 8: // shades
      return (
        <G>
          <Rect x={21} y={37} width={25} height={15} rx={7} fill={INK} />
          <Rect x={54} y={37} width={25} height={15} rx={7} fill={INK} />
          <Line x1={44} y1={42} x2={56} y2={42} {...STROKE} strokeWidth={4} />
          <Path d="M39 65 Q52 74 63 62" {...STROKE} />
        </G>
      );
    case 9: // freckles
      return (
        <G>
          <Eyes />
          {[
            [25, 56],
            [30, 60],
            [24, 62],
            [75, 56],
            [70, 60],
            [76, 62],
          ].map(([cx, cy]) => (
            <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.7} fill={INK} opacity={0.55} />
          ))}
          <Path d="M35 62 Q50 78 65 62" {...STROKE} />
        </G>
      );
    default: // smile
      return (
        <G>
          <Eyes />
          <Path d="M36 61 Q50 76 64 61" {...STROKE} />
        </G>
      );
  }
}

export interface AvatarProps {
  avatar: AvatarSpec;
  size?: number;
  /** White ring and soft shadow, for avatars floating over other content. */
  ring?: boolean;
  /** Used as the accessibility label. Pass "" when a name is shown beside it. */
  name?: string;
  /** A deleted or removed account: neutral, no face. */
  ghost?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Avatar({ avatar, size = 40, ring = false, name, ghost = false, style }: AvatarProps) {
  const ringWidth = ring ? Math.max(2, Math.round(size * 0.07)) : 0;
  const outer = size + ringWidth * 2;
  const background = ghost ? colors.surfaceSunken : (avatarColors[avatar.color] ?? avatarColors.sun);
  return (
    <View
      accessible={name !== ''}
      accessibilityRole={name ? 'image' : undefined}
      accessibilityLabel={name ? `${name}’s avatar` : undefined}
      style={[
        {
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          backgroundColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        ring ? shadow.soft : null,
        style,
      ]}>
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: background, overflow: 'hidden' }}>
        {ghost ? null : (
          <Svg width={size} height={size} viewBox="0 0 100 100">
            <Face index={avatar.face} />
          </Svg>
        )}
      </View>
    </View>
  );
}

export interface AvatarStackProps {
  people: readonly { userId: string; displayName: string; avatar: AvatarSpec; deleted?: boolean }[];
  size?: number;
  /** How many faces to show before collapsing into "+N". */
  max?: number;
  style?: StyleProp<ViewStyle>;
}

export function AvatarStack({ people, size = 32, max = 4, style }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  const overlap = Math.round(size * 0.28);
  const names = people.map((p) => p.displayName).join(', ');
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={people.length === 0 ? 'No members yet' : `${people.length} ${people.length === 1 ? 'person' : 'people'}: ${names}`}
      style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>
      {shown.map((person, index) => (
        <Avatar
          key={person.userId}
          avatar={person.avatar}
          ghost={person.deleted}
          size={size}
          ring
          name=""
          style={{ marginLeft: index === 0 ? 0 : -overlap, zIndex: shown.length - index }}
        />
      ))}
      {extra > 0 ? (
        <View
          style={{
            marginLeft: -overlap,
            minWidth: size + 4,
            height: size + 4,
            paddingHorizontal: 6,
            borderRadius: (size + 4) / 2,
            backgroundColor: colors.surfaceStrong,
            borderWidth: 2,
            borderColor: colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text variant="micro" color="textSecondary">
            +{extra}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
