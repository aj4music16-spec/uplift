import { View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { StatusBadge } from '@/components/Badges';
import { DayProgress } from '@/components/DayProgress';
import { Clock, Trophy, UserMinus } from '@/components/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { Text } from '@/components/Text';
import { useChallenge } from '@/data/hooks';
import type { ChallengeDetail, StandingView } from '@/data/types';
import { ordinal, pluralize } from '@/domain';
import { colors, radius, space } from '@/theme/tokens';

/** "1", "T-1" for a shared rank, "—" for removed players. Never implies a tie-break. */
function rankText(row: StandingView): string {
  if (row.rank == null) return '—';
  return row.tied ? `T-${row.rank}` : String(row.rank);
}

function rankSpoken(row: StandingView): string {
  if (row.rank == null) return 'Removed, unranked';
  return row.tied ? `Tied for ${ordinal(row.rank)}` : ordinal(row.rank);
}

/** Standings for a challenge: successful days only; pending days shown apart and never counted. */
export function StandingsList({ challengeId }: { challengeId: string }) {
  const query = useChallenge(challengeId);
  if (!query.data) {
    if (query.isPending) return <LoadingState variant="list" />;
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />;
  }
  return <Standings detail={query.data} />;
}

function Standings({ detail }: { detail: ChallengeDetail }) {
  const rows = [...detail.standings.filter((r) => !r.removed), ...detail.standings.filter((r) => r.removed)];
  const total = detail.myDays.length || rows[0]?.days.length || 0;
  if (rows.length === 0) {
    return <EmptyState emoji="🏁" title="No players yet" message="Standings appear once people join this challenge." compact />;
  }
  const ranked = rows.filter((r) => !r.removed);
  const allTied = ranked.length > 1 && ranked.every((r) => r.rank === 1);
  const myId = detail.viewer.participantId;

  return (
    <View style={{ gap: space.sm }} testID="standings-list">
      <Text variant="caption" color="textSecondary">
        Ranked by completed days. Days awaiting review don’t count until they’re reviewed. Need {detail.rules.requiredDays} to qualify.
      </Text>
      {allTied ? (
        <Text variant="calloutStrong">
          Everyone is tied at {pluralize(ranked[0]?.successfulDays ?? 0, 'day')}.
        </Text>
      ) : null}
      {rows.map((row) => {
        const me = row.participantId === myId;
        return (
          <View
            key={row.participantId}
            accessible
            accessibilityLabel={`${rankSpoken(row)}. ${row.person.displayName}${me ? ', you' : ''}. ${row.successfulDays} of ${total} days completed${row.pendingDays ? `, ${row.pendingDays} awaiting review` : ''}${row.qualified ? ', qualified' : ''}${row.removed ? ', removed' : ''}.`}
            style={{
              minHeight: 72,
              borderRadius: radius.lg,
              padding: space.md,
              gap: space.sm,
              backgroundColor: me ? colors.surfaceStrong : colors.surface,
              opacity: row.removed ? 0.75 : 1,
            }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <Text variant="score" style={{ minWidth: 40 }} color={row.removed ? 'textSecondary' : 'ink'}>
                {rankText(row)}
              </Text>
              <Avatar avatar={row.person.avatar} ghost={row.person.deleted || row.removed} size={40} name="" />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
                  <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {row.person.deleted ? 'Deleted member' : row.person.displayName}
                  </Text>
                  {me ? <StatusBadge label="YOU" tone="ink" /> : null}
                </View>
                <View style={{ flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' }}>
                  {row.removed ? <StatusBadge label="Removed" icon={UserMinus} /> : null}
                  {row.qualified ? <StatusBadge label="Qualified" tone="positive" icon={Trophy} /> : null}
                  {row.pendingDays > 0 ? <StatusBadge label={`${row.pendingDays} awaiting review`} tone="warning" icon={Clock} /> : null}
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text variant="score">{row.successfulDays}</Text>
                <Text variant="caption" color="textSecondary" style={{ fontVariant: ['tabular-nums'] }}>
                  /{total}
                </Text>
              </View>
            </View>
            {row.days.length > 0 ? <DayProgress days={row.days} size={18} /> : null}
          </View>
        );
      })}
    </View>
  );
}
