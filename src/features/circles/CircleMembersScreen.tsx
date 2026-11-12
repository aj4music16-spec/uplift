import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { StatusBadge } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Card, Divider, ListRow } from '@/components/Card';
import { Crown, LogOut, Shield, ShieldCheck, UserMinus, UserPlus } from '@/components/icons';
import { NavHeader, Screen, SectionHeading, TitleBlock } from '@/components/Screen';
import { ConfirmationSheet, Sheet } from '@/components/Sheet';
import { EmptyState, ErrorState, LoadingState, QueryBoundary } from '@/components/States';
import { Text } from '@/components/Text';
import { useToast } from '@/components/Toast';
import { useApp } from '@/data/AppProvider';
import { useAction, useCircle, useInvites, useNow } from '@/data/hooks';
import type { CircleDetail, InviteView, Member } from '@/data/types';
import { formatDateKey, formatRelative, pluralize } from '@/domain/format';
import { dateKeyAt } from '@/domain/time';
import type { CircleRole } from '@/domain/types';
import { space } from '@/theme/tokens';

import { CreateInviteSheet } from './CreateInviteSheet';
import { canManageCircle, RoleBadge, ROLE_LABEL } from './roles';

type Confirm = { kind: 'remove' | 'transfer'; member: Member } | { kind: 'leave' } | { kind: 'revoke'; invite: InviteView } | null;

export function CircleMembersScreen() {
  const params = useLocalSearchParams<{ circleId?: string | string[] }>();
  const circleId = Array.isArray(params.circleId) ? params.circleId[0] : params.circleId;
  const circle = useCircle(circleId);
  return (
    <QueryBoundary
      query={circle}
      loading={
        <Screen header={<NavHeader title="Members" />}>
          <LoadingState variant="list" />
        </Screen>
      }>
      {(data) => <Members detail={data} refreshing={circle.isRefetching} onRefresh={() => void circle.refetch()} />}
    </QueryBoundary>
  );
}

/** What the viewer may do to another member. The server enforces the same rules. */
function allowedActions(viewer: CircleRole, target: Member, isSelf: boolean) {
  if (isSelf || target.deleted) return { changeRole: false, transfer: false, remove: false };
  const owner = viewer === 'owner';
  return {
    changeRole: owner && target.role !== 'owner',
    transfer: owner && target.role !== 'owner',
    remove: target.role !== 'owner' && (owner || (viewer === 'admin' && target.role === 'member')),
  };
}

