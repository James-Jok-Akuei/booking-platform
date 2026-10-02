import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getShop, getShopReviews, type ShopService } from '../../src/api/discovery';
import { useMoney } from '../../src/money';
import { theme } from '../../src/theme';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const niceDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

/**
 * One shop: what it does, what it costs, and what people said.
 *
 * The deposit is spelled out on every service, because it is the number that
 * surprises people. The platform takes a percentage at booking and the rest is
 * paid at the shop (§2) — a price with no mention of that reads as the whole
 * amount being due now.
 */
export default function Shop() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const money = useMoney();
  const router = useRouter();

  const shop = useQuery({ queryKey: ['shop', id], queryFn: () => getShop(id) });
  const reviews = useQuery({
    queryKey: ['shop-reviews', id],
    queryFn: () => getShopReviews(id),
  });

  if (shop.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Place' }} />
        <ActivityIndicator style={styles.spinner} color={theme.accent} />
      </>
    );
  }

  if (shop.isError || !shop.data) {
    return (
      <>
        <Stack.Screen options={{ title: 'Place' }} />
        <View style={styles.screen}>
          <Text style={styles.empty}>This place is not available right now.</Text>
        </View>
      </>
    );
  }

  const s = shop.data;
  const today = new Date().getDay();

  return (
    <>
      <Stack.Screen options={{ title: s.business.name ?? s.name }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {s.business.coverImageUrl && (
          <Image source={{ uri: s.business.coverImageUrl }} style={styles.cover} />
        )}

        <View style={styles.block}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{s.business.name ?? s.name}</Text>
            {s.openNow ? (
              <Text style={styles.open}>Open now</Text>
            ) : (
              <Text style={styles.shut}>Closed</Text>
            )}
          </View>

          <Text style={styles.sub}>
            {s.name} · {s.address}
          </Text>
          {s.district && (
            <Text style={styles.sub}>
              {s.district.name}, {s.district.provinceName}
            </Text>
          )}

          {s.rating.count > 0 ? (
            <Text style={styles.rating}>
              ★ {s.rating.average?.toFixed(1)}{' '}
              <Text style={styles.muted}>from {s.rating.count} reviews</Text>
            </Text>
          ) : (
            <Text style={styles.muted}>No reviews yet</Text>
          )}

          {s.business.description && (
            <Text style={styles.description}>{s.business.description}</Text>
          )}
        </View>

        <View style={styles.block}>
          <Text style={styles.heading}>What they do</Text>
          {s.services.length === 0 && (
            <Text style={styles.muted}>Nothing is bookable here yet.</Text>
          )}
          {s.services.map((service) => (
            <ServiceRow
              key={service.id}
              service={service}
              format={money.format}
              onPress={() => router.push(`/book/${s.id}?serviceId=${service.id}`)}
            />
          ))}
        </View>

        <View style={styles.block}>
          <Text style={styles.heading}>Opening hours</Text>
          {s.hours.map((h) => (
            <View key={h.dayOfWeek} style={styles.hourRow}>
              <Text style={[styles.day, h.dayOfWeek === today && styles.dayToday]}>
                {DAYS[h.dayOfWeek]}
              </Text>
              <Text style={h.isClosed ? styles.muted : styles.hourText}>
                {h.isClosed ? 'Closed' : `${h.openTime} – ${h.closeTime}`}
              </Text>
            </View>
          ))}

          {/* Days that differ from the usual week (§91). Worth seeing before
              choosing a date, not after. */}
          {s.upcomingExceptions.length > 0 && (
            <View style={styles.exceptions}>
              <Text style={styles.heading}>Coming up</Text>
              {s.upcomingExceptions.map((exception) => (
                <View key={exception.date} style={styles.hourRow}>
                  <Text style={styles.day}>{niceDate(exception.date)}</Text>
                  <Text style={exception.isClosed ? styles.closedDay : styles.hourText}>
                    {exception.isClosed
                      ? 'Closed'
                      : `${exception.customOpenTime} – ${exception.customCloseTime}`}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.block}>
          <Text style={styles.heading}>
            Reviews {reviews.data ? `(${reviews.data.total})` : ''}
          </Text>
          {reviews.data?.reviews.length === 0 && (
            <Text style={styles.muted}>Nobody has reviewed this place yet.</Text>
          )}
          {reviews.data?.reviews.map((review) => (
            <View key={review.id} style={styles.review}>
              <Text style={styles.reviewHead}>
                <Text style={styles.rating}>{'★'.repeat(review.rating)}</Text>
                <Text style={styles.muted}>{'★'.repeat(5 - review.rating)}</Text>
                {'  '}
                {review.displayName}
              </Text>
              {review.comment && <Text style={styles.reviewText}>{review.comment}</Text>}
              {/* The shop's reply, which is often the more useful half. */}
              {review.responseText && (
                <View style={styles.reply}>
                  <Text style={styles.muted}>They replied</Text>
                  <Text style={styles.reviewText}>{review.responseText}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

function ServiceRow({
  service,
  format,
  onPress,
}: {
  service: ShopService;
  format: (minor: number | null | undefined, code?: string | null) => string;
  onPress: () => void;
}) {
  // Rounded the way the server does it, so the figure shown is the figure
  // charged — the deposit is a percentage of the price, taken at booking.
  const depositMinor = Math.round(
    (service.priceMinor * Number(service.depositPercentage)) / 100,
  );

  return (
    <Pressable style={styles.service} onPress={onPress}>
      <View style={styles.serviceMain}>
        <Text style={styles.serviceName}>{service.name}</Text>
        {service.description && (
          <Text style={styles.muted} numberOfLines={2}>
            {service.description}
          </Text>
        )}
        <Text style={styles.muted}>{service.durationMinutes} minutes</Text>
      </View>
      <View style={styles.servicePrice}>
        <Text style={styles.price}>{format(service.priceMinor, service.currency)}</Text>
        <Text style={styles.deposit}>pay {format(depositMinor, service.currency)} now</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  spinner: { marginTop: 40 },
  cover: { width: '100%', height: 150, borderRadius: theme.radius },
  block: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    padding: 14,
    gap: 7,
  },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  title: { fontSize: 19, fontWeight: '700', color: theme.ink, flex: 1 },
  sub: { color: theme.muted, fontSize: 13 },
  description: { color: theme.ink, lineHeight: 20, marginTop: 4 },
  heading: { fontWeight: '600', color: theme.ink, marginBottom: 2 },
  muted: { color: theme.muted, fontSize: 13 },
  rating: { color: theme.warn, fontWeight: '600' },
  open: { color: theme.ok, fontWeight: '600', fontSize: 13 },
  shut: { color: theme.muted, fontSize: 13 },
  service: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: theme.line,
  },
  serviceMain: { flex: 1, gap: 2 },
  serviceName: { fontWeight: '600', color: theme.ink, fontSize: 15 },
  servicePrice: { alignItems: 'flex-end', gap: 2 },
  price: { fontWeight: '700', color: theme.ink },
  deposit: { color: theme.accent, fontSize: 12, fontWeight: '500' },
  hourRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  day: { color: theme.muted, fontSize: 13 },
  dayToday: { color: theme.ink, fontWeight: '600' },
  hourText: { color: theme.ink, fontSize: 13 },
  closedDay: { color: theme.danger, fontSize: 13, fontWeight: '500' },
  exceptions: { marginTop: 10, borderTopWidth: 1, borderTopColor: theme.line, paddingTop: 9 },
  review: { borderTopWidth: 1, borderTopColor: theme.line, paddingTop: 10, marginTop: 8, gap: 3 },
  reviewHead: { fontSize: 13, color: theme.ink },
  reviewText: { color: theme.ink, lineHeight: 19 },
  reply: {
    marginTop: 5,
    paddingLeft: 10,
    borderLeftWidth: 3,
    borderLeftColor: theme.accent,
    gap: 2,
  },
  empty: { color: theme.muted, textAlign: 'center', padding: 28 },
});
