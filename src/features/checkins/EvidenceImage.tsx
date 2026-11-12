import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '@/components/Button';
import { ImageOff, Lock, RefreshCw, X } from '@/components/icons';
import { Text } from '@/components/Text';
import { parseSyntheticEvidence } from '@/data/demo/createDemo';
import { useEvidenceUrl } from '@/data/hooks';
import { describeError, formatDateKey, formatMinutes } from '@/domain';
import { colors, radius, space } from '@/theme/tokens';

type SyntheticSpec = NonNullable<ReturnType<typeof parseSyntheticEvidence>>;

/** Deterministic bar lengths (fractions) from the total, so the same sample always looks the same. */
function bars(minutes: number): { label: string; fraction: number }[] {
  const seed = Math.max(1, Math.round(minutes));
  const parts = [0.38, 0.24, 0.17, 0.12].map((base, i) => base + (((seed * (i + 3)) % 7) - 3) / 100);
  const max = Math.max(...parts);
  return ['Social', 'Video', 'Messages', 'Other'].map((label, i) => ({ label, fraction: (parts[i] ?? 0) / max }));
}

/**
 * A drawn stand-in for a phone's daily usage screen, used by Demo Mode's
 * sample proof. Original layout, clearly watermarked as synthetic.
 */
export function SyntheticScreenTime({ spec, large = false }: { spec: SyntheticSpec; large?: boolean }) {
  const week = spec.view === 'week';
  const showDate = spec.view === 'day';
  const scale = large ? 1.4 : 1;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Synthetic sample screenshot. ${week ? 'Week view, daily average' : showDate ? `Day view for ${formatDateKey(spec.date)}` : 'Day view without a date'}: ${formatMinutes(spec.minutes)}.`}
      style={{ backgroundColor: colors.bg, borderRadius: radius.lg, padding: space.lg * scale, gap: space.md * scale, overflow: 'hidden' }}>
      <Text variant="micro" color="textSecondary">
        Screen Time
      </Text>
      <Text variant="subhead">{week ? 'Week' : showDate ? formatDateKey(spec.date, { year: true }) : 'Day'}</Text>
      <View style={{ gap: 2 }}>
        <Text variant="caption" color="textSecondary">
          {week ? 'Daily average' : 'Total today'}
        </Text>
        <Text variant="stat" style={{ fontSize: 40 * scale, lineHeight: 44 * scale }}>
          {formatMinutes(spec.minutes)}
        </Text>
      </View>
      <View style={{ gap: space.sm }}>
        {bars(spec.minutes).map((bar) => (
          <View key={bar.label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text variant="micro" color="textSecondary" style={{ width: 64 }}>
              {bar.label}
            </Text>
            <View style={{ flex: 1, height: 8 * scale, borderRadius: 4 * scale, backgroundColor: colors.surfaceStrong }}>
              <View style={{ width: `${Math.round(bar.fraction * 100)}%`, height: '100%', borderRadius: 4 * scale, backgroundColor: colors.info }} />
            </View>
          </View>
        ))}
      </View>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            transform: [{ rotate: '-22deg' }],
            borderWidth: 2,
            borderColor: colors.danger,
            borderRadius: radius.sm,
            paddingHorizontal: space.md,
            paddingVertical: space.xs,
            backgroundColor: 'rgba(253, 231, 228, 0.82)',
          }}>
          <Text variant="labelSmall" color="danger" maxFontSizeMultiplier={1.2}>
            SYNTHETIC SAMPLE
          </Text>
        </View>
      </View>
    </View>
  );
}

export interface EvidenceImageProps {
  uri: string;
  /** Height of the inline preview. */
  height?: number;
  /** Called when the image can't be decoded or loaded. */
  onUnreadable?: () => void;
  /** Called when the person asks to reload (a short-lived link may have expired). */
  onReload?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Shows one piece of proof. Never cached to disk; tap to open a full-screen
 * viewer. Synthetic demo samples are drawn instead of loaded.
 */
export function EvidenceImage({ uri, height = 240, onUnreadable, onReload, accessibilityLabel = 'Proof image', testID }: EvidenceImageProps) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const synthetic = parseSyntheticEvidence(uri);

  if (!synthetic && state === 'error') {
    return (
      <View
        accessibilityRole="alert"
        testID={testID ? `${testID}-unreadable` : undefined}
        style={{ minHeight: 120, borderRadius: radius.lg, backgroundColor: colors.surface, padding: space.lg, gap: space.sm, alignItems: 'center', justifyContent: 'center' }}>
        <ImageOff size={24} color={colors.textSecondary} strokeWidth={2.2} />
        <Text variant="calloutStrong" align="center">
          This image can’t be read
        </Text>
        <Text variant="caption" color="textSecondary" align="center">
          The file didn’t load or isn’t a readable image.
        </Text>
        {onReload ? (
          <Button
            label="Try loading again"
            icon={RefreshCw}
            variant="ghost"
            size="sm"
            fullWidth={false}
            onPress={() => {
              setState('loading');
              onReload();
            }}
          />
        ) : null}
      </View>
    );
  }

  const content = (large: boolean) =>
    synthetic ? (
      <SyntheticScreenTime spec={synthetic} large={large} />
    ) : (
      <View style={{ height: large ? '100%' : height, width: '100%' }}>
        <Image
          source={{ uri }}
          cachePolicy="none"
          contentFit="contain"
          style={{ flex: 1 }}
          accessibilityLabel={accessibilityLabel}
          onLoad={() => setState('ready')}
          onError={() => {
            setState('error');
            onUnreadable?.();
          }}
        />
        {state === 'loading' ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={large ? colors.onInk : colors.ink} accessibilityLabel="Loading proof" />
          </View>
        ) : null}
      </View>
    );

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}. Opens full screen`}
        testID={testID}
        style={({ pressed }) => ({ borderRadius: radius.lg, backgroundColor: colors.surface, padding: synthetic ? space.sm : 0, overflow: 'hidden', opacity: pressed ? 0.85 : 1 })}>
        {content(false)}
      </Pressable>
      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: colors.ink, paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xl, gap: space.md }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Lock size={14} color={colors.onInkSecondary} strokeWidth={2.4} />
              <Text variant="caption" color="onInkSecondary">
                Private proof — only the player and challenge admins can see it
              </Text>
            </View>
            <IconButton icon={X} label="Close" onPress={() => setOpen(false)} testID="evidence-viewer-close" />
          </View>
          <View style={{ flex: 1, padding: space.xl, justifyContent: 'center' }}>{content(true)}</View>
        </View>
      </Modal>
    </>
  );
}

