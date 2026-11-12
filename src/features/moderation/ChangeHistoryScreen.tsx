import { useLocalSearchParams } from 'expo-router';

import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { NavHeader, Screen, TitleBlock } from '@/components/Screen';
import { EmptyState, LoadingState } from '@/components/States';
import { Text } from '@/components/Text';
import { useApp } from '@/data/AppProvider';
import { useAudit, useChallenge } from '@/data/hooks';
import { DataError } from '@/features/checkins/common';

import { AuditEvent, type AuditContext } from './AuditEvent';

export function ChangeHistoryScreen() {
  const { challengeId } = useLocalSearchParams<{ challengeId: string }>();
  const { session } = useApp();
  const challenge = useChallenge(challengeId);
  const audit = useAudit({ challengeId });
  const header = <NavHeader title={challenge.data?.name ?? 'History'} />;

  const detail = challenge.data;
  if (!detail || !audit.data) {
    const error = challenge.error ?? audit.error;
    return (
      <Screen header={header}>
        {error ? (
          <DataError error={error} onRetry={() => { void challenge.refetch(); void audit.refetch(); }} />
        ) : (
          <LoadingState variant="list" />
        )}
      </Screen>
    );
  }
  const context: AuditContext = {
    viewerId: session?.userId ?? null,
    habitType: detail.habitType,
    comparator: detail.rules.comparator,
    unit: detail.metricUnit,
    timeZone: detail.timezone,
  };
  const events = audit.data.pages.flatMap((p) => p.items);

  return (
    <Screen header={header} refreshing={audit.isRefetching && !audit.isFetchingNextPage} onRefresh={() => void audit.refetch()}>
      <TitleBlock title="Change history" subtitle="Every review, correction and rule change, with the reason. Entries are never edited or removed." />
      {events.length === 0 ? (
        <EmptyState emoji="🗒️" title="Nothing yet" message="Reviews, corrections and changes will be listed here." />
      ) : (
        <Card padding={16} style={{ gap: 0 }}>
          {events.map((event, i) => (
            <AuditEventWithDivider key={event.id} first={i === 0}>
              <AuditEvent event={event} context={context} />
            </AuditEventWithDivider>
          ))}
        </Card>
      )}
      {audit.hasNextPage ? (
        <Button label="Load more" variant="secondary" loading={audit.isFetchingNextPage} onPress={() => void audit.fetchNextPage()} testID="history-load-more" />
      ) : events.length > 0 ? (
        <Text variant="caption" color="textSecondary" align="center">
          That’s the beginning of the history.
        </Text>
      ) : null}
      {audit.isFetchNextPageError ? (
        <Text variant="caption" color="danger" accessibilityRole="alert" align="center">
          Couldn’t load older entries. Try again.
        </Text>
      ) : null}
    </Screen>
  );
}

function AuditEventWithDivider({ first, children }: { first: boolean; children: React.ReactNode }) {
  return (
    <>
      {first ? null : <Divider />}
      {children}
    </>
  );
}
