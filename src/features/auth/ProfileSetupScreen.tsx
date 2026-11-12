import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar, FACE_COUNT, FACE_NAMES, type AvatarSpec } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { SelectField, TextField } from '@/components/Fields';
import { Check } from '@/components/icons';
import { NavHeader, Screen, TitleBlock } from '@/components/Screen';
import { LoadingState, QueryBoundary } from '@/components/States';
import { Text } from '@/components/Text';
import { useApp } from '@/data/AppProvider';
import { useAction, useProfile } from '@/data/hooks';
import type { Profile } from '@/data/types';
import { timeZoneAbbreviation, timeZoneCity } from '@/domain/format';
import { isValidTimeZone } from '@/domain/time';
import { LIMITS } from '@/domain/types';
import { SplashView } from '@/features/shell/SplashView';
import { AVATAR_COLOR_NAMES, avatarColors, colors, radius, space } from '@/theme/tokens';

import { firstParam } from './schemas';
import { TimeZoneSheet } from './TimeZonePicker';

/**
 * First-run profile (display name, avatar, time zone). With `?edit=1` it
 * edits the existing profile and returns to the previous screen.
 */
export function ProfileSetupScreen() {
  const { phase } = useApp();
  const params = useLocalSearchParams<{ edit?: string }>();
  const editing = firstParam(params.edit) === '1';
  const profile = useProfile();

  if (phase === 'loading') return <SplashView />;
  if (phase === 'signed_out') return <Redirect href="/welcome" />;

  return (
    <QueryBoundary
      query={profile}
      loading={
        <Screen header={editing ? <NavHeader /> : undefined}>
          <LoadingState variant="detail" />
        </Screen>
      }>
      {(data) => <ProfileForm profile={data} editing={editing} onSaved={() => profile.refetch()} />}
    </QueryBoundary>
  );
}

function ProfileForm({ profile, editing, onSaved }: { profile: Profile | null; editing: boolean; onSaved: () => Promise<unknown> }) {
  const router = useRouter();
  const { deviceTimeZone, pendingInvite } = useApp();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [avatar, setAvatar] = useState<AvatarSpec>(profile?.avatar ?? { color: 'sun', face: 0 });
  const [timezone, setTimezone] = useState(() => {
    const saved = profile?.onboarded ? profile.timezone : null;
    return saved && isValidTimeZone(saved) ? saved : deviceTimeZone;
  });
  const [pickingZone, setPickingZone] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const save = useAction((repo, input: { displayName: string; timezone: string; avatar: AvatarSpec }) => repo.saveProfile(input), {
    onSuccess: () => {
      // Wait for the canonical profile so the app shell sees "onboarded" before moving on.
      void onSaved().finally(() => {
        if (editing) {
          if (router.canGoBack()) router.back();
          else router.replace('/profile');
        } else {
          router.replace(pendingInvite ? `/invite/${pendingInvite}` : '/');
        }
      });
    },
  });

  const submit = () => {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (trimmed.length === 0) return setNameError('Add the name your Circle will see.');
    if (trimmed.length > LIMITS.maxNameLength) return setNameError(`Keep it to ${LIMITS.maxNameLength} characters.`);
    if (!isValidTimeZone(timezone)) return setNameError(null);
    setNameError(null);
    save.mutate({ displayName: trimmed, timezone, avatar });
  };

  const now = new Date();
  return (
    <Screen
      header={editing ? <NavHeader /> : undefined}
      footer={<Button label={editing ? 'Save profile' : 'Continue'} loading={save.isPending} onPress={submit} testID="profile-save" />}>
      <TitleBlock
        title={editing ? 'Edit profile' : 'Make it yours'}
        subtitle={editing ? undefined : 'This is how friends and family will see you in your Circles.'}
      />

      <View style={{ alignItems: 'center', gap: space.md }}>
        <Avatar avatar={avatar} size={128} ring name={name.trim() || 'Your'} />
        <Text variant="headline" align="center">
          {name.trim() || 'Your name'}
        </Text>
      </View>

      <TextField
        label="Display name"
        value={name}
        onChangeText={(text) => {
          setName(text);
          if (nameError) setNameError(null);
        }}
        placeholder="e.g. Mia, Dad, Coach K"
        maxLength={LIMITS.maxNameLength}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="nickname"
        returnKeyType="done"
        onSubmitEditing={submit}
        error={nameError ?? undefined}
        helper="Visible only to people in your Circles."
        testID="profile-name"
      />

      <View style={{ gap: space.sm }}>
        <Text variant="calloutStrong">Color</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Avatar color">
          {AVATAR_COLOR_NAMES.map((color) => {
            const selected = avatar.color === color;
            return (
              <Pressable
                key={color}
                onPress={() => setAvatar((a) => ({ ...a, color }))}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={color}
                testID={`profile-color-${color}`}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 24,
                  backgroundColor: avatarColors[color],
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: selected ? 3 : 0,
                  borderColor: colors.ink,
                }}>
                {selected ? <Check size={20} color={colors.ink} strokeWidth={3} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <Text variant="calloutStrong">Face</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Avatar face">
          {Array.from({ length: FACE_COUNT }, (_, face) => {
            const selected = avatar.face === face;
            return (
              <Pressable
                key={face}
                onPress={() => setAvatar((a) => ({ ...a, face }))}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={FACE_NAMES[face] ?? `Face ${face + 1}`}
                testID={`profile-face-${face}`}
                style={({ pressed }) => ({
                  padding: 4,
                  borderRadius: radius.lg,
                  backgroundColor: selected ? colors.ink : pressed ? colors.surfaceStrong : colors.surface,
                })}>
                <Avatar avatar={{ color: avatar.color, face }} size={48} name="" />
              </Pressable>
            );
          })}
        </View>
      </View>

      <SelectField
        label="Your time zone"
        value={`${timeZoneCity(timezone)} (${timeZoneAbbreviation(now, timezone)})`}
        onPress={() => setPickingZone(true)}
        helper={
          timezone === deviceTimeZone
            ? 'Matches this device. Reminders use it; each challenge keeps its own time zone.'
            : `This device is set to ${timeZoneCity(deviceTimeZone)}. Reminders use the zone you pick here.`
        }
        testID="profile-timezone"
      />

      <TimeZoneSheet
        visible={pickingZone}
        onClose={() => setPickingZone(false)}
        value={timezone}
        suggested={deviceTimeZone}
        onSelect={setTimezone}
        subtitle="Used for your reminders. Challenge days always follow the challenge’s own time zone."
      />
    </Screen>
  );
}
