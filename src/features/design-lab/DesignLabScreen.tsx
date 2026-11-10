import { BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque/800ExtraBold';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { useFonts } from 'expo-font';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text as RNText, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, type AvatarSpec } from '@/components/Avatar';
import { Wordmark } from '@/components/brand/Wordmark';
import { ArrowLeft, Check } from '@/components/icons';
import { Text } from '@/components/Text';
import { avatarColors, colors, gutter, radius, shadow, space } from '@/theme/tokens';

import { CHOSEN_RATIONALE, DIRECTIONS, type Direction } from './directions';

/**
 * Design exploration. Each direction renders the same four things — heading,
 * challenge card, avatar group and primary action — so the differences are
 * easy to compare. Nothing here is wired to data on purpose.
 */

const PEOPLE: { name: string; avatar: AvatarSpec }[] = [
  { name: 'AJ', avatar: { color: 'sun', face: 2 } },
  { name: 'Ben', avatar: { color: 'coral', face: 1 } },
  { name: 'Kaan', avatar: { color: 'sky', face: 0 } },
  { name: 'Dad', avatar: { color: 'mint', face: 4 } },
  { name: 'Mia', avatar: { color: 'rose', face: 5 } },
  { name: 'Leo', avatar: { color: 'iris', face: 3 } },
];

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DONE = 5;

function LabWordmark({ d }: { d: Direction }) {
  if (d.wordmark === 'lifted-dot') return <Wordmark height={26} />;
  if (d.wordmark === 'serif') {
    return (
      <RNText style={{ fontFamily: d.fonts.heading, fontSize: 26, letterSpacing: -0.5, color: d.colors.ink }} accessibilityLabel="Uplift">
        Uplift
      </RNText>
    );
  }
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: d.colors.selectedBg,
        borderWidth: 2,
        borderColor: d.colors.ink,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 2,
        transform: [{ rotate: '-3deg' }],
      }}>
      <RNText style={{ fontFamily: d.fonts.heading, fontSize: 22, color: d.colors.ink }} accessibilityLabel="Uplift">
        uplift
      </RNText>
    </View>
  );
}

function LabAvatars({ d }: { d: Direction }) {
  const size = 34;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessible accessibilityLabel="6 people competing">
      {PEOPLE.slice(0, 4).map((person, index) => {
        const offset = { marginLeft: index === 0 ? 0 : -9, zIndex: 10 - index };
        if (d.avatar === 'face') return <Avatar key={person.name} avatar={person.avatar} size={size} ring name="" style={offset} />;
        if (d.avatar === 'initials') {
          return (
            <View
              key={person.name}
              style={[
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  backgroundColor: ['#EFE3C8', '#E3EAD9', '#E9DCD3', '#DCE4EA'][index],
                  borderWidth: 2,
                  borderColor: d.colors.bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                offset,
              ]}>
              <RNText style={{ fontFamily: d.fonts.heading, fontSize: 14, color: d.colors.ink }}>{person.name[0]}</RNText>
            </View>
          );
        }
        return (
          <View
            key={person.name}
            style={[
              {
                width: size + 4,
                height: size + 4,
                borderRadius: 12,
                borderWidth: 2,
                borderColor: d.colors.ink,
                backgroundColor: avatarColors[person.avatar.color],
                overflow: 'hidden',
                alignItems: 'center',
                justifyContent: 'center',
              },
              offset,
            ]}>
            <Avatar avatar={person.avatar} size={size} name="" />
          </View>
        );
      })}
      <RNText style={{ marginLeft: 10, fontFamily: d.fonts.bodyStrong, fontSize: 14, color: d.colors.secondary }}>6 competing</RNText>
    </View>
  );
}

