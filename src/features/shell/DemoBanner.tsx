import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { ChoiceRow } from '@/components/Fields';
import { ChevronDown, FlaskConical } from '@/components/icons';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { useApp } from '@/data/AppProvider';
import { useNow } from '@/data/hooks';
import { formatDateTime } from '@/domain/format';
import { colors, gutter, space } from '@/theme/tokens';

/** Height of the strip below the status bar. */
export const DEMO_BANNER_HEIGHT = 36;

/**
 * Always visible in Demo Mode, on every screen. Makes it impossible to mistake
 * sample data for a real account, and opens the demo tools.
 */
export function DemoBanner() {
  const { mode, demo, phase, deviceTimeZone } = useApp();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const now = useNow(15_000);
  const [open, setOpen] = useState(false);
  if (mode !== 'demo') return null;
  const signedIn = phase === 'signed_in' && demo;
  const current = demo?.personas.find((p) => p.key === demo.persona);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={!demo}
        accessibilityRole="button"
        accessibilityLabel={`Demo Mode. Sample data, nothing is saved.${signedIn && current ? ` Viewing as ${current.name}.` : ''} Opens demo tools.`}
        testID="demo-banner"
        style={{ backgroundColor: colors.warningSoft, paddingTop: insets.top }}>
        <View style={{ height: DEMO_BANNER_HEIGHT, paddingHorizontal: gutter, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <FlaskConical size={14} color={colors.warning} strokeWidth={2.6} />
          <Text variant="captionStrong" color="warning" style={{ flex: 1 }} numberOfLines={1}>
            Demo Mode · sample data, nothing is saved
          </Text>
          {signedIn && current ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text variant="captionStrong" color="warning">
                as {current.name}
              </Text>
              <ChevronDown size={14} color={colors.warning} strokeWidth={2.6} />
            </View>
          ) : null}
        </View>
      </Pressable>
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Demo tools"
        subtitle={`Everything here is sample data on this device. No account, no server, no money. Demo clock: ${formatDateTime(now, deviceTimeZone)}.`}
        testID="demo-tools">
        {demo ? (
          <>
            <Text variant="calloutStrong">View the app as</Text>
            <View style={{ gap: space.sm }}>
              {demo.personas.map((p) => (
                <ChoiceRow
                  key={p.key}
                  title={p.name}
                  subtitle={p.key === 'aj' ? 'Circle owner · admin of Screen Time Showdown' : p.key === 'dad' ? 'Second admin of Screen Time Showdown' : 'Player'}
                  selected={!!signedIn && demo.persona === p.key}
                  leading={<Avatar avatar={p.avatar} size={36} name="" />}
                  testID={`demo-persona-${p.key}`}
                  onPress={() => {
                    if (signedIn) demo.switchPersona(p.key);
                    else demo.enter(p.key);
                    setOpen(false);
                    router.replace('/');
                  }}
                />
              ))}
            </View>
            <Text variant="calloutStrong">Move the demo clock</Text>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="+4 hours" variant="secondary" size="md" fullWidth={false} onPress={() => demo.advanceClock(4)} testID="demo-clock-4h" />
              <Button label="+1 day" variant="secondary" size="md" fullWidth={false} onPress={() => demo.advanceClock(24)} testID="demo-clock-1d" />
            </View>
            <Button
              label="Reset sample data"
              variant="secondary"
              size="md"
              onPress={() => {
                void demo.reset();
                setOpen(false);
              }}
            />
            {signedIn ? (
              <Button
                label="Leave the demo"
                variant="ghost"
                size="md"
                onPress={() => {
                  demo.leave();
                  setOpen(false);
                  router.replace('/welcome');
                }}
              />
            ) : null}
          </>
        ) : null}
      </Sheet>
    </>
  );
}
