import { StyleSheet, Text, View } from 'react-native';
import { font, theme } from '../theme';
import { Icon } from './Icon';
import { t } from '@lingui/core/macro';

/** Five stars, filled to the score. Drawn as icons so they line up with text. */
export function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={styles.row} accessibilityLabel={t`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Icon
          key={value}
          name="star"
          size={size}
          color={value <= Math.round(rating) ? theme.star : theme.line}
        />
      ))}
    </View>
  );
}

/**
 * The rating as one small badge: a star, the score, and how many people it
 * comes from. Renders nothing for an unreviewed place — the caller decides
 * what, if anything, to say instead.
 */
export function RatingBadge({
  average,
  count,
  onPhoto,
}: {
  average: number | null | undefined;
  count: number;
  /** A solid white chip, for sitting on top of a picture. */
  onPhoto?: boolean;
}) {
  if (count === 0 || average === null || average === undefined) return null;
  return (
    <View style={[styles.badge, onPhoto && styles.badgeOnPhoto]}>
      <Icon name="star" size={13} color={theme.star} />
      <Text style={styles.score}>{average.toFixed(1)}</Text>
      <Text style={styles.count}>({count})</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  badgeOnPhoto: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  score: { fontFamily: font.bold, fontSize: 13, color: theme.ink },
  count: { fontFamily: font.medium, fontSize: 12.5, color: theme.muted },
});
