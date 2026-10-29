import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Image, Linking, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { font, theme } from '../theme';
import { useReducedMotion } from './Motion';

/**
 * A still map around a branch's pin (§318), drawn from map tiles the way the
 * seller app and the console draw theirs (§195) — a picture, not a map to
 * drag: inside a page that scrolls, a live map catches the finger that meant
 * to scroll, and it would need a paid key and a heavy download on weak data.
 * Tapping it is for the phone's own maps app, which does the finding.
 *
 * The tiles come from OpenStreetMap's servers unless
 * `EXPO_PUBLIC_MAP_TILES` names a provider ("https://…/{z}/{x}/{y}.png") —
 * theirs are for light use, so a provider is set before launch (§299), with
 * its credit in `EXPO_PUBLIC_MAP_CREDIT`. The credit stays on the map, as
 * the tile terms ask. A phone app has to say who it is when it asks for
 * tiles, so it does; a browser says so itself.
 */
const TILE = 256;
const TILES = process.env.EXPO_PUBLIC_MAP_TILES?.trim() || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const CREDIT = process.env.EXPO_PUBLIC_MAP_CREDIT?.trim() || '© OpenStreetMap contributors';
const HEADERS = Platform.OS === 'web' ? undefined : { 'User-Agent': 'BwanguReservations-customer/1.0' };

const tileUrl = (z: number, x: number, y: number) =>
  TILES.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

function worldPixel(latitude: number, longitude: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const x = ((longitude + 180) / 360) * scale;
  const sin = Math.sin((latitude * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

export function StaticMap({
  latitude,
  longitude,
  height,
  zoom = 16,
  focusY = 0.58,
  style,
  children,
}: {
  latitude: number;
  longitude: number;
  height: number;
  zoom?: number;
  /** How far down the box (0–1) the pin's point sits; a little low, so the pin itself is in the middle. */
  focusY?: number;
  style?: StyleProp<ViewStyle>;
  /** Drawn over the map: a chip saying how far it is. */
  children?: ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const tipX = width / 2;
  const tipY = height * focusY;

  const tiles = useMemo(() => {
    if (width === 0) return [];
    const center = worldPixel(latitude, longitude, zoom);
    const left = center.x - tipX;
    const top = center.y - tipY;
    const max = 2 ** zoom;
    const out: Array<{ key: string; uri: string; left: number; top: number }> = [];
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + height) / TILE); ty++) {
      if (ty < 0 || ty >= max) continue;
      for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + width) / TILE); tx++) {
        const x = ((tx % max) + max) % max;
        out.push({ key: `${tx}-${ty}`, uri: tileUrl(zoom, x, ty), left: Math.round(tx * TILE - left), top: Math.round(ty * TILE - top) });
      }
    }
    return out;
  }, [width, height, latitude, longitude, zoom, tipX, tipY]);

  return (
    <View style={[styles.box, { height }, style]} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      <View style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {tiles.map((tile) => (
          <Image
            key={tile.key}
            source={{ uri: tile.uri, headers: HEADERS }}
            style={[styles.tile, { left: tile.left, top: tile.top }]}
            fadeDuration={200}
          />
        ))}
      </View>
      {width > 0 && <Pin x={tipX} y={tipY} />}
      {children}
      {/* The credit the map's terms ask for, linking to them. */}
      <Text
        style={styles.credit}
        onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright').catch(() => undefined)}
        accessibilityRole="link"
        suppressHighlighting
      >
        {CREDIT}
      </Text>
    </View>
  );
}

const PIN_W = 34;
const PIN_H = 45;

/** The coral pin, dropped onto its point with a ripple on the ground — once, unless the phone asks for stillness. */
function Pin({ x, y }: { x: number; y: number }) {
  const still = useReducedMotion();
  const drop = useRef(new Animated.Value(still ? 1 : 0)).current;
  const ripple = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (still) {
      drop.setValue(1);
      return;
    }
    Animated.spring(drop, { toValue: 1, delay: 250, speed: 9, bounciness: 12, useNativeDriver: true }).start();
    const loop = Animated.loop(
      Animated.timing(ripple, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [still, drop, ripple]);

  return (
    <View pointerEvents="none" style={[styles.pinAt, { left: x - 40, top: y - 40 }]}>
      {/* The ground under the point: a ring spreading out, flattened like a shadow on a road. */}
      {!still && (
        <Animated.View
          style={[
            styles.ripple,
            {
              opacity: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
              transform: [{ scaleY: 0.42 }, { scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.6] }) }],
            },
          ]}
        />
      )}
      <View style={styles.shadow} />
      <Animated.View
        style={[
          styles.pin,
          {
            opacity: drop.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }),
            transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-34, 0] }) }],
          },
        ]}
      >
        <Svg width={PIN_W} height={PIN_H} viewBox="0 0 24 32">
          <Path
            d="M12 0.9C6 0.9 1.1 5.6 1.1 11.5c0 7.6 9.2 17.4 10.2 18.5a1 1 0 0 0 1.4 0c1-1.1 10.2-10.9 10.2-18.5C22.9 5.6 18 0.9 12 0.9z"
            fill={theme.accent}
            stroke="#FFFFFF"
            strokeWidth={1.6}
          />
          <Circle cx={12} cy={11.4} r={4.3} fill="#FFFFFF" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: '#ECE8DF' },
  tile: { position: 'absolute', width: TILE, height: TILE },
  // An 80×80 square centred on the point; everything in it is placed from there.
  pinAt: { position: 'absolute', width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  ripple: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: theme.accent,
    backgroundColor: 'rgba(240,83,45,0.18)',
  },
  shadow: {
    position: 'absolute',
    top: 37,
    width: 14,
    height: 6,
    borderRadius: 7,
    backgroundColor: 'rgba(31,42,31,0.28)',
  },
  // The pin's point is its bottom centre, on the middle of the square.
  pin: { position: 'absolute', left: 40 - PIN_W / 2, top: 40 - PIN_H + 1 },
  credit: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderTopLeftRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.82)',
    fontFamily: font.medium,
    fontSize: 9.5,
    color: theme.ink2,
  },
});
