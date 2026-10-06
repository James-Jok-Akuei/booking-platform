import { useEffect, useState } from 'react';
import {
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
  discoverServices,
  listCategories,
  listProvinces,
  type Category,
  type Province,
  type DiscoveredService,
  type DiscoverySort,
} from '../../src/api/discovery';
import { useMoney } from '../../src/money';
import { useNearMe } from '../../src/useNearMe';
import { useUnread } from '../../src/useUnread';
import { PlaceBubble } from '../../src/components/PlaceBubble';
import { ServiceCard } from '../../src/components/ServiceCard';
import { font, radius, shadow, TAB_BAR_CLEARANCE, theme, type } from '../../src/theme';
import { Chip } from '../../src/ui/Chip';
import { CountBadge } from '../../src/ui/CountBadge';
import { IconButton } from '../../src/ui/IconButton';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { Icon, lookFor } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { PressableScale } from '../../src/ui/PressableScale';
import { RwandaFlag } from '../../src/ui/RwandaFlag';
import { Sheet } from '../../src/ui/Sheet';
import { Skeleton } from '../../src/ui/Skeleton';

/** "City of Kigali" is what the state calls it; "Kigali" is what people say. */
const shortName = (name: string) =>
  name.replace(/^City of /, '').replace(/ Province$/, '');

const SORTS: Array<{ value: DiscoverySort; label: string }> = [
  { value: 'rating', label: 'Best rated' },
  { value: 'price', label: 'Cheapest' },
  { value: 'newest', label: 'Newest' },
];

/**
 * What the first shelf is called. It is the whole catalogue in the chosen
 * order, so its name is the order — "Most popular" over a list sorted by price
 * would be a lie told in a heading.
 */
const SHELF_TITLE: Record<DiscoverySort, string> = {
  popular: 'Most popular',
  rating: 'Best rated',
  price: 'Cheapest',
  newest: 'Newest',
  distance: 'Nearest',
};

/** How many cards a shelf holds before "more" is the category itself. */
const SHELF_SIZE = 10;

/**
 * Browse and search.
 *
 * Anonymous: someone should be able to look before they have an account. The
 * endpoint allows it, and asking for a sign-in to see a shop would lose most
 * people before they ever saw a price.
 *
 * Laid out top to bottom in the order a person narrows things down (§133):
 * WHERE, then WHAT by name, then what KIND, then in what ORDER.
 *
 * Below that, the screen is a shop window rather than a list (§135). The shops
 * are one row of circles, most popular first — who is here, in the height of
 * one line. The room the tall place cards used to take goes to the SERVICES,
 * in small cards on shelves that scroll sideways: the thing a person actually
 * came to buy, with its price, three shelves to a screen.
 *
 * With nothing narrowed, the shelves are the whole catalogue and then one per
 * category. Once someone searches or picks a category they have said what they
 * want, so the shelves give way to a grid of exactly that.
 */