function Members({ detail, refreshing, onRefresh }: { detail: CircleDetail; refreshing: boolean; onRefresh: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { session } = useApp();
  const role = detail.circle.role;
  const manager = canManageCircle(role);
  const circleId = detail.circle.id;
  const [selected, setSelected] = useState<Member | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [inviting, setInviting] = useState(false);

  const closeAll = () => {
    setConfirm(null);
    setSelected(null);
  };

  const setRole = useAction((repo, input: { userId: string; role: 'admin' | 'member' }) => repo.setMemberRole({ circleId, ...input }), {
    onSuccess: (_result, input) => {
      toast.success(input.role === 'admin' ? 'Made admin' : 'Now a member');
      setSelected(null);
    },
  });
  const transfer = useAction((repo, userId: string) => repo.transferOwnership({ circleId, userId }), {
    onSuccess: () => {
      toast.success('Ownership transferred', 'You’re now an admin of this Circle.');
      closeAll();
    },
  });
  const remove = useAction((repo, input: { userId: string; reason: string }) => repo.removeMember({ circleId, ...input }), {
    onSuccess: () => {
      toast.success('Member removed');
      closeAll();
    },
  });
  const leave = useAction((repo) => repo.leaveCircle(circleId), {
    onSuccess: () => {
      toast.success(`You left ${detail.circle.name}`);
      closeAll();
      router.replace('/circles');
    },
  });
  const revoke = useAction((repo, inviteId: string) => repo.revokeInvite(inviteId), {
    onSuccess: () => {
      toast.success('Invite revoked', 'That code no longer works.');
      setConfirm(null);
    },
  });

  const ordered = [...detail.members].sort((a, b) => {
    const rank = { owner: 0, admin: 1, member: 2 } as const;
    return rank[a.role] - rank[b.role] || a.displayName.localeCompare(b.displayName);
  });
  const actionsFor = selected ? allowedActions(role, selected, selected.userId === session?.userId) : null;

  return (
    <Screen
      header={<NavHeader title={detail.circle.name} />}
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={manager ? <Button label="Invite people" icon={UserPlus} onPress={() => setInviting(true)} testID="members-invite" /> : undefined}
      testID="members-screen">
      <TitleBlock title="Members" subtitle={`${pluralize(detail.members.length, 'person', 'people')} · you’re ${ROLE_LABEL[role].toLowerCase()}`} />

      <Card padding={space.lg} style={{ gap: space.xs }}>
        {ordered.map((member, index) => {
          const isSelf = member.userId === session?.userId;
          const actions = allowedActions(role, member, isSelf);
          const canAct = actions.changeRole || actions.transfer || actions.remove;
          const name = member.deleted ? 'Deleted member' : member.displayName;
          return (
            <View key={member.userId} style={{ gap: space.xs }}>
              {index > 0 ? <Divider /> : null}
              <ListRow
                title={isSelf ? `${name} (you)` : name}
                subtitle={`Joined ${formatDateKey(dateKeyAt(new Date(member.joinedAt), detail.circle.timezone), { weekday: false, year: true })}`}
                leading={<Avatar avatar={member.avatar} ghost={member.deleted} size={44} name="" />}
                trailing={<RoleBadge role={member.role} />}
                onPress={canAct ? () => setSelected(member) : undefined}
                accessibilityLabel={`${name}, ${ROLE_LABEL[member.role]}${canAct ? '. Opens member options' : ''}`}
                testID={`member-row-${member.userId}`}
              />
            </View>
          );
        })}
      </Card>

      {manager ? <InvitesSection circleId={circleId} onRevoke={(invite) => setConfirm({ kind: 'revoke', invite })} /> : null}

      <View style={{ gap: space.sm }}>
        <Button label="Leave Circle" icon={LogOut} variant="danger" size="md" onPress={() => setConfirm({ kind: 'leave' })} testID="members-leave" />
        {role === 'owner' ? (
          <Text variant="caption" color="textSecondary" align="center">
            As the owner, transfer ownership to another member before leaving.
          </Text>
        ) : null}
      </View>

      {/* Member options */}
      <Sheet
        visible={!!selected && !confirm}
        onClose={() => setSelected(null)}
        title={selected ? (selected.deleted ? 'Deleted member' : selected.displayName) : undefined}
        subtitle={selected ? `${ROLE_LABEL[selected.role]} of ${detail.circle.name}` : undefined}
        testID="member-sheet">
        {selected && actionsFor ? (
          <View style={{ gap: space.xs }}>
            {actionsFor.changeRole ? (
              selected.role === 'admin' ? (
                <ListRow
                  title="Make member"
                  subtitle="They can no longer create invites or remove members."
                  icon={Shield}
                  onPress={() => setRole.mutate({ userId: selected.userId, role: 'member' })}
                  disabled={setRole.isPending}
                  disabledNote="Saving…"
                  testID="member-make-member"
                />
              ) : (
                <ListRow
                  title="Make admin"
                  subtitle="Admins can invite people and remove members."
                  icon={ShieldCheck}
                  onPress={() => setRole.mutate({ userId: selected.userId, role: 'admin' })}
                  disabled={setRole.isPending}
                  disabledNote="Saving…"
                  testID="member-make-admin"
                />
              )
            ) : null}
            {actionsFor.transfer ? (
              <ListRow
                title="Transfer ownership"
                subtitle="They become the owner; you stay on as an admin."
                icon={Crown}
                onPress={() => setConfirm({ kind: 'transfer', member: selected })}
                testID="member-transfer"
              />
            ) : null}
            {actionsFor.remove ? (
              <ListRow
                title="Remove from Circle"
                subtitle="They leave every live challenge here. Needs a reason."
                icon={UserMinus}
                tone="danger"
                onPress={() => setConfirm({ kind: 'remove', member: selected })}
                testID="member-remove"
              />
            ) : null}
          </View>
        ) : null}
      </Sheet>

      <ConfirmationSheet
        visible={confirm?.kind === 'remove'}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'remove' ? `Remove ${confirm.member.displayName}?` : 'Remove member?'}
        message="They lose access to the Circle, its chat and its challenges, and leave any live challenge. The removal and your reason are recorded in the Circle history."
        confirmLabel="Remove member"
        confirmVariant="danger"
        reason={{ label: 'Reason', placeholder: 'e.g. Left the family group chat', required: true }}
        loading={remove.isPending}
        onConfirm={(reason) => {
          if (confirm?.kind === 'remove') remove.mutate({ userId: confirm.member.userId, reason });
        }}
        testID="confirm-remove"
      />
      <ConfirmationSheet
        visible={confirm?.kind === 'transfer'}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'transfer' ? `Make ${confirm.member.displayName} the owner?` : 'Transfer ownership?'}
        message="There is one owner per Circle. You’ll become an admin and can’t undo this yourself — only the new owner can hand it back."
        confirmLabel="Transfer ownership"
        loading={transfer.isPending}
        onConfirm={() => {
          if (confirm?.kind === 'transfer') transfer.mutate(confirm.member.userId);
        }}
        testID="confirm-transfer"
      />
      <ConfirmationSheet
        visible={confirm?.kind === 'leave'}
        onClose={() => setConfirm(null)}
        title={`Leave ${detail.circle.name}?`}
        message="You’ll leave its live challenges and lose access to its chat. Someone will need to invite you to come back."
        confirmLabel="Leave Circle"
        confirmVariant="danger"
        loading={leave.isPending}
        onConfirm={() => leave.mutate(undefined)}
        testID="confirm-leave"
      />
      <ConfirmationSheet
        visible={confirm?.kind === 'revoke'}
        onClose={() => setConfirm(null)}
        title="Revoke this invite?"
        message="The code stops working right away. People who already joined stay in the Circle."
        confirmLabel="Revoke invite"
        confirmVariant="danger"
        loading={revoke.isPending}
        onConfirm={() => {
          if (confirm?.kind === 'revoke') revoke.mutate(confirm.invite.id);
        }}
        testID="confirm-revoke"
      />

      {manager ? <CreateInviteSheet visible={inviting} onClose={() => setInviting(false)} circleId={circleId} circleName={detail.circle.name} /> : null}
    </Screen>
  );
}

