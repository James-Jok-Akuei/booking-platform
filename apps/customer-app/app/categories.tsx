import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { discoverLocations, listCategories, type Category } from '../src/api/discovery';
import { font, radius, shadow, theme, type } from '../src/theme';
import { Button } from '../src/ui/Button';
import { EmptyState } from '../src/ui/EmptyState';
import { FadeIn } from '../src/ui/FadeIn';
import { Icon, lookFor } from '../src/ui/Icon';
import { useLayout } from '../src/ui/layout';
import { PopIn } from '../src/ui/Motion';
import { PressableScale } from '../src/ui/PressableScale';
import { Sheet } from '../src/ui/Sheet';
import { Skeleton } from '../src/ui/Skeleton';
import { TopBar } from '../src/ui/TopBar';

const GAP = 12;

/**
 * Everything the platform is open for (§121), as a wall of colour (§145).
 *
 * Discovery already filters by category, through tiles that scroll sideways and
 * show about four of eight. That works for someone who knows what they want.
 * This is for someone who does not — so it is built to be looked at, not read:
 * each category is a tile in its own colour (the same rose sparkle it wears on
 * the home screen, §133), with its icon large and half off the corner, and how
 * many places it holds. The tiles are two heights, staggered, so the page is a
 * pattern rather than a table.
 *
 * Tapping a tile lifts a sheet with what the category covers and the kinds
 * inside it — which keeps the wall clean and still puts every subcategory two
 * taps away. Typing in the search narrows the wall, and finds a KIND by name
 * ("barber") even though kinds are not tiles.
 */