export interface ServerEvidenceProps {
  evidenceId: string;
  /** False once the retention policy has removed the file. */
  available?: boolean;
  height?: number;
  onUnreadable?: () => void;
  testID?: string;
}

/** Fetches a short-lived signed link for a stored proof and shows it. */
export function ServerEvidence({ evidenceId, available = true, height, onUnreadable, testID }: ServerEvidenceProps) {
  const query = useEvidenceUrl(available ? evidenceId : null);
  if (!available) {
    return <EvidenceNote title="Proof removed" message="This file was removed under the 30-day retention policy. The decision and history remain." />;
  }
  if (query.data) {
    return <EvidenceImage uri={query.data.url} height={height} onUnreadable={onUnreadable} onReload={() => void query.refetch()} testID={testID} />;
  }
  if (query.isPending) {
    return (
      <View style={{ height: height ?? 240, borderRadius: radius.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.ink} accessibilityLabel="Loading proof" />
      </View>
    );
  }
  const copy = describeError(query.error);
  const gone = copy.code === 'NOT_FOUND' || copy.code === 'FORBIDDEN';
  return (
    <View style={{ gap: space.sm }}>
      <EvidenceNote
        title={gone ? 'Proof isn’t available' : copy.title}
        message={gone ? 'You can’t open this file anymore. It may have been removed, or your access changed.' : copy.message}
      />
      {gone ? null : <Button label="Try again" icon={RefreshCw} variant="secondary" size="sm" fullWidth={false} onPress={() => void query.refetch()} />}
    </View>
  );
}

function EvidenceNote({ title, message }: { title: string; message: string }) {
  return (
    <View style={{ borderRadius: radius.lg, backgroundColor: colors.surface, padding: space.lg, flexDirection: 'row', gap: space.md }}>
      <ImageOff size={20} color={colors.textSecondary} strokeWidth={2.2} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="calloutStrong">{title}</Text>
        <Text variant="caption" color="textSecondary">
          {message}
        </Text>
      </View>
    </View>
  );
}
