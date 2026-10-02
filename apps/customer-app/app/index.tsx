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
  type DiscoveredLocation,
  type DiscoverySort,
} from '../src/api/discovery';
import { useMoney } from '../src/money';
import { theme } from '../src/theme';

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

  // Districts only once a province is chosen. Thirty at once is a wall of
  // names, and twenty-seven of them are hours from the customer (§104).
  const chosenProvince = provinces.data?.find((p) => p.id === provinceId);

  const results = useQuery({
    queryKey: ['discover', query, categoryId, sort, openNow, provinceId, districtId],
    queryFn: () =>
      discoverLocations({
        limit: 50,
        sort,
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
          {SORTS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              active={sort === option.value}
              onPress={() => setSort(option.value)}
            />
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
          <Chip
            label="Anywhere"
            active={provinceId === null}
            onPress={() => {
              setProvinceId(null);
              setDistrictId(null);
            }}
          />
          {provinces.data?.map((province) => (
            <Chip
              key={province.id}
              label={province.name.replace(' Province', '')}
              active={provinceId === province.id}
              onPress={() => {
                // Changing province clears the district: a district from the
                // old one would filter to nothing and look like a bug.
                setProvinceId((was) => (was === province.id ? null : province.id));
                setDistrictId(null);
              }}
            />
          ))}
        </ScrollView>

        {chosenProvince && chosenProvince.districts.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
            <Chip
              label={`All of ${chosenProvince.name.replace(' Province', '')}`}
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
}: {
  location: DiscoveredLocation;
  format: (minor: number | null | undefined) => string;
  onPress: () => void;
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
      </View>

      <Text style={styles.cardSub} numberOfLines={1}>
        {/* The district first: "Remera" places a shop for someone in Kigali in
            a way a street name does not. */}
        {location.district ? `${location.district.name} · ` : ''}
        {location.address}
      </Text>

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
});
