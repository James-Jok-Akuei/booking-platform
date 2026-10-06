import { useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSignedIn } from '../src/api/client';
import {
  dismissNotification,
  dismissNotifications,
  dismissReadNotifications,
  markNotificationsRead,
  restoreNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  restoreNotification,
  type Notification,
  type NotificationPage,
} from '../src/api/notifications';
import {
  FALLBACK,
  LOOKS,
  NEEDS_ATTENTION,
  NotificationCard,
} from '../src/components/NotificationCard';
import { font, radius, shadow, theme, type } from '../src/theme';
import { Button } from '../src/ui/Button';
import { EmptyState } from '../src/ui/EmptyState';
import { FadeIn } from '../src/ui/FadeIn';
import { Icon } from '../src/ui/Icon';
import { useLayout } from '../src/ui/layout';
import { PressableScale } from '../src/ui/PressableScale';
import { Segmented } from '../src/ui/Segmented';
import { Sheet } from '../src/ui/Sheet';
import { RowSkeleton } from '../src/ui/Skeleton';
import { TopBar } from '../src/ui/TopBar';
import { Undo } from '../src/ui/Undo';

type Filter = 'all' | 'unread';
type Section = { title: string; data: Notification[]; important?: boolean };

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today", "Yesterday", "This week", "Earlier" — how people place a thing in time. */
const dayGroup = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  if (now.getTime() - d.getTime() < 7 * 86_400_000) return 'This week';
  return 'Earlier';
};

const fullWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });

/**
 * What the platform has told this person (§134, §159).
 *
 * Every email sent is also stored, and this is where they are read. The text
 * was written to be an email — a subject and a few lines — so a card shows the
 * subject and the first line, and a tap opens the whole thing in a sheet, with
 * the way to the booking it is about.
 *
 * Laid out the way an inbox earns its keep: what NEEDS ATTENTION first (a
 * reminder for today, a failed payment, a cancellation, a message — unread
 * ones only), then everything by day. A filter for unread, mark-all-read, and
 * swipe-to-remove on every card. Taking one off the list is not deleting a
 * record; the server keeps it and simply stops showing it.
 */
