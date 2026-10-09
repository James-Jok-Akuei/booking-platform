import { useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, lookFor } from './Icon';
import { LineArt } from './LineArt';

/** From this wide, an empty cover shows the category's drawing; narrower, its icon. */
const DRAWING_FROM = 120;

/**
 * The picture a place or a service leads with — or what stands in for it (§133).
 *
 * Most shops will not have uploaded a photo on the day they join, so the empty
 * case is the COMMON case and is designed rather than tolerated: a soft
 * gradient in the category's own colour with its icon on it — or, where the
 * cover is wide enough to read it, the category's fine-line drawing on a soft
 * tint of that colour (§264), the same one the categories screens use. A list
 * of ten shops with no photos then looks like ten different shops, not ten
 * grey boxes.
 *
 * A real photo fades in over the tile when it has loaded, so a slow connection
 * shows the tile and then the picture, never a white flash between them.
 */
export function Cover({
  uri,
  categoryIcon,
  style,
  iconSize = 34,
}: {
  uri?: string | null;
  /** The category's `icon` word, which picks the fallback's colour and glyph. */
  categoryIcon?: string | null;
  style?: StyleProp<ViewStyle>;
  iconSize?: number;
}) {
  const look = lookFor(categoryIcon);
  const fade = useRef(new Animated.Value(0)).current;
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
  const drawn = width >= DRAWING_FROM;

  return (
    <View style={[styles.box, style]} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      {drawn ? (
        <>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: look.tint }]} />
          <LineArt icon={categoryIcon} width={Math.min(width * 0.86, 300)} ink={look.ink} swash={false} />
        </>
      ) : (
        <>
          <LinearGradient
            colors={[look.from, look.to]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.glyph}>
            <Icon name={look.icon} size={iconSize} color={look.ink} />
          </View>
        </>
      )}
      {uri && !failed && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
          <Image
            source={{ uri }}
            style={styles.image}
            resizeMode="cover"
            onLoad={() =>
              Animated.timing(fade, {
                toValue: 1,
                duration: 280,
                useNativeDriver: true,
              }).start()
            }
            // A broken link leaves the tile showing, which is the right answer.
            onError={() => setFailed(true)}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  glyph: { opacity: 0.85 },
  image: { width: '100%', height: '100%' },
});
