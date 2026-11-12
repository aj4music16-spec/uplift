import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/Button';
import { TextField } from '@/components/Fields';
import { Sheet } from '@/components/Sheet';
import { extractInviteCode, formatInviteCode, INVITE_CODE_LENGTH, isWellFormedInviteCode, normalizeInviteCode } from '@/domain/invites';

/** Type or paste an invite code (or link), then open its preview. */
export function JoinCodeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setCode('');
    setError(null);
    onClose();
  };

  const submit = () => {
    if (!isWellFormedInviteCode(code)) {
      setError(`Codes have ${INVITE_CODE_LENGTH} letters and numbers, like ABCD-2345-WXYZ.`);
      return;
    }
    const normalized = normalizeInviteCode(code);
    close();
    router.push(`/invite/${normalized}`);
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title="Join with a code"
      subtitle="Enter the code someone shared with you. You’ll see the Circle before you join."
      testID="join-code-sheet"
      footer={
        <>
          <Button label="Continue" onPress={submit} testID="join-code-submit" />
          <Button label="Not now" variant="ghost" size="md" onPress={close} />
        </>
      }>
      <TextField
        label="Invite code"
        value={code}
        onChangeText={(text) => {
          // Accept a pasted link as well as a typed code.
          const raw = text.includes('/') ? extractInviteCode(text) : text;
          setCode(formatInviteCode(raw).slice(0, INVITE_CODE_LENGTH + 2));
          if (error) setError(null);
        }}
        placeholder="XXXX-XXXX-XXXX"
        autoCapitalize="characters"
        autoComplete="off"
        returnKeyType="go"
        onSubmitEditing={submit}
        error={error ?? undefined}
        helper="Letters and numbers only; dashes are optional."
        autoFocus
        testID="join-code-input"
      />
    </Sheet>
  );
}
