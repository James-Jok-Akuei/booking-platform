import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { RING } from '../stories/StoryRing';
import { font, shadow, theme } from '../theme';
import { Avatar } from '../ui/Avatar';
import { Icon } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';
import { distanceLabel } from '../distance';
import { plural, t } from '@lingui/core/macro';

const SIZE = 66;

/**
 * One shop, as a circle (§135.3).
 *
 * The row of these is the answer to "who is here" in the height of one line —
 * the way a messaging app shows people across the top. Its picture is the
 * shop's logo, and only the logo (§150): with none, the initial — which reads
 * as "no logo yet", the way every messaging app's blank contact does.
 *
 * The rating rides on the bottom edge of the circle. The small dot is whether it is OPEN NOW, borrowed from the "online" dot
 * everybody already reads without being told. Green and present, or absent —
 * never a grey dot, which would be one more thing to decode.
 *
 * A shop with a story today wears the stories' ring around the circle (§295):
 * coral while there is something new, a thin grey line once it has all been
 * seen — so a shop shows once on Home, not once as a place and again as a
 * story.
 */
export function PlaceBubble({
  name,
  logoUrl,
  openNow,
  ratingAvg,
  ratingCount,
  distanceKm,
  story,
  onPress,
}: {
  name: string;
  logoUrl: string | null;
  openNow?: boolean;
  ratingAvg?: number | null;
  ratingCount?: number;
  distanceKm?: number | null;
  /** A story up today, and whether all of it has been seen. Null for none. */
  story?: { seen: boolean; count: number } | null;
  onPress: () => void;
}) {
  const away = distanceLabel(distanceKm ?? null);
  const label = [
    name,
    story
      ? story.seen
        ? plural(story.count, { one: '# story today, seen', other: '# stories today, seen' })
        : plural(story.count, { one: '# story today, new', other: '# stories today, new' })
      : null,
    openNow ? t`open now` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const circle = (
    <View style={[styles.circle, story && styles.circleInRing]}>
      {logoUrl ? <Image source={{ uri: logoUrl }} style={styles.picture} /> : <Avatar name={name} size={SIZE} />}
      {openNow && <View style={styles.open} />}
      {(ratingCount ?? 0) > 0 && ratingAvg !== null && ratingAvg !== undefined && (
        <View style={styles.rating}>
          <Icon name="star" size={9} color={theme.star} />
          <Text style={styles.ratingText}>{ratingAvg.toFixed(1)}</Text>
        </View>
      )}
    </View>
  );

  return (
    <PressableScale
      onPress={onPress}
      haptic
      scaleTo={0.93}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.wrap}
    >
      {!story ? (
        circle
      ) : story.seen ? (
        <View style={[styles.ring, styles.ringSeen]}>{circle}</View>
      ) : (
        <LinearGradient colors={RING} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={styles.ring}>
          {circle}
        </LinearGradient>
      )}

      <Text style={[styles.name, story && !story.seen && styles.nameNew]} numberOfLines={2}>
        {name}
      </Text>
      {away && <Text style={styles.away}>{away}</Text>}
    </PressableScale>
  );
}

const OUTER = SIZE + 8;
const INNER = SIZE + 3;

const styles = StyleSheet.create({
  wrap: { width: 76, alignItems: 'center', gap: 7 },
  circle: {
    width: OUTER,
    height: OUTER,
    borderRadius: OUTER / 2,
    backgroundColor: theme.panel,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  // Inside a ring: a little smaller, so the ring and the circle together are
  // the size of a plain circle and the row stays even.
  circleInRing: { width: INNER, height: INNER, borderRadius: INNER / 2, shadowOpacity: 0, elevation: 0 },
  ring: { width: OUTER + 4, height: OUTER + 4, borderRadius: (OUTER + 4) / 2, alignItems: 'center', justifyContent: 'center' },
  ringSeen: { borderWidth: 1.5, borderColor: theme.line, backgroundColor: theme.panel },
  picture: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: theme.sunken },
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
  nameNew: { fontFamily: font.bold },
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