export default function Discover() {
  const money = useMoney();
  const router = useRouter();
  const nearMe = useNearMe();
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
  const [sort, setSort] = useState<DiscoverySort>('popular');
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

  /**
   * What the place pill reads: the narrowest thing chosen, or the country.
   *
   * "Rwanda", with its flag, rather than "Anywhere" (§147): the pill is the
   * first thing on the first screen, and it is where the app says where it
   * operates — the way a shop puts its city on the sign. The flag stays when a
   * district is chosen, so "Gasabo" is still visibly Gasabo, Rwanda.
   */
  const placeLabel =
    (districtId &&
      provinces.data?.flatMap((p) => p.districts).find((d) => d.id === districtId)?.name) ||
    (chosenProvince && shortName(chosenProvince.name)) ||
    'Rwanda';

  // Sent ONLY for a distance sort, and never with a radius: the position
  // orders the list, it does not narrow it (§107).
  const position = nearMe.state.status === 'on' ? nearMe.state : null;
  const sortingByDistance = sort === 'distance' && position !== null;

  /**
   * ONE set of filters for both lists. The circles and the shelves are two
   * views of the same search, so a shop can never be in one and missing from
   * the other.
   *
   * Popular is the order until someone asks for another; the sort chips are
   * switches, and switching one off comes back here.
   */
  const filters = {
    limit: 50,
    // Falls back to popular when there is no position — asking the server
    // to sort by distance without one is a 400, and a refused request is
    // not what declining a permission should produce.
    sort: sortingByDistance ? 'distance' : sort === 'distance' ? 'popular' : sort,
    // The position goes with EVERY search once it is known (§139), so each
    // card can say how far away it is. Still never with a radius: it measures
    // and orders, it does not hide anything (§107).
    ...(position ? { lat: position.lat, lng: position.lng } : {}),
    ...(query.trim() ? { q: query.trim() } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(subcategoryId ? { subcategoryId } : {}),
    ...(openNow ? { openNow: true } : {}),
    ...(districtId ? { districtId } : provinceId ? { provinceId } : {}),
  } satisfies Parameters<typeof discoverLocations>[0];

  const filterKey = [
    query,
    categoryId,
    subcategoryId,
    sort,
    openNow,
    provinceId,
    districtId,
    position?.lat,
    position?.lng,
  ];

  const results = useQuery({
    queryKey: ['discover', ...filterKey],
    queryFn: () => discoverLocations(filters),
  });

  const services = useQuery({
    queryKey: ['discover-services', ...filterKey],
    queryFn: () => discoverServices(filters),
  });

  /**
   * One circle per BUSINESS, not per branch (§135.6). The search returns
   * branches, so a business with three of them was three identical circles in
   * a row that is meant for telling businesses apart.
   *
   * The first branch seen is the one kept, and the list arrives in the chosen
   * order — so the circle opens the business's most popular branch, or its
   * nearest one when sorting by distance.
   */
  const branches = results.data?.locations ?? [];
  /**
   * "Near you": the closest services, as a shelf of its own (§139). Asked for
   * separately, in distance order, because the nearest ten are not necessarily
   * among the fifty most popular. Only once a position is known, and not when
   * the whole screen is already in distance order — it would be the first
   * shelf twice.
   */
  const nearby = useQuery({
    queryKey: ['discover-services-near', ...filterKey],
    queryFn: () => discoverServices({ ...filters, sort: 'distance', limit: SHELF_SIZE }),
    enabled: position !== null && !sortingByDistance,
  });
  const nearOffers = (nearby.data?.services ?? []).filter(
    (o) => o.location.distanceKm !== undefined && o.location.distanceKm !== null,
  );

  const shops = branches.filter(
    (branch, index) => branches.findIndex((b) => b.business.id === branch.business.id) === index,
  );
  // Only a true count is shown: with more branches on the server than on this
  // page, the number of businesses is not known, and a guess is worse than
  // no number.
  const shopCount =
    results.data && results.data.total <= branches.length ? shops.length : undefined;
  const offers = services.data?.services ?? [];

  /** Nothing narrowed by word or by kind: show the shop window, not a list. */
  const browsing = !query.trim() && !categoryId && !subcategoryId;

  /**
   * One shelf per category, in the order the categories are listed everywhere
   * else. Built from the page already fetched — the cards arrive in the chosen
   * order, and filtering keeps it, so each shelf is that category's own
   * "most popular first" without another request.
   *
   * A category with a single service gets no shelf: one card under a heading
   * is a row of empty space, and that card is already on the shelf above.
   */
  const shelves = browsing
    ? (categories.data ?? [])
        .map((category) => ({
          category,
          items: offers.filter((o) => o.business.category?.id === category.id),
        }))
        .filter((shelf) => shelf.items.length > 1)
    : [];

  /**
   * Two and a half cards across a phone. The half is deliberate: a card cut
   * off by the edge is the clearest "this scrolls" there is, and it needs no
   * arrow. Capped so a tablet shows more cards rather than bigger ones.
   */
  const inner = layout.contentWidth - layout.gutter * 2;
  const shelfCard = Math.max(124, Math.min(168, Math.round((inner - 20) / 2.45)));
  const gridColumns = inner >= 640 ? 4 : inner >= 440 ? 3 : 2;
  const gridCard = Math.floor((inner - 10 * (gridColumns - 1)) / gridColumns);

  /**
   * What makes a card unique is the service AT a branch, not the service: the
   * same "Haircut" is sold at two branches and is two cards. Keyed on the
   * service alone, React was handed two children with one key in every shelf
   * that held both, said so on every render, and could have dropped or doubled
   * one of them.
   */
  const offerKey = (service: DiscoveredService) => `${service.id}:${service.location.id}`;

  const openService = (service: DiscoveredService) =>
    router.push(`/book/${service.location.id}?serviceId=${service.id}`);

  const refreshing = results.isRefetching || services.isRefetching;
  const failed = results.isError && services.isError;
  const settled = results.isSuccess && services.isSuccess;

  /** Rows that run to the screen's edge and start at the gutter. */
  const bleed = { marginHorizontal: -layout.gutter, flexGrow: 0 };
  const bleedPad = { paddingHorizontal: layout.gutter };

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
          <RwandaFlag width={20} />
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
            style={bleed}
            contentContainerStyle={[styles.tiles, bleedPad]}
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
          style={bleed}
          contentContainerStyle={[styles.chips, bleedPad]}
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
                // Only the ORDER goes back. The position stays, because the
                // distances on the cards are still wanted (§139).
                setSort('popular');
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
              // A switch: off again is back to most popular.
              onPress={() => setSort((was) => (was === option.value ? 'popular' : option.value))}
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

    </View>
  );

  return (
    <View style={styles.screen}>
      <ScrollView
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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              results.refetch();
              services.refetch();
            }}
            tintColor={theme.accent}
            colors={[theme.accent]}
            progressViewOffset={insets.top}
          />
        }
      >
        {header}

        {/* WHO IS HERE. One line tall, most popular first. */}
        {results.isLoading && (
          <View>
            <SectionHead title="Places" />
            <View style={styles.bubbles}>
              {[0, 1, 2, 3, 4].map((n) => (
                <View key={n} style={styles.bubbleGhost}>
                  <Skeleton width={74} height={74} round={37} />
                  <Skeleton width={56} height={10} />
                </View>
              ))}
            </View>
          </View>
        )}

        {shops.length > 0 && (
          <FadeIn>
            <SectionHead
              title="Places"
              note={
                shopCount === undefined
                  ? undefined
                  : `${shopCount} ${shopCount === 1 ? 'place' : 'places'}`
              }
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={bleed}
              contentContainerStyle={[styles.bubbles, bleedPad]}
            >
              {shops.map((shop) => (
                <PlaceBubble
                  key={shop.id}
                  place={shop}
                  onPress={() => router.push(`/shop/${shop.id}`)}
                />
              ))}
            </ScrollView>
          </FadeIn>
        )}

        {/* WHAT YOU CAN BOOK. */}
        {services.isLoading && (
          <View>
            <SectionHead title={SHELF_TITLE[filters.sort]} />
            <View style={styles.shelf}>
              {[0, 1, 2].map((n) => (
                <View key={n} style={[styles.cardGhost, { width: shelfCard }]}>
                  <Skeleton height={Math.round(shelfCard * 0.72)} round={radius.md} />
                  <Skeleton width="85%" height={12} />
                  <Skeleton width="55%" height={10} />
                </View>
              ))}
            </View>
          </View>
        )}

        {browsing && offers.length > 0 && (
          <FadeIn delay={60}>
            <SectionHead title={SHELF_TITLE[filters.sort]} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={bleed}
              contentContainerStyle={[styles.shelf, bleedPad]}
            >
              {offers.slice(0, SHELF_SIZE).map((service) => (
                <ServiceCard
                  key={offerKey(service)}
                  service={service}
                  price={money.format(service.priceMinor)}
                  width={shelfCard}
                  onPress={() => openService(service)}
                />
              ))}
            </ScrollView>
          </FadeIn>
        )}

        {browsing && position !== null && !sortingByDistance && nearOffers.length > 0 && (
          <FadeIn delay={90}>
            <SectionHead title="Near you" />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={bleed}
              contentContainerStyle={[styles.shelf, bleedPad]}
            >
              {nearOffers.map((service) => (
                <ServiceCard
                  key={offerKey(service)}
                  service={service}
                  price={money.format(service.priceMinor)}
                  width={shelfCard}
                  onPress={() => openService(service)}
                />
              ))}
            </ScrollView>
          </FadeIn>
        )}

        {/* The invitation, for someone who has never been asked. One quiet
            row, and tapping it is what raises the phone's own question — so
            the permission is still asked for at the moment it explains
            itself (§107.3). Gone for good once answered either way. */}
        {browsing && nearMe.state.status === 'off' && offers.length > 0 && (
          <PressableScale
            onPress={() => nearMe.enable()}
            haptic
            accessibilityRole="button"
            style={styles.nearInvite}
          >
            <View style={styles.nearIcon}>
              <Icon name="navigate" size={18} color={theme.accent} />
            </View>
            <View style={styles.nearText}>
              <Text style={type.subheading}>See what is near you</Text>
              <Text style={type.small}>Shows how far each place is. Nothing is hidden.</Text>
            </View>
            <Icon name="chevron-forward" size={16} color={theme.muted} />
          </PressableScale>
        )}

        {shelves.map((shelf, index) => (
          <FadeIn key={shelf.category.id} delay={120 + index * 50}>
            <SectionHead
              title={shelf.category.name}
              icon={shelf.category.icon}
              // The same thing the category tile above does — a shortcut to
              // it from where the eye already is, not a new place to go.
              action="See all"
              onAction={() => pickCategory(shelf.category.id)}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={bleed}
              contentContainerStyle={[styles.shelf, bleedPad]}
            >
              {shelf.items.slice(0, SHELF_SIZE).map((service) => (
                <ServiceCard
                  key={offerKey(service)}
                  service={service}
                  price={money.format(service.priceMinor)}
                  width={shelfCard}
                  onPress={() => openService(service)}
                />
              ))}
            </ScrollView>
          </FadeIn>
        ))}

        {!browsing && offers.length > 0 && (
          <FadeIn delay={60}>
            <SectionHead
              title="Services"
              note={`${services.data?.total} ${services.data?.total === 1 ? 'service' : 'services'}`}
            />
            <View style={styles.grid}>
              {offers.map((service) => (
                <ServiceCard
                  key={offerKey(service)}
                  service={service}
                  price={money.format(service.priceMinor)}
                  width={gridCard}
                  onPress={() => openService(service)}
                />
              ))}
            </View>
          </FadeIn>
        )}

        {failed ? (
          <EmptyState
            icon="cloud-offline-outline"
            title="Could not reach the server."
            text="Pull down to try again."
          />
        ) : settled && shops.length === 0 && offers.length === 0 ? (
          <EmptyState
            icon="search"
            title="Nothing matches that yet."
            text="Try a different word, or clear the filters."
          />
        ) : null}
      </ScrollView>

      <Sheet open={placeSheet} title="Where in Rwanda" onClose={() => setPlaceSheet(false)}>
        <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
          <View style={styles.wrapRow}>
            <Chip
              label="All of Rwanda"
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

