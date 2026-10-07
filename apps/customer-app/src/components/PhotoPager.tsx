import { useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { font } from '../theme';
import { Cover } from '../ui/Cover';
import type { ViewerOrigin, ViewerPhoto } from '../ui/PhotoViewer';
import { PressableScale } from '../ui/PressableScale';

/**
 * The photos a service leads with, edge to edge, one at a time (§179).
 *
 * Swiped through like a camera roll — a page at a time, never half a photo —
 * with dots and a "2 / 5" count so the other photos are known to exist. One
 * tap opens the photo properly (§135.7), growing out of where it sits.
 *
 * With no photos it is the shop's own picture, and failing that the category's
 * tile — a service nobody has photographed yet is not a broken one.
 */
export function PhotoPager({
  photos,
  fallbackUri,
  categoryIcon,
  width,
  height,
  onOpen,
}: {
  photos: ViewerPhoto[];
  fallbackUri?: string | null;
  categoryIcon?: string | null;
  width: number;
  height: number;
  onOpen: (index: number, origin: ViewerOrigin | null) => void;
}) {
  const [index, setIndex] = useState(0);

  if (photos.length === 0) {
    return (
      <Cover
        uri={fallbackUri}
        categoryIcon={categoryIcon}
        style={{ width, height }}
        iconSize={72}
      />
    );
  }

  const track = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== index && next >= 0 && next < photos.length) setIndex(next);
  };

  const open = (event: GestureResponderEvent, at: number) => {
    // Asked of the photo itself rather than worked out from the touch: the
    // touch's own offsets are not reported the same way everywhere, and a
    // wrong origin is worse than none.
    const target = event.currentTarget as unknown as {
      measureInWindow?: (done: (x: number, y: number, w: number, h: number) => void) => void;
    };
    if (!target?.measureInWindow) return onOpen(at, null);
    target.measureInWindow((x, y, w, h) =>
      onOpen(at, [x, y, w, h].every(Number.isFinite) ? { x, y, width: w, height: h } : null),
    );
  };

  return (
    <View style={{ width, height }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={track}
        scrollEventThrottle={16}
        style={{ width, height }}
      >
        {photos.map((photo, i) => (
          <PressableScale
            key={photo.id}
            scaleTo={0.985}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
            onPress={(event) => open(event, i)}
            style={{ width, height }}
          >
            <Image source={{ uri: photo.url }} style={{ width, height }} resizeMode="cover" />
          </PressableScale>
        ))}
      </ScrollView>

      {photos.length > 1 && (
        <>
          {/* A little shade at the foot, so the dots read on a bright photo. */}
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.38)']}
            style={styles.shade}
          />
          <View pointerEvents="none" style={styles.dots}>
            {photos.map((photo, i) => (
              <View key={photo.id} style={[styles.dot, i === index && styles.dotOn]} />
            ))}
          </View>
          <View pointerEvents="none" style={styles.counter}>
            <Text style={styles.counterText}>
              {index + 1} / {photos.length}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 110 },
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 44,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotOn: { width: 18, backgroundColor: '#FFFFFF' },
  counter: {
    position: 'absolute',
    right: 16,
    bottom: 40,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    backgroundColor: 'rgba(10,12,18,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  counterText: { fontFamily: font.bold, fontSize: 12, color: '#FFFFFF' },
});
