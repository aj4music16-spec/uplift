import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeError } from '@/domain/errors';
import { useReducedMotion } from '@/lib/motion';
import { colors, gutter, layout, motion, radius, shadow, space } from '@/theme/tokens';

import { CircleAlert, CircleCheck, Info } from './icons';
import { Text } from './Text';

type ToastTone = 'success' | 'error' | 'info';

interface ToastMessage {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastApi {
  show: (toast: { tone?: ToastTone; title: string; message?: string }) => void;
  /** Shows the mapped, actionable copy for any failure. */
  error: (error: unknown) => void;
  success: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

/** Brief confirmation or failure message. Announced to screen readers; tap to dismiss. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [progress] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(progress, { toValue: 0, duration: reduced ? 0 : motion.fast, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setToast(null);
    });
  }, [progress, reduced]);

  const show = useCallback<ToastApi['show']>(
    ({ tone = 'info', title, message }) => {
      counter.current += 1;
      setToast({ id: counter.current, tone, title, message });
      AccessibilityInfo.announceForAccessibility(message ? `${title}. ${message}` : title);
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(progress, { toValue: 1, duration: reduced ? 0 : motion.base, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, tone === 'error' ? 6000 : 3500);
    },
    [hide, progress, reduced],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      error: (error) => {
        const copy = describeError(error);
        show({ tone: 'error', title: copy.title, message: copy.message });
      },
      success: (title, message) => show({ tone: 'success', title, message }),
    }),
    [show],
  );

  const Icon = toast?.tone === 'success' ? CircleCheck : toast?.tone === 'error' ? CircleAlert : Info;
  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: insets.top + space.sm,
            alignItems: 'center',
            paddingHorizontal: gutter,
            opacity: progress,
            transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
          }}>
          <Pressable
            onPress={hide}
            accessibilityRole="alert"
            accessibilityLabel={toast.message ? `${toast.title}. ${toast.message}` : toast.title}
            accessibilityHint="Double tap to dismiss"
            testID="toast"
            style={[
              {
                width: '100%',
                maxWidth: layout.maxWidth - gutter * 2,
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: space.md,
                padding: space.lg,
                borderRadius: radius.lg,
                backgroundColor: colors.ink,
              },
              shadow.float,
            ]}>
            <Icon size={20} color={toast.tone === 'error' ? '#FFB4A8' : colors.onInk} strokeWidth={2.4} style={{ marginTop: 1 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="calloutStrong" color="onInk">
                {toast.title}
              </Text>
              {toast.message ? (
                <Text variant="caption" color="onInkSecondary">
                  {toast.message}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}
