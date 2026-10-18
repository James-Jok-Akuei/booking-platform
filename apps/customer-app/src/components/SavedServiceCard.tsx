import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { SavedService } from '../api/discovery';
import { duration } from '../duration';
import { font, radius, shadow, theme } from '../theme';
import { Avatar } from '../ui/Avatar';
import { Cover } from '../ui/Cover';
import { Icon } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';
import { SaveButton } from './SaveButton';
import { SaleBadge } from './Sale';
import { useMoney } from '../money';

/**
 * A saved service, as a card worth coming back to (§158).
 *
 * Wider than the shelf card and photo-first: the picture fills the top with
 * the price and length sitting on it, the shop's logo and name beneath, and
 * one dark "Book" that is the point of having saved it. A service that cannot
 * be booked right now is dimmed and says so across its picture — kept, like a
 * saved place, because it comes back on its own.
 */
export function SavedServiceCard({
  service,
  price,
  width,
  onPress,
  onShop,
  onSave,
}: {
  service: SavedService;
  price: string;
  width?: number;
  onPress: () => void;
  onShop: () => void;
  onSave: () => void;
}) {
  const shop = service.business.name ?? service.location.name;
  const rated = service.location.ratingCount > 0 && service.location.ratingAvg !== null;
  const money = useMoney();

  return (
    // The whole card opens it to a tap, but is not itself a button: it holds
    // three (the heart, the shop, Book), which a screen reader must reach one
    // by one, and on the web a button inside a button is not allowed. Book and
    // the shop between them do everything the card does.
    <PressableScale
      onPress={service.bookable ? onPress : onShop}
      scaleTo={0.98}
      accessible={false}
      style={[styles.card, width !== undefined && { width }]}
    >
      <View>
        <Cover
          uri={service.imageUrl ?? service.business.coverImageUrl}
          categoryIcon={service.business.category?.icon}
          style={[styles.photo, !service.bookable && styles.photoOff]}
          iconSize={40}
        />
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
          style={styles.shade}
          pointerEvents="none"
        />

        <View style={styles.heart}>
          <SaveButton saved onPress={onSave} onPhoto />
        </View>

        {/* On sale (§186). */}
        {service.discount && (
          <View style={styles.sale}>
            <SaleBadge percent={service.discount.percent} large />
          </View>
        )}

        {/* The two numbers a person compares, on the picture. */}
        <View style={styles.onPhoto} pointerEvents="none">
          <Text style={styles.price}>
            {price}
            {service.discount && (
              <Text style={styles.was}>{`  ${money.format(service.discount.listPriceMinor)}`}</Text>
            )}
          </Text>
          <View style={styles.facts}>
            <View style={styles.fact}>
              <Icon name="time-outline" size={12} color="#FFFFFF" />
              <Text style={styles.factText}>{duration(service.durationMinutes)}</Text>
            </View>
            {rated && (
              <View style={styles.fact}>
                <Icon name="star" size={12} color={theme.star} />
                <Text style={styles.factText}>{service.location.ratingAvg?.toFixed(1)}</Text>
              </View>
            )}
            {service.bookingCount > 0 && (
              <View style={styles.fact}>
                <Icon name="flame" size={12} color="#FFB08A" />
                <Text style={styles.factText}>{service.bookingCount} booked</Text>
              </View>
            )}
          </View>
        </View>

        {!service.bookable && (
          <View style={styles.paused} pointerEvents="none">
            <Icon name="pause-circle" size={16} color="#FFFFFF" />
            <Text style={styles.pausedText}>Not taking bookings right now</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <View style={styles.flex}>
          <Text style={styles.name} numberOfLines={1}>
            {service.name}
          </Text>
          <PressableScale onPress={onShop} hitSlop={6} style={styles.shopRow} accessibilityRole="button">
            <Avatar uri={service.business.logoUrl} name={shop} size={22} />
            <Text style={styles.shop} numberOfLines={1}>
              {shop}
              {service.location.district ? ` · ${service.location.district.name}` : ''}
            </Text>
          </PressableScale>
        </View>

        {service.bookable ? (
          <PressableScale
            onPress={onPress}
            haptic
            scaleTo={0.93}
            accessibilityRole="button"
            accessibilityLabel={`Book ${service.name}`}
            style={styles.book}
          >
            <Text style={styles.bookText}>Book</Text>
            <Icon name="arrow-forward" size={15} color="#FFFFFF" />
          </PressableScale>
        ) : (
          <Text style={styles.stays}>Stays here</Text>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 8,
    ...shadow.card,
  },
  photo: { width: '100%', height: 168, borderRadius: radius.lg },
  photoOff: { opacity: 0.55 },
  shade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 96,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  heart: { position: 'absolute', top: 10, right: 10 },
  sale: { position: 'absolute', top: 12, left: 12 },
  was: {
    fontFamily: font.semibold,
    fontSize: 13,
    color: 'rgba(255,255,255,0.78)',
    textDecorationLine: 'line-through',
  },
  onPhoto: { position: 'absolute', left: 14, right: 14, bottom: 12, gap: 5 },
  price: { fontFamily: font.extrabold, fontSize: 20, color: '#FFFFFF', letterSpacing: -0.3 },
  facts: { flexDirection: 'row', gap: 10 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  factText: { fontFamily: font.bold, fontSize: 12, color: 'rgba(255,255,255,0.92)' },
  paused: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(31,42,31,0.78)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pausedText: { fontFamily: font.bold, fontSize: 12, color: '#FFFFFF' },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 6,
  },
  name: { fontFamily: font.bold, fontSize: 16.5, color: theme.ink },
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 5 },
  shop: { flexShrink: 1, fontFamily: font.semibold, fontSize: 13, color: theme.ink2 },
  book: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.night,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  bookText: { fontFamily: font.bold, fontSize: 14, color: '#FFFFFF' },
  stays: { fontFamily: font.semibold, fontSize: 12.5, color: theme.muted },
});
