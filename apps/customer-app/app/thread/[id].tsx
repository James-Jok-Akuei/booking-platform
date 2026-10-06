import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pickImage } from '../../src/pickImage';
import {
  getThread,
  listMessages,
  markThreadRead,
  sendMessage,
  type Message,
} from '../../src/api/chat';
import { ApiError } from '../../src/api/client';
import { useThreadSocket } from '../../src/useThreadSocket';
import { font, radius, shadow, theme, type } from '../../src/theme';
import { Avatar } from '../../src/ui/Avatar';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { Icon } from '../../src/ui/Icon';
import { IconButton } from '../../src/ui/IconButton';
import { useLayout } from '../../src/ui/layout';
import { PhotoViewer } from '../../src/ui/PhotoViewer';
import { PressableScale } from '../../src/ui/PressableScale';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** "Today", "Yesterday", "Monday", "6 October" — the pill between days. */
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
};
const dayKey = (iso: string) => new Date(iso).toDateString();

/**
 * Messages as they are drawn (§164): grouped, the way every chat app groups
 * them. A run of messages from one side within five minutes is one group —
 * the tail and the time sit on the last bubble, the others are plain, and
 * the gap inside a group is smaller than the gap between groups. A new day
 * puts a pill between them.
 */
type Drawn = {
  message: Message;
  mine: boolean;
  first: boolean;
  last: boolean;
  day: string | null;
};
const GROUP_MS = 5 * 60 * 1000;

type Picked = { uri: string; name: string; type: string };

/**
 * One conversation.
 *
 * Live over the socket (§22) and polled underneath it. The poll is not
 * redundant: a phone sleeps, changes network and loses signal, and a socket
 * that quietly died would otherwise leave the screen looking like nobody had
 * replied. The socket makes it instant; the poll makes it correct.
 */
