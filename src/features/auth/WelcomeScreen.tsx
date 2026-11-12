import { Redirect, useRouter } from 'expo-router';
import { View } from 'react-native';

import { Avatar, type AvatarSpec } from '@/components/Avatar';
import { Banner } from '@/components/Badges';
import { Wordmark } from '@/components/brand/Wordmark';
import { Button, IconButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { Gift, LogOut, ShieldCheck, X } from '@/components/icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useApp } from '@/data/AppProvider';
import { SplashView } from '@/features/shell/SplashView';
import { colors, space } from '@/theme/tokens';

import { useAfterSignInHref } from './afterSignIn';

/** Decorative faces, for personality. Not real people. */
const SAMPLE_AVATARS: AvatarSpec[] = [
  { color: 'sun', face: 2 },
  { color: 'coral', face: 1 },
  { color: 'sky', face: 0 },
  { color: 'mint', face: 4 },
  { color: 'rose', face: 5 },
  { color: 'iris', face: 3 },
];

const HABIT_LINES: { emoji: string; text: string }[] = [
  { emoji: '📱', text: 'Less screen time' },
  { emoji: '📚', text: 'More reading' },
  { emoji: '🙏', text: 'Daily prayer' },
  { emoji: '💪', text: 'Pushups' },
  { emoji: '✨', text: 'Your own goal' },
];

export function WelcomeScreen() {
  const router = useRouter();
  const { mode, phase, demo, notice, clearNotice, pendingInvite } = useApp();
  const afterSignIn = useAfterSignInHref();

  if (phase === 'loading') return <SplashView />;
  if (phase === 'signed_in') return <Redirect href={afterSignIn} />;

  const footer =
    mode === 'demo' ? (
      <>
        <Button
          label="Explore the demo"
          disabled={!demo}
          disabledReason="The sample data is still loading"
          onPress={() => {
            if (!demo) return;
            demo.enter('aj');
            router.replace(pendingInvite ? `/invite/${pendingInvite}` : '/');
          }}
          testID="welcome-explore-demo"
        />
        <Text variant="caption" color="textSecondary" align="center">
          Real accounts need a backend — see the README to connect one.
        </Text>
      </>
    ) : (
      <>
        <Button label="Create account" onPress={() => router.push('/sign-up')} testID="welcome-create-account" />
        <Button label="Sign in" variant="ghost" size="md" onPress={() => router.push('/sign-in')} testID="welcome-sign-in" />
      </>
    );

  return (
    <Screen footer={footer} testID="welcome-screen" contentStyle={{ paddingTop: space.xxxl }}>
      <Wordmark height={34} />

      {notice === 'expired' ? (
        <Banner
          icon={LogOut}
          title="You were signed out"
          message="Your session ended. Sign in again to pick up where you left off."
          action={
            <IconButton icon={X} label="Dismiss" variant="surface" size={36} onPress={clearNotice} testID="welcome-dismiss-notice" />
          }
        />
      ) : null}
      {pendingInvite ? (
        <Banner
          tone="info"
          icon={Gift}
          title="Invitation waiting"
          message={
            mode === 'demo'
              ? 'You have an invitation waiting. Explore the demo to open it.'
              : 'You have an invitation waiting. Sign in or create an account to accept it.'
          }
        />
      ) : null}

      <View style={{ gap: space.md }}>
        <Text variant="display" accessibilityRole="header">
          Level up. Together.
        </Text>
        <Text variant="body" color="textSecondary">
          Private habit challenges with the friends and family who keep you honest. Pick a goal, set the dates, and check in every day.
        </Text>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {SAMPLE_AVATARS.map((avatar, index) => (
          <Avatar key={`${avatar.color}-${avatar.face}`} avatar={avatar} size={52} ring name="" style={{ marginLeft: index === 0 ? 0 : -12, zIndex: SAMPLE_AVATARS.length - index }} />
        ))}
      </View>

      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {HABIT_LINES.map((line) => (
            <View
              key={line.text}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, minHeight: 36, borderRadius: 999, backgroundColor: colors.bg }}>
              <Text accessibilityElementsHidden importantForAccessibility="no">
                {line.emoji}
              </Text>
              <Text variant="labelSmall">{line.text}</Text>
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'flex-start' }}>
          <ShieldCheck size={20} color={colors.ink} strokeWidth={2.3} style={{ marginTop: 2 }} />
          <Text variant="callout" color="textSecondary" style={{ flex: 1 }}>
            Every challenge has an admin who reviews proof, like a screen-time screenshot, so the standings stay fair. Your proof is only seen by you and the admins.
          </Text>
        </View>
      </Card>
    </Screen>
  );
}
