import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Card, Divider, ListRow } from '@/components/Card';
import { TextField } from '@/components/Fields';
import { FlaskConical, KeyRound, Mail, Trash2 } from '@/components/icons';
import { NavHeader, Screen, SectionHeading, TitleBlock } from '@/components/Screen';
import { Sheet } from '@/components/Sheet';
import { Text } from '@/components/Text';
import { useApp } from '@/data/AppProvider';
import { useAction } from '@/data/hooks';
import { describeError, toAppError } from '@/domain/errors';
import { space } from '@/theme/tokens';

const CONFIRM_WORD = 'DELETE';

const CONSEQUENCES = [
  'Your private proof files (screenshots and photos) are removed.',
  'You leave every Circle and challenge you’re in.',
  'Your chat messages are removed.',
  'In shared history your name is replaced by “Deleted member”.',
  'Scores and the change history stay, so everyone else’s results remain fair.',
];

/** The blocking message, including the Circles or challenges the server names. */
function deletionError(error: unknown): string {
  const appError = toAppError(error);
  const copy = describeError(error);
  const detail = appError.message && appError.message !== appError.code ? appError.message : copy.message;
  return `${copy.title}. ${detail}`;
}

export function AccountScreen() {
  const router = useRouter();
  const { mode, session, signOut } = useApp();
  const demo = mode === 'demo';
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  const remove = useAction((repo, _input: void) => repo.deleteAccount(), {
    silent: true,
    onSuccess: () => {
      void signOut()
        .catch(() => undefined)
        .finally(() => router.replace('/welcome'));
    },
    onError: (e) => setError(deletionError(e)),
  });

  const close = () => {
    setDeleting(false);
    setTyped('');
    setError(null);
  };

  return (
    <Screen header={<NavHeader title="Account" />} testID="account-screen">
      <TitleBlock title="Account" />

      {demo ? <Banner tone="warning" icon={FlaskConical} message="Not available in Demo Mode — the people here are sample data." /> : null}

      <Card padding={space.lg} style={{ gap: space.xs }}>
        <ListRow title="Email" subtitle={demo ? 'Sample people have no email address' : (session?.email ?? 'Not available')} icon={Mail} testID="account-email" />
        <Divider />
        <ListRow
          title="Change password"
          icon={KeyRound}
          onPress={() => router.push('/reset-password')}
          disabled={demo}
          disabledNote="Not available in Demo Mode — the people here are sample data."
          testID="account-change-password"
        />
      </Card>

      <View style={{ gap: space.md }}>
        <SectionHeading title="Delete account" />
        <Text variant="callout" color="textSecondary">
          Before deleting, hand over any Circle you own and appoint another admin for challenges you run. Uplift tells you which ones if anything is left.
        </Text>
        <Button
          label="Delete account"
          icon={Trash2}
          variant="danger"
          size="md"
          disabled={demo}
          disabledReason="Not available in Demo Mode — the people here are sample data."
          onPress={() => setDeleting(true)}
          testID="account-delete"
        />
        {demo ? (
          <Text variant="caption" color="textSecondary">
            Not available in Demo Mode — the people here are sample data.
          </Text>
        ) : null}
      </View>

      <Sheet
        visible={deleting}
        onClose={close}
        title="Delete your account?"
        subtitle="This can’t be undone."
        testID="account-delete-sheet"
        footer={
          <>
            <Button
              label="Delete my account"
              variant="danger"
              disabled={typed.trim() !== CONFIRM_WORD}
              disabledReason={`Type ${CONFIRM_WORD} to confirm`}
              loading={remove.isPending}
              onPress={() => {
                setError(null);
                remove.mutate();
              }}
              testID="account-delete-confirm"
            />
            <Button label="Keep my account" variant="ghost" size="md" onPress={close} />
          </>
        }>
        <View style={{ gap: space.sm }}>
          {CONSEQUENCES.map((line) => (
            <View key={line} style={{ flexDirection: 'row', gap: space.sm }}>
              <Text variant="callout">•</Text>
              <Text variant="callout" style={{ flex: 1 }}>
                {line}
              </Text>
            </View>
          ))}
        </View>
        <Banner message="You must transfer ownership of any Circle you own and appoint another admin for any challenge you’re the only admin of first." />
        <TextField
          label={`Type ${CONFIRM_WORD} to confirm`}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          error={error ?? undefined}
          testID="account-delete-input"
        />
      </Sheet>
    </Screen>
  );
}
