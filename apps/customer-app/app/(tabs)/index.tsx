import { useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  discoverLocations,
  listCategories,
  listProvinces,
  type Category,
  type Province,
  type DiscoveredLocation,
  type DiscoverySort,
} from '../../src/api/discovery';
import { useMoney } from '../../src/money';
import { useNearMe } from '../../src/useNearMe';
import { useSaved } from '../../src/useSaved';
import { useUnread } from '../../src/useUnread';
import { PlaceCard } from '../../src/components/PlaceCard';
import { font, radius, shadow, TAB_BAR_CLEARANCE, theme, type } from '../../src/theme';
import { Chip } from '../../src/ui/Chip';
import { CountBadge } from '../../src/ui/CountBadge';
import { IconButton } from '../../src/ui/IconButton';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { Icon, lookFor } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { PressableScale } from '../../src/ui/PressableScale';
import { Sheet } from '../../src/ui/Sheet';
import { PlaceCardSkeleton } from '../../src/ui/Skeleton';

/** "City of Kigali" is what the state calls it; "Kigali" is what people say. */
const shortName = (name: string) =>
  name.replace(/^City of /, '').replace(/ Province$/, '');

const SORTS: Array<{ value: DiscoverySort; label: string }> = [
  { value: 'rating', label: 'Best rated' },
  { value: 'price', label: 'Cheapest' },
  { value: 'newest', label: 'Newest' },
];

/** Under a kilometre reads as "600 m" — nobody says "0.6 km". */
const distanceLabel = (km: number | null | undefined) =>
  km === undefined || km === null
    ? null
    : km < 1
      ? `${Math.round(km * 1000)} m away`
      : `${km.toFixed(1)} km away`;

/**
 * Browse and search.
 *
 * Anonymous: someone should be able to look before they have an account. The
 * endpoint allows it, and asking for a sign-in to see a shop would lose most
 * people before they ever saw a price.
 *
 * Laid out top to bottom in the order a person narrows things down (§133):
 * WHERE, then WHAT by name, then what KIND, then in what ORDER — and then the
 * places themselves, each leading with its picture. Everything above the list
 * scrolls away with it, so the controls never cost the list its room.
 */
