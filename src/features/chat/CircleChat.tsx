import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { ChallengeStatusBadge, HabitBadge } from '@/components/Badges';
import { Button, IconButton } from '@/components/Button';
import { ChevronRight, CircleAlert, Pin, Send, SmilePlus } from '@/components/icons';
import { Sheet } from '@/components/Sheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { Text } from '@/components/Text';
import { useApp } from '@/data/AppProvider';
import { useAction, useMessages, useNow } from '@/data/hooks';
import type { ChallengeCard, MessageView } from '@/data/types';
import { daysLeftLabel, formatDateTime, formatTime, startsInLabel } from '@/domain/format';
import { dateKeyAt, todayKey } from '@/domain/time';
import { LIMITS, REACTION_EMOJI } from '@/domain/types';
import { colors, radius, space } from '@/theme/tokens';
import { fonts } from '@/theme/typography';

import { describeEvent } from './describeEvent';

/** A message this device is sending. Reconciled with server rows by clientId. */
interface Outgoing {
  clientId: string;
  text: string;
  createdAt: string;
  state: 'pending' | 'sent' | 'failed';
  message?: MessageView;
}

type Row = { key: string; kind: 'server'; message: MessageView } | { key: string; kind: 'outgoing'; item: Outgoing };

const COUNTER_FROM = LIMITS.maxMessageLength - 200;

export interface CircleChatProps {
  circleId: string;
  pinned?: ChallengeCard | null;
}

/**
 * Circle chat: plain text and a small reaction set. Durable rows are the
 * source of truth; realtime only triggers a re-read (see useMessages). It
 * fills a flex:1 container and manages its own list and composer.
 */
