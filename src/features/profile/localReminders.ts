import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { ChallengeCard, ReminderPreference } from '@/data/types';

/**
 * Local, on-device daily reminders. Nothing here talks to a server and
 * nothing is a push notification: remote push is deferred.
 *
 * Every sync cancels all previously scheduled Uplift reminders and schedules
 * one daily notification per enabled preference for a challenge the person is
 * still playing (scheduled or active). Finished, canceled and left challenges
 * therefore lose their reminders on the next sync.
 */

const KIND = 'uplift-daily-reminder';
const CHANNEL_ID = 'uplift-reminders';

export type ReminderSyncStatus =
  /** At least one reminder is scheduled on this device. */
  | 'scheduled'
  /** Nothing is enabled (any previous reminders were cancelled). */
  | 'none'
  /** Reminders are enabled but the OS permission is not granted. */
  | 'denied'
  /** Local notifications don't exist on this platform (web). */
  | 'unavailable';

export interface ReminderSyncResult {
  status: ReminderSyncStatus;
  scheduled: number;
}

export function localRemindersAvailable(): boolean {
  return Platform.OS !== 'web';
}

/** Challenges that may carry a reminder: the person is playing and it isn't over. */
export function remindableChallenges(challenges: readonly ChallengeCard[]): ChallengeCard[] {
  return challenges.filter(
    (c) => (c.status === 'scheduled' || c.status === 'active') && !!c.viewer.participantId && !c.viewer.removed,
  );
}

async function cancelUpliftReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((request) => request.content.data?.kind === KIND || request.identifier.startsWith(`${KIND}:`))
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
  );
}

async function ensurePermission(request: boolean): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!request || !current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/**
 * Reconciles this device's scheduled reminders with the saved preferences.
 * Asks for permission only when `requestPermission` is set (the moment the
 * first reminder is turned on), never on a background sync.
 */
export async function syncLocalReminders(
  preferences: readonly ReminderPreference[],
  challenges: readonly ChallengeCard[],
  options: { requestPermission?: boolean } = {},
): Promise<ReminderSyncResult> {
  if (!localRemindersAvailable()) return { status: 'unavailable', scheduled: 0 };

  const playable = new Map(remindableChallenges(challenges).map((c) => [c.id, c]));
  const wanted = preferences.filter((p) => p.enabled && playable.has(p.challengeId));

  await cancelUpliftReminders();
  if (wanted.length === 0) return { status: 'none', scheduled: 0 };

  if (!(await ensurePermission(options.requestPermission === true))) return { status: 'denied', scheduled: 0 };

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Check-in reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  let scheduled = 0;
  for (const preference of wanted) {
    const challenge = playable.get(preference.challengeId);
    const [hour, minute] = preference.localTime.split(':').map(Number);
    if (!challenge || hour == null || minute == null || Number.isNaN(hour) || Number.isNaN(minute)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: `${KIND}:${challenge.id}`,
      content: {
        title: 'Uplift',
        // Generic on purpose: no values, proof or standings on the lock screen.
        body: `Time for today’s check-in — ${challenge.name}`,
        data: { kind: KIND, challengeId: challenge.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: CHANNEL_ID },
    });
    scheduled += 1;
  }
  return { status: scheduled > 0 ? 'scheduled' : 'none', scheduled };
}