export default function Discover() {
  const money = useMoney();
  const router = useRouter();
  const nearMe = useNearMe();
  const saved = useSaved();
  const unread = useUnread();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const [query, setQuery] = useState('');
  const [placeSheet, setPlaceSheet] = useState(false);
  /**
   * Seeded from the route, so the browse-by-category screen can hand one over
   * (§121).
   */
  const params = useLocalSearchParams<{ categoryId?: string; subcategoryId?: string }>();
  const [categoryId, setCategoryId] = useState<string | null>(params.categoryId ?? null);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(
    params.subcategoryId ?? null,
  );
  const [sort, setSort] = useState<DiscoverySort>('rating');
  const [openNow, setOpenNow] = useState(false);
  const [provinceId, setProvinceId] = useState<string | null>(null);
  const [districtId, setDistrictId] = useState<string | null>(null);

  /**
   * As a tab, this screen is mounted ONCE and stays mounted (§133). When it was
   * a stack screen, arriving from the category list made a fresh copy and the
   * `useState` initialisers above picked the category up. Now the same copy is
   * simply shown again with new params, so they have to be followed — otherwise
   * tapping a category on that screen would bring you back here unfiltered.
   *
   * Keyed on the params alone, so choosing a chip here afterwards is not undone.
   */
  useEffect(() => {
    if (params.categoryId === undefined && params.subcategoryId === undefined) return;
    setCategoryId(params.categoryId ?? null);
    setSubcategoryId(params.subcategoryId ?? null);
  }, [params.categoryId, params.subcategoryId]);

  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories });
  const provinces = useQuery({
    queryKey: ['provinces'],
    queryFn: listProvinces,
    staleTime: Infinity,
  });

  /**
   * The places the platform is actually open in, as a customer names them.
   *
   * A CITY is one chip — Kigali, not Gasabo and Kicukiro and Nyarugenge, which
   * are parts of it rather than alternatives to it. Its districts stay
   * available as a second row for anyone who wants to narrow.
   *
   * Everywhere else, the DISTRICT is the chip: Musanze and Rubavu are towns
   * hours apart, and nobody looking for either would think to tap "Western
   * Province" (§106).
   */
  type Place = {
    kind: 'city' | 'district';
    id: string;
    label: string;
    province: Province;
  };

  const places: Place[] = (provinces.data ?? []).flatMap((province): Place[] =>
    province.isCity
      ? [
          {
            kind: 'city',
            id: province.id,
            label: shortName(province.name),
            province,
          },
        ]
      : province.districts.map(
          (district) =>
            ({
              kind: 'district',
              id: district.id,
              label: district.name,
              province,
            }),
        ),
  );

  const chosenProvince = provinces.data?.find((p) => p.id === provinceId);

  /** What the place pill reads: the narrowest thing chosen, or "Anywhere". */
  const placeLabel =
    (districtId &&
      provinces.data?.flatMap((p) => p.districts).find((d) => d.id === districtId)?.name) ||
    (chosenProvince && shortName(chosenProvince.name)) ||
    'Anywhere';

  // Sent ONLY for a distance sort, and never with a radius: the position
  // orders the list, it does not narrow it (§107).
  const position = nearMe.state.status === 'on' ? nearMe.state : null;
  const sortingByDistance = sort === 'distance' && position !== null;

  const results = useQuery({
    queryKey: [
      'discover',
      query,
      categoryId,
      subcategoryId,
      sort,
      openNow,
      provinceId,
      districtId,
      position?.lat,
      position?.lng,
    ],
    queryFn: () =>
      discoverLocations({
        limit: 50,
        // Falls back to rating when there is no position — asking the server
        // to sort by distance without one is a 400, and a refused request is
        // not what declining a permission should produce.
        sort: sortingByDistance ? 'distance' : sort === 'distance' ? 'rating' : sort,
        ...(sortingByDistance ? { lat: position.lat, lng: position.lng } : {}),
        ...(query.trim() ? { q: query.trim() } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(subcategoryId ? { subcategoryId } : {}),
        ...(openNow ? { openNow: true } : {}),
        ...(districtId ? { districtId } : provinceId ? { provinceId } : {}),
      }),
  });

  const pickCategory = (id: string | null) => {
    setCategoryId((was) => (id === null || was === id ? null : id));
    // Changing the category leaves any narrower choice behind:
    // "Beauty + Auto Electrical" matches nothing by construction.
    setSubcategoryId(null);
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      {/* WHERE. Nothing here is applied automatically: "Anywhere" is the
          default and stays until someone picks a place — a customer in Gasabo
          sees every listing until they say otherwise (§106.2). */}
      <FadeIn>
        <View style={styles.topRow}>
        <PressableScale
          onPress={() => setPlaceSheet(true)}
          haptic
          scaleTo={0.95}
          accessibilityRole="button"
          accessibilityLabel={`Place: ${placeLabel}`}
          style={styles.placePill}
        >
          <Icon name="location" size={15} color={theme.accent} />
          <Text style={styles.placeText}>{placeLabel}</Text>
          <Icon name="chevron-down" size={14} color={theme.ink2} />
        </PressableScale>

          {/* The bell (§134). Shown to everyone: signed out, the screen behind
              it says that signing in is what fills it — the same invitation
              the Bookings tab makes. */}
          <View>
            <IconButton
              icon="notifications-outline"
              label={
                unread.notifications > 0
                  ? `Notifications, ${unread.notifications} unread`
                  : 'Notifications'
              }
              onPress={() => router.push('/notifications')}
            />
            <CountBadge count={unread.notifications} ring={theme.bg} style={styles.bellBadge} />
          </View>
        </View>

        <Text style={[type.display, layout.compact && styles.displayCompact, styles.title]}>
          Find a place
        </Text>
      </FadeIn>

      <FadeIn delay={60} style={styles.search}>
        <Icon name="search" size={19} color={theme.muted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search a shop or a service"
          placeholderTextColor={theme.muted}
          returnKeyType="search"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <PressableScale
            onPress={() => setQuery('')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear the search"
            style={styles.clear}
          >
            <Icon name="close" size={14} color={theme.ink2} />
          </PressableScale>
        )}
      </FadeIn>

      {(categories.data?.length ?? 0) > 0 && (
        <FadeIn delay={120}>
          <View style={styles.sectionHead}>
            <Text style={type.heading}>Categories</Text>
            {/* The tiles scroll sideways and show about four of eight. Someone
                who does not already know what they want needs to SEE the list
                (§121). */}
            <PressableScale onPress={() => router.push('/categories')} hitSlop={8}>
              <Text style={styles.link}>Browse all categories →</Text>
            </PressableScale>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.bleed}
            contentContainerStyle={styles.tiles}
          >
            <CategoryTile label="All" active={categoryId === null} onPress={() => pickCategory(null)} />
            {categories.data?.map((category) => (
              <CategoryTile
                key={category.id}
                label={category.name}
                category={category}
                active={categoryId === category.id}
                onPress={() => pickCategory(category.id)}
              />
            ))}
          </ScrollView>
        </FadeIn>
      )}

      <FadeIn delay={180}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.bleed}
          contentContainerStyle={styles.chips}
        >
          <Chip
            label="Open now"
            icon="time-outline"
            tone="accent"
            active={openNow}
            onPress={() => setOpenNow((was) => !was)}
          />
          {/* A SORT, deliberately sitting with the sorts. It reorders the list
              and removes nothing — tapping it never makes a shop disappear. */}
          <Chip
            label={nearMe.state.status === 'asking' ? 'Finding you…' : 'Nearest'}
            icon="navigate-outline"
            active={sort === 'distance' && nearMe.state.status === 'on'}
            onPress={async () => {
              if (sort === 'distance') {
                setSort('rating');
                nearMe.disable();
                return;
              }
              if (nearMe.state.status !== 'on') await nearMe.enable();
              setSort('distance');
            }}
          />
          {SORTS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              active={sort === option.value}
              onPress={() => setSort(option.value)}
            />
          ))}
        </ScrollView>
      </FadeIn>

      {(nearMe.state.status === 'denied' || nearMe.state.status === 'failed') && (
        <View style={styles.notice}>
          <Icon name="information-circle-outline" size={17} color={theme.warn} />
          <Text style={styles.noticeText}>
            {nearMe.state.status === 'denied'
              ? 'Without your location we cannot sort by nearest. Everything else still works.'
              : 'Could not get a position just now. Everything else still works.'}
          </Text>
        </View>
      )}

      {results.data && (
        <Text style={[type.label, styles.count]}>
          {results.data.total} {results.data.total === 1 ? 'place' : 'places'}
        </Text>
      )}

      {results.isLoading && (
        <View style={styles.skeletons}>
          <PlaceCardSkeleton />
          <PlaceCardSkeleton />
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        // Re-keyed when the column count changes: FlatList cannot change
        // `numColumns` on the fly, and a rotated tablet should re-flow.
        key={layout.columns}
        numColumns={layout.columns}
        data={results.data?.locations ?? []}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        style={styles.listOuter}
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
            refreshing={results.isRefetching}
            onRefresh={() => results.refetch()}
            tintColor={theme.accent}
            colors={[theme.accent]}
            progressViewOffset={insets.top}
          />
        }
        ListHeaderComponent={header}
        ListEmptyComponent={
          results.isError ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="Could not reach the server."
              text="Pull down to try again."
            />
          ) : results.isSuccess ? (
            <EmptyState
              icon="search"
              title="Nothing matches that yet."
              text="Try a different word, or clear the filters."
            />
          ) : null
        }
        renderItem={({ item, index }) => (
          <FadeIn index={index}>
            <LocationCard
              location={item}
              format={money.format}
              width={layout.columns > 1 ? layout.cardWidth : undefined}
              onPress={() => router.push(`/shop/${item.id}`)}
              onSave={() => saved.toggle(item.id, item.saved ?? false, '/')}
            />
          </FadeIn>
        )}
      />

      <Sheet open={placeSheet} title="Where" onClose={() => setPlaceSheet(false)}>
        <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
          <View style={styles.wrapRow}>
            <Chip
              label="Anywhere"
              tone="accent"
              active={provinceId === null && districtId === null}
              onPress={() => {
                setProvinceId(null);
                setDistrictId(null);
              }}
            />
            {places.map((place) => (
              <Chip
                key={place.id}
                label={place.label}
                tone="accent"
                active={
                  place.kind === 'city'
                    ? provinceId === place.province.id
                    : districtId === place.id
                }
                onPress={() => {
                  if (place.kind === 'city') {
                    const same = provinceId === place.province.id;
                    setProvinceId(same ? null : place.province.id);
                    setDistrictId(null);
                  } else {
                    const same = districtId === place.id;
                    setDistrictId(same ? null : place.id);
                    setProvinceId(null);
                  }
                }}
              />
            ))}
          </View>

          {chosenProvince?.isCity && chosenProvince.districts.length > 1 && (
            <View style={styles.wrapRow}>
              <Chip
                label={`All of ${shortName(chosenProvince.name)}`}
                active={districtId === null}
                onPress={() => setDistrictId(null)}
              />
              {chosenProvince.districts.map((district) => (
                <Chip
                  key={district.id}
                  label={district.name}
                  active={districtId === district.id}
                  onPress={() =>
                    setDistrictId((was) => (was === district.id ? null : district.id))
                  }
                />
              ))}
            </View>
          )}
        </ScrollView>
      </Sheet>
    </View>
  );
}

