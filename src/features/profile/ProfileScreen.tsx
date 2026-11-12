import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Banner } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Card, Divider, ListRow } from '@/components/Card';
import { Bell, FlaskConical, History, LogOut, Palette, Pencil, Shield, User } from '@/components/icons';
import { Screen, SectionHeading } from '@/components/Screen';
import { ConfirmationSheet } from '@/components/Sheet';
import { QueryBoundary } from '@/components/States';
import { Text } from '@/components/Text';
import { useApp } from '@/data/AppProvider';
import { useNow, useProfile } from '@/data/hooks';
import { timeZoneAbbreviation, timeZoneCity } from '@/domain/format';
import { space } from '@/theme/tokens';

export function ProfileScreen() {
  const router = useRouter();
  const { mode, demo, signOut } = useApp();
  const profile = useProfile();
  const now = useNow();
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const persona = demo?.personas.find((p) => p.key === demo.persona);

  return (
    <Screen tabBarInset testID="profile-screen">
      <QueryBoundary query={profile}>
        {(me) =>
          me ? (
            <View style={{ alignItems: 'center', gap: space.md, paddingTop: space.lg }}>
              <Avatar avatar={me.avatar} size={104} ring name="" />
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Text variant="display" align="center" accessibilityRole="header">
                  {me.displayName}
                </Text>
                <Text variant="body" color="textSecondary" align="center">
                  {timeZoneCity(me.timezone)} · {timeZoneAbbreviation(now, me.timezone)}
                </Text>
              </View>
              <Button label="Edit profile" icon={Pencil} variant="secondary" size="md" fullWidth={false} onPress={() => router.push('/profile-setup?edit=1')} testID="profile-edit" />
            </View>
          ) : (
            <Text variant="body">No profile yet.</Text>
          )
        }
      </QueryBoundary>

      {mode === 'demo' ? (
        <Banner
          tone="warning"
          icon={FlaskConical}
          title={persona ? `You’re viewing the demo as ${persona.name}` : 'Demo Mode'}
          message="These people are sample data and nothing is saved to a server. Switch person, move the demo clock or reset from the Demo Mode banner at the top of the screen."
        />
      ) : null}

      <View style={{ gap: space.sm }}>
        <SectionHeading title="Your challenges" />
        <Card padding={space.lg}>
          <ListRow title="History" subtitle="Finished and canceled challenges" icon={History} onPress={() => router.push('/history')} testID="profile-history" />
        </Card>
      </View>

      <View style={{ gap: space.sm }}>
        <SectionHeading title="Settings" />
        <Card padding={space.lg} style={{ gap: space.xs }}>
          <ListRow title="Reminders" subtitle="Daily check-in reminders on this device" icon={Bell} onPress={() => router.push('/settings/reminders')} testID="profile-reminders" />
          <Divider />
          <ListRow title="Privacy" subtitle="Who sees what, and what’s kept" icon={Shield} onPress={() => router.push('/settings/privacy')} testID="profile-privacy" />
          <Divider />
          <ListRow title="Account" subtitle="Email, password, delete account" icon={User} onPress={() => router.push('/settings/account')} testID="profile-account" />
          <Divider />
          <ListRow title="Design lab" subtitle="The visual directions we compared" icon={Palette} onPress={() => router.push('/design-lab')} testID="profile-design-lab" />
        </Card>
      </View>

      <Card padding={space.lg}>
        <ListRow title={mode === 'demo' ? 'Leave the demo' : 'Sign out'} icon={LogOut} tone="danger" onPress={() => setConfirming(true)} testID="profile-sign-out" />
      </Card>

      <ConfirmationSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={mode === 'demo' ? 'Leave the demo?' : 'Sign out?'}
        message={
          mode === 'demo'
            ? 'You’ll go back to the welcome screen. The sample data stays on this device until you reset it.'
            : 'Data stored on this device for your account is cleared. Reminders already scheduled on this device stay until you change them.'
        }
        confirmLabel={mode === 'demo' ? 'Leave the demo' : 'Sign out'}
        loading={signingOut}
        onConfirm={() => {
          setSigningOut(true);
          void signOut()
            .catch(() => undefined)
            .finally(() => {
              setSigningOut(false);
              setConfirming(false);
              router.replace('/welcome');
            });
        }}
        testID="profile-sign-out-sheet"
      />
    </Screen>
  );
}
