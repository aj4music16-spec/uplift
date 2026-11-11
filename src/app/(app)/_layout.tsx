import { Redirect, Stack } from 'expo-router';
import { View } from 'react-native';

import { ErrorState } from '@/components/States';
import { useApp } from '@/data/AppProvider';
import { useProfile } from '@/data/hooks';
import { SplashView } from '@/features/shell/SplashView';
import { colors } from '@/theme/tokens';

/**
 * Everything in this group needs a signed-in person with a completed profile.
 * (The server enforces access independently; this only decides what to show.)
 */
export default function AppLayout() {
  const { phase } = useApp();
  const profile = useProfile();
  if (phase === 'loading') return <SplashView />;
  if (phase === 'signed_out') return <Redirect href="/welcome" />;
  if (profile.isPending) return <SplashView />;
  if (profile.error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      </View>
    );
  }
  if (!profile.data?.onboarded) return <Redirect href="/profile-setup" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