function LabTabs({ d }: { d: Direction }) {
  const tabs = ['Challenges', 'Standings', 'Chat'];
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: d.tabs === 'underline' ? 20 : 8,
        borderBottomWidth: d.tabs === 'underline' ? 1 : 0,
        borderBottomColor: d.colors.hairline,
      }}>
      {tabs.map((tab, index) => {
        const selected = index === 0;
        if (d.tabs === 'underline') {
          return (
            <View key={tab} style={{ paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: selected ? d.colors.primaryBg : 'transparent' }}>
              <RNText style={{ fontFamily: d.fonts.bodyStrong, fontSize: 15, color: selected ? d.colors.selectedFg : d.colors.secondary }}>{tab}</RNText>
            </View>
          );
        }
        const chunky = d.tabs === 'chunky';
        return (
          <View
            key={tab}
            style={[
              {
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: d.radius.control,
                backgroundColor: selected ? d.colors.selectedBg : d.colors.bg,
                borderWidth: chunky ? 2 : 0,
                borderColor: d.colors.ink,
              },
              chunky ? null : selected ? null : shadow.soft,
            ]}>
            <RNText style={{ fontFamily: d.fonts.bodyStrong, fontSize: 14, color: selected ? d.colors.selectedFg : d.colors.ink }}>{tab}</RNText>
          </View>
        );
      })}
    </View>
  );
}

function LabProgress({ d }: { d: Direction }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} accessible accessibilityLabel="5 of 7 days completed">
      {DAYS.map((day, index) => {
        const done = index < DONE;
        const size = 30;
        const shape = d.id === 'almanac' ? 8 : d.id === 'sticker' ? 9 : size / 2;
        return (
          <View
            key={`${day}-${index}`}
            style={{
              width: size,
              height: size,
              borderRadius: shape,
              backgroundColor: done ? d.colors.done : d.colors.empty,
              borderWidth: d.id === 'sticker' ? 2 : 0,
              borderColor: d.colors.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            {done ? (
              <Check size={15} color={d.colors.doneFg} strokeWidth={3} />
            ) : (
              <RNText style={{ fontFamily: d.fonts.bodyStrong, fontSize: 11, color: d.colors.secondary }}>{day}</RNText>
            )}
          </View>
        );
      })}
    </View>
  );
}

