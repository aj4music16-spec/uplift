import * as Linking from 'expo-linking';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/Badges';
import { Button } from '@/components/Button';
import { FlaskConical, ImageIcon, Lock, RefreshCw, Settings, Trash2 } from '@/components/icons';
import { Text } from '@/components/Text';
import { useApp } from '@/data/AppProvider';
import { syntheticEvidence } from '@/data/demo/createDemo';
import type { LocalEvidence } from '@/data/types';
import { formatDateKey, type HabitType } from '@/domain';
import { pickEvidenceImage } from '@/lib/evidence';
import { space } from '@/theme/tokens';

import { EvidenceImage } from './EvidenceImage';

type Problem = 'denied' | 'too_large' | 'error' | null;

export interface EvidenceUploaderProps {
  habitType: HabitType;
  date: string;
  value: LocalEvidence | null;
  onChange: (evidence: LocalEvidence | null) => void;
  /** Used for Demo Mode's synthetic sample. */
  sampleMinutes?: number | null;
  disabled?: boolean;
}

/** Choose, preview, replace or remove one proof image. Nothing is uploaded until the check-in is submitted. */
export function EvidenceUploader({ habitType, date, value, onChange, sampleMinutes, disabled }: EvidenceUploaderProps) {
  const { mode } = useApp();
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);
  const screenTime = habitType === 'screen_time';

  const pick = async () => {
    setBusy(true);
    try {
      const result = await pickEvidenceImage();
      if (result.status === 'picked') {
        setProblem(null);
        onChange(result.evidence);
      } else if (result.status !== 'canceled') {
        setProblem(result.status);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      {screenTime ? (
        <Banner
          title="What to upload"
          message={`A screenshot of your phone’s Day view for ${formatDateKey(date)} showing the date and that day’s total. Your one primary phone only — not the weekly average, and not totals across devices.`}
          icon={ImageIcon}
        />
      ) : (
        <Banner title="Photo proof" message="Add one photo that shows you did it. An admin reviews it before the day counts." icon={ImageIcon} />
      )}
      <Banner
        title="Your proof stays private"
        message="Screenshots can show app names or other sensitive details. Only you and the challenge admins can see it — the group only sees the outcome. Location data is removed before upload."
        icon={Lock}
      />

      {problem === 'denied' ? (
        <Banner
          tone="warning"
          title="Photo access is off"
          message="Uplift needs permission to open the one image you choose. Turn on photo access for Uplift in Settings, then try again."
          action={<Button label="Open Settings" icon={Settings} variant="secondary" size="sm" fullWidth={false} onPress={() => void Linking.openSettings()} />}
        />
      ) : problem === 'too_large' ? (
        <Banner tone="warning" title="That image is too large" message="Even after shrinking it’s over 10 MB. Choose a regular screenshot instead of a very large photo." />
      ) : problem === 'error' ? (
        <Banner tone="warning" title="Couldn’t prepare that image" message="It may be in a format we can’t read. Try a different screenshot (JPEG, PNG or HEIC)." />
      ) : null}

      {value ? (
        <View style={{ gap: space.sm }}>
          <Text variant="calloutStrong">Preview</Text>
          <EvidenceImage uri={value.uri} accessibilityLabel="Your chosen proof" testID="checkin-preview" />
          <Text variant="caption" color="textSecondary">
            Check that the date and the total are easy to read before you submit.
          </Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Replace" icon={RefreshCw} variant="secondary" size="md" fullWidth={false} onPress={() => void pick()} loading={busy} disabled={disabled} testID="checkin-replace-image" style={{ flex: 1 }} />
            <Button label="Remove" icon={Trash2} variant="ghost" size="md" fullWidth={false} onPress={() => onChange(null)} disabled={disabled} testID="checkin-remove-image" style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <Button
          label={screenTime ? 'Choose screenshot' : 'Choose photo'}
          icon={ImageIcon}
          variant="secondary"
          onPress={() => void pick()}
          loading={busy}
          disabled={disabled}
          testID="checkin-pick-image"
        />
      )}

      {mode === 'demo' && screenTime && !value ? (
        <Button
          label="Use a synthetic sample (Demo Mode)"
          icon={FlaskConical}
          variant="ghost"
          size="md"
          disabled={disabled || sampleMinutes == null}
          disabledReason="Enter the total first so the sample can show it"
          onPress={() => {
            if (sampleMinutes == null) return;
            setProblem(null);
            onChange(syntheticEvidence({ date, minutes: sampleMinutes }));
          }}
          testID="checkin-use-sample"
        />
      ) : null}
    </View>
  );
}
