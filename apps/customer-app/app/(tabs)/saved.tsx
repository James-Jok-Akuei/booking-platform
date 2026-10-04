import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listFavourites, type SavedPlace } from '../../src/api/discovery';
import { useSignedIn } from '../../src/api/client';
import { useSaved } from '../../src/useSaved';
import { PlaceCard } from '../../src/components/PlaceCard';
import { useMoney } from '../../src/money';
import { TAB_BAR_CLEARANCE, theme } from '../../src/theme';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { useLayout } from '../../src/ui/layout';
import { PlaceCardSkeleton } from '../../src/ui/Skeleton';
import { BigTitle } from '../../src/ui/TopBar';

/**
 * Places kept to come back to (§120).
 *
 * Not a cart, and the screen says so by what it does not have: no total, no
 * checkout, no quantity. Saving reserves nothing — a slot is held by booking it,
 * and a basket that held slots would take them from somebody ready to book.
 *
 * The same card the search list uses (§133), so a place looks like itself
 * wherever it turns up.
 */
export default function Saved() {
  const router = useRouter();
  const money = useMoney();
  const saved = useSaved();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const signedIn = useSignedIn();

  const places = useQuery({
    queryKey: ['favourites'],
    queryFn: listFavourites,
    enabled: signedIn,
  });

  if (!signedIn) {
    return (
      <View style={styles.screen}>
        <BigTitle title="Saved" />
        <EmptyState
          icon="heart-outline"
          title="Sign in to keep a list"
          text="Places you save are kept with your account, so they follow you to any phone."
          action="Sign in"
          onAction={() => router.push('/sign-in?next=/saved')}
        />
      </View>
    );
  }

  const rows = places.data?.favourites ?? [];

  return (
    <View style={styles.screen}>
      <BigTitle title="Saved" />
      <FlatList
        key={layout.columns}
        numColumns={layout.columns}
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
        columnWrapperStyle={layout.columns > 1 ? styles.columns : undefined}
        refreshControl={
          <RefreshControl
            refreshing={places.isRefetching}
            onRefresh={places.refetch}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        ListEmptyComponent={
          places.isLoading ? (
            <View style={styles.skeletons}>
              <PlaceCardSkeleton />
              <PlaceCardSkeleton />
            </View>
          ) : (
            <EmptyState
              icon="heart-outline"
              title="Nothing saved yet"
              text="Tap the heart on a place to keep it here. Saving holds nothing — it is just somewhere to put the ones you liked."
              action="Find a place"
              onAction={() => router.push('/')}
            />
          )
        }
        renderItem={({ item, index }: { item: SavedPlace; index: number }) => (
          <FadeIn index={index}>
            <PlaceCard
              name={item.business.name ?? item.name}
              where={`${item.district ? `${item.district.name} · ` : ''}${item.address}`}
              coverUrl={item.business.coverImageUrl}
              logoUrl={item.business.logoUrl}
              ratingAvg={item.ratingAvg}
              ratingCount={item.ratingCount}
              price={
                item.fromPriceMinor !== null ? `from ${money.format(item.fromPriceMinor)}` : null
              }
              // Kept in the list rather than hidden, and marked. A customer
              // whose barber vanished would decide the app lost it; this says
              // what happened, and it comes back on its own.
              note={
                item.bookable
                  ? null
                  : 'Not taking bookings right now. It stays here until it does.'
              }
              saved
              onSave={() => saved.toggle(item.id, true, '/saved')}
              onPress={() => router.push(`/shop/${item.id}`)}
              width={layout.columns > 1 ? layout.cardWidth : undefined}
            />
          </FadeIn>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  list: { paddingTop: 6, gap: 16, alignSelf: 'center' },
  columns: { gap: 14 },
  skeletons: { gap: 16 },
});