export function CircleChat({ circleId, pinned }: CircleChatProps) {
  const { session, deviceTimeZone } = useApp();
  const me = session?.userId ?? null;
  const now = useNow();
  const messages = useMessages(circleId);
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [draft, setDraft] = useState('');
  const [reactingTo, setReactingTo] = useState<MessageView | null>(null);

  const send = useAction((repo, input: { clientId: string; text: string }) => repo.sendMessage({ circleId, ...input }), { silent: true });
  const react = useAction((repo, input: { messageId: string; emoji: string }) => repo.toggleReaction(input));

  const serverItems = useMemo(() => messages.data?.pages.flatMap((page) => page.items) ?? [], [messages.data]);
  const serverClientIds = useMemo(() => new Set(serverItems.map((m) => m.clientId).filter((id): id is string => !!id)), [serverItems]);

  // Once the server rows include a sent message, the local copy is no longer needed.
  useEffect(() => {
    setOutbox((current) => {
      const next = current.filter((item) => !(item.state === 'sent' && serverClientIds.has(item.clientId)));
      return next.length === current.length ? current : next;
    });
  }, [serverClientIds]);

  const rows = useMemo<Row[]>(() => {
    const local = outbox
      .filter((item) => !serverClientIds.has(item.clientId))
      .slice()
      .reverse()
      .map<Row>((item) => ({ key: `local-${item.clientId}`, kind: 'outgoing', item }));
    // Newest first: the inverted list shows index 0 at the bottom.
    return [...local, ...serverItems.map<Row>((message) => ({ key: message.id, kind: 'server', message }))];
  }, [outbox, serverItems, serverClientIds]);

  const deliver = (clientId: string, text: string) => {
    setOutbox((current) => current.map((item) => (item.clientId === clientId ? { ...item, state: 'pending' } : item)));
    send
      .mutateAsync({ clientId, text })
      .then((message) => setOutbox((current) => current.map((item) => (item.clientId === clientId ? { ...item, state: 'sent', message } : item))))
      .catch(() => setOutbox((current) => current.map((item) => (item.clientId === clientId ? { ...item, state: 'failed' } : item))));
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || text.length > LIMITS.maxMessageLength) return;
    // The same clientId is reused for every retry, so the server deduplicates.
    const clientId = Crypto.randomUUID();
    setOutbox((current) => [...current, { clientId, text, createdAt: new Date().toISOString(), state: 'pending' }]);
    setDraft('');
    deliver(clientId, text);
  };

  const timeLabel = (iso: string) =>
    dateKeyAt(new Date(iso), deviceTimeZone) === dateKeyAt(now, deviceTimeZone) ? formatTime(iso, deviceTimeZone) : formatDateTime(iso, deviceTimeZone);

  let body: React.ReactNode;
  if (messages.data === undefined && messages.isPending) {
    body = (
      <View style={{ flex: 1, paddingTop: space.lg }}>
        <LoadingState variant="list" />
      </View>
    );
  } else if (messages.data === undefined) {
    body = (
      <View style={{ flex: 1 }}>
        <ErrorState error={messages.error} onRetry={() => void messages.refetch()} compact />
      </View>
    );
  } else if (rows.length === 0) {
    body = (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState emoji="💬" title="No messages yet" message="Say hi. Everyone in this Circle can read what you write here." compact />
      </View>
    );
  } else {
    body = (
      <FlatList
        testID="chat-list"
        inverted
        data={rows}
        keyExtractor={(row) => row.key}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingVertical: space.md, gap: space.md }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.3}
        onEndReached={() => {
          if (messages.hasNextPage && !messages.isFetchingNextPage) void messages.fetchNextPage();
        }}
        ListFooterComponent={
          // Rendered at the top of an inverted list.
          <View style={{ alignItems: 'center', paddingVertical: space.md }}>
            {messages.isFetchingNextPage ? (
              <ActivityIndicator color={colors.ink} accessibilityLabel="Loading earlier messages" />
            ) : messages.hasNextPage ? (
              <Button label="Load earlier messages" variant="ghost" size="sm" fullWidth={false} onPress={() => void messages.fetchNextPage()} testID="chat-load-earlier" />
            ) : (
              <Text variant="caption" color="textSecondary">
                Start of the conversation
              </Text>
            )}
          </View>
        }
        renderItem={({ item: row }) => {
          if (row.kind === 'outgoing') {
            const { item } = row;
            return (
              <OwnBubble
                text={item.message?.text ?? item.text}
                time={timeLabel(item.message?.createdAt ?? item.createdAt)}
                state={item.state}
                onRetry={item.state === 'failed' ? () => deliver(item.clientId, item.text) : undefined}
              />
            );
          }
          const message = row.message;
          if (message.kind === 'system') {
            const copy = describeEvent(message.event, message.text);
            const Icon = copy.icon;
            return (
              <View style={{ alignItems: 'center', paddingHorizontal: space.lg }}>
                <View
                  accessible
                  accessibilityLabel={`${copy.text} ${timeLabel(message.createdAt)}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, maxWidth: 420, paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface }}>
                  <Icon size={15} color={colors.textSecondary} strokeWidth={2.4} />
                  <Text variant="caption" color="textSecondary" style={{ flexShrink: 1 }}>
                    {copy.text}
                  </Text>
                </View>
              </View>
            );
          }
          const own = !!me && message.author?.userId === me;
          return own ? (
            <OwnBubble
              text={message.text}
              time={timeLabel(message.createdAt)}
              state="sent"
              reactions={message.reactions}
              onReact={() => setReactingTo(message)}
              onToggle={(emoji) => react.mutate({ messageId: message.id, emoji })}
            />
          ) : (
            <OtherBubble
              message={message}
              time={timeLabel(message.createdAt)}
              onReact={() => setReactingTo(message)}
              onToggle={(emoji) => react.mutate({ messageId: message.id, emoji })}
            />
          );
        }}
      />
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      {pinned ? <PinnedChallenge challenge={pinned} now={now} /> : null}
      {body}
      <Composer value={draft} onChange={setDraft} onSend={submit} />
      <Sheet visible={!!reactingTo} onClose={() => setReactingTo(null)} title="React" testID="chat-reactions">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center' }}>
          {REACTION_EMOJI.map((emoji) => {
            const mine = reactingTo?.reactions.some((r) => r.emoji === emoji && r.mine) ?? false;
            return (
              <Pressable
                key={emoji}
                onPress={() => {
                  if (reactingTo) react.mutate({ messageId: reactingTo.id, emoji });
                  setReactingTo(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={mine ? `Remove ${emoji} reaction` : `React with ${emoji}`}
                accessibilityState={{ selected: mine }}
                testID={`chat-react-${REACTION_EMOJI.indexOf(emoji)}`}
                style={({ pressed }) => ({
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: mine ? colors.ink : pressed ? colors.surfaceStrong : colors.surface,
                })}>
                <Text style={{ fontSize: 26, lineHeight: 32 }} maxFontSizeMultiplier={1}>
                  {emoji}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

function PinnedChallenge({ challenge, now }: { challenge: ChallengeCard; now: Date }) {
  const router = useRouter();
  const today = todayKey(now, challenge.timezone);
  const label =
    challenge.status === 'active'
      ? daysLeftLabel(today, challenge.endDate)
      : challenge.status === 'scheduled'
        ? startsInLabel(today, challenge.startDate)
        : null;
  return (
    <Pressable
      onPress={() => router.push(`/challenge/${challenge.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Pinned challenge: ${challenge.name}${label ? `, ${label}` : ''}`}
      testID="chat-pinned"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.md,
        marginTop: space.sm,
        borderRadius: radius.lg,
        backgroundColor: pressed ? colors.surfaceStrong : colors.surface,
      })}>
      <HabitBadge habitType={challenge.habitType} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Pin size={12} color={colors.textSecondary} strokeWidth={2.4} />
          <Text variant="micro" color="textSecondary">
            Pinned
          </Text>
        </View>
        <Text variant="bodyStrong" numberOfLines={1}>
          {challenge.name}
        </Text>
      </View>
      {label ? (
        <Text variant="captionStrong" color="textSecondary">
          {label}
        </Text>
      ) : (
        <ChallengeStatusBadge status={challenge.status} />
      )}
      <ChevronRight size={18} color={colors.textTertiary} strokeWidth={2.4} />
    </Pressable>
  );
}

function Reactions({ reactions, align, onToggle, onReact }: { reactions: MessageView['reactions']; align: 'flex-start' | 'flex-end'; onToggle: (emoji: string) => void; onReact: () => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: align, alignItems: 'center' }}>
      {reactions
        .filter((r) => r.count > 0)
        .map((r) => (
          <Pressable
            key={r.emoji}
            onPress={() => onToggle(r.emoji)}
            accessibilityRole="button"
            accessibilityLabel={`${r.emoji} ${r.count}${r.mine ? ', including you. Double tap to remove yours' : '. Double tap to add yours'}`}
            hitSlop={6}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              minHeight: 30,
              paddingHorizontal: 10,
              borderRadius: radius.pill,
              backgroundColor: r.mine ? colors.ink : pressed ? colors.surfaceStrong : colors.surface,
            })}>
            <Text style={{ fontSize: 14, lineHeight: 18 }} maxFontSizeMultiplier={1.2}>
              {r.emoji}
            </Text>
            <Text variant="micro" color={r.mine ? 'onInk' : 'textSecondary'}>
              {r.count}
            </Text>
          </Pressable>
        ))}
      <IconButton icon={SmilePlus} label="Add a reaction" variant="plain" size={30} onPress={onReact} />
    </View>
  );
}

function OwnBubble({
  text,
  time,
  state,
  reactions = [],
  onRetry,
  onReact,
  onToggle,
}: {
  text: string;
  time: string;
  state: Outgoing['state'];
  reactions?: MessageView['reactions'];
  onRetry?: () => void;
  onReact?: () => void;
  onToggle?: (emoji: string) => void;
}) {
  const failed = state === 'failed';
  return (
    <View style={{ alignItems: 'flex-end', gap: 4, paddingLeft: space.huge }}>
      <Pressable
        onPress={onRetry}
        onLongPress={onReact}
        disabled={!onRetry && !onReact}
        accessibilityRole={onRetry ? 'button' : undefined}
        accessibilityLabel={`You: ${text}. ${failed ? 'Not sent. Double tap to retry.' : state === 'pending' ? 'Sending.' : `Sent ${time}.`}`}
        accessibilityHint={onReact ? 'Long press to react' : undefined}
        testID={failed ? 'chat-retry' : undefined}
        style={{
          maxWidth: '100%',
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderRadius: radius.lg,
          borderBottomRightRadius: 6,
          backgroundColor: colors.ink,
          opacity: state === 'pending' ? 0.7 : 1,
        }}>
        <Text variant="body" color="onInk" selectable>
          {text}
        </Text>
      </Pressable>
      {failed ? (
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Not sent. Tap to retry" hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <CircleAlert size={13} color={colors.danger} strokeWidth={2.6} />
          <Text variant="captionStrong" color="danger">
            Not sent · Tap to retry
          </Text>
        </Pressable>
      ) : (
        <Text variant="caption" color="textSecondary">
          {state === 'pending' ? 'Sending…' : `${time} · Sent`}
        </Text>
      )}
      {onReact && onToggle && (reactions.length > 0 || state === 'sent') ? <Reactions reactions={reactions} align="flex-end" onToggle={onToggle} onReact={onReact} /> : null}
    </View>
  );
}

function OtherBubble({ message, time, onReact, onToggle }: { message: MessageView; time: string; onReact: () => void; onToggle: (emoji: string) => void }) {
  const author = message.author;
  const name = !author ? 'Unknown' : author.deleted ? 'Deleted member' : author.displayName;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingRight: space.huge }}>
      <Avatar avatar={author?.avatar ?? { color: 'sand', face: 0 }} ghost={!author || author.deleted} size={32} name="" />
      <View style={{ flex: 1, gap: 4, alignItems: 'flex-start' }}>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'baseline' }}>
          <Text variant="captionStrong">{name}</Text>
          <Text variant="caption" color="textSecondary">
            {time}
          </Text>
        </View>
        <Pressable
          onLongPress={onReact}
          accessibilityLabel={`${name}: ${message.text}. ${time}`}
          accessibilityHint="Long press to react"
          style={{ maxWidth: '100%', paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.lg, borderTopLeftRadius: 6, backgroundColor: colors.surface }}>
          <Text variant="body" selectable>
            {message.text}
          </Text>
        </Pressable>
        <Reactions reactions={message.reactions} align="flex-start" onToggle={onToggle} onReact={onReact} />
      </View>
    </View>
  );
}

function Composer({ value, onChange, onSend }: { value: string; onChange: (text: string) => void; onSend: () => void }) {
  const [focused, setFocused] = useState(false);
  const length = value.length;
  const empty = value.trim().length === 0;
  return (
    <View style={{ paddingTop: space.sm, paddingBottom: space.sm, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <View
          style={{
            flex: 1,
            minHeight: 44,
            borderRadius: 22,
            backgroundColor: colors.surface,
            borderWidth: focused ? 2 : 1,
            borderColor: focused ? colors.ink : colors.borderStrong,
            paddingHorizontal: focused ? space.lg - 1 : space.lg,
            justifyContent: 'center',
          }}>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder="Message the Circle"
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={LIMITS.maxMessageLength}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            accessibilityLabel="Message"
            accessibilityHint="Plain text. Type @ and a name to mention someone."
            testID="chat-input"
            style={{
              fontFamily: fonts.body,
              fontSize: 16,
              lineHeight: 22,
              color: colors.ink,
              maxHeight: 120,
              paddingVertical: 10,
              ...({ outlineStyle: 'none' } as object),
            }}
          />
        </View>
        <IconButton icon={Send} label="Send message" variant="ink" onPress={onSend} disabled={empty} testID="chat-send" style={empty ? { opacity: 0.4 } : undefined} />
      </View>
      {value.includes('@') || length >= COUNTER_FROM ? (
        <View style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.sm }}>
          <Text variant="caption" color="textSecondary" style={{ flex: 1 }}>
            {value.includes('@') ? 'Write @Name exactly as it appears to notify that person.' : ''}
          </Text>
          {length >= COUNTER_FROM ? (
            <Text variant="caption" color={length >= LIMITS.maxMessageLength ? 'danger' : 'textSecondary'} accessibilityLiveRegion="polite">
              {length.toLocaleString('en-US')}/{LIMITS.maxMessageLength.toLocaleString('en-US')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
