import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font } from '../theme';
import { tick } from './haptic';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

/** `label` is what the photo is of — "Haircut" — shown beside the counter (§152). */
export type ViewerPhoto = { id: string; url: string; label?: string };

/** Where on the screen the tapped thumbnail was, so the photo can grow from it. */
export type ViewerOrigin = { x: number; y: number; width: number; height: number };

/**
 * A photo, looked at properly (§135.7).
 *
 * The thing it is built around is that the photo never APPEARS — it travels.
 * It lifts out of the thumbnail that was tapped and grows to fill the screen
 * while the page behind it dims, so there is never a moment of wondering what
 * just opened or where it came from. Closing sends it back to the same spot.
 *
 * Three ways out, because people reach for different ones: the cross, a tap on
 * the dark around the photo, and dragging the photo down — which shrinks it
 * and lets the page show through as it goes, so the drag itself is the answer
 * to "what will happen if I let go".
 *
 * Sideways moves between photos; the strip along the bottom shows where you
 * are among them and jumps to any one.
 *
 * Built on `Animated` with the native driver, like everything else here, so
 * the movement stays smooth on a modest phone.
 */
export function PhotoViewer({
  photos,
  openAt,
  origin,
  onClose,
}: {
  photos: ViewerPhoto[];
  /** Which photo to open on; `null` is closed. */
  openAt: number | null;
  origin?: ViewerOrigin | null;
  onClose: () => void;
}) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const open = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const pager = useRef<ScrollView>(null);
  const strip = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  /** Width ÷ height of each photo, learnt as they load. */
  const [shapes, setShapes] = useState<Record<string, number>>({});
  const closing = useRef(false);
  /** True while a photo is zoomed in: the pager and the drag-to-close stand down. */
  const [zoomed, setZoomed] = useState(false);
  const zoomedRef = useRef(false);
  zoomedRef.current = zoomed;

  useEffect(() => {
    if (openAt === null) return;
    closing.current = false;
    setZoomed(false);
    setIndex(openAt);
    open.setValue(0);
    drag.setValue(0);
    tick();
    Animated.spring(open, {
      toValue: 1,
      useNativeDriver: true,
      speed: 13,
      bounciness: 5,
    }).start();
  }, [openAt, open, drag]);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(open, {
        toValue: 0,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(drag, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start(() => onClose());
  };
  // The pan handlers are made once; this keeps them calling the latest close.
  const closeRef = useRef(close);
  closeRef.current = close;

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Only a clearly DOWNWARD drag: sideways belongs to the pager.
        // One finger, straight down, on a photo that is not zoomed. Two
        // fingers are a pinch and belong to the photo (§149).
        onMoveShouldSetPanResponder: (e, g) =>
          e.nativeEvent.touches.length < 2 &&
          !zoomedRef.current &&
          g.dy > 10 &&
          g.dy > Math.abs(g.dx) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > 110 || g.vy > 0.9) closeRef.current();
          else
            Animated.spring(drag, {
              toValue: 0,
              useNativeDriver: true,
              speed: 18,
              bounciness: 7,
            }).start();
        },
        onPanResponderTerminate: () =>
          Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start(),
      }),
    [drag],
  );

  const goTo = (next: number, animated = true) => {
    pager.current?.scrollTo({ x: next * W, animated });
    strip.current?.scrollTo({ x: Math.max(0, next * 56 - W / 2 + 28), animated: true });
  };

  /**
   * Home is the thumbnail the photo came from. It only counts while that same
   * photo is showing — swipe to another and there is no thumbnail to fly back
   * to that would be the right one, so it simply settles back and fades.
   */
  const home = origin && index === openAt ? origin : null;
  const fromScale = home ? Math.max(0.12, home.width / W) : 0.86;
  const fromX = home ? home.x + home.width / 2 - W / 2 : 0;
  const fromY = home ? home.y + home.height / 2 - H / 2 : 30;

  // Two layers, one per cause, so each transform is a plain interpolation:
  // the outer one follows the finger, the inner one is the flight from the
  // thumbnail and back.
  const pulled = {
    transform: [
      { translateY: drag },
      {
        scale: drag.interpolate({
          inputRange: [0, H],
          outputRange: [1, 0.55],
          extrapolate: 'clamp',
        }),
      },
    ],
  };
  const stage = {
    opacity: open.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }),
    transform: [
      { translateX: open.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] }) },
      { translateY: open.interpolate({ inputRange: [0, 1], outputRange: [fromY, 0] }) },
      { scale: open.interpolate({ inputRange: [0, 1], outputRange: [fromScale, 1] }) },
    ],
  };
  const dim = Animated.multiply(
    open,
    drag.interpolate({ inputRange: [0, H * 0.55], outputRange: [1, 0], extrapolate: 'clamp' }),
  );
  // The controls leave first, so a drag is the photo and nothing else.
  const chrome = Animated.multiply(
    open.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 1] }),
    drag.interpolate({ inputRange: [0, 70], outputRange: [1, 0], extrapolate: 'clamp' }),
  );

  // The room a photo may fill: the screen, less the controls above and below.
  const many = photos.length > 1;
  const boxW = W - 24;
  const boxH = H - insets.top - insets.bottom - (many ? 190 : 130);

  return (
    <Modal
      visible={openAt !== null}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={close}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, { opacity: dim }]} />

      <Animated.View style={[StyleSheet.absoluteFill, pulled]} {...pan.panHandlers}>
      <Animated.View style={[StyleSheet.absoluteFill, stage]}>
        <ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          contentOffset={{ x: (openAt ?? 0) * W, y: 0 }}
          // A zoomed photo is panned with one finger; the pager must not take
          // that finger for the next photo.
          scrollEnabled={!zoomed}
          onLayout={() => goTo(openAt ?? 0, false)}
          onScroll={(e) => {
            const next = Math.round(e.nativeEvent.contentOffset.x / W);
            if (next !== index && next >= 0 && next < photos.length) {
              setIndex(next);
              tick();
              strip.current?.scrollTo({ x: Math.max(0, next * 56 - W / 2 + 28), animated: true });
            }
          }}
        >
          {photos.map((photo) => {
            const shape = shapes[photo.id] ?? 4 / 3;
            // As big as it can be without being cropped, at its own shape —
            // so the rounded corners sit on the photo, not on black bars.
            const w = Math.min(boxW, boxH * shape);
            return (
              <Pressable key={photo.id} onPress={close} style={[styles.page, { width: W, height: H }]}>
                <Zoomable
                  uri={photo.url}
                  width={w}
                  height={w / shape}
                  active={photos[index]?.id === photo.id}
                  onZoom={setZoomed}
                  onLoad={(ratio) => {
                    if (!shapes[photo.id]) setShapes((was) => ({ ...was, [photo.id]: ratio }));
                  }}
                />
              </Pressable>
            );
          })}
        </ScrollView>
      </Animated.View>
      </Animated.View>

      <Animated.View
        style={[styles.top, { paddingTop: insets.top + 10, opacity: chrome }]}
        pointerEvents="box-none"
      >
        <View style={styles.topLeft}>
          {many && (
            <View style={styles.counter}>
              <Text style={styles.counterText}>
                {index + 1} / {photos.length}
              </Text>
            </View>
          )}
          {photos[index]?.label && (
            <View style={styles.counter}>
              <Text style={styles.counterText} numberOfLines={1}>
                {photos[index].label}
              </Text>
            </View>
          )}
        </View>
        <PressableScale
          onPress={close}
          haptic
          scaleTo={0.9}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.close}
        >
          <Icon name="close" size={20} color="#FFFFFF" />
        </PressableScale>
      </Animated.View>

      {many && (
        <Animated.View
          style={[styles.bottom, { paddingBottom: insets.bottom + 18, opacity: chrome }]}
          pointerEvents="box-none"
        >
          <ScrollView
            ref={strip}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
          >
            {photos.map((photo, i) => (
              <PressableScale
                key={photo.id}
                onPress={() => goTo(i)}
                scaleTo={0.9}
                accessibilityRole="button"
                accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
                style={[styles.thumb, i === index && styles.thumbOn]}
              >
                <Image
                  source={{ uri: photo.url }}
                  style={[styles.thumbImage, i !== index && styles.thumbOff]}
                />
              </PressableScale>
            ))}
          </ScrollView>
        </Animated.View>
      )}
    </Modal>
  );
}

