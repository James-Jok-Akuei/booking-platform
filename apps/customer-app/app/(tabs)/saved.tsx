import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  listFavourites,
  listSavedServices,
  type SavedPlace,
  type SavedService,
} from '../../src/api/discovery';
import { useSignedIn } from '../../src/api/client';
import { useSaved } from '../../src/useSaved';
import { useSavedService } from '../../src/useSavedService';
import { PlaceCard } from '../../src/components/PlaceCard';
import { SavedServiceCard } from '../../src/components/SavedServiceCard';
import { useMoney } from '../../src/money';
import { radius, TAB_BAR_CLEARANCE, theme, type } from '../../src/theme';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { Icon } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { Segmented } from '../../src/ui/Segmented';
import { PlaceCardSkeleton } from '../../src/ui/Skeleton';
import { BigTitle } from '../../src/ui/TopBar';

type Kind = 'places' | 'services';

/**
 * Places and services kept to come back to (§120, §158).
 *
 * Not a cart, and the screen says so by what it does not have: no total, no
 * checkout, no quantity. Saving reserves nothing — a slot is held by booking it,
 * and a basket that held slots would take them from somebody ready to book.
 *
 * Two lists under one heading, switched rather than mixed: a saved shop and a
 * saved haircut are different kinds of thing, and a list that interleaved them
 * would read as neither.
 */
export default function Saved() {
  const router = useRouter();
  const money = useMoney();
  const saved = useSaved();
  const savedService = useSavedService();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const signedIn = useSignedIn();
  const [kind, setKind] = useState<Kind>('places');

  const places = useQuery({
    queryKey: ['favourites'],
    queryFn: listFavourites,
    enabled: signedIn,
  });
  const services = useQuery({
    queryKey: ['saved-services'],
    queryFn: listSavedServices,
    enabled: signedIn,
  });

  if (!signedIn) {
    return (
      <View style={styles.screen}>
        <BigTitle title="Saved" />
        <EmptyState
          icon="heart-outline"
          title="Sign in to keep a list"
          text="Places and services you save are kept with your account, so they follow you to any phone."
          action="Sign in"
          onAction={() => router.push('/sign-in?next=/saved')}
        />
      </View>
    );
  }

  const placeRows = places.data?.favourites ?? [];
  const serviceRows = services.data?.services ?? [];
  const active = kind === 'places' ? places : services;
  const removed = services.data?.removed ?? 0;

  const count = (n: number | undefined) => (n === undefined ? '' : ` · ${n}`);

  const header = (
    <View style={styles.header}>
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: 'places', label: `Places${count(places.data?.total)}` },
          { value: 'services', label: `Services${count(services.data?.total)}` },
        ]}
      />
      {/* Said once, on the read that found them gone (§158): a list that is
          shorter than it was should say why. */}
      {kind === 'services' && removed > 0 && (
        <FadeIn style={styles.removed}>
          <Icon name="information-circle-outline" size={16} color={theme.ink2} />
          <Text style={[type.small, styles.flex]}>
            {removed === 1
              ? 'One saved service is no longer offered and was taken off your list.'
              : `${removed} saved services are no longer offered and were taken off your list.`}
          </Text>
        </FadeIn>
      )}
    </View>
  );

  const empty = active.isLoading ? (
    <View style={styles.skeletons}>
      <PlaceCardSkeleton />
      <PlaceCardSkeleton />
    </View>
  ) : kind === 'places' ? (
    <EmptyState
      icon="heart-outline"
      title="No places saved yet"
      text="Tap the heart on a place to keep it here. Saving holds nothing — it is just somewhere to put the ones you liked."
      action="Find a place"
      onAction={() => router.push('/')}
    />
  ) : (
    <EmptyState
      icon="heart-outline"
      title="No services saved yet"
      text="Tap the heart on any service — on Home or on a shop's page — and it will wait for you here."
      action="Browse services"
      onAction={() => router.push('/')}
    />
  );

  const listProps = {
    key: `${kind}-${layout.columns}`,
    numColumns: layout.columns,
    showsVerticalScrollIndicator: false,
    contentContainerStyle: [
      styles.list,
      {
        paddingBottom: TAB_BAR_CLEARANCE + insets.bottom,
        width: layout.contentWidth,
        paddingHorizontal: layout.gutter,
      },
    ],
    columnWrapperStyle: layout.columns > 1 ? styles.columns : undefined,
    refreshControl: (
      <RefreshControl
        refreshing={active.isRefetching}
        onRefresh={() => active.refetch()}
        tintColor={theme.accent}
        colors={[theme.accent]}
      />
    ),
    ListHeaderComponent: header,
    ListEmptyComponent: empty,
  };

  return (
    <View style={styles.screen}>
      <BigTitle title="Saved" />
      {kind === 'places' ? (
        <FlatList
          {...listProps}
          data={placeRows}
          keyExtractor={(item) => item.id}
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
      ) : (
        <FlatList
          {...listProps}
          data={serviceRows}
          keyExtractor={(item) => `${item.id}:${item.location.id}`}
          renderItem={({ item, index }: { item: SavedService; index: number }) => (
            <FadeIn index={index}>
              <SavedServiceCard
                service={item}
                price={money.format(item.priceMinor, item.currency)}
                width={layout.columns > 1 ? layout.cardWidth : undefined}
                onPress={() => router.push(`/book/${item.location.id}?serviceId=${item.id}`)}
                onShop={() => router.push(`/shop/${item.location.id}`)}
                onSave={() => savedService.toggle(item.id, item.location.id, true, '/saved')}
              />
            </FadeIn>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  header: { gap: 12, paddingTop: 2, paddingBottom: 4 },
  removed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.panel,
    borderRadius: radius.md,
    padding: 12,
  },
  list: { paddingTop: 6, gap: 16, alignSelf: 'center' },
  columns: { gap: 14 },
  skeletons: { gap: 16 },
});