export default function Categories() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories });

  // How many places each category holds. One small request, counted here.
  // Only trusted when the page holds every place — a count of "the first
  // fifty" would be a wrong number stated confidently.
  const places = useQuery({
    queryKey: ['category-counts'],
    queryFn: () => discoverLocations({ limit: 50 }),
    staleTime: 60_000,
  });
  const counts = useMemo(() => {
    const page = places.data;
    if (!page || page.total > page.locations.length) return null;
    const byCategory = new Map<string, number>();
    for (const place of page.locations) {
      const id = place.business.category?.id;
      if (id) byCategory.set(id, (byCategory.get(id) ?? 0) + 1);
    }
    return byCategory;
  }, [places.data]);

  const all = categories.data ?? [];
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? all.filter(
        (c) =>
          c.name.toLowerCase().includes(needle) ||
          c.subcategories.some((s) => s.name.toLowerCase().includes(needle)),
      )
    : all;
  // Kinds that match what was typed, offered directly: nobody searching
  // "barber" wants to be shown "Beauty & Personal Care" and left to dig.
  const kinds = needle
    ? all.flatMap((c) =>
        c.subcategories
          .filter((s) => s.name.toLowerCase().includes(needle))
          .map((s) => ({ category: c, sub: s })),
      )
    : [];

  const open = all.find((c) => c.id === openId) ?? null;

  // Back DOWN to the Home that is already there, not a second one pushed on
  // top of it (§133.6). Home is a tab and stays mounted; it follows the params
  // it is handed.
  const go = (categoryId: string, subcategoryId?: string) => {
    setOpenId(null);
    router.dismissTo(
      subcategoryId
        ? `/?categoryId=${categoryId}&subcategoryId=${subcategoryId}`
        : `/?categoryId=${categoryId}`,
    );
  };

  // Two columns on a phone, more on anything wider. Each column is its own
  // stack, so tiles of two heights interlock instead of leaving holes.
  const inner = layout.contentWidth - layout.gutter * 2;
  const columnCount = inner >= 700 ? 4 : inner >= 480 ? 3 : 2;
  const tileWidth = Math.floor((inner - GAP * (columnCount - 1)) / columnCount);
  const columns: Array<Array<{ category: Category; index: number; tall: boolean }>> = Array.from(
    { length: columnCount },
    () => [],
  );
  shown.forEach((category, index) => {
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    // Tall, short, tall down one column; short, tall, short down the next.
    columns[column].push({ category, index, tall: (row + column) % 2 === 0 });
  });

  return (
    <View style={styles.screen}>
      <TopBar title="Categories" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: insets.bottom + 28,
            width: layout.contentWidth,
            paddingHorizontal: layout.gutter,
          },
        ]}
      >
        <FadeIn>
          <Text style={[type.display, layout.compact && styles.displayCompact]}>
            What are you{'\n'}looking for?
          </Text>
        </FadeIn>

        <FadeIn delay={60} style={styles.search}>
          <Icon name="search" size={19} color={theme.muted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Try “barber” or “massage”"
            placeholderTextColor={theme.muted}
            autoCorrect={false}
            returnKeyType="search"
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

        {categories.isLoading && (
          <View style={styles.wall}>
            {[0, 1].map((column) => (
              <View key={column} style={styles.column}>
                <Skeleton height={column ? 140 : 190} round={radius.xl} />
                <Skeleton height={column ? 190 : 140} round={radius.xl} />
              </View>
            ))}
          </View>
        )}

        {categories.data?.length === 0 && (
          <EmptyState icon="grid-outline" title="Nothing is listed yet." />
        )}

        {/* The kinds that match, as shortcuts. */}
        {kinds.length > 0 && (
          <FadeIn style={styles.kinds}>
            {kinds.slice(0, 8).map(({ category, sub }) => {
              const look = lookFor(category.icon);
              return (
                <PressableScale
                  key={sub.id}
                  haptic
                  scaleTo={0.97}
                  accessibilityRole="button"
                  onPress={() => go(category.id, sub.id)}
                  style={styles.kind}
                >
                  <View style={[styles.kindDisc, { backgroundColor: look.tint }]}>
                    <Icon name={look.icon} size={17} color={look.ink} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.kindName}>{sub.name}</Text>
                    <Text style={type.small} numberOfLines={1}>
                      in {category.name}
                    </Text>
                  </View>
                  <Icon name="arrow-forward" size={16} color={theme.muted} />
                </PressableScale>
              );
            })}
          </FadeIn>
        )}

        {needle !== '' && shown.length === 0 && categories.data && (
          <EmptyState
            icon="search"
            title="Nothing by that name."
            text="Try a shorter word, or clear the search to see everything."
          />
        )}

        {/* The wall. */}
        <View style={styles.wall}>
          {columns.map((stack, c) => (
            <View key={c} style={[styles.column, { width: tileWidth }]}>
              {stack.map(({ category, index, tall }) => (
                <PopIn key={category.id} delay={Math.min(index, 8) * 55}>
                  <Tile
                    category={category}
                    height={tall ? 196 : 148}
                    count={counts ? (counts.get(category.id) ?? 0) : undefined}
                    onPress={() => setOpenId(category.id)}
                  />
                </PopIn>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* One category, opened: what it covers and the kinds inside it. */}
      <Sheet open={open !== null} title={open?.name ?? ''} onClose={() => setOpenId(null)}>
        {open && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheet}>
            {open.description && <Text style={type.body}>{open.description}</Text>}

            <Button
              icon="search"
              label={`See everything in ${open.name}`}
              onPress={() => go(open.id)}
            />

            {open.subcategories.length > 0 && (
              <>
                <Text style={type.label}>Or pick a kind</Text>
                <View style={styles.subs}>
                  {open.subcategories.map((sub) => {
                    const look = lookFor(open.icon);
                    return (
                      <PressableScale
                        key={sub.id}
                        haptic
                        scaleTo={0.94}
                        accessibilityRole="button"
                        style={[styles.sub, { backgroundColor: look.tint }]}
                        onPress={() => go(open.id, sub.id)}
                      >
                        <Text style={[styles.subText, { color: look.ink }]}>{sub.name}</Text>
                      </PressableScale>
                    );
                  })}
                </View>
              </>
            )}
          </ScrollView>
        )}
      </Sheet>
    </View>
  );
}

/**
 * One category, as a tile of its own colour.
 *
 * The icon is drawn twice: small in a white disc, where it is a label, and
 * very large and faint, tipped off the bottom corner, where it is the picture.
 * That second one is what makes eight tiles look like eight different places
 * with no photograph behind any of them.
 */
function Tile({
  category,
  height,
  count,
  onPress,
}: {
  category: Category;
  height: number;
  /** Places in it; undefined while that is not known. */
  count: number | undefined;
  onPress: () => void;
}) {
  const look = lookFor(category.icon);
  const kinds = category.subcategories.length;
  const facts = [
    count === undefined ? null : count === 0 ? 'Coming soon' : `${count} ${count === 1 ? 'place' : 'places'}`,
    kinds > 0 ? `${kinds} ${kinds === 1 ? 'kind' : 'kinds'}` : null,
  ].filter(Boolean);

  return (
    <PressableScale
      onPress={onPress}
      haptic
      scaleTo={0.96}
      accessibilityRole="button"
      accessibilityLabel={`${category.name}${facts.length ? `, ${facts.join(', ')}` : ''}`}
      style={[styles.tile, { height }]}
    >
      <LinearGradient
        colors={[look.from, look.to]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.ghost} pointerEvents="none">
        <Icon name={look.icon} size={height > 160 ? 128 : 104} color={look.ink} />
      </View>

      <View style={styles.tileTop}>
        <View style={styles.tileDisc}>
          <Icon name={look.icon} size={20} color={look.ink} />
        </View>
        <View style={styles.tileGo}>
          <Icon name="arrow-forward" size={14} color={look.ink} />
        </View>
      </View>

      <View style={styles.tileText}>
        <Text style={[styles.tileName, { color: look.ink }]} numberOfLines={3}>
          {category.name}
        </Text>
        {facts.length > 0 && (
          <Text style={[styles.tileFacts, { color: look.ink }]} numberOfLines={1}>
            {facts.join(' · ')}
          </Text>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  content: { paddingTop: 6, gap: 18, alignSelf: 'center' },
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

  kinds: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    paddingHorizontal: 14,
    paddingVertical: 6,
    ...shadow.card,
  },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  kindDisc: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindName: { fontFamily: font.bold, fontSize: 15, color: theme.ink },

  wall: { flexDirection: 'row', gap: GAP },
  column: { flex: 1, gap: GAP },
  tile: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    padding: 14,
    justifyContent: 'space-between',
  },
  // Bigger than the tile's corner and tipped, so it reads as a picture cut by
  // the edge rather than an icon that did not fit.
  ghost: {
    position: 'absolute',
    right: -26,
    bottom: -24,
    opacity: 0.16,
    transform: [{ rotate: '-14deg' }],
  },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tileDisc: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileGo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: { gap: 3 },
  tileName: { fontFamily: font.extrabold, fontSize: 16.5, lineHeight: 20.5, letterSpacing: -0.2 },
  tileFacts: { fontFamily: font.semibold, fontSize: 12, opacity: 0.78 },

  sheet: { gap: 14, paddingBottom: 8 },
  subs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sub: { borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9 },
  subText: { fontFamily: font.bold, fontSize: 13.5 },
});
