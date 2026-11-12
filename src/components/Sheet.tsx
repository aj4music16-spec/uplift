import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Animated, Dimensions, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LIMITS } from '@/domain/types';
import { useReducedMotion } from '@/lib/motion';
import { colors, gutter, layout, motion, radius, shadow, space } from '@/theme/tokens';

import { Button, type ButtonVariant } from './Button';
import { TextField } from './Fields';
import { Text } from './Text';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Pinned under the scrolling content. */
  footer?: ReactNode;
  testID?: string;
}

/**
 * Rounded bottom sheet with a handle, for short actions. Slides over a dimmed
 * backdrop, moves with the keyboard, respects the bottom safe area and
 * Reduce Motion, and can be dismissed by the backdrop, the system back
 * gesture or a screen reader's escape gesture.
 */
export function Sheet({ visible, onClose, title, subtitle, children, footer, testID }: SheetProps) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const [progress] = useState(() => new Animated.Value(0));

  // Mount as soon as it becomes visible (derived during render, not in an effect).
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      Animated.timing(progress, { toValue: 1, duration: reduced ? 0 : motion.base, useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(progress, { toValue: 0, duration: reduced ? 0 : motion.fast, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, mounted, progress, reduced]);

  if (!mounted) return null;
  const height = Dimensions.get('window').height;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.overlay, opacity: progress }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          testID={testID}
          style={[
            {
              width: '100%',
              maxWidth: layout.maxWidth,
              alignSelf: 'center',
              maxHeight: height * 0.9,
              backgroundColor: colors.bg,
              borderTopLeftRadius: radius.sheet,
              borderTopRightRadius: radius.sheet,
              paddingBottom: Math.max(insets.bottom, space.lg),
              transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [height * 0.5, 0] }) }],
            },
            shadow.sheet,
          ]}>
          <View style={{ alignItems: 'center', paddingTop: space.md, paddingBottom: space.sm }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: colors.surfaceSunken }} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.sm, paddingBottom: space.lg, gap: space.lg }}>
            {title ? (
              <View style={{ gap: space.xs }}>
                <Text variant="title" accessibilityRole="header">
                  {title}
                </Text>
                {subtitle ? (
                  <Text variant="callout" color="textSecondary">
                    {subtitle}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: gutter, paddingTop: space.sm, gap: space.sm }}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface ConfirmationSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  cancelLabel?: string;
  /** Ask for a written reason before allowing the action. */
  reason?: { label: string; placeholder?: string; required?: boolean };
  loading?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  children?: ReactNode;
  testID?: string;
}

/** Clear confirmation for consequential actions (remove, cancel, override), optionally with a mandatory reason. */
export function ConfirmationSheet({
  visible,
  onClose,
  title,
  message,
  confirmLabel,
  confirmVariant = 'primary',
  cancelLabel = 'Not now',
  reason,
  loading,
  error,
  onConfirm,
  children,
  testID,
}: ConfirmationSheetProps) {
  const [text, setText] = useState('');
  // Start every opening with an empty reason.
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible) setText('');
  }
  const needsReason = !!reason && reason.required !== false;
  const blocked = needsReason && text.trim().length < LIMITS.minReasonLength;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={message}
      testID={testID}
      footer={
        <>
          <Button
            label={confirmLabel}
            variant={confirmVariant}
            loading={loading}
            disabled={blocked}
            disabledReason="Add a short reason first"
            onPress={() => onConfirm(text.trim())}
            testID={testID ? `${testID}-confirm` : undefined}
          />
          <Button label={cancelLabel} variant="ghost" size="md" onPress={onClose} />
        </>
      }>
      {children}
      {reason ? (
        <TextField
          label={reason.label}
          value={text}
          onChangeText={setText}
          placeholder={reason.placeholder}
          multiline
          maxLength={LIMITS.maxReasonLength}
          helper={needsReason ? 'Required. Everyone affected can see this.' : 'Optional'}
          error={error ?? undefined}
          testID={testID ? `${testID}-reason` : undefined}
        />
      ) : error ? (
        <Text variant="callout" color="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}
