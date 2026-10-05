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

export type ViewerPhoto = { id: string; url: string };

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

  useEffect(() => {
    if (openAt === null) return;
    closing.current = false;
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
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 10 && g.dy > Math.abs(g.dx) * 1.5,
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
                <Pressable style={styles.lift}>
                  <Image
                    source={{ uri: photo.url }}
                    style={[styles.photo, { width: w, height: w / shape }]}
                    resizeMode="cover"
                    onLoad={(e) => {
                      const s = e.nativeEvent.source;
                      if (s?.width && s?.height && !shapes[photo.id])
                        setShapes((was) => ({ ...was, [photo.id]: s.width / s.height }));
                    }}
                  />
                </Pressable>
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
        {many ? (
          <View style={styles.counter}>
            <Text style={styles.counterText}>
              {index + 1} / {photos.length}
            </Text>
          </View>
        ) : (
          <View />
        )}
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
