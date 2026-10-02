import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { listThreads, type Thread } from '../src/api/chat';
import { tokens } from '../src/api/client';
import { theme } from '../src/theme';

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/**
 * What a thread is about, in one line.
 *
 * An appointment thread already has a subject — the booking it was created with
 * (§21.1) — and saying so is what stops a list of eight threads with the same
 * shop being eight identical rows.
 */
const subject = (thread: Thread) =>
  thread.appointment
    ? `${thread.appointment.serviceName} · ${new Date(
        thread.appointment.startTime,
      ).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
    : 'Question';

/** Every conversation this customer has, newest activity first. */
export default function Messages() {
  const router = useRouter();
  const signedIn = Boolean(tokens.access);

  const threads = useQuery({
    queryKey: ['threads'],
    queryFn: () => listThreads({ limit: 50 }),
    enabled: signedIn,
    // The list is not held open the way a thread is, so it is refreshed on
    // arrival and by pulling rather than polled.
    staleTime: 0,
  });

  if (!signedIn) {
    return (
      <>
        <Stack.Screen options={{ title: 'Messages' }} />
        <View style={styles.centre}>
          <Text style={styles.emptyTitle}>Sign in to see your messages</Text>
          <Text style={styles.empty}>
            Conversations are kept with your account, so they follow you to any phone.
          </Text>
          <Pressable
            style={styles.cta}
            onPress={() => router.push('/sign-in?next=/messages')}
          >
            <Text style={styles.ctaText}>Sign in</Text>
          </Pressable>
        </View>
      </>
    );
  }

  // Threads that have never been used are noise: an appointment thread is made
  // with every booking (§21.1), so a customer with ten bookings and no messages
  // would open this screen onto ten empty conversations.
  const rows = (threads.data?.threads ?? []).filter(
    (t) => t.lastMessage !== null || t.kind === 'INQUIRY',
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Messages' }} />
      <View style={styles.screen}>
        {threads.isLoading && <ActivityIndicator style={styles.spinner} color={theme.accent} />}
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={threads.isRefetching} onRefresh={threads.refetch} />
          }
          ListEmptyComponent={
            threads.isLoading ? null : (
              <View style={styles.centre}>
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.empty}>
                  Open a place and tap Message the shop to ask something before you book.
                </Text>
                <Pressable style={styles.cta} onPress={() => router.push('/')}>
                  <Text style={styles.ctaText}>Find a place</Text>
                </Pressable>
              </View>
            )
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/thread/${item.id}`)}>
              <View style={styles.rowTop}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.business.name}
                </Text>
                {item.lastMessageAt && (
                  <Text style={styles.when}>{ago(item.lastMessageAt)}</Text>
                )}
                {item.unreadCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.unreadCount}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.subject}>{subject(item)}</Text>
              <Text style={styles.preview} numberOfLines={1}>
                {item.lastMessage
                  ? (item.lastMessage.preview ??
                    (item.lastMessage.hasPhoto ? 'Photo' : 'Message'))
                  : 'No messages yet'}
              </Text>
            </Pressable>
          )}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  spinner: { marginTop: 30 },
  list: { padding: 16, gap: 10 },
  row: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    padding: 14,
    gap: 3,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '700', color: theme.ink },
  when: { color: theme.muted, fontSize: 12 },
  badge: {
    backgroundColor: theme.accent,
    borderRadius: 11,
    minWidth: 22,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  subject: { color: theme.accent, fontSize: 12, fontWeight: '600' },
  preview: { color: theme.muted, fontSize: 13 },
  centre: { alignItems: 'center', padding: 30, gap: 7 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: theme.ink },
  empty: { color: theme.muted, textAlign: 'center', lineHeight: 20 },
  cta: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 13,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