/**
 * A photo you can zoom (§149).
 *
 * Three gestures, the ones every phone has taught: pinch to zoom, drag to
 * move around once zoomed, and double-tap to jump in on the spot tapped — or
 * back out. It never claims a touch it does not need: a single finger on an
 * unzoomed photo is left for the pager and for the drag that closes, so those
 * keep working exactly as before.
 *
 * Let go below full size and it settles back to fit; drag it past its edge
 * and it springs back to the edge. Built on `PanResponder` and `Animated`,
 * like the rest, so nothing new is installed.
 */
function Zoomable({
  uri,
  width,
  height,
  active,
  onZoom,
  onLoad,
}: {
  uri: string;
  width: number;
  height: number;
  /** The photo on screen. Leaving it resets the zoom. */
  active: boolean;
  onZoom: (zoomed: boolean) => void;
  onLoad: (ratio: number) => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  // What the fingers started from, and where things are now. A ref, not
  // state: it changes on every move and must never cause a render.
  const g = useRef({
    scale: 1,
    tx: 0,
    ty: 0,
    startScale: 1,
    startDist: 0,
    startTx: 0,
    startTy: 0,
    lastTap: 0,
  }).current;

  const MAX = 4;
  const fit = (s: number, x: number, y: number) => {
    // How far the photo may move before its edge leaves the screen's edge.
    const maxX = Math.max(0, (width * s - width) / 2);
    const maxY = Math.max(0, (height * s - height) / 2);
    return {
      s: Math.min(MAX, Math.max(1, s)),
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  };
  const settle = (to: { s: number; x: number; y: number }) => {
    g.scale = to.s;
    g.tx = to.x;
    g.ty = to.y;
    Animated.parallel([
      Animated.spring(scale, { toValue: to.s, useNativeDriver: true, speed: 20, bounciness: 4 }),
      Animated.spring(tx, { toValue: to.x, useNativeDriver: true, speed: 20, bounciness: 4 }),
      Animated.spring(ty, { toValue: to.y, useNativeDriver: true, speed: 20, bounciness: 4 }),
    ]).start();
    onZoom(to.s > 1.02);
  };
  const reset = () => settle({ s: 1, x: 0, y: 0 });

  useEffect(() => {
    if (!active && g.scale !== 1) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const distance = (touches: Array<{ pageX: number; pageY: number }>) =>
    Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Two fingers, or one finger on a zoomed photo. Nothing else is ours.
        onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length >= 2,
        onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length >= 2 || g.scale > 1.02,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          g.startScale = g.scale;
          g.startTx = g.tx;
          g.startTy = g.ty;
          g.startDist = e.nativeEvent.touches.length >= 2 ? distance(e.nativeEvent.touches) : 0;
        },
        onPanResponderMove: (e, gesture) => {
          const touches = e.nativeEvent.touches;
          if (touches.length >= 2) {
            if (g.startDist === 0) {
              // The second finger arrived mid-gesture: measure from here.
              g.startDist = distance(touches);
              g.startScale = g.scale;
            }
            const next = fit((g.startScale * distance(touches)) / g.startDist, g.tx, g.ty);
            g.scale = next.s;
            scale.setValue(next.s);
            return;
          }
          if (g.scale > 1.02) {
            // Not clamped while the finger is down: a little give past the
            // edge, then the spring on release, is what feels like a thing.
            g.tx = g.startTx + gesture.dx;
            g.ty = g.startTy + gesture.dy;
            tx.setValue(g.tx);
            ty.setValue(g.ty);
          }
        },
        onPanResponderRelease: () => {
          if (g.scale < 1.08) reset();
          else settle(fit(g.scale, g.tx, g.ty));
        },
        onPanResponderTerminate: () => settle(fit(g.scale, g.tx, g.ty)),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height],
  );

  // Double-tap: in on the spot tapped, or back out.
  const tap = (e: { nativeEvent: { locationX: number; locationY: number } }) => {
    const now = Date.now();
    const twice = now - g.lastTap < 300;
    g.lastTap = now;
    if (!twice) return;
    if (g.scale > 1.02) {
      reset();
      return;
    }
    const s = 2.5;
    const { locationX, locationY } = e.nativeEvent;
    // Move the tapped point to the middle, as far as the edges allow.
    const x = Number.isFinite(locationX) ? (width / 2 - locationX) * (s - 1) : 0;
    const y = Number.isFinite(locationY) ? (height / 2 - locationY) * (s - 1) : 0;
    settle(fit(s, x, y));
  };

  return (
    <Animated.View
      {...pan.panHandlers}
      style={[styles.lift, { transform: [{ translateX: tx }, { translateY: ty }, { scale }] }]}
    >
      <Pressable onPress={tap}>
        <Image
          source={{ uri }}
          style={[styles.photo, { width, height }]}
          resizeMode="cover"
          onLoad={(e) => {
            const s = e.nativeEvent.source;
            if (s?.width && s?.height) onLoad(s.width / s.height);
          }}
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: '#0B0C0F' },
  page: { alignItems: 'center', justifyContent: 'center' },
  lift: {
    borderRadius: 22,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 40,
    shadowOpacity: 0.5,
  },
  photo: { borderRadius: 22, backgroundColor: '#1D1F25' },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, paddingRight: 12 },
  counter: {
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.14)',
    justifyContent: 'center',
  },
  counterText: { fontFamily: font.bold, fontSize: 13, color: '#FFFFFF' },
  close: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  strip: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 16, gap: 8 },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 13,
    padding: 2,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbOn: { borderColor: '#FFFFFF' },
  thumbImage: { flex: 1, borderRadius: 9, backgroundColor: '#1D1F25' },
  thumbOff: { opacity: 0.45 },
});
