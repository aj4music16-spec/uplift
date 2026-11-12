import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Share, View } from 'react-native';

import { Banner } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Stepper } from '@/components/Fields';
import { Copy, Lock, Share2 } from '@/components/icons';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { useToast } from '@/components/Toast';
import { useAction } from '@/data/hooks';
import type { CreatedInvite } from '@/data/types';
import { pluralize } from '@/domain/format';
import { formatInviteCode, inviteLink } from '@/domain/invites';
import { LIMITS } from '@/domain/types';
import { colors, radius, space } from '@/theme/tokens';

/**
 * Creates an invite and shows its code exactly once. The server stores only a
 * hash, so the code cannot be shown again after the sheet closes.
 */
export function CreateInviteSheet({ visible, onClose, circleId, circleName }: { visible: boolean; onClose: () => void; circleId: string; circleName: string }) {
  const toast = useToast();
  const [days, setDays] = useState<number>(LIMITS.inviteDefaultExpiryDays);
  const [uses, setUses] = useState<number>(LIMITS.inviteDefaultMaxUses);
  const [created, setCreated] = useState<CreatedInvite | null>(null);

  // Closing forgets the code: it is never shown again.
  const close = () => {
    setCreated(null);
    setDays(LIMITS.inviteDefaultExpiryDays);
    setUses(LIMITS.inviteDefaultMaxUses);
    onClose();
  };

  const create = useAction((repo, input: { circleId: string; expiresInDays: number; maxUses: number }) => repo.createInvite(input), {
    onSuccess: (result) => setCreated(result),
  });

  if (created) {
    const formatted = formatInviteCode(created.code);
    const link = inviteLink(created.code);
    return (
      <Sheet
        visible={visible}
        onClose={close}
        title="Invite ready"
        subtitle={`Share it with the people you want in ${circleName}. Valid for ${pluralize(days, 'day')}, up to ${pluralize(uses, 'person', 'people')}.`}
        testID="invite-created-sheet"
        footer={<Button label="Done" onPress={close} testID="invite-created-done" />}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.xl, paddingVertical: space.xxl, paddingHorizontal: space.lg, alignItems: 'center', gap: space.sm }}>
          <Text variant="caption" color="textSecondary">
            Invite code
          </Text>
          <Text variant="title" selectable accessibilityLabel={`Invite code ${formatted.split('').join(' ')}`} testID="invite-code" style={{ fontVariant: ['tabular-nums'], letterSpacing: 1 }}>
            {formatted}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button
            label="Copy code"
            icon={Copy}
            variant="secondary"
            size="md"
            style={{ flex: 1 }}
            onPress={() => {
              Clipboard.setStringAsync(formatted)
                .then(() => toast.success('Code copied'))
                .catch(() => toast.show({ tone: 'error', title: 'Couldn’t copy', message: 'Select the code and copy it by hand.' }));
            }}
            testID="invite-copy"
          />
          <Button
            label="Share link"
            icon={Share2}
            variant="secondary"
            size="md"
            style={{ flex: 1 }}
            onPress={() => {
              Share.share({ message: `Join ${circleName} on Uplift: ${link}\nOr enter the code ${formatted} in the app.` }).catch(() =>
                toast.show({ tone: 'error', title: 'Sharing isn’t available here', message: 'Copy the code instead.' }),
              );
            }}
            testID="invite-share"
          />
        </View>
        <Banner icon={Lock} message="This code is shown only once. If you lose it, create a new invite and revoke this one." />
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title="Invite people"
      subtitle="Anyone with the code can ask to join until it expires or runs out of uses."
      testID="create-invite-sheet"
      footer={
        <>
          <Button label="Create invite" loading={create.isPending} onPress={() => create.mutate({ circleId, expiresInDays: days, maxUses: uses })} testID="create-invite-submit" />
          <Button label="Not now" variant="ghost" size="md" onPress={close} />
        </>
      }>
      <Stepper
        label="Expires after"
        value={days}
        onChange={setDays}
        min={1}
        max={LIMITS.inviteMaxExpiryDays}
        format={(value) => pluralize(value, 'day')}
        testID="invite-days"
      />
      <Stepper
        label="Can be used by"
        value={uses}
        onChange={setUses}
        min={1}
        max={LIMITS.inviteMaxUses}
        format={(value) => pluralize(value, 'person', 'people')}
        testID="invite-uses"
      />
    </Sheet>
  );
}
