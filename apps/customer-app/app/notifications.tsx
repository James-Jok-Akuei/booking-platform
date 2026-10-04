import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSignedIn } from '../src/api/client';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
  type NotificationPage,
} from '../src/api/notifications';
import { font, radius, shadow, theme, type } from '../src/theme';
import { EmptyState } from '../src/ui/EmptyState';
import { FadeIn } from '../src/ui/FadeIn';
import { Icon, type IconName } from '../src/ui/Icon';
import { useLayout } from '../src/ui/layout';
import { PressableScale } from '../src/ui/PressableScale';
import { RowSkeleton } from '../src/ui/Skeleton';
import { TopBar } from '../src/ui/TopBar';

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

type Look = { icon: IconName; fg: string; bg: string };

/**
 * A picture for each kind of news, so the list can be scanned by colour.
 *
 * Green is good news, red needs attention, coral is "something for you to
 * read". A kind this app does not know yet gets the bell rather than nothing —
 * the server adds kinds, and an unknown one must still be readable.
 */
const LOOKS: Partial<Record<Notification['type'], Look>> = {
  DEPOSIT_CONFIRMED: { icon: 'checkmark-circle', fg: theme.ok, bg: theme.okSoft },
  APPOINTMENT_BOOKED: { icon: 'calendar', fg: theme.ok, bg: theme.okSoft },
  APPOINTMENT_REMINDER: { icon: 'alarm-outline', fg: theme.accent, bg: theme.accentSoft },
  APPOINTMENT_CANCELLED: { icon: 'close-circle', fg: theme.danger, bg: theme.dangerSoft },
  APPOINTMENT_NO_SHOW: { icon: 'alert-circle-outline', fg: theme.danger, bg: theme.dangerSoft },
  DEPOSIT_FAILED: { icon: 'alert-circle-outline', fg: theme.danger, bg: theme.dangerSoft },
  NEW_MESSAGE: { icon: 'chatbubble-ellipses', fg: theme.accent, bg: theme.accentSoft },
  REVIEW_RESPONSE: { icon: 'star', fg: theme.warn, bg: theme.warnSoft },
  REVIEW_HIDDEN: { icon: 'eye-off-outline', fg: theme.warn, bg: theme.warnSoft },
  DISPLAY_NAME_CLEARED: { icon: 'eye-off-outline', fg: theme.warn, bg: theme.warnSoft },
};
const FALLBACK: Look = { icon: 'notifications', fg: theme.accent, bg: theme.accentSoft };

/**
 * What the platform has told this person (§134).
 *
 * These rows have existed since notifications were built — every email sent is
 * also stored — and the phone showed none of them. A customer whose booking was
 * cancelled by the shop found out from their email or not at all.
 *
 * The text was written to be an EMAIL: a subject and a few lines. So each row
 * shows the subject and the first two lines, and opens to the rest on a tap,
 * rather than every row being a paragraph.
 *
 * Tapping marks it read, optimistically — the dot goes before the request
 * returns, the same reasoning as the heart (§120.2). One about a booking also
 * offers the way to that booking, because that is nearly always the next thing
 * somebody wants.
 */
