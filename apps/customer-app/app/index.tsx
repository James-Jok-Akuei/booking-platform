import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  discoverLocations,
  listCategories,
  listProvinces,
  type Province,
  type DiscoveredLocation,
  type DiscoverySort,
} from '../src/api/discovery';
import { useMoney } from '../src/money';
import { useNearMe } from '../src/useNearMe';
import { useSaved } from '../src/useSaved';
import { SaveButton } from '../src/components/SaveButton';
import { theme } from '../src/theme';

/** "City of Kigali" is what the state calls it; "Kigali" is what people say. */
const shortName = (name: string) =>
  name.replace(/^City of /, '').replace(/ Province$/, '');

const SORTS: Array<{ value: DiscoverySort; label: string }> = [
  { value: 'rating', label: 'Best rated' },
  { value: 'price', label: 'Cheapest' },
  { value: 'newest', label: 'Newest' },
];

/**
 * Browse and search.
 *
 * Anonymous: someone should be able to look before they have an account. The
 * endpoint allows it, and asking for a sign-in to see a shop would lose most
 * people before they ever saw a price.
 */
export default function Discover() {
  const money = useMoney();
  const router = useRouter();
  const nearMe = useNearMe();
  const saved = useSaved();
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [sort, setSort] = useState<DiscoverySort>('rating');
  const [openNow, setOpenNow] = useState(false);
  const [provinceId, setProvinceId] = useState<string | null>(null);
  const [districtId, setDistrictId] = useState<string | null>(null);

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

  // Sent ONLY for a distance sort, and never with a radius: the position
  // orders the list, it does not narrow it (§107).
  const position = nearMe.state.status === 'on' ? nearMe.state : null;
  const sortingByDistance = sort === 'distance' && position !== null;

  const results = useQuery({
    queryKey: [
      'discover',
      query,
      categoryId,
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
        ...(openNow ? { openNow: true } : {}),
        ...(districtId ? { districtId } : provinceId ? { provinceId } : {}),
      }),
  });

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.controls}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search a shop or a service"
          placeholderTextColor={theme.muted}
          returnKeyType="search"
          autoCorrect={false}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
          <Chip label="Open now" active={openNow} onPress={() => setOpenNow((was) => !was)} />
          {/* A SORT, deliberately sitting with the sorts. It reorders the list
              and removes nothing — tapping it never makes a shop disappear. */}
          <Chip
            label={nearMe.state.status === 'asking' ? 'Finding you…' : 'Nearest'}
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

        {/* Nothing here is applied automatically. "Anywhere" is the default
            and stays selected until someone taps a place — a customer in
            Gasabo sees every listing until they say otherwise (§106.2). */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
          <Chip
            label="Anywhere"
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
        </ScrollView>

        {chosenProvince?.isCity && chosenProvince.districts.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
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
          </ScrollView>
        )}

        {(categories.data?.length ?? 0) > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
            <Chip label="All" active={categoryId === null} onPress={() => setCategoryId(null)} />
            {categories.data?.map((category) => (
              <Chip
                key={category.id}
                label={category.name}
                active={categoryId === category.id}
                onPress={() =>
                  setCategoryId((was) => (was === category.id ? null : category.id))
                }
              />
            ))}
          </ScrollView>
        )}
      </View>

      {(nearMe.state.status === 'denied' || nearMe.state.status === 'failed') && (
        <Text style={styles.notice}>
          {nearMe.state.status === 'denied'
            ? 'Without your location we cannot sort by nearest. Everything else still works.'
            : 'Could not get a position just now. Everything else still works.'}
        </Text>
      )}

      {results.isLoading && <ActivityIndicator style={styles.spinner} color={theme.accent} />}

      {results.isError && (
        <Text style={styles.empty}>
          Could not reach the server. Pull down to try again.
        </Text>
      )}

      <FlatList
        data={results.data?.locations ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={results.isRefetching} onRefresh={() => results.refetch()} />
        }
        ListHeaderComponent={
          results.data ? (
            <Text style={styles.count}>
              {results.data.total} {results.data.total === 1 ? 'place' : 'places'}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          results.isSuccess ? (
            <Text style={styles.empty}>
              Nothing matches that yet. Try a different word, or clear the filters.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <LocationCard
            location={item}
            format={money.format}
            onPress={() => router.push(`/shop/${item.id}`)}
            onSave={() => saved.toggle(item.id, item.saved ?? false, '/')}
          />
        )}
      />
    </SafeAreaView>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function LocationCard({
  location,
  format,
  onPress,
  onSave,
}: {
  location: DiscoveredLocation;
  format: (minor: number | null | undefined) => string;
  onPress: () => void;
  onSave: () => void;
}) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {location.business.name ?? location.name}
        </Text>
        {/* Computed from today's hours, so it is the one thing on the card
            that answers "can I go right now". */}
        {location.openNow ? (
          <Text style={styles.open}>Open</Text>
        ) : (
          <Text style={styles.shut}>Closed</Text>
        )}
        {/* Inside the card and outside the Pressable's job: tapping the heart
            must not also open the shop. */}
        <SaveButton saved={location.saved} onPress={onSave} />
      </View>

      <Text style={styles.cardSub} numberOfLines={1}>
        {/* The district first: "Remera" places a shop for someone in Kigali in
            a way a street name does not. */}
        {location.district ? `${location.district.name} · ` : ''}
        {location.address}
      </Text>

      {location.distanceKm !== undefined && location.distanceKm !== null && (
        <Text style={styles.distance}>
          {/* Under a kilometre reads as "600 m" — nobody says "0.6 km". */}
          {location.distanceKm < 1
            ? `${Math.round(location.distanceKm * 1000)} m away`
            : `${location.distanceKm.toFixed(1)} km away`}
        </Text>
      )}

      <View style={styles.cardFoot}>
        {location.ratingCount > 0 ? (
          <Text style={styles.rating}>
            ★ {location.ratingAvg?.toFixed(1)}{' '}
            <Text style={styles.muted}>({location.ratingCount})</Text>
          </Text>
        ) : (
          <Text style={styles.muted}>No reviews yet</Text>
        )}

        {/* Null means nothing is on sale here, which is not the same as free. */}
        {location.fromPriceMinor !== null && (
          <Text style={styles.price}>from {format(location.fromPriceMinor)}</Text>
        )}
      </View>

      {location.business.subcategory && (
        <Text style={styles.tag}>{location.business.subcategory.name}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  controls: { paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  search: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 16,
    color: theme.ink,
  },
  chips: { flexGrow: 0 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.panel,
    marginRight: 7,
  },
  chipActive: { backgroundColor: theme.ink, borderColor: theme.ink },
  chipText: { fontSize: 13, color: theme.ink },
  chipTextActive: { color: theme.panel, fontWeight: '600' },
  spinner: { marginTop: 24 },
  list: { padding: 16, gap: 10 },
  count: { color: theme.muted, fontSize: 13, marginBottom: 4 },
  empty: { color: theme.muted, textAlign: 'center', padding: 28, lineHeight: 20 },
  card: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    padding: 14,
    gap: 5,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: theme.ink, flex: 1 },
  cardSub: { color: theme.muted, fontSize: 13 },
  cardFoot: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  rating: { color: theme.warn, fontWeight: '500' },
  muted: { color: theme.muted, fontWeight: '400' },
  price: { color: theme.ink, fontWeight: '600' },
  open: { color: theme.ok, fontWeight: '600', fontSize: 13 },
  shut: { color: theme.muted, fontSize: 13 },
  tag: { color: theme.muted, fontSize: 12, marginTop: 2 },
  distance: { color: theme.accent, fontSize: 13, fontWeight: '500', marginTop: 3 },
  notice: {
    color: theme.muted,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
});
