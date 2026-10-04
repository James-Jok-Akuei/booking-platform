import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { radius, shadow, theme } from '../theme';

/**
 * The shape of what is coming, breathing while it loads (§133).
 *
 * A spinner says "wait". A skeleton says "wait, and here is what for" — the
 * screen does not jump when the data lands, because the room for it was already
 * there.
 */
export function Skeleton({
  width = '100%',
  height = 14,
  round = radius.sm,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  round?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: round, backgroundColor: theme.line, opacity: pulse },
        style,
      ]}
    />
  );
}

/** A place card, before it is one. */
export function PlaceCardSkeleton() {
  return (
    <View style={styles.card}>
      <Skeleton height={150} round={radius.lg} />
      <View style={styles.body}>
        <Skeleton width="62%" height={18} />
        <Skeleton width="84%" />
        <View style={styles.row}>
          <Skeleton width={70} />
          <Skeleton width={90} />
        </View>
      </View>
    </View>
  );
}

/** A list row with a square thumb, before it is one. */
export function RowSkeleton() {
  return (
    <View style={[styles.card, styles.rowCard]}>
      <Skeleton width={56} height={56} round={radius.md} />
      <View style={styles.rowBody}>
        <Skeleton width="55%" height={16} />
        <Skeleton width="80%" />
        <Skeleton width="40%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 10,
    ...shadow.card,
  },
  body: { padding: 8, paddingTop: 14, gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  rowCard: { flexDirection: 'row', gap: 14, padding: 14, alignItems: 'center' },
  rowBody: { flex: 1, gap: 9 },
});