function inviteState(invite: InviteView, now: Date): { label: string; tone: 'positive' | 'neutral' | 'warning'; active: boolean } {
  if (invite.revokedAt) return { label: 'Revoked', tone: 'neutral', active: false };
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return { label: 'Expired', tone: 'neutral', active: false };
  if (invite.useCount >= invite.maxUses) return { label: 'Used up', tone: 'warning', active: false };
  return { label: 'Active', tone: 'positive', active: true };
}

function InvitesSection({ circleId, onRevoke }: { circleId: string; onRevoke: (invite: InviteView) => void }) {
  const invites = useInvites(circleId);
  const now = useNow();
  return (
    <View style={{ gap: space.md }}>
      <SectionHeading title="Invites" />
      {invites.data === undefined ? (
        invites.isPending ? (
          <LoadingState variant="list" />
        ) : (
          <ErrorState error={invites.error} onRetry={() => void invites.refetch()} compact />
        )
      ) : invites.data.length === 0 ? (
        <EmptyState compact emoji="✉️" title="No invites yet" message="Create one to share a code. Each code is shown only once." />
      ) : (
        <Card padding={space.lg} style={{ gap: space.xs }}>
          {invites.data.map((invite, index) => {
            const state = inviteState(invite, now);
            const expiry = state.active ? `expires ${formatRelative(invite.expiresAt, now)}` : `created by ${invite.createdBy.displayName}`;
            return (
              <View key={invite.id} style={{ gap: space.xs }}>
                {index > 0 ? <Divider /> : null}
                <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <StatusBadge label={state.label} tone={state.tone} />
                    <Text variant="bodyStrong">
                      {invite.useCount} of {pluralize(invite.maxUses, 'use')}
                    </Text>
                    <Text variant="caption" color="textSecondary">
                      {state.active ? `By ${invite.createdBy.displayName} · ${expiry}` : expiry}
                    </Text>
                  </View>
                  {state.active ? (
                    <Button label="Revoke" variant="secondary" size="sm" fullWidth={false} onPress={() => onRevoke(invite)} testID={`invite-revoke-${invite.id}`} />
                  ) : null}
                </View>
              </View>
            );
          })}
        </Card>
      )}
    </View>
  );
}
