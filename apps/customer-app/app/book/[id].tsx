import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getAvailability, getShop } from '../../src/api/discovery';
import { createAppointment } from '../../src/api/booking';
import { ApiError, tokens } from '../../src/api/client';
import { useMoney } from '../../src/money';
import { theme } from '../../src/theme';

/** The next 14 days, as the YYYY-MM-DD the endpoint takes. */
const nextDays = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i);
    return date.toISOString().slice(0, 10);
  });

const dayLabel = (ymd: string) => {
  const date = new Date(`${ymd}T12:00:00Z`);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
    day: date.toLocaleDateString(undefined, { day: 'numeric' }),
  };
};

/**
 * Pick a day, pick a time, hold the slot.
 *
 * Availability is asked for with the SERVICE's duration, not the default grid:
 * a 60-minute service cannot start 45 minutes before closing, and the default
 * would offer starts that booking then refuses.
 *
 * The slots come back as local times in the SHOP's time zone. They are sent
 * back as the same wall-clock time rather than converted through the phone's
 * zone — a customer in Kigali and a phone set to London must mean 10:00 at the
 * shop when they tap 10:00.
 */
export default function Book() {
  const { id, serviceId } = useLocalSearchParams<{ id: string; serviceId: string }>();
  const router = useRouter();
  const money = useMoney();

  const days = useMemo(() => nextDays(14), []);
  const [date, setDate] = useState(days[0]);
  const [slot, setSlot] = useState<string | null>(null);

  const shop = useQuery({ queryKey: ['shop', id], queryFn: () => getShop(id) });
  const service = shop.data?.services.find((s) => s.id === serviceId);

  const availability = useQuery({
    queryKey: ['availability', id, date, service?.durationMinutes],
    queryFn: () => getAvailability(id, date, service!.durationMinutes),
    enabled: Boolean(service),
  });

  const book = useMutation({
    mutationFn: () =>
      createAppointment({
        locationId: id,
        serviceId,
        // The shop's wall clock, sent as-is. The server knows the location's
        // zone and resolves it; converting here would shift the booking.
        startTime: `${date}T${slot}:00`,
      }),
    onSuccess: (appointment) => router.replace(`/booking/${appointment.id}`),
    onError: (error) =>
      Alert.alert(
        'Could not book that',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  if (shop.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Book' }} />
        <ActivityIndicator style={styles.spinner} color={theme.accent} />
      </>
    );
  }
  if (!service) {
    return (
      <>
        <Stack.Screen options={{ title: 'Book' }} />
        <View style={styles.screen}>
          <Text style={styles.empty}>That service is no longer offered here.</Text>
        </View>
      </>
    );
  }

  const depositMinor = Math.round(
    (service.priceMinor * Number(service.depositPercentage)) / 100,
  );
  const slots = availability.data?.slots ?? [];

  return (
    <>
      <Stack.Screen options={{ title: service.name }} />
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.block}>
            <Text style={styles.title}>{service.name}</Text>
            <Text style={styles.muted}>
              {service.durationMinutes} minutes at {shop.data?.name}
            </Text>
            <View style={styles.priceRow}>
              <Text style={styles.price}>
                {money.format(service.priceMinor, service.currency)}
              </Text>
              <Text style={styles.muted}>total</Text>
            </View>
            {/* The split is stated before anything is chosen. It is the part
                people get wrong about a deposit. */}
            <Text style={styles.depositNote}>
              You pay {money.format(depositMinor, service.currency)} now to hold the
              slot. The rest is paid at the shop.
            </Text>
          </View>

          <Text style={styles.heading}>Which day?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.days}>
            {days.map((ymd) => {
              const label = dayLabel(ymd);
              const active = ymd === date;
              return (
                <Pressable
                  key={ymd}
                  onPress={() => {
                    setDate(ymd);
                    setSlot(null);
                  }}
                  style={[styles.day, active && styles.dayActive]}
                >
                  <Text style={[styles.dayWeek, active && styles.dayTextActive]}>
                    {label.weekday}
                  </Text>
                  <Text style={[styles.dayNum, active && styles.dayTextActive]}>
                    {label.day}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.heading}>What time?</Text>
          {availability.isLoading && <ActivityIndicator color={theme.accent} />}

          {availability.data && slots.length === 0 && (
            <Text style={styles.closed}>
              {/* The server says WHY, and it is more useful than "no slots". */}
              {availability.data.reason ??
                (availability.data.source.startsWith('CLOSED')
                  ? 'Closed on this day.'
                  : 'Nothing free on this day.')}
            </Text>
          )}

          <View style={styles.slots}>
            {slots.map((time) => (
              <Pressable
                key={time}
                onPress={() => setSlot(time)}
                style={[styles.slot, slot === time && styles.slotActive]}
              >
                <Text style={[styles.slotText, slot === time && styles.dayTextActive]}>
                  {time}
                </Text>
              </Pressable>
            ))}
          </View>

          {availability.data?.timeZone && slots.length > 0 && (
            <Text style={styles.muted}>Times are local to the shop ({availability.data.timeZone}).</Text>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={[styles.cta, (!slot || book.isPending) && styles.ctaOff]}
            disabled={!slot || book.isPending}
            onPress={() => {
              // Signing in is required to hold a slot, but not to get here —
              // asking earlier loses people who were only looking.
              if (!tokens.access) {
                router.push(`/sign-in?next=/book/${id}?serviceId=${serviceId}`);
                return;
              }
              book.mutate();
            }}
          >
            <Text style={styles.ctaText}>
              {book.isPending
                ? 'Holding your slot…'
                : slot
                  ? `Book ${slot} · pay ${money.format(depositMinor, service.currency)}`
                  : 'Pick a time'}
            </Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 10, paddingBottom: 24 },
  spinner: { marginTop: 40 },
  block: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    padding: 14,
    gap: 5,
  },
  title: { fontSize: 18, fontWeight: '700', color: theme.ink },
  muted: { color: theme.muted, fontSize: 13 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginTop: 3 },
  price: { fontSize: 20, fontWeight: '700', color: theme.ink },
  depositNote: { color: theme.accent, fontSize: 13, lineHeight: 19, marginTop: 4 },
  heading: { fontWeight: '600', color: theme.ink, marginTop: 8 },
  days: { flexGrow: 0 },
  day: {
    width: 56,
    paddingVertical: 9,
    marginRight: 8,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.panel,
    alignItems: 'center',
  },
  dayActive: { backgroundColor: theme.ink, borderColor: theme.ink },
  dayWeek: { fontSize: 12, color: theme.muted },
  dayNum: { fontSize: 17, fontWeight: '600', color: theme.ink },
  dayTextActive: { color: theme.panel },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: {
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.panel,
  },
  slotActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  slotText: { color: theme.ink, fontWeight: '500' },
  closed: { color: theme.muted, paddingVertical: 10 },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    backgroundColor: theme.panel,
  },
  cta: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaOff: { backgroundColor: theme.line },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  empty: { color: theme.muted, textAlign: 'center', padding: 28 },
});