/**
 * The line above a row: what it is, and at most one quiet thing on the right.
 */
function SectionHead({
  title,
  icon,
  note,
  action,
  onAction,
}: {
  title: string;
  /** A category's `icon` word: a small disc in its colour before the title. */
  icon?: string | null;
  note?: string;
  action?: string;
  onAction?: () => void;
}) {
  const look = icon !== undefined ? lookFor(icon) : null;
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionTitle}>
        {look && (
          <View style={[styles.sectionDisc, { backgroundColor: look.tint }]}>
            <Icon name={look.icon} size={13} color={look.ink} />
          </View>
        )}
        <Text style={[type.heading, styles.sectionText]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {note !== undefined && <Text style={type.label}>{note}</Text>}
      {action !== undefined && (
        <PressableScale onPress={onAction} hitSlop={10} haptic accessibilityRole="button">
          <Text style={styles.link}>{action} →</Text>
        </PressableScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  listOuter: { flex: 1 },
  list: { gap: 22, alignSelf: 'center' },
  header: { gap: 16 },
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
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  sectionTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionDisc: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionText: { flexShrink: 1 },
  link: { fontFamily: font.bold, fontSize: 13, color: theme.accent },
  tiles: { gap: 14 },
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
  chips: { gap: 8 },
  notice: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: theme.warnSoft,
    borderRadius: radius.md,
    padding: 12,
  },
  noticeText: { flex: 1, fontFamily: font.medium, fontSize: 13, lineHeight: 18.5, color: theme.ink2 },
  // Padded top and bottom so the cards' shadows are not cut by the scroller.
  bubbles: { flexDirection: 'row', gap: 10, paddingTop: 2, paddingBottom: 6 },
  bubbleGhost: { width: 76, alignItems: 'center', gap: 8 },
  shelf: { flexDirection: 'row', gap: 10, paddingTop: 2, paddingBottom: 10 },
  cardGhost: {
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 6,
    paddingBottom: 14,
    gap: 9,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  nearInvite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 14,
    ...shadow.card,
  },
  nearIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearText: { flex: 1, gap: 1 },
  sheetBody: { gap: 18, paddingBottom: 8 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
