import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/Button';
import { Check } from '@/components/icons';
import { PillTabs } from '@/components/Pills';
import { Screen, TitleBlock } from '@/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { Text } from '@/components/Text';
import { useAction, useNotifications, useNow } from '@/data/hooks';
import type { NotificationView } from '@/data/types';
import { formatRelative } from '@/domain/format';
import { colors, radius, space } from '@/theme/tokens';

import { describeNotification } from './describeNotification';

type Filter = 'all' | 'unread';

/** In-app notifications. These live in Uplift only: remote push isn’t available yet. */
export function ActivityScreen() {
  const router = useRouter();
  const now = useNow();
  const query = useNotifications();
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const acknowledge = useAction((repo, id: string) => repo.acknowledgeNotification(id));
  const acknowledgeAll = useAction((repo, _input: void) => repo.acknowledgeAllNotifications());

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = items.filter((n) => !n.readAt).length;
  const shown = filter === 'unread' ? items.filter((n) => !n.readAt) : items;

  const open = (n: NotificationView) => {
    if (!n.readAt) acknowledge.mutate(n.id);
    const href = describeNotification(n).href;
    if (href) router.push(href);
  };

  return (
    <Screen
      tabBarInset
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void query.refetch().finally(() => setRefreshing(false));
      }}
      testID="activity-screen">
      <TitleBlock
        title="Activity"
        size="display"
        subtitle="Invites, reviews, rule changes and results. Shown here in the app; push notifications aren’t available yet."
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <PillTabs<Filter>
            options={[
              { value: 'all', label: 'All' },
              { value: 'unread', label: 'Unread', count: unread },
            ]}
            value={filter}
            onChange={setFilter}
            accessibilityLabel="Filter activity"
            testID="activity-filter"
          />
        </View>
        <Button
          label="Mark all read"
          icon={Check}
          variant="secondary"
          size="sm"
          fullWidth={false}
          disabled={unread === 0}
          disabledReason="Everything is already read"
          loading={acknowledgeAll.isPending}
          onPress={() => acknowledgeAll.mutate()}
          testID="activity-mark-all-read"
        />
      </View>

      {query.data === undefined ? (
        query.isPending ? (
          <LoadingState variant="list" />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )
      ) : shown.length === 0 ? (
        filter === 'unread' && items.length > 0 ? (
          <EmptyState emoji="✨" title="You’re all caught up" message="Nothing unread right now." compact />
        ) : (
          <EmptyState emoji="🔔" title="No activity yet" message="Invitations, review decisions, rule changes and results will show up here." />
        )
      ) : (
        <View style={{ gap: space.xs }}>
          {shown.map((n) => (
            <NotificationRow key={n.id} notification={n} now={now} onPress={() => open(n)} />
          ))}
          {query.hasNextPage ? (
            <Button
              label="Show older"
              variant="ghost"
              size="md"
              loading={query.isFetchingNextPage}
              onPress={() => void query.fetchNextPage()}
              testID="activity-load-more"
            />
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function NotificationRow({ notification, now, onPress }: { notification: NotificationView; now: Date; onPress: () => void }) {
  const copy = describeNotification(notification);
  const unread = !notification.readAt;
  const Icon = copy.icon;
  const when = formatRelative(notification.createdAt, now);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${copy.title}.${copy.body ? ` ${copy.body}` : ''} ${when}.`}
      accessibilityHint={copy.href ? 'Opens it' : 'Marks it as read'}
      testID={`activity-item-${notification.type}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: space.md,
        padding: space.md,
        borderRadius: radius.lg,
        backgroundColor: pressed ? colors.surfaceStrong : unread ? colors.surface : colors.bg,
      })}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: unread ? colors.bg : colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={18} color={colors.ink} strokeWidth={2.3} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant={unread ? 'bodyStrong' : 'body'}>{copy.title}</Text>
        {copy.body ? (
          <Text variant="callout" color="textSecondary">
            {copy.body}
          </Text>
        ) : null}
        <Text variant="caption" color="textSecondary">
          {unread ? `New · ${when}` : when}
        </Text>
      </View>
      {unread ? <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.signal, marginTop: 6 }} /> : null}
    </Pressable>
  );
}
