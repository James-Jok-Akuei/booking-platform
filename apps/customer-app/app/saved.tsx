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
import { listFavourites, type SavedPlace } from '../src/api/discovery';
import { tokens } from '../src/api/client';
import { useSaved } from '../src/useSaved';
import { SaveButton } from '../src/components/SaveButton';
import { useMoney } from '../src/money';
import { theme } from '../src/theme';

/**
 * Places kept to come back to (§120).
 *
 * Not a cart, and the screen says so by what it does not have: no total, no
 * checkout, no quantity. Saving reserves nothing — a slot is held by booking it,
 * and a basket that held slots would take them from somebody ready to book.
 */
export default function Saved() {
  const router = useRouter();
  const money = useMoney();
  const saved = useSaved();
  const signedIn = Boolean(tokens.access);

  const places = useQuery({
    queryKey: ['favourites'],
    queryFn: listFavourites,
    enabled: signedIn,
  });

  if (!signedIn) {
    return (
      <>
        <Stack.Screen options={{ title: 'Saved' }} />
        <View style={styles.centre}>
          <Text style={styles.emptyTitle}>Sign in to keep a list</Text>
          <Text style={styles.empty}>
            Places you save are kept with your account, so they follow you to any
            phone.
          </Text>
          <Pressable style={styles.cta} onPress={() => router.push('/sign-in?next=/saved')}>
            <Text style={styles.ctaText}>Sign in</Text>
          </Pressable>
        </View>
      </>
    );
  }

  const rows = places.data?.favourites ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Saved' }} />
      <View style={styles.screen}>
        {places.isLoading && <ActivityIndicator style={styles.spinner} color={theme.accent} />}
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={places.isRefetching} onRefresh={places.refetch} />
          }
          ListEmptyComponent={
            places.isLoading ? null : (
              <View style={styles.centre}>
                <Text style={styles.emptyTitle}>Nothing saved yet</Text>
                <Text style={styles.empty}>
                  Tap the heart on a place to keep it here. Saving holds nothing —
                  it is just somewhere to put the ones you liked.
                </Text>
                <Pressable style={styles.cta} onPress={() => router.push('/')}>
                  <Text style={styles.ctaText}>Find a place</Text>
                </Pressable>
              </View>
            )
          }
          renderItem={({ item }: { item: SavedPlace }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/shop/${item.id}`)}>
              <View style={styles.rowTop}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.business.name ?? item.name}
                </Text>
                <SaveButton saved onPress={() => saved.toggle(item.id, true, '/saved')} />
              </View>

              <Text style={styles.place} numberOfLines={1}>
                {item.district ? `${item.district.name} · ` : ''}
                {item.address}
              </Text>

              <View style={styles.meta}>
                {item.ratingCount > 0 && (
                  <Text style={styles.rating}>
                    ★ {item.ratingAvg?.toFixed(1)}{' '}
                    <Text style={styles.place}>({item.ratingCount})</Text>
                  </Text>
                )}
                {item.fromPriceMinor !== null && (
                  <Text style={styles.price}>from {money.format(item.fromPriceMinor)}</Text>
                )}
              </View>

              {/* Kept in the list rather than hidden, and marked. A customer
                  whose barber vanished would decide the app lost it; this says
                  what happened, and it comes back on its own. */}
              {!item.bookable && (
                <Text style={styles.closed}>
                  Not taking bookings right now. It stays here until it does.
                </Text>
              )}
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
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { flex: 1, fontSize: 16, fontWeight: '700', color: theme.ink },
  place: { color: theme.muted, fontSize: 13 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  rating: { color: '#f0a202', fontWeight: '600', fontSize: 13 },
  price: { color: theme.ink, fontWeight: '600', fontSize: 13 },
  closed: { color: theme.warn, fontSize: 13, marginTop: 4 },
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