export default function Notifications() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const signedIn = useSignedIn();
  const [open, setOpen] = useState<string | null>(null);

  const inbox = useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications({ limit: 50 }),
    enabled: signedIn,
  });

  const patch = (change: (page: NotificationPage) => NotificationPage) =>
    queryClient.setQueryData<NotificationPage>(['notifications'], (page) =>
      page ? change(page) : page,
    );

  const read = useMutation({
    mutationFn: markNotificationRead,
    onMutate: (id) =>
      patch((page) => {
        const target = page.notifications.find((n) => n.id === id);
        if (!target || target.readAt) return page;
        return {
          ...page,
          unread: Math.max(0, page.unread - 1),
          notifications: page.notifications.map((n) =>
            n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
          ),
        };
      }),
    // Whatever happened, the server's version is the truth.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const readAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: () =>
      patch((page) => ({
        ...page,
        unread: 0,
        notifications: page.notifications.map((n) =>
          n.readAt ? n : { ...n, readAt: new Date().toISOString() },
        ),
      })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (!signedIn) {
    return (
      <View style={styles.screen}>
        <TopBar title="Notifications" />
        <EmptyState
          icon="notifications-outline"
          title="Sign in to see your notifications"
          text="They are kept with your account, so they follow you to any phone."
          action="Sign in"
          onAction={() => router.push('/sign-in?next=/notifications')}
        />
      </View>
    );
  }

  const rows = inbox.data?.notifications ?? [];
  const unread = inbox.data?.unread ?? 0;

  return (
    <View style={styles.screen}>
      <TopBar
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : undefined}
      />

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.list,
          {
            paddingBottom: insets.bottom + 28,
            width: layout.contentWidth,
            paddingHorizontal: layout.gutter,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={inbox.isRefetching}
            onRefresh={inbox.refetch}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        ListHeaderComponent={
          unread > 0 ? (
            <PressableScale
              haptic
              hitSlop={8}
              disabled={readAll.isPending}
              onPress={() => readAll.mutate()}
              style={styles.readAll}
            >
              <Icon name="checkmark-done" size={16} color={theme.accent} />
              <Text style={styles.readAllText}>Mark all as read</Text>
            </PressableScale>
          ) : null
        }
        ListEmptyComponent={
          inbox.isLoading ? (
            <View style={styles.skeletons}>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </View>
          ) : (
            <EmptyState
              icon="notifications-outline"
              title="No notifications yet"
              text="When something happens with a booking, it shows up here."
            />
          )
        }
        renderItem={({ item, index }) => {
          const look = LOOKS[item.type] ?? FALLBACK;
          const isUnread = item.readAt === null;
          const expanded = open === item.id;
          return (
            <FadeIn index={index}>
              <PressableScale
                scaleTo={0.985}
                accessibilityRole="button"
                accessibilityLabel={`${isUnread ? 'Unread. ' : ''}${item.subject}`}
                onPress={() => {
                  if (isUnread) read.mutate(item.id);
                  setOpen(expanded ? null : item.id);
                }}
                style={[styles.row, isUnread && styles.rowUnread]}
              >
                <View style={[styles.disc, { backgroundColor: look.bg }]}>
                  <Icon name={look.icon} size={20} color={look.fg} />
                </View>

                <View style={styles.main}>
                  <View style={styles.top}>
                    <Text
                      style={[styles.subject, isUnread && styles.subjectUnread]}
                      numberOfLines={expanded ? undefined : 2}
                    >
                      {item.subject}
                    </Text>
                    <Text style={[styles.when, isUnread && styles.whenUnread]}>
                      {ago(item.createdAt)}
                    </Text>
                  </View>

                  {/* Collapsed, the line breaks are folded away so two lines
                      carry as much as they can. Opened, the message reads as
                      it was written. */}
                  <Text style={type.small} numberOfLines={expanded ? undefined : 2}>
                    {expanded ? item.body : item.body.replace(/\s*\n+\s*/g, ' · ')}
                  </Text>

                  {expanded && item.appointmentId && (
                    <PressableScale
                      haptic
                      hitSlop={6}
                      style={styles.go}
                      onPress={() => router.push(`/booking/${item.appointmentId}`)}
                    >
                      <Text style={styles.goText}>Your booking</Text>
                      <Icon name="arrow-forward" size={14} color={theme.accent} />
                    </PressableScale>
                  )}
                </View>

                {isUnread && <View style={styles.dot} />}
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
  list: { paddingTop: 6, gap: 10, alignSelf: 'center' },
  skeletons: { gap: 10 },
  readAll: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 6,
    paddingVertical: 4,
    marginBottom: 2,
  },
  readAllText: { fontFamily: font.bold, fontSize: 13.5, color: theme.accent },
  row: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 14,
    ...shadow.card,
  },
  // A read row steps back; an unread one keeps the full card and gains a dot.
  rowUnread: { borderWidth: 1.5, borderColor: theme.accentSoft },
  disc: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: { flex: 1, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  subject: { flex: 1, fontFamily: font.semibold, fontSize: 14.5, lineHeight: 20, color: theme.ink2 },
  subjectUnread: { fontFamily: font.extrabold, color: theme.ink },
  when: { fontFamily: font.medium, fontSize: 12, color: theme.muted, marginTop: 2 },
  whenUnread: { fontFamily: font.bold, color: theme.accent },
  go: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 6,
    backgroundColor: theme.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  goText: { fontFamily: font.bold, fontSize: 13, color: theme.accent },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.accent, marginTop: 6 },
});
