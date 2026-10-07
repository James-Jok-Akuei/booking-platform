import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { discoverServices } from '../api/discovery';
import { Cover } from '../ui/Cover';
import { useReducedMotion } from '../ui/Motion';

/** The app's own categories, for a wall with no photos yet. */
const CATEGORY_TILES = [
  'sparkles',
  'heart-pulse',
  'car',
  'camera',
  'calendar-star',
  'paw',
  'home-tools',
  'briefcase',
];

/** Each tile's height as a multiple of the column's width: a rhythm, not a grid. */
const SHAPES = [1.32, 1.02, 1.22, 0.94, 1.38, 1.1];

const GAP = 10;
/** Pixels a second. Slow enough to be a backdrop, not a slideshow. */
const SPEED = 14;

type Tile = { key: string; uri: string | null; icon: string | null };

/**
 * The picture behind signing in (§183): a wall of the services shops have
 * actually put up, three columns (five on a tablet) drifting past each other,
 * turned a little,
 * under a warm coral-to-night shade so the words on it read.
 *
 * Real photos are the most convincing thing this screen can show — these are
 * the places the account is for. Until six are known (a new deployment, no
 * signal) the app's own categories stand in, each in its own colour. The
 * phone's "reduce motion" setting holds the wall still.
 */
export function AuthWall({ width, height }: { width: number; height: number }) {
  const reduced = useReducedMotion();
  // More columns on a tablet, so its tiles stay photo-sized rather than posters.
  const count = width > 600 ? 5 : 3;
  const services = useQuery({
    queryKey: ['auth-wall'],
    queryFn: () => discoverServices({ sort: 'popular', limit: 30 }),
    staleTime: 10 * 60_000,
    retry: false,
  });

  const tiles = useMemo<Tile[]>(() => {
    const seen = new Set<string>();
    const photos: Tile[] = [];
    for (const s of services.data?.services ?? []) {
      // The service's own photo only: a shop's cover is often a logo or a
      // banner with words on it, which reads as noise behind a headline.
      const uri = s.imageUrl;
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      photos.push({ key: uri, uri, icon: s.business.category?.icon ?? null });
    }
    const base: Tile[] =
      photos.length >= 6
        ? photos
        : CATEGORY_TILES.map((icon) => ({ key: icon, uri: null, icon }));
    return Array.from({ length: count * 6 }, (_, i) => {
      const tile = base[i % base.length];
      return { ...tile, key: `${tile.key}#${i}` };
    });
  }, [services.data, count]);

  // Wider and taller than the space, and turned, so its edges are never seen.
  const wallWidth = width * 1.4;
  const wallHeight = height * 1.7;
  const column = (wallWidth - GAP * (count - 1)) / count;

  return (
    <View style={styles.frame} pointerEvents="none">
      <View
        style={[
          styles.wall,
          {
            width: wallWidth,
            height: wallHeight,
            left: (width - wallWidth) / 2,
            top: (height - wallHeight) / 2,
          },
        ]}
      >
        {Array.from({ length: count }, (_, c) => (
          <Column
            key={c}
            tiles={tiles.filter((_, i) => i % count === c)}
            width={column}
            rhythm={c * 2}
            // Neighbours drift opposite ways.
            up={c % 2 === 0}
            still={reduced}
          />
        ))}
      </View>
      {/* Night rising from the bottom, where the words sit… */}
      <LinearGradient
        colors={['rgba(21,23,28,0.30)', 'rgba(21,23,28,0.55)', 'rgba(21,23,28,0.97)']}
        locations={[0, 0.48, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* …and the app's coral, warm from the top corner. */}
      <LinearGradient
        colors={['rgba(240,83,45,0.62)', 'rgba(240,83,45,0.12)', 'rgba(240,83,45,0)']}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/** One column, drawn twice end to end so the drift never runs out. */
function Column({
  tiles,
  width,
  rhythm,
  up,
  still,
}: {
  tiles: Tile[];
  width: number;
  rhythm: number;
  up: boolean;
  still: boolean;
}) {
  const heights = tiles.map((_, i) => Math.round(width * SHAPES[(i + rhythm) % SHAPES.length]));
  const length = heights.reduce((sum, h) => sum + h + GAP, 0);
  const move = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (still || length === 0) return;
    move.setValue(0);
    const loop = Animated.loop(
      Animated.timing(move, {
        toValue: 1,
        duration: (length / SPEED) * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [move, length, still]);

  const translateY = move.interpolate({
    inputRange: [0, 1],
    outputRange: up ? [0, -length] : [-length, 0],
  });

  return (
    <Animated.View style={{ width, gap: GAP, transform: [{ translateY }] }}>
      {[...tiles, ...tiles].map((tile, i) => (
        <Cover
          key={`${tile.key}:${i}`}
          uri={tile.uri}
          categoryIcon={tile.icon}
          style={{ width, height: heights[i % tiles.length], borderRadius: 18 }}
          iconSize={Math.round(width * 0.26)}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  wall: {
    position: 'absolute',
    flexDirection: 'row',
    gap: GAP,
    transform: [{ rotate: '-10deg' }],
  },
});
