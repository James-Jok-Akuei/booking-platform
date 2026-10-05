import { StyleSheet, Text, View } from 'react-native';
import type { DiscoveredLocation } from '../api/discovery';
import { font, shadow, theme } from '../theme';
import { Cover } from '../ui/Cover';
import { Icon } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';
import { distanceLabel } from '../distance';

const SIZE = 66;

/**
 * One shop, as a circle (§135.3).
 *
 * The row of these is the answer to "who is here" in the height of one line —
 * the way a messaging app shows people across the top. Its picture is the
 * shop's logo, then its cover, then a tile in its category's colour, so a shop
 * that has uploaded nothing is still recognisably a salon and not a blank.
 *
 * The rating rides on the bottom edge of the circle. The small dot is whether it is OPEN NOW, borrowed from the "online" dot
 * everybody already reads without being told. Green and present, or absent —
 * never a grey dot, which would be one more thing to decode.
 */
export function PlaceBubble({
  place,
  onPress,
}: {
  place: DiscoveredLocation;
  onPress: () => void;
}) {
  const name = place.business.name ?? place.name;
  const away = distanceLabel(place.distanceKm);
  return (
    <PressableScale
      onPress={onPress}
      haptic
      scaleTo={0.93}
      accessibilityRole="button"
      accessibilityLabel={`${name}${place.openNow ? ', open now' : ''}`}
      style={styles.wrap}
    >
      <View style={styles.ring}>
        <Cover
          uri={place.business.logoUrl ?? place.business.coverImageUrl}
          categoryIcon={place.business.category?.icon}
          style={styles.picture}
          iconSize={26}
        />
        {place.openNow && <View style={styles.open} />}
        {place.ratingCount > 0 && place.ratingAvg !== null && (
          <View style={styles.rating}>
            <Icon name="star" size={9} color={theme.star} />
            <Text style={styles.ratingText}>{place.ratingAvg.toFixed(1)}</Text>
          </View>
        )}
      </View>

      <Text style={styles.name} numberOfLines={2}>
        {name}
      </Text>
      {away && <Text style={styles.away}>{away}</Text>}

    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 76, alignItems: 'center', gap: 7 },
  ring: {
    width: SIZE + 8,
    height: SIZE + 8,
    borderRadius: (SIZE + 8) / 2,
    backgroundColor: theme.panel,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  picture: { width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  open: {
    position: 'absolute',
    right: 3,
    top: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.ok,
    borderWidth: 3,
    borderColor: theme.panel,
  },
  name: {
    fontFamily: font.semibold,
    fontSize: 11.5,
    lineHeight: 14.5,
    color: theme.ink,
    textAlign: 'center',
  },
  away: { fontFamily: font.bold, fontSize: 10.5, color: theme.ink2, marginTop: -4 },
  // Sits on the bottom edge of the circle, the way a "live" tag does.
  rating: {
    position: 'absolute',
    bottom: -5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: theme.panel,
    ...shadow.card,
  },
  ratingText: { fontFamily: font.bold, fontSize: 10, color: theme.ink },
});
