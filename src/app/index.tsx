import { Redirect } from 'expo-router';

import { useApp } from '@/data/AppProvider';
import { SplashView } from '@/features/shell/SplashView';

/** Entry point: sends people to the welcome screen or into the app. */
export default function Index() {
  const { phase } = useApp();
  if (phase === 'loading') return <SplashView />;
  if (phase === 'signed_out') return <Redirect href="/welcome" />;
  return <Redirect href="/(app)/(tabs)" />;
}
