import { useMemo, useState } from 'react';
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
import { listMyAppointments, type Appointment } from '../src/api/booking';
import { tokens } from '../src/api/client';
import { useMoney } from '../src/money';
import { theme } from '../src/theme';

type Tab = 'upcoming' | 'past';

/**
 * What each status means to the person who booked it.
 *
 * The enum is the platform's vocabulary and belongs in the API; this is the
 * customer's. `PENDING_PAYMENT` in particular is not a state to describe but a
 * thing to do, so it is the one that gets the accent colour and a nudge.
 */
const STATUS: Record<
  Appointment['status'],
  { label: string; colour: string; nudge?: string }
> = {
  PENDING_PAYMENT: {
    label: 'Not paid yet',
    colour: theme.warn,
    nudge: 'Pay the deposit to confirm this slot',
  },
  BOOKED: { label: 'Confirmed', colour: theme.ok },
  IN_PROGRESS: { label: 'Happening now', colour: theme.accent },
  COMPLETED: { label: 'Done', colour: theme.muted },
  CANCELLED: { label: 'Cancelled', colour: theme.muted },
  NO_SHOW: { label: 'Missed', colour: theme.danger },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Every booking this customer has made.
 *
 * Until now a booking could be reached only by the screen that created it: close
 * the app after paying and the arrival code was gone from the phone (it is in the
 * email too, §54, but a customer standing at a counter is not reading email).
 *
 * The two tabs are two different questions and they are sorted differently
 * because of it. "What is next" is soonest-first; "what happened" is
 * most-recent-first. The endpoint defaults to the latter, which on the upcoming
 * tab would have put next year's booking at the top of page one (§110.2).
 */
export default function Bookings() {
  const router = useRouter();
  const money = useMoney();
  const [tab, setTab] = useState<Tab>('upcoming');
  const signedIn = Boolean(tokens.access);

  // Pinned when the screen opens rather than read per render: a boundary that
  // moves on every keystroke makes the two tabs disagree about the booking
  // happening right now, and can drop it from both.
  const boundary = useMemo(() => new Date().toISOString(), []);

  const bookings = useQuery({
    queryKey: ['my-appointments', tab, boundary],
    queryFn: () =>
      listMyAppointments(
        tab === 'upcoming'
          ? { from: boundary, sort: 'soonest', limit: 50 }
          : { to: boundary, sort: 'latest', limit: 50 },
      ),
    enabled: signedIn,
  });

  if (!signedIn) {
    return (
      <>
        <Stack.Screen options={{ title: 'My bookings' }} />
        <View style={styles.centre}>
          <Text style={styles.emptyTitle}>Sign in to see your bookings</Text>
          <Text style={styles.empty}>
            They are kept with your account, so they follow you to any phone.
          </Text>
          <Pressable
            style={styles.cta}
            onPress={() => router.push('/sign-in?next=/bookings')}
          >
            <Text style={styles.ctaText}>Sign in</Text>
          </Pressable>
        </View>
      </>
    );
  }

  const rows = bookings.data?.appointments ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'My bookings' }} />
      <View style={styles.screen}>
        <View style={styles.tabs}>
          {(['upcoming', 'past'] as const).map((value) => (
            <Pressable
              key={value}
              onPress={() => setTab(value)}
              style={[styles.tab, tab === value && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === value && styles.tabTextActive]}>
                {value === 'upcoming' ? 'Upcoming' : 'Past'}
              </Text>
            </Pressable>
          ))}
        </View>

        {bookings.isLoading && <ActivityIndicator style={styles.spinner} color={theme.accent} />}

        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={bookings.isRefetching} onRefresh={bookings.refetch} />
          }
          ListEmptyComponent={
            bookings.isLoading ? null : (
              <View style={styles.centre}>
                <Text style={styles.emptyTitle}>
                  {tab === 'upcoming' ? 'Nothing booked yet' : 'Nothing here yet'}
                </Text>
                <Text style={styles.empty}>
                  {tab === 'upcoming'
                    ? 'Bookings you make will show up here.'
                    : 'Bookings that have been and gone will show up here.'}
                </Text>
                {tab === 'upcoming' && (
                  <Pressable style={styles.cta} onPress={() => router.push('/')}>
                    <Text style={styles.ctaText}>Find a place</Text>
                  </Pressable>
                )}
              </View>
            )
          }
          renderItem={({ item }) => {
            const status = STATUS[item.status];
            return (
              <Pressable
                style={styles.row}
                onPress={() => router.push(`/booking/${item.id}`)}
              >
                <View style={styles.rowTop}>
                  <Text style={styles.service} numberOfLines={1}>
                    {item.service.name}
                  </Text>
                  <Text style={[styles.status, { color: status.colour }]}>
                    {status.label}
                  </Text>
                </View>
                <Text style={styles.when}>{when(item.startTime)}</Text>
                <Text style={styles.place} numberOfLines={1}>
                  {item.location.name} · {item.location.address}
                </Text>

                {/* The deposit, because it is the half that has been paid and the
                    reason a cancellation costs something. */}
                <Text style={styles.money}>
                  {item.depositPaidAt
                    ? `${money.format(item.depositAmountMinor, item.currency)} deposit paid`
                    : `${money.format(item.depositAmountMinor, item.currency)} deposit due`}
                </Text>

                {status.nudge && <Text style={styles.nudge}>{status.nudge}</Text>}
              </Pressable>
            );
          }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  spinner: { marginTop: 30 },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    paddingBottom: 6,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.panel,
  },
  tabActive: { backgroundColor: theme.ink, borderColor: theme.ink },
  tabText: { color: theme.ink, fontWeight: '500' },
  tabTextActive: { color: theme.panel },
  list: { padding: 16, paddingTop: 6, gap: 10 },
  row: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    padding: 14,
    gap: 3,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  service: { flex: 1, fontSize: 16, fontWeight: '700', color: theme.ink },
  status: { fontSize: 12, fontWeight: '700' },
  when: { fontSize: 14, color: theme.ink, fontWeight: '500' },
  place: { color: theme.muted, fontSize: 13 },
  money: { color: theme.muted, fontSize: 13, marginTop: 2 },
  nudge: { color: theme.warn, fontSize: 13, fontWeight: '500', marginTop: 3 },
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
