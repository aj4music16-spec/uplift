import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/Button';
import { SelectField, TextField } from '@/components/Fields';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useApp } from '@/data/AppProvider';
import { useAction, useProfile } from '@/data/hooks';
import { timeZoneAbbreviation, timeZoneCity } from '@/domain/format';
import { isValidTimeZone } from '@/domain/time';
import { LIMITS } from '@/domain/types';
import { TimeZonePicker } from '@/features/auth/TimeZonePicker';

/** Name + time zone. The time zone picker opens inside the same sheet (no stacked modals). */
export function CreateCircleSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { deviceTimeZone } = useApp();
  const profile = useProfile();
  const defaultZone = profile.data?.timezone && isValidTimeZone(profile.data.timezone) ? profile.data.timezone : deviceTimeZone;
  const [name, setName] = useState('');
  const [chosenZone, setTimezone] = useState<string | null>(null);
  const timezone = chosenZone ?? defaultZone;
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setName('');
    setTimezone(null);
    setPicking(false);
    setError(null);
    onClose();
  };

  const create = useAction((repo, input: { name: string; timezone: string }) => repo.createCircle(input), {
    onSuccess: (circle) => {
      toast.success('Circle created', `${circle.name} is ready. Invite people from Members.`);
      close();
      router.push(`/circle/${circle.id}`);
    },
  });

  const submit = () => {
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (trimmed.length === 0) return setError('Give your Circle a name.');
    if (trimmed.length > LIMITS.maxNameLength) return setError(`Keep it to ${LIMITS.maxNameLength} characters.`);
    setError(null);
    create.mutate({ name: trimmed, timezone });
  };

  if (picking) {
    return (
      <Sheet
        visible={visible}
        onClose={() => setPicking(false)}
        title="Circle time zone"
        subtitle="New challenges in this Circle start with this zone."
        footer={<Button label="Back" variant="ghost" size="md" onPress={() => setPicking(false)} />}>
        <TimeZonePicker
          value={timezone}
          suggested={deviceTimeZone}
          testID="circle-timezone"
          onSelect={(zone) => {
            setTimezone(zone);
            setPicking(false);
          }}
        />
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title="Create a Circle"
      subtitle="A private group for your friends or family. Challenges happen inside it."
      testID="create-circle-sheet"
      footer={
        <>
          <Button label="Create Circle" loading={create.isPending} onPress={submit} testID="create-circle-submit" />
          <Button label="Not now" variant="ghost" size="md" onPress={close} />
        </>
      }>
      <TextField
        label="Circle name"
        value={name}
        onChangeText={(text) => {
          setName(text);
          if (error) setError(null);
        }}
        placeholder="e.g. The Inner Circle"
        maxLength={LIMITS.maxNameLength}
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={submit}
        error={error ?? undefined}
        testID="create-circle-name"
      />
      <SelectField
        label="Time zone"
        value={`${timeZoneCity(timezone)} (${timeZoneAbbreviation(new Date(), timezone)})`}
        onPress={() => setPicking(true)}
        helper="The default for new challenges. Each published challenge keeps its own zone."
        testID="create-circle-timezone"
      />
    </Sheet>
  );
}
