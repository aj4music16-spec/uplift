import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { WifiOff } from '@/components/icons';
import { Text } from '@/components/Text';
import { useApp } from '@/data/AppProvider';
import { colors, gutter, space } from '@/theme/tokens';

/** Shown while the device is offline. On reconnect every view is re-read from the server. */
export function OfflineBanner() {
  const { mode } = useApp();
  const queryClient = useQueryClient();
  const [offline, setOffline] = useState(false);
  const wasOffline = useRef(false);
  useEffect(() => {
    if (mode !== 'live') return undefined;
    return NetInfo.addEventListener((state) => {
      const isOffline = state.isConnected === false;
      setOffline(isOffline);
      if (!isOffline && wasOffline.current) void queryClient.invalidateQueries();
      wasOffline.current = isOffline;
    });
  }, [mode, queryClient]);
  if (!offline) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: colors.ink, paddingHorizontal: gutter, paddingVertical: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      <WifiOff size={14} color={colors.onInk} strokeWidth={2.6} />
      <Text variant="captionStrong" color="onInk" style={{ flex: 1 }}>
        You’re offline. Check-ins are sent when you’re back online and try again.
      </Text>
    </View>
  );
}
