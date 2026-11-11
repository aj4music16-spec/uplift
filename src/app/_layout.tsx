import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaInsetsContext, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components/Toast';
import { AppProvider, useApp } from '@/data/AppProvider';
import { DemoBanner } from '@/features/shell/DemoBanner';
import { OfflineBanner } from '@/features/shell/OfflineBanner';
import { appFonts } from '@/theme/fonts';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

function Shell() {
  const { mode } = useApp();
  const insets = useSafeAreaInsets();
  // In Demo Mode the banner occupies the top safe area, so screens below it start at zero.
  const inner = mode === 'demo' ? { ...insets, top: 0 } : insets;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <DemoBanner />
      <SafeAreaInsetsContext.Provider value={inner}>
        <OfflineBanner />
        <ToastProvider>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
        </ToastProvider>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(appFonts);
  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}
