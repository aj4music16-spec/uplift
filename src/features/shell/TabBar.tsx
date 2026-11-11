import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Activity, House, User, Users, type LucideIcon } from '@/components/icons';
import { Text } from '@/components/Text';
import { colors, layout, radius, shadow, space } from '@/theme/tokens';

const TABS: Record<string, { label: string; icon: LucideIcon }> = {
  index: { label: 'Home', icon: House },
  circles: { label: 'Circles', icon: Users },
  activity: { label: 'Activity', icon: Activity },
  profile: { label: 'Profile', icon: User },
};

export interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigateToTab: (routeKey: string) => void;
  unreadActivity?: number;
}

/** Floating white tab bar; the selected tab is a black pill, like every other selected state. */
export function TabBar({ state, navigateToTab, unreadActivity = 0 }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insets.bottom, space.md), alignItems: 'center', paddingHorizontal: space.lg }}>
      <View
        accessibilityRole="tablist"
        style={[
          { flexDirection: 'row', gap: 4, padding: 6, borderRadius: radius.pill, backgroundColor: colors.bg, height: layout.tabBarHeight, width: '100%', maxWidth: 420 },
          shadow.float,
        ]}>
        {state.routes.map((route, index) => {
          const tab = TABS[route.name];
          if (!tab) return null;
          const selected = state.index === index;
          const Icon = tab.icon;
          const badge = route.name === 'activity' && unreadActivity > 0;
          return (
            <Pressable
              key={route.key}
              onPress={() => navigateToTab(route.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={badge ? `${tab.label}, ${unreadActivity} unread` : tab.label}
              testID={`tab-${route.name}`}
              style={({ pressed }) => ({
                flex: 1,
                borderRadius: radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                backgroundColor: selected ? colors.ink : pressed ? colors.surface : colors.transparent,
              })}>
              <View>
                <Icon size={20} color={selected ? colors.onInk : colors.textSecondary} strokeWidth={2.3} />
                {badge ? (
                  <View style={{ position: 'absolute', top: -3, right: -6, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.signal, borderWidth: 1.5, borderColor: selected ? colors.ink : colors.bg }} />
                ) : null}
              </View>
              <Text variant="micro" color={selected ? 'onInk' : 'textSecondary'} maxFontSizeMultiplier={1.15}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
