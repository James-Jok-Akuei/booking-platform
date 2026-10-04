import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listThreads, type Thread } from '../../src/api/chat';
import { useSignedIn } from '../../src/api/client';
import { font, radius, shadow, TAB_BAR_CLEARANCE, theme, type } from '../../src/theme';
import { Avatar } from '../../src/ui/Avatar';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { useLayout } from '../../src/ui/layout';
import { PressableScale } from '../../src/ui/PressableScale';
import { RowSkeleton } from '../../src/ui/Skeleton';
import { BigTitle } from '../../src/ui/TopBar';

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
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const signedIn = useSignedIn();

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
      <View style={styles.screen}>
        <BigTitle title="Messages" />
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

  // Threads that have never been used are noise: an appointment thread is made
  // with every booking (§21.1), so a customer with ten bookings and no messages
  // would open this screen onto ten empty conversations.
  const rows = (threads.data?.threads ?? []).filter(
    (t) => t.lastMessage !== null || t.kind === 'INQUIRY',
  );

  return (
    <View style={styles.screen}>
      <BigTitle title="Messages" />
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.list,
          {
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
          />
        }
        ListEmptyComponent={
          threads.isLoading ? (
            <View style={styles.skeletons}>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </View>
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
          return (
            <FadeIn index={index}>
              <PressableScale
                style={styles.row}
                scaleTo={0.98}
                onPress={() => router.push(`/thread/${item.id}`)}
              >
                <Avatar name={item.business.name} size={52} />
                <View style={styles.main}>
                  <View style={styles.rowTop}>
                    <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
                      {item.business.name}
                    </Text>
                    {item.lastMessageAt && (
                      <Text style={[styles.when, unread && styles.whenUnread]}>
                        {ago(item.lastMessageAt)}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.subject} numberOfLines={1}>
                    {subject(item)}
                  </Text>
                  <View style={styles.rowTop}>
                    <Text
                      style={[type.small, styles.flex, unread && styles.previewUnread]}
                      numberOfLines={1}
                    >
                      {item.lastMessage
                        ? (item.lastMessage.preview ??
                          (item.lastMessage.hasPhoto ? 'Photo' : 'Message'))
                        : 'No messages yet'}
                    </Text>
                    {unread && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{item.unreadCount}</Text>
                      </View>
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
  list: { paddingTop: 6, gap: 12, alignSelf: 'center' },
  skeletons: { gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 14,
    ...shadow.card,
  },
  main: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontFamily: font.semibold, fontSize: 15.5, color: theme.ink },
  nameUnread: { fontFamily: font.extrabold },
  when: { fontFamily: font.medium, fontSize: 12, color: theme.muted },
  whenUnread: { fontFamily: font.bold, color: theme.accent },
  subject: { fontFamily: font.bold, fontSize: 12, color: theme.accent },
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
