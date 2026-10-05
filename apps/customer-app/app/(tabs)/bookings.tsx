import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listMyAppointments, type Appointment } from '../../src/api/booking';
import { useSignedIn } from '../../src/api/client';
import { BOOKING_STATUS } from '../../src/bookingStatus';
import { useMoney } from '../../src/money';
import { font, radius, shadow, TAB_BAR_CLEARANCE, theme, type } from '../../src/theme';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { Icon } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { Pill } from '../../src/ui/Pill';
import { PressableScale } from '../../src/ui/PressableScale';
import { Segmented } from '../../src/ui/Segmented';
import { RowSkeleton } from '../../src/ui/Skeleton';
import { Stars } from '../../src/ui/Stars';
import { BigTitle } from '../../src/ui/TopBar';

type Tab = 'upcoming' | 'past';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const weekday = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'long' });

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
 *
 * Each row leads with the DATE as a block (§133), the way a calendar page does,
 * because on this screen the question is always "when" before it is "what".
 */
export default function Bookings() {
  const router = useRouter();
  const money = useMoney();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const [tab, setTab] = useState<Tab>('upcoming');
  const signedIn = useSignedIn();

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
      <View style={styles.screen}>
        <BigTitle title="My bookings" />
        <EmptyState
          icon="calendar-outline"
          title="Sign in to see your bookings"
          text="They are kept with your account, so they follow you to any phone."
          action="Sign in"
          onAction={() => router.push('/sign-in?next=/bookings')}
        />
      </View>
    );
  }

  const rows = bookings.data?.appointments ?? [];

  return (
    <View style={styles.screen}>
      <BigTitle title="My bookings" />
      <View style={[styles.tabs, { width: layout.contentWidth, paddingHorizontal: layout.gutter }]}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'past', label: 'Past' },
          ]}
        />
      </View>

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
            refreshing={bookings.isRefetching}
            onRefresh={bookings.refetch}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        ListEmptyComponent={
          bookings.isLoading ? (
            <View style={styles.skeletons}>
              <RowSkeleton />
              <RowSkeleton />
              <RowSkeleton />
            </View>
          ) : (
            <EmptyState
              icon={tab === 'upcoming' ? 'calendar-outline' : 'time-outline'}
              title={tab === 'upcoming' ? 'Nothing booked yet' : 'Nothing here yet'}
              text={
                tab === 'upcoming'
                  ? 'Bookings you make will show up here.'
                  : 'Bookings that have been and gone will show up here.'
              }
              action={tab === 'upcoming' ? 'Find a place' : undefined}
              onAction={() => router.push('/')}
            />
          )
        }
        renderItem={({ item, index }) => (
          <FadeIn index={index}>
            <BookingRow
              item={item}
              deposit={money.format(item.depositAmountMinor, item.currency)}
              onPress={() => router.push(`/booking/${item.id}`)}
            />
          </FadeIn>
        )}
      />
    </View>
  );
}

function BookingRow({
  item,
  deposit,
  onPress,
}: {
  item: Appointment;
  deposit: string;
  onPress: () => void;
}) {
  const status = BOOKING_STATUS[item.status];
  const start = new Date(item.startTime);
  const faded = item.status === 'CANCELLED' || item.status === 'NO_SHOW';

  return (
    <PressableScale style={styles.row} onPress={onPress} scaleTo={0.98}>
      <View style={[styles.date, faded && styles.dateFaded]}>
        <Text style={[styles.dateMonth, faded && styles.dateTextFaded]}>
          {start.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}
        </Text>
        <Text style={[styles.dateDay, faded && styles.dateTextFaded]}>{start.getDate()}</Text>
      </View>

      <View style={styles.main}>
        <View style={styles.rowTop}>
          <Text style={styles.service} numberOfLines={1}>
            {item.service.name}
            {item.quantity > 1 ? ` × ${item.quantity}` : ''}
          </Text>
          <Icon name="chevron-forward" size={16} color={theme.muted} />
        </View>

        <View style={styles.line}>
          <Icon name="time-outline" size={13} color={theme.muted} />
          <Text style={styles.when}>
            {weekday(item.startTime)} · {clock(item.startTime)}
          </Text>
        </View>
        <View style={styles.line}>
          <Icon name="location-outline" size={13} color={theme.muted} />
          <Text style={[type.small, styles.flex]} numberOfLines={1}>
            {item.location.name} · {item.location.address}
          </Text>
        </View>

        <View style={styles.foot}>
          <Pill label={status.label} tone={status.tone} dot={item.status === 'BOOKED'} />
          {/* The deposit, because it is the half that has been paid and the
              reason a cancellation costs something. */}
          <Text style={styles.money} numberOfLines={1}>
            {item.depositPaidAt ? `${deposit} deposit paid` : `${deposit} deposit due`}
          </Text>
        </View>

        {status.nudge && (
          <View style={styles.nudge}>
            <Icon name="alert-circle-outline" size={14} color={theme.warn} />
            <Text style={styles.nudgeText}>{status.nudge}</Text>
          </View>
        )}

        {/* The Past tab is the only place a finished visit is ever seen
            again, so it is the only place a review can be asked for. */}
        {item.status === 'COMPLETED' &&
          (item.review ? (
            <View style={styles.line}>
              <Stars rating={item.review.rating} size={13} />
              <Text style={type.small}>you rated this</Text>
            </View>
          ) : (
            <View style={styles.nudge}>
              <Icon name="star-outline" size={14} color={theme.warn} />
              <Text style={styles.nudgeText}>Tell others how it went</Text>
            </View>
          ))}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  tabs: { alignSelf: 'center', paddingBottom: 6 },
  list: { paddingTop: 12, gap: 12, alignSelf: 'center' },
  skeletons: { gap: 12 },
  row: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 14,
    ...shadow.card,
  },
  date: {
    width: 58,
    height: 66,
    borderRadius: radius.md,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateFaded: { backgroundColor: theme.sunken },
  dateMonth: { fontFamily: font.bold, fontSize: 11, color: theme.accent, letterSpacing: 0.8 },
  dateDay: { fontFamily: font.extrabold, fontSize: 24, lineHeight: 28, color: theme.accentDeep },
  dateTextFaded: { color: theme.muted },
  main: { flex: 1, gap: 5 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  service: { flex: 1, fontFamily: font.bold, fontSize: 16, color: theme.ink },
  line: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  when: { fontFamily: font.semibold, fontSize: 13, color: theme.ink2 },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Wraps on a narrow phone, so the deposit drops under the status rather
    // than being cut off mid-word.
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  money: { fontFamily: font.semibold, fontSize: 12.5, color: theme.ink2 },
  nudge: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  nudgeText: { fontFamily: font.bold, fontSize: 12.5, color: theme.warn },
});
