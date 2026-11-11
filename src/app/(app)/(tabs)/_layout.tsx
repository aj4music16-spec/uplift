import { Tabs } from 'expo-router/js-tabs';

import { useHome } from '@/data/hooks';
import { TabBar } from '@/features/shell/TabBar';
import { colors } from '@/theme/tokens';

export default function TabsLayout() {
  const home = useHome();
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
      tabBar={(props) => <TabBar state={props.state} navigateToTab={props.navigateToTab} unreadActivity={home.data?.unreadNotifications ?? 0} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="circles" />
      <Tabs.Screen name="activity" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
