import { useRouter } from 'expo-router';

import { Banner } from '@/components/Badges';
import { Button } from '@/components/Button';
import { FlaskConical } from '@/components/icons';
import { NavHeader, Screen, TitleBlock } from '@/components/Screen';

/**
 * Shown on account screens in Demo Mode. There are no accounts to create or
 * sign in to without a backend, so no working-looking form is offered.
 */
export function AuthUnavailable({ title }: { title: string }) {
  const router = useRouter();
  return (
    <Screen
      header={<NavHeader />}
      footer={<Button label="Back to welcome" onPress={() => router.replace('/welcome')} testID="auth-back-to-welcome" />}>
      <TitleBlock title={title} />
      <Banner
        tone="warning"
        icon={FlaskConical}
        title="Accounts need a backend"
        message="This is Demo Mode: there is no server, so accounts can’t be created or signed in to. Explore the demo with sample people instead, or connect a backend as described in the README."
      />
    </Screen>
  );
}
