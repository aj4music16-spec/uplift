import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';

import { Banner, HabitBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChoiceRow, SelectField, SwitchRow } from '@/components/Fields';
import { BellOff, Globe, Settings } from '@/components/icons';
import { NavHeader, Screen, TitleBlock } from '@/components/Screen';
import { Sheet } from '@/components/Sheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { Text } from '@/components/Text';
import { useAction, useHome, useReminders } from '@/data/hooks';
import type { ChallengeCard, ReminderPreference } from '@/data/types';
import { space } from '@/theme/tokens';

import { localRemindersAvailable, remindableChallenges, syncLocalReminders, type ReminderSyncStatus } from './localReminders';

const COMMON_TIMES = ['07:00', '08:00', '09:00', '12:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'] as const;
const DEFAULT_TIME = '20:00';

function formatClock(localTime: string): string {
  const [h = 0, m = 0] = localTime.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function RemindersScreen() {
  const home = useHome();
  const reminders = useReminders();
  const [syncStatus, setSyncStatus] = useState<ReminderSyncStatus | null>(null);
  const [picking, setPicking] = useState<ChallengeCard | null>(null);
  const synced = useRef(false);

  const challenges = remindableChallenges(home.data?.challenges ?? []);
  const preferences = reminders.data ?? [];
  const prefFor = (challengeId: string): ReminderPreference =>
    preferences.find((p) => p.challengeId === challengeId) ?? { challengeId, enabled: false, localTime: DEFAULT_TIME };

  const runSync = (prefs: readonly ReminderPreference[], requestPermission: boolean) => {
    syncLocalReminders(prefs, home.data?.challenges ?? [], { requestPermission })
      .then((result) => setSyncStatus(result.status))
      .catch(() => setSyncStatus('denied'));
  };

  // On load: bring this device's schedule in line with the saved preferences.
  useEffect(() => {
    if (synced.current || !home.data || !reminders.data) return;
    synced.current = true;
    runSync(reminders.data, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home.data, reminders.data]);

  const save = useAction((repo, input: ReminderPreference) => repo.setReminder(input), {
    onSuccess: (saved) => {
      const before = preferences.filter((p) => p.challengeId !== saved.challengeId);
      const firstOn = saved.enabled && !preferences.some((p) => p.enabled && p.challengeId !== saved.challengeId);
      runSync([...before, saved], firstOn);
    },
  });

  const loading = (home.isPending && !home.data) || (reminders.isPending && !reminders.data);
  const error = (!home.data && home.error) || (!reminders.data && reminders.error);

  return (
    <Screen header={<NavHeader title="Reminders" />} testID="reminders-screen">
      <TitleBlock title="Reminders" subtitle="These are reminders on this device. Push notifications from the server aren’t available yet." />

      {!localRemindersAvailable() ? (
        <Banner
          icon={Globe}
          title="Not available in the browser"
          message="Local reminders only work in the iOS and Android app. Your choices are still saved and apply when you open Uplift on your phone."
        />
      ) : syncStatus === 'denied' ? (
        <Banner
          tone="warning"
          icon={BellOff}
          title="Notifications are turned off"
          message="Uplift can’t remind you until notifications are allowed for it in your device settings. Your choices are saved."
          action={<Button label="Open settings" icon={Settings} variant="secondary" size="sm" fullWidth={false} onPress={() => void Linking.openSettings()} testID="reminders-open-settings" />}
        />
      ) : null}

      {loading ? (
        <LoadingState variant="list" />
      ) : error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            void home.refetch();
            void reminders.refetch();
          }}
        />
      ) : challenges.length === 0 ? (
        <EmptyState emoji="⏰" title="Nothing to remind you about" message="Reminders are for challenges you’re playing that are scheduled or running. Join one and come back." />
      ) : (
        <View style={{ gap: space.md }}>
          {challenges.map((challenge) => {
            const pref = prefFor(challenge.id);
            const busy = save.isPending && save.variables?.challengeId === challenge.id;
            return (
              <Card key={challenge.id} padding={space.lg}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                  <HabitBadge habitType={challenge.habitType} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{challenge.name}</Text>
                    <Text variant="caption" color="textSecondary">
                      {challenge.circleName}
                    </Text>
                  </View>
                </View>
                <SwitchRow
                  title="Daily reminder"
                  subtitle={pref.enabled ? `Every day at ${formatClock(pref.localTime)}, your local time` : 'Off'}
                  value={pref.enabled}
                  disabled={busy}
                  onValueChange={(enabled) => save.mutate({ ...pref, enabled })}
                  testID={`reminder-switch-${challenge.id}`}
                />
                <SelectField
                  label="Time"
                  value={formatClock(pref.localTime)}
                  onPress={() => setPicking(challenge)}
                  disabled={busy}
                  helper="Uses this device’s clock and time zone."
                  testID={`reminder-time-${challenge.id}`}
                />
              </Card>
            );
          })}
          <Text variant="caption" color="textSecondary">
            Reminders say “Time for today’s check-in” and the challenge name — never your values or proof. They stop on their own when a challenge ends or you leave it.
          </Text>
        </View>
      )}

      <Sheet visible={!!picking} onClose={() => setPicking(null)} title="Reminder time" subtitle={picking?.name} testID="reminder-time-sheet">
        <View style={{ gap: space.sm }}>
          {COMMON_TIMES.map((time) => {
            const pref = picking ? prefFor(picking.id) : null;
            return (
              <ChoiceRow
                key={time}
                title={formatClock(time)}
                selected={pref?.localTime === time}
                onPress={() => {
                  // Picking a time turns the reminder on: that is why it was chosen.
                  if (pref) save.mutate({ ...pref, localTime: time, enabled: true });
                  setPicking(null);
                }}
                testID={`reminder-time-option-${time.replace(':', '')}`}
              />
            );
          })}
        </View>
      </Sheet>
    </Screen>
  );
}