function LabCard({ d }: { d: Direction }) {
  const block = d.card === 'block';
  return (
    <View
      style={[
        {
          borderRadius: d.radius.card,
          padding: 18,
          gap: 16,
          backgroundColor: block ? '#CFE4FF' : d.card === 'fill' ? d.colors.surface : d.colors.bg,
          borderWidth: block ? 2 : d.card === 'outline' ? 1 : 0,
          borderColor: block ? d.colors.ink : d.colors.hairline,
        },
        block ? { boxShadow: `4px 5px 0px ${d.colors.ink}` } : null,
      ]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: d.radius.tile,
            backgroundColor: d.colors.habitTile,
            borderWidth: block ? 2 : 0,
            borderColor: d.colors.ink,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <RNText style={{ fontSize: 26 }} accessibilityElementsHidden importantForAccessibility="no">
            📱
          </RNText>
        </View>
        <View style={{ flex: 1 }}>
          <RNText style={{ fontFamily: d.fonts.heading, fontSize: 20, letterSpacing: d.fonts.headingTracking * 0.4, color: d.colors.ink }}>
            Screen Time Showdown
          </RNText>
          <RNText style={{ fontFamily: d.fonts.body, fontSize: 14, color: d.colors.secondary, marginTop: 2 }}>2h or less a day · 2 days left</RNText>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <LabProgress d={d} />
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <RNText style={{ fontFamily: d.fonts.heading, fontSize: 30, letterSpacing: -1, color: d.colors.ink, fontVariant: ['tabular-nums'] }}>5</RNText>
          <RNText style={{ fontFamily: d.fonts.bodyStrong, fontSize: 14, color: d.colors.secondary }}>/7</RNText>
        </View>
      </View>
      <LabAvatars d={d} />
    </View>
  );
}

function LabAction({ d }: { d: Direction }) {
  const block = d.card === 'block';
  return (
    <View
      accessibilityRole="button"
      accessibilityLabel="Submit yesterday’s screenshot"
      style={[
        {
          minHeight: 54,
          borderRadius: d.radius.control,
          backgroundColor: d.colors.primaryBg,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 20,
          borderWidth: block ? 2 : 0,
          borderColor: d.colors.ink,
        },
        block ? { boxShadow: `3px 4px 0px ${d.colors.ink}` } : null,
      ]}>
      <RNText style={{ fontFamily: d.fonts.bodyStrong, fontSize: 16, color: d.colors.primaryFg }}>Submit yesterday’s screenshot</RNText>
    </View>
  );
}

function DirectionPreview({ d }: { d: Direction }) {
  return (
    <View
      style={[
        { borderRadius: radius.xl, backgroundColor: d.colors.bg, padding: 20, gap: 18, borderWidth: 1, borderColor: colors.border },
      ]}
      testID={`direction-${d.id}`}>
      <LabWordmark d={d} />
      <View style={{ gap: 4 }}>
        <RNText style={{ fontFamily: d.fonts.heading, fontSize: 34, lineHeight: 38, letterSpacing: d.fonts.headingTracking, color: d.colors.ink }}>
          Your next win.
        </RNText>
        <RNText style={{ fontFamily: d.fonts.body, fontSize: 16, color: d.colors.secondary }}>The Inner Circle · 6 members</RNText>
      </View>
      <LabTabs d={d} />
      <LabCard d={d} />
      <LabAction d={d} />
    </View>
  );
}

function DirectionNotes({ d }: { d: Direction }) {
  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        <Text variant="headline">
          {d.letter} · {d.name}
        </Text>
        {d.chosen ? (
          <View style={{ backgroundColor: colors.ink, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text variant="micro" color="onInk">
              Chosen
            </Text>
          </View>
        ) : (
          <View style={{ backgroundColor: colors.surfaceStrong, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text variant="micro" color="textSecondary">
              Alternative
            </Text>
          </View>
        )}
      </View>
      <Text variant="callout" color="textSecondary">
        {d.summary}
      </Text>
      <View style={{ gap: space.xs }}>
        {d.strengths.map((line) => (
          <Text key={line} variant="caption" color="ink">
            + {line}
          </Text>
        ))}
        {d.risks.map((line) => (
          <Text key={line} variant="caption" color="textSecondary">
            − {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

export function DesignLabScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [labFontsLoaded] = useFonts({ Fraunces_600SemiBold, BricolageGrotesque_800ExtraBold });
  const [selected, setSelected] = useState<Direction['id']>('crew');
  const wide = width >= 1000;
  const visible = wide ? DIRECTIONS : DIRECTIONS.filter((d) => d.id === selected);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{
        paddingTop: insets.top + space.lg,
        paddingBottom: insets.bottom + space.huge,
        paddingHorizontal: gutter,
        gap: space.xl,
        alignSelf: 'center',
        width: '100%',
        maxWidth: wide ? 1320 : 560,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={[{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }, shadow.soft]}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={2.4} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text variant="title" accessibilityRole="header">
            Design lab
          </Text>
        </View>
      </View>
      <Text variant="callout" color="textSecondary">
        Three directions explored after the purple-and-lime brand kit was rejected. Each one shows the same heading, challenge card, avatar group and primary action. The
        app uses direction A.
      </Text>

      {wide ? null : (
        <View style={{ flexDirection: 'row', gap: space.sm }} accessibilityRole="tablist">
          {DIRECTIONS.map((d) => {
            const active = d.id === selected;
            return (
              <Pressable
                key={d.id}
                onPress={() => setSelected(d.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Direction ${d.letter}, ${d.name}`}
                style={[
                  { minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: active ? colors.ink : colors.bg, justifyContent: 'center' },
                  active ? null : shadow.soft,
                ]}>
                <Text variant="labelSmall" color={active ? 'onInk' : 'ink'}>
                  <Text variant="labelSmall" color={active ? 'onInkSecondary' : 'textTertiary'}>
                    {d.letter}{' '}
                  </Text>
                  {d.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {labFontsLoaded ? (
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: space.xl, alignItems: 'flex-start' }}>
          {visible.map((d) => (
            <View key={d.id} style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%', gap: space.lg }}>
              <DirectionPreview d={d} />
              <DirectionNotes d={d} />
            </View>
          ))}
        </View>
      ) : (
        <Text variant="callout" color="textSecondary">
          Loading preview fonts…
        </Text>
      )}

      <View style={{ backgroundColor: colors.bg, borderRadius: radius.xl, padding: space.xl, gap: space.sm }}>
        <Text variant="headline">Why Crew</Text>
        <Text variant="callout" color="textSecondary">
          {CHOSEN_RATIONALE}
        </Text>
      </View>
    </ScrollView>
  );
}