/**
 * One category, as a picture you can tap (§133).
 *
 * A tinted disc with the category's own icon and colour, and its name beneath.
 * The names are long — "Photography & Creative Services" — so they wrap to two
 * lines under a fixed-width tile instead of stretching a chip across the
 * screen, which is what made the old row show three of eight.
 */
function CategoryTile({
  label,
  category,
  active,
  onPress,
}: {
  label: string;
  category?: Category;
  active: boolean;
  onPress: () => void;
}) {
  const look = category ? lookFor(category.icon) : null;
  return (
    <PressableScale
      onPress={onPress}
      haptic
      scaleTo={0.93}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={styles.tile}
    >
      <View
        style={[
          styles.tileDisc,
          { backgroundColor: look ? look.tint : theme.panel },
          active && styles.tileDiscOn,
        ]}
      >
        <Icon
          name={look ? look.icon : 'apps'}
          size={24}
          color={active ? '#FFFFFF' : look ? look.ink : theme.ink}
        />
      </View>
      <Text style={[styles.tileLabel, active && styles.tileLabelOn]} numberOfLines={2}>
        {label}
      </Text>
    </PressableScale>
  );
}

function LocationCard({
  location,
  format,
  onPress,
  onSave,
  width,
}: {
  location: DiscoveredLocation;
  format: (minor: number | null | undefined) => string;
  onPress: () => void;
  onSave: () => void;
  width?: number;
}) {
  return (
    <PlaceCard
      name={location.business.name ?? location.name}
      // The district first: "Remera" places a shop for someone in Kigali in
      // a way a street name does not.
      where={`${location.district ? `${location.district.name} · ` : ''}${location.address}`}
      coverUrl={location.business.coverImageUrl}
      logoUrl={location.business.logoUrl}
      categoryIcon={location.business.category?.icon}
      tag={location.business.subcategory?.name}
      ratingAvg={location.ratingAvg}
      ratingCount={location.ratingCount}
      price={
        location.fromPriceMinor !== null ? `from ${format(location.fromPriceMinor)}` : null
      }
      distance={distanceLabel(location.distanceKm)}
      openNow={location.openNow}
      saved={location.saved}
      onSave={onSave}
      onPress={onPress}
      width={width}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  listOuter: { flex: 1 },
  list: { gap: 16, alignSelf: 'center' },
  columns: { gap: 14 },
  header: { gap: 16, paddingBottom: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bellBadge: { position: 'absolute', top: -4, right: -4 },
  placePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    backgroundColor: theme.panel,
    ...shadow.card,
  },
  placeText: { fontFamily: font.bold, fontSize: 13.5, color: theme.ink },
  title: { marginTop: 14 },
  displayCompact: { fontSize: 26, lineHeight: 32 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 54,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: theme.panel,
    ...shadow.card,
  },
  searchInput: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 15,
    color: theme.ink,
    paddingVertical: 0,
  },
  clear: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  link: { fontFamily: font.bold, fontSize: 13, color: theme.accent },
  // The rows run to the screen's edge and start at the gutter, so a half-seen
  // tile at the right says "there is more" without an arrow.
  bleed: { marginHorizontal: -20, flexGrow: 0 },
  tiles: { paddingHorizontal: 20, gap: 14 },
  tile: { width: 72, alignItems: 'center', gap: 7 },
  tileDisc: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileDiscOn: { backgroundColor: theme.accent, ...shadow.raised },
  tileLabel: {
    fontFamily: font.semibold,
    fontSize: 11.5,
    lineHeight: 14.5,
    color: theme.ink2,
    textAlign: 'center',
  },
  tileLabelOn: { color: theme.accent, fontFamily: font.bold },
  chips: { paddingHorizontal: 20, gap: 8 },
  notice: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: theme.warnSoft,
    borderRadius: radius.md,
    padding: 12,
  },
  noticeText: { flex: 1, fontFamily: font.medium, fontSize: 13, lineHeight: 18.5, color: theme.ink2 },
  count: { marginTop: 2 },
  skeletons: { gap: 16 },
  sheetBody: { gap: 18, paddingBottom: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