export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const [draft, setDraft] = useState('');
  const [photo, setPhoto] = useState<Picked | null>(null);
  const listRef = useRef<FlatList<Drawn>>(null);

  const thread = useQuery({ queryKey: ['thread', id], queryFn: () => getThread(id) });

  const messages = useQuery({
    queryKey: ['messages', id],
    queryFn: () => listMessages(id, { limit: 100 }),
    refetchInterval: 6000,
  });

  useThreadSocket(id);

  const count = messages.data?.messages.length ?? 0;

  /**
   * Marking read is tied to the messages ARRIVING, not to the screen opening:
   * opening an empty thread and marking it read would clear a badge for
   * messages that had not loaded yet.
   *
   * Only the reader's own state moves — read state is per person, not per
   * thread (§21.3) — so this cannot clear a colleague's badge on the other side.
   */
  useEffect(() => {
    if (count === 0) return;
    markThreadRead(id)
      .then(() => queryClient.invalidateQueries({ queryKey: ['threads'] }))
      .catch(() => undefined);
  }, [id, count, queryClient]);

  const send = useMutation({
    mutationFn: () =>
      sendMessage(id, {
        body: draft.trim() || undefined,
        ...(photo ? { photo } : {}),
      }),
    onSuccess: (message) => {
      setDraft('');
      setPhoto(null);
      // Appended rather than refetched, so the message a person just sent does
      // not wait for the next poll to appear.
      queryClient.setQueryData(['messages', id], (page: typeof messages.data) =>
        page && !page.messages.some((m) => m.id === message.id)
          ? { ...page, total: page.total + 1, messages: [...page.messages, message] }
          : page,
      );
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },
    onError: (error) =>
      Alert.alert(
        'Not sent',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  /**
   * The same shared picker the profile picture uses (§125).
   *
   * This had the identical bug and nobody had hit it yet: an iPhone's library
   * returns HEIC, the endpoint allows jpg/png/webp only, and every photo a
   * customer tried to send would have been refused. Passing `asset.mimeType`
   * straight through looked careful and was exactly the problem.
   */
  const attach = async () => {
    try {
      const picked = await pickImage();
      if (picked) setPhoto(picked);
    } catch (error) {
      Alert.alert('Photos are not allowed', (error as Error).message);
    }
  };

  const rows = messages.data?.messages ?? [];
  const drawn = useMemo<Drawn[]>(
    () =>
      rows.map((message, i) => {
        const mine = message.sender.role === 'CUSTOMER';
        const prev = rows[i - 1];
        const next = rows[i + 1];
        const joins = (other: Message | undefined) =>
          other !== undefined &&
          (other.sender.role === 'CUSTOMER') === mine &&
          Math.abs(new Date(other.createdAt).getTime() - new Date(message.createdAt).getTime()) < GROUP_MS &&
          dayKey(other.createdAt) === dayKey(message.createdAt);
        return {
          message,
          mine,
          first: !joins(prev),
          last: !joins(next),
          day: !prev || dayKey(prev.createdAt) !== dayKey(message.createdAt) ? dayLabel(message.createdAt) : null,
        };
      }),
    [rows],
  );
  const photos = useMemo(
    () => rows.filter((m) => m.photoUrl).map((m) => ({ id: m.id, url: m.photoUrl! })),
    [rows],
  );
  const [openPhoto, setOpenPhoto] = useState<number | null>(null);
  const canSend = (draft.trim().length > 0 || photo !== null) && !send.isPending;
  const businessName = thread.data?.business.name ?? 'Messages';

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Who you are talking to, and — for a booking's thread — what about.
          The header is the app's own (§133), so the name sits beside a face
          rather than alone in a system bar. */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <IconButton
          icon="chevron-back"
          label="Go back"
          flat
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/messages'))}
        />
        <PressableScale
          onPress={() => thread.data && router.push(`/shop/${thread.data.business.id}`)}
          scaleTo={0.95}
          accessibilityRole="button"
          accessibilityLabel={`Open ${businessName}`}
        >
          <Avatar uri={thread.data?.business.logoUrl} name={businessName} size={42} />
        </PressableScale>
        <View style={styles.flex}>
          <Text style={styles.headerName} numberOfLines={1}>
            {businessName}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {thread.data?.appointment ? 'About a booking' : 'Question'}
          </Text>
        </View>
      </View>

      {/* The booking this is about, as a chip under the header — one tap to
          the reservation, which is nearly always what "wait, when was it?"
          wants (§164). */}
      {thread.data?.appointment && (
        <PressableScale
          onPress={() => router.push(`/booking/${thread.data!.appointment!.id}`)}
          haptic
          scaleTo={0.97}
          accessibilityRole="button"
          style={[styles.about, { width: Math.min(layout.contentWidth - 32, 520) }]}
        >
          <View style={styles.aboutIcon}>
            <Icon name="calendar" size={15} color={theme.accent} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.aboutName} numberOfLines={1}>
              {thread.data.appointment.serviceName}
            </Text>
            <Text style={type.tiny} numberOfLines={1}>
              {new Date(thread.data.appointment.startTime).toLocaleString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
          <Text style={styles.aboutGo}>View</Text>
          <Icon name="chevron-forward" size={14} color={theme.accent} />
        </PressableScale>
      )}

      {messages.isLoading && <ActivityIndicator style={styles.spinner} color={theme.accent} />}

      <FlatList
        ref={listRef}
        data={drawn}
        keyExtractor={(item) => item.message.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.list, { width: layout.contentWidth }]}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          messages.isLoading ? null : (
            <EmptyState
              icon="chatbubble-ellipses-outline"
              title="Nothing here yet."
              text="Ask them anything — prices, parking, what to bring."
            />
          )
        }
        renderItem={({ item: { message: item, mine, first, last, day } }) => (
          <View style={[styles.bubbleRow, mine && styles.bubbleRowMine, !first && styles.bubbleRowJoined]}>
            {day && (
              <View style={styles.dayPill}>
                <Text style={styles.dayText}>{day}</Text>
              </View>
            )}
            <FadeIn distance={8} style={[styles.bubbleLine, mine && styles.bubbleLineMine]}>
              <View
                style={[
                  styles.bubble,
                  mine ? styles.mine : styles.theirs,
                  // Corners: square towards the neighbour in a group, round
                  // elsewhere — the shape that says "these go together".
                  mine
                    ? { borderTopRightRadius: first ? 20 : 6, borderBottomRightRadius: last ? 6 : 6 }
                    : { borderTopLeftRadius: first ? 20 : 6, borderBottomLeftRadius: last ? 6 : 6 },
                  item.photoUrl && !item.body && styles.bubblePhotoOnly,
                ]}
              >
                {item.photoUrl && (
                  <PressableScale
                    scaleTo={0.97}
                    accessibilityRole="imagebutton"
                    accessibilityLabel="Photo, tap to open"
                    onPress={() => setOpenPhoto(photos.findIndex((p) => p.id === item.id))}
                  >
                    <Image source={{ uri: item.photoUrl }} style={styles.photo} />
                  </PressableScale>
                )}
                {item.body && <Text style={[styles.body, mine && styles.bodyMine]}>{item.body}</Text>}
                {last && (
                  <View style={styles.timeRow}>
                    <Text style={[styles.time, mine && styles.timeMine]}>{clock(item.createdAt)}</Text>
                    {mine && <Icon name="checkmark-done" size={13} color="rgba(255,255,255,0.78)" />}
                  </View>
                )}
              </View>
            </FadeIn>
          </View>
        )}
      />

      <PhotoViewer photos={photos} openAt={openPhoto} onClose={() => setOpenPhoto(null)} />

      {photo && (
        <View style={styles.attached}>
          <Image source={{ uri: photo.uri }} style={styles.thumb} />
          <Text style={[type.small, styles.flex]} numberOfLines={1}>
            {photo.name}
          </Text>
          <PressableScale onPress={() => setPhoto(null)} hitSlop={10}>
            <Text style={styles.remove}>Remove</Text>
          </PressableScale>
        </View>
      )}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <IconButton icon="image-outline" label="Attach a photo" onPress={attach} flat size={46} />
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Write a message"
          placeholderTextColor={theme.muted}
          multiline
          maxLength={2000}
        />
        <PressableScale
          haptic
          scaleTo={0.9}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send"
          onPress={() => send.mutate()}
          style={[styles.send, !canSend && styles.sendOff]}
        >
          {send.isPending ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Icon name="arrow-up" size={21} color={canSend ? '#FFFFFF' : theme.muted} />
          )}
        </PressableScale>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  spinner: { marginTop: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: theme.panel,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    ...shadow.card,
  },
  headerName: { fontFamily: font.bold, fontSize: 16.5, color: theme.ink },
  headerSub: { fontFamily: font.semibold, fontSize: 12.5, color: theme.accent, marginTop: 1 },
  about: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'center',
    marginTop: 10,
    backgroundColor: theme.panel,
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingHorizontal: 12,
    ...shadow.card,
  },
  aboutIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aboutName: { fontFamily: font.bold, fontSize: 13.5, color: theme.ink },
  aboutGo: { fontFamily: font.bold, fontSize: 12.5, color: theme.accent },
  list: { paddingHorizontal: 16, paddingVertical: 16, gap: 10, alignSelf: 'center' },
  bubbleRow: { gap: 10 },
  bubbleRowMine: {},
  // Inside a group the bubbles sit close; between groups the list's gap applies.
  bubbleRowJoined: { marginTop: -7 },
  bubbleLine: { flexDirection: 'row' },
  bubbleLineMine: { justifyContent: 'flex-end' },
  dayPill: {
    alignSelf: 'center',
    backgroundColor: theme.sunken,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginVertical: 6,
  },
  dayText: { fontFamily: font.bold, fontSize: 11.5, color: theme.muted },
  bubble: { maxWidth: '82%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  bubblePhotoOnly: { padding: 4 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-end' },
  mine: { backgroundColor: theme.accent, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: theme.panel, borderBottomLeftRadius: 6, ...shadow.card },
  body: { fontFamily: font.medium, color: theme.ink, fontSize: 15, lineHeight: 21 },
  bodyMine: { color: '#FFFFFF' },
  time: { fontFamily: font.medium, color: theme.muted, fontSize: 11, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(255,255,255,0.78)' },
  photo: { width: 220, height: 166, borderRadius: 14, backgroundColor: theme.line },
  attached: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 6,
    padding: 8,
    paddingRight: 14,
    backgroundColor: theme.panel,
    borderRadius: radius.md,
    ...shadow.card,
  },
  thumb: { width: 40, height: 40, borderRadius: 9, backgroundColor: theme.line },
  remove: { fontFamily: font.bold, color: theme.danger, fontSize: 13 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: theme.panel,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    ...shadow.float,
  },
  input: {
    flex: 1,
    fontFamily: font.medium,
    backgroundColor: theme.sunken,
    borderRadius: 23,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 46,
    maxHeight: 120,
    fontSize: 15,
    color: theme.ink,
  },
  send: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { backgroundColor: theme.sunken },
});
