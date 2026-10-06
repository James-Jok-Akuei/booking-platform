import { StyleSheet, Text, View } from 'react-native';
import { font, radius, shadow, theme, type } from '../theme';
import { Avatar } from '../ui/Avatar';
import { Cover } from '../ui/Cover';
import { Icon } from '../ui/Icon';
import { Pill } from '../ui/Pill';
import { PressableScale } from '../ui/PressableScale';
import { RatingBadge } from '../ui/Stars';
import { SaveButton } from './SaveButton';

/**
 * One place, as a card (§133).
 *
 * The picture leads, because that is how people choose between shops, and the
 * three things that decide a tap sit ON it: whether it is open, what people
 * thought, and the heart. Everything underneath is the detail you read once the
 * picture has your attention — name, where, and the price it starts from.
 *
 * Shared by the search list and the Saved screen. They were two hand-written
 * rows that had already drifted: one showed the district and one did not.
 */
export function PlaceCard({
  name,
  where,
  coverUrl,
  logoUrl,
  categoryIcon,
  tag,
  ratingAvg,
  ratingCount,
  price,
  distance,
  openNow,
  note,
  saved,
  onSave,
  onPress,
  width,
}: {
  name: string;
  /** "Remera · KG 9 Ave" — the district first, where there is one. */
  where: string;
  coverUrl?: string | null;
  logoUrl?: string | null;
  categoryIcon?: string | null;
  /** The subcategory, as a small label. */
  tag?: string | null;
  ratingAvg: number | null | undefined;
  ratingCount: number;
  /** Already formatted, "from RWF 5,000". Null when nothing is on sale. */
  price: string | null;
  /** Already formatted, "600 m away". */
  distance?: string | null;
  /** Undefined when the caller does not know, which hides the pill entirely. */
  openNow?: boolean;
  /** A line of explanation under the card's details, in the warning colour. */
  note?: string | null;
  saved: boolean | undefined;
  onSave: () => void;
  onPress: () => void;
  width?: number;
}) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.985} style={[styles.card, width ? { width } : null]}>
      <View>
        <Cover uri={coverUrl} categoryIcon={categoryIcon} style={styles.cover} iconSize={40} />

        <View style={styles.topRow}>
          {/* Computed from today's hours, so it is the one thing on the card
              that answers "can I go right now". */}
          {openNow === undefined ? (
            <View />
          ) : (
            <Pill
              label={openNow ? 'Open' : 'Closed'}
              tone={openNow ? 'ok' : 'neutral'}
              dot={openNow}
              solid
            />
          )}
          {/* Inside the card and outside its tap: the heart must not also
              open the shop. */}
          <SaveButton saved={saved} onPress={onSave} onPhoto />
        </View>

        <View style={styles.bottomRow}>
          <RatingBadge average={ratingAvg} count={ratingCount} onPhoto />
        </View>

        {logoUrl && (
          <View style={styles.logo}>
            <Avatar uri={logoUrl} name={name} size={44} />
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>

        <View style={styles.line}>
          <Icon name="location-outline" size={14} color={theme.muted} />
          <Text style={[type.small, styles.flex]} numberOfLines={1}>
            {where}
          </Text>
        </View>

        <View style={styles.foot}>
          <View style={styles.tags}>
            {distance && (
              <View style={styles.line}>
                <Icon name="navigate" size={12} color={theme.accent} />
                <Text style={styles.distance}>{distance}</Text>
              </View>
            )}
            {tag && !distance && (
              <Text style={styles.tag} numberOfLines={1}>
                {tag}
              </Text>
            )}
          </View>
          {/* Null means nothing is on sale here, which is not the same as free. */}
          {price && <Text style={styles.price}>{price}</Text>}
        </View>

        {note && <Text style={styles.note}>{note}</Text>}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 10,
    ...shadow.card,
  },
  cover: { height: 164, borderRadius: radius.lg },
  topRow: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  bottomRow: { position: 'absolute', left: 10, bottom: 10 },
  logo: {
    position: 'absolute',
    right: 12,
    bottom: -18,
    borderRadius: 26,
    borderWidth: 3,
    borderColor: theme.panel,
  },
  body: { paddingHorizontal: 8, paddingTop: 13, paddingBottom: 8, gap: 5 },
  name: { fontFamily: font.bold, fontSize: 17, color: theme.ink, letterSpacing: -0.2, paddingRight: 50 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  flex: { flex: 1 },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 5,
  },
  tags: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  tag: {
    fontFamily: font.semibold,
    fontSize: 11.5,
    color: theme.ink2,
    backgroundColor: theme.sunken,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
    maxWidth: '100%',
  },
  distance: { fontFamily: font.bold, fontSize: 12.5, color: theme.accent },
  price: { fontFamily: font.extrabold, fontSize: 15, color: theme.ink },
  note: { fontFamily: font.medium, fontSize: 12.5, lineHeight: 18, color: theme.warn, marginTop: 4 },
});