export default function Notifications() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const signedIn = useSignedIn();
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  /** The last thing removed, while it can still be put back (§160, §162). */
  const [undo, setUndo] = useState<{ ids: string[]; token: number } | null>(null);
  /** Chosen by long press (§162). Empty set means not selecting. */
  const [selected, setSelected] = useState<Set<string> | null>(null);

  const inbox = useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications({ limit: 50 }),
    enabled: signedIn,
  });

  const patch = (change: (page: NotificationPage) => NotificationPage) =>
    queryClient.setQueryData<NotificationPage>(['notifications'], (page) =>
      page ? change(page) : page,
    );
  const settle = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

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
    onSettled: settle,
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
    onSettled: settle,
  });

  // The card has already slid away by the time this runs (§159): the list
  // drops the row at once, and the server is told. If the server refuses, the
  // refetch brings it back, which is the right answer to "did that work".
  const remove = useMutation({
    mutationFn: dismissNotification,
    onMutate: (id) =>
      patch((page) => {
        const target = page.notifications.find((n) => n.id === id);
        if (target) setUndo({ ids: [id], token: Date.now() });
        return {
          ...page,
          total: Math.max(0, page.total - 1),
          unread: target && !target.readAt ? Math.max(0, page.unread - 1) : page.unread,
          notifications: page.notifications.filter((n) => n.id !== id),
        };
      }),
    onSettled: settle,
  });

  // Put back, and only then refetch: the server's answer decides what the
  // list shows, so a restore that failed cannot leave a ghost row.
  const restore = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 1) await restoreNotification(ids[0]);
      else await restoreNotifications(ids);
    },
    onSettled: settle,
  });

  // The server says which ones went, so the undo puts back exactly those.
  const clearRead = useMutation({
    mutationFn: dismissReadNotifications,
    onMutate: () =>
      patch((page) => {
        const kept = page.notifications.filter((n) => !n.readAt);
        return { ...page, total: kept.length, notifications: kept };
      }),
    onSuccess: (result) => {
      if (result.ids.length > 0) setUndo({ ids: result.ids, token: Date.now() });
    },
    onSettled: settle,
  });

  // ---- A selection (§162) ----
  const removeMany = useMutation({
    mutationFn: dismissNotifications,
    onMutate: (ids) => {
      const set = new Set(ids);
      setUndo({ ids, token: Date.now() });
      patch((page) => {
        const kept = page.notifications.filter((n) => !set.has(n.id));
        const unreadGone = page.notifications.filter((n) => set.has(n.id) && !n.readAt).length;
        return {
          ...page,
          total: Math.max(0, page.total - ids.length),
          unread: Math.max(0, page.unread - unreadGone),
          notifications: kept,
        };
      });
    },
    onSettled: settle,
  });
  const readMany = useMutation({
    mutationFn: markNotificationsRead,
    onMutate: (ids) => {
      const set = new Set(ids);
      patch((page) => {
        const now = new Date().toISOString();
        const newlyRead = page.notifications.filter((n) => set.has(n.id) && !n.readAt).length;
        return {
          ...page,
          unread: Math.max(0, page.unread - newlyRead),
          notifications: page.notifications.map((n) =>
            set.has(n.id) && !n.readAt ? { ...n, readAt: now } : n,
          ),
        };
      });
    },
    onSettled: settle,
  });

  const selecting = selected !== null;
  const toggleSelect = (id: string) =>
    setSelected((was) => {
      const next = new Set(was ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = inbox.data?.notifications ?? [];
  const unread = inbox.data?.unread ?? 0;
  const shownIds = useMemo(() => new Set(rows.map((n) => n.id)), [rows]);
  const chosen = selected ? [...selected].filter((id) => shownIds.has(id)) : [];
  const allChosen = selecting && rows.length > 0 && chosen.length === rows.length;
  const readCount = rows.filter((n) => n.readAt).length;

  const sections = useMemo<Section[]>(() => {
    const shown = filter === 'unread' ? rows.filter((n) => !n.readAt) : rows;
    const attention = shown.filter((n) => !n.readAt && NEEDS_ATTENTION.has(n.type));
    const rest = shown.filter((n) => !attention.includes(n));
    const byDay = new Map<string, Notification[]>();
    for (const n of rest) {
      const key = dayGroup(n.createdAt);
      byDay.set(key, [...(byDay.get(key) ?? []), n]);
    }
    return [
      ...(attention.length > 0 ? [{ title: 'Needs your attention', data: attention, important: true }] : []),
      ...[...byDay.entries()].map(([title, data]) => ({ title, data })),
    ];
  }, [rows, filter]);

  const open = rows.find((n) => n.id === openId) ?? null;
  const openLook = open ? (LOOKS[open.type] ?? FALLBACK) : null;

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

  const header = selecting ? (
    /* The select bar (§162), in the header's place, the way mail apps do it:
       how many, all or none, and the two things worth doing to several. */
    <View style={styles.header}>
      <View style={styles.selectBar}>
        <PressableScale
          onPress={() => setSelected(null)}
          hitSlop={10}
          haptic
          accessibilityRole="button"
          accessibilityLabel="Stop selecting"
          style={styles.selectClose}
        >
          <Icon name="close" size={18} color={theme.ink} />
        </PressableScale>
        <Text style={[type.heading, styles.flex]}>
          {chosen.length === 0 ? 'Select' : `${chosen.length} selected`}
        </Text>
        <PressableScale
          onPress={() => setSelected(allChosen ? new Set() : new Set(rows.map((n) => n.id)))}
          hitSlop={8}
          haptic
          accessibilityRole="button"
          style={styles.action}
        >
          <Icon name={allChosen ? 'square-outline' : 'checkbox'} size={17} color={theme.accent} />
          <Text style={styles.actionText}>{allChosen ? 'None' : 'Select all'}</Text>
        </PressableScale>
      </View>
      <View style={styles.selectActions}>
        <Button
          kind="soft"
          compact
          icon="checkmark-done"
          label="Mark read"
          disabled={chosen.length === 0 || !rows.some((n) => chosen.includes(n.id) && !n.readAt)}
          onPress={() => {
            readMany.mutate(chosen);
            setSelected(null);
          }}
          style={styles.flex}
        />
        <Button
          kind="danger"
          compact
          icon="trash-outline"
          label={chosen.length > 0 ? `Remove ${chosen.length}` : 'Remove'}
          disabled={chosen.length === 0}
          onPress={() => {
            removeMany.mutate(chosen);
            setSelected(null);
          }}
          style={styles.flex}
        />
      </View>
    </View>
  ) : (
    <View style={styles.header}>
      <View style={styles.headRow}>
        <View style={styles.flex}>
          <Text style={type.title}>Notifications</Text>
          <Text style={type.small}>
            {unread > 0
              ? `${unread} unread of ${inbox.data?.total ?? rows.length}`
              : rows.length > 0
                ? 'All caught up'
                : ' '}
          </Text>
        </View>
        {unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread}</Text>
          </View>
        )}
      </View>

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: unread > 0 ? `Unread · ${unread}` : 'Unread' },
        ]}
      />

      {/* Two quiet actions, each shown only while it would do something. */}
      {(unread > 0 || readCount > 0) && (
        <View style={styles.actions}>
          {unread > 0 && (
            <PressableScale
              haptic
              hitSlop={8}
              disabled={readAll.isPending}
              onPress={() => readAll.mutate()}
              style={styles.action}
            >
              <Icon name="checkmark-done" size={16} color={theme.accent} />
              <Text style={styles.actionText}>Mark all as read</Text>
            </PressableScale>
          )}
          {readCount > 0 && (
            <PressableScale
              haptic
              hitSlop={8}
              disabled={clearRead.isPending}
              onPress={() => clearRead.mutate()}
              style={styles.action}
            >
              <Icon name="trash-outline" size={15} color={theme.ink2} />
              <Text style={[styles.actionText, styles.actionMuted]}>Clear read</Text>
            </PressableScale>
          )}
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <TopBar title="" />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 28, width: layout.contentWidth, paddingHorizontal: layout.gutter },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={inbox.isRefetching}
            onRefresh={inbox.refetch}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionHead, section.important && styles.sectionHeadImportant]}>
            {section.important && <Icon name="flash" size={13} color={theme.accent} />}
            <Text style={[type.label, section.important && { color: theme.accent }]}>
              {section.title}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          inbox.isLoading ? (
            <View style={styles.skeletons}>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </View>
          ) : filter === 'unread' && rows.length > 0 ? (
            <EmptyState
              icon="checkmark-done-circle-outline"
              title="Nothing unread"
              text="You have read everything. Switch to All to see it again."
            />
          ) : (
            <EmptyState
              icon="notifications-outline"
              title="No notifications yet"
              text="When something happens with a booking, it shows up here."
            />
          )
        }
        renderItem={({ item, index, section }) => (
          <FadeIn index={Math.min(index, 8)}>
            <NotificationCard
              item={item}
              important={Boolean(section.important)}
              selecting={selecting}
              selected={selected?.has(item.id) ?? false}
              onLongPress={() => {
                if (!selecting) setSelected(new Set([item.id]));
              }}
              onPress={() => {
                if (selecting) {
                  toggleSelect(item.id);
                  return;
                }
                if (item.readAt === null) read.mutate(item.id);
                setOpenId(item.id);
              }}
              onRemove={() => remove.mutate(item.id)}
            />
          </FadeIn>
        )}
      />

      <Undo
        message={undo ? (undo.ids.length === 1 ? 'Removed' : `${undo.ids.length} removed`) : null}
        token={undo?.token ?? 0}
        onUndo={() => {
          if (!undo) return;
          restore.mutate(undo.ids);
          setUndo(null);
        }}
        onExpire={() => setUndo(null)}
      />

      {/* The whole message, with the way to what it is about. */}
      <Sheet open={open !== null} title={openLook?.label ?? ''} onClose={() => setOpenId(null)}>
        {open && openLook && (
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View style={[styles.sheetDisc, { backgroundColor: openLook.bg }]}>
                <Icon name={openLook.icon} size={24} color={openLook.fg} />
              </View>
              <View style={styles.flex}>
                <Text style={type.subheading}>{open.subject}</Text>
                <Text style={type.small}>{fullWhen(open.createdAt)}</Text>
              </View>
            </View>
            <Text style={styles.body}>{open.body}</Text>
            {open.appointmentId && (
              <Button
                icon="ticket-outline"
                label="Open the reservation"
                onPress={() => {
                  setOpenId(null);
                  router.push(`/booking/${open.appointmentId}`);
                }}
              />
            )}
            <Button
              kind="quietDanger"
              icon="trash-outline"
              label="Remove this notification"
              onPress={() => {
                setOpenId(null);
                remove.mutate(open.id);
              }}
            />
          </View>
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  list: { paddingTop: 0, gap: 10, alignSelf: 'center' },
  skeletons: { gap: 10 },
  header: { gap: 14, paddingBottom: 6 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 10,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  badgeText: { fontFamily: font.extrabold, fontSize: 14, color: '#FFFFFF' },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectBar: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.panel,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  selectActions: { flexDirection: 'row', gap: 10 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  actionText: { fontFamily: font.bold, fontSize: 13.5, color: theme.accent },
  actionMuted: { color: theme.ink2 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10, marginBottom: 2 },
  sectionHeadImportant: {
    alignSelf: 'flex-start',
    backgroundColor: theme.accentSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  sheet: { gap: 14, paddingBottom: 6 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetDisc: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 23, color: theme.ink2 },
});
