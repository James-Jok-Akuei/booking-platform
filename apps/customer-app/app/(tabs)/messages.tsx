import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listThreads, type Thread } from '../../src/api/chat';
import { tokens, useSignedIn } from '../../src/api/client';
import { font, radius, shadow, TAB_BAR_CLEARANCE, theme, type } from '../../src/theme';
import { Avatar } from '../../src/ui/Avatar';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { Icon } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { PressableScale } from '../../src/ui/PressableScale';
import { Segmented } from '../../src/ui/Segmented';
import { RowSkeleton } from '../../src/ui/Skeleton';

type Filter = 'all' | 'unread';

/** "now", "12 min", "3 h", "Yesterday", "Mon", "6 Oct" — the way a chat list says it. */
const when = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const minutes = Math.round((now.getTime() - d.getTime()) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min`;
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/**
 * What a thread is about, in one line. An appointment thread already has a
 * subject — the booking it was created with (§21.1) — and saying so is what
 * stops a list of eight threads with the same shop being eight identical rows.
 */
const subject = (thread: Thread) =>
  thread.appointment
    ? `${thread.appointment.serviceName} · ${new Date(thread.appointment.startTime).toLocaleDateString(
        undefined,
        { day: 'numeric', month: 'short' },
      )}`
    : 'Question';

/**
 * Every conversation this customer has, newest activity first (§164).
 *
 * Laid out the way every messaging app has taught: a face, a bold name, the
 * last line, the time on the right, and a count for what is unread. The last
 * line says WHO said it — "You: thank you!" — because a list where every
 * preview reads the same way makes you open threads to find out who is
 * waiting on whom. A search narrows by shop, service or words said; a filter
 * shows only what is unread.
 */
export default function Messages() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const signedIn = useSignedIn();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const threads = useQuery({
    queryKey: ['threads'],
    queryFn: () => listThreads({ limit: 50 }),
    enabled: signedIn,
    // The list is not held open the way a thread is, so it is refreshed on
    // arrival and by pulling rather than polled.
    staleTime: 0,
  });

  // Threads that have never been used are noise: an appointment thread is made
  // with every booking (§21.1), so a customer with ten bookings and no messages
  // would open this screen onto ten empty conversations.
  const all = useMemo(
    () => (threads.data?.threads ?? []).filter((t) => t.lastMessage !== null || t.kind === 'INQUIRY'),
    [threads.data],
  );
  const unreadTotal = all.reduce((sum, t) => sum + t.unreadCount, 0);
  const needle = query.trim().toLowerCase();
  const rows = all.filter(
    (t) =>
      (filter === 'all' || t.unreadCount > 0) &&
      (needle === '' ||
        (t.business.name ?? '').toLowerCase().includes(needle) ||
        subject(t).toLowerCase().includes(needle) ||
        (t.lastMessage?.preview ?? '').toLowerCase().includes(needle)),
  );
  const me = tokens.user?.id;

  if (!signedIn) {
    return (
      <View style={styles.screen}>
        <View style={[styles.head, { paddingTop: insets.top + 14 }]}>
          <Text style={type.display}>Messages</Text>
        </View>
        <EmptyState
          icon="chatbubble-ellipses-outline"
          title="Sign in to see your messages"
          text="Conversations are kept with your account, so they follow you to any phone."
          action="Sign in"
          onAction={() => router.push('/sign-in?next=/messages')}
        />
      </View>
    );
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={type.display}>Messages</Text>
          <Text style={type.small}>
            {unreadTotal > 0
              ? `${unreadTotal} unread in ${all.filter((t) => t.unreadCount > 0).length} ${
                  all.filter((t) => t.unreadCount > 0).length === 1 ? 'conversation' : 'conversations'
                }`
              : all.length > 0
                ? 'All caught up'
                : ' '}
          </Text>
        </View>
        {unreadTotal > 0 && (
          <View style={styles.badgeBig}>
            <Text style={styles.badgeBigText}>{unreadTotal}</Text>
          </View>
        )}
      </View>

      <View style={styles.search}>
        <Icon name="search" size={18} color={theme.muted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search a shop or a message"
          placeholderTextColor={theme.muted}
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <PressableScale onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear the search" style={styles.clear}>
            <Icon name="close" size={13} color={theme.ink2} />
          </PressableScale>
        )}
      </View>

      {all.length > 0 && (
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: unreadTotal > 0 ? `Unread · ${unreadTotal}` : 'Unread' },
          ]}
        />
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[
          styles.list,
          {
            paddingTop: insets.top + 14,
            paddingBottom: TAB_BAR_CLEARANCE + insets.bottom,
            width: layout.contentWidth,
            paddingHorizontal: layout.gutter,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={threads.isRefetching}
            onRefresh={threads.refetch}
            tintColor={theme.accent}
            colors={[theme.accent]}
            progressViewOffset={insets.top}
          />
        }
        ListHeaderComponent={header}
        ListEmptyComponent={
          threads.isLoading ? (
            <View style={styles.skeletons}>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </View>
          ) : needle !== '' ? (
            <EmptyState icon="search" title="Nothing matches that." text="Try a shop's name, or a word from the message." />
          ) : filter === 'unread' ? (
            <EmptyState icon="checkmark-done-circle-outline" title="Nothing unread" text="You have read everything. Switch to All to see it again." />
          ) : (
            <EmptyState
              icon="chatbubble-ellipses-outline"
              title="No messages yet"
              text="Open a place and tap Message the shop to ask something before you book."
              action="Find a place"
              onAction={() => router.push('/')}
            />
          )
        }
        renderItem={({ item, index }) => {
          const unread = item.unreadCount > 0;
          const last = item.lastMessage;
          const mineLast = last?.senderId === me;
          const preview = last
            ? `${mineLast ? 'You: ' : ''}${last.preview || (last.hasPhoto ? 'Photo' : 'Message')}`
            : 'No messages yet';
          const name = item.business.name ?? 'A business';
          return (
            <FadeIn index={Math.min(index, 8)}>
              <PressableScale
                style={[styles.row, unread && styles.rowUnread]}
                scaleTo={0.985}
                accessibilityRole="button"
                accessibilityLabel={`${unread ? `${item.unreadCount} unread. ` : ''}${name}, ${subject(item)}. ${preview}`}
                onPress={() => router.push(`/thread/${item.id}`)}
              >
                {/* The face, with a ring when something is waiting. */}
                <View style={[styles.face, unread && styles.faceUnread]}>
                  <Avatar uri={item.business.logoUrl} name={name} size={50} />
                </View>

                <View style={styles.main}>
                  <View style={styles.top}>
                    <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
                      {name}
                    </Text>
                    {item.lastMessageAt && (
                      <Text style={[styles.when, unread && styles.whenUnread]}>{when(item.lastMessageAt)}</Text>
                    )}
                  </View>
                  <View style={styles.subjectRow}>
                    <Icon
                      name={item.appointment ? 'calendar-outline' : 'help-circle-outline'}
                      size={12}
                      color={theme.accent}
                    />
                    <Text style={styles.subject} numberOfLines={1}>
                      {subject(item)}
                    </Text>
                  </View>
                  <View style={styles.top}>
                    <View style={[styles.previewRow, styles.flex]}>
                      {last?.hasPhoto && !last.preview && (
                        <Icon name="camera" size={13} color={unread ? theme.ink : theme.muted} />
                      )}
                      <Text
                        style={[styles.preview, unread && styles.previewUnread, styles.flex]}
                        numberOfLines={1}
                      >
                        {preview}
                      </Text>
                    </View>
                    {unread ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{item.unreadCount}</Text>
                      </View>
                    ) : (
                      mineLast && <Icon name="checkmark-done" size={15} color={theme.muted} />
                    )}
                  </View>
                </View>
              </PressableScale>
            </FadeIn>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  head: { paddingHorizontal: 20 },
  list: { gap: 10, alignSelf: 'center' },
  skeletons: { gap: 10 },
  header: { gap: 14, paddingBottom: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badgeBig: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 10,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  badgeBigText: { fontFamily: font.extrabold, fontSize: 14, color: '#FFFFFF' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: theme.panel,
    ...shadow.card,
  },
  searchInput: { flex: 1, fontFamily: font.medium, fontSize: 15, color: theme.ink, paddingVertical: 0 },
  clear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 12,
    paddingRight: 14,
    ...shadow.card,
  },
  rowUnread: { borderWidth: 1.5, borderColor: theme.accentSoft },
  face: { borderRadius: 29, padding: 2 },
  faceUnread: { borderWidth: 2, borderColor: theme.accent, padding: 1 },
  main: { flex: 1, gap: 2 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontFamily: font.semibold, fontSize: 15.5, color: theme.ink },
  nameUnread: { fontFamily: font.extrabold },
  when: { fontFamily: font.medium, fontSize: 12, color: theme.muted },
  whenUnread: { fontFamily: font.bold, color: theme.accent },
  subjectRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  subject: { flexShrink: 1, fontFamily: font.bold, fontSize: 12, color: theme.accent },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  preview: { fontFamily: font.medium, fontSize: 13.5, color: theme.muted },
  previewUnread: { fontFamily: font.bold, color: theme.ink },
  badge: {
    backgroundColor: theme.accent,
    borderRadius: 11,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.bold, color: '#FFFFFF', fontSize: 12 },
});
