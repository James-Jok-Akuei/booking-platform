import { Image, StyleSheet, Text, View } from 'react-native';
import type { DiscoveredService } from '../api/discovery';
import { font, radius, shadow, theme } from '../theme';
import { Cover } from '../ui/Cover';
import { Icon } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';
import { SaveButton } from './SaveButton';
import { SaleBadge } from './Sale';
import { SaleEndsChip } from './SaleCountdown';
import { distanceLabel } from '../distance';
import { duration } from '../duration';

/**
 * One service, small (§135.3).
 *
 * The size is the design. A phone shows two and a half of these across, so a
 * shelf of eight is one swipe and a screen holds three shelves — where the
 * full-width place cards it replaces showed one and a half places per screen.
 *
 * Everything that decides a tap is in the top half, on or just under the
 * picture: what it is, what it costs, and whether other people chose it. The
 * shop's name is there because the same "Haircut" is sold by six shops and the
 * card has to say whose this is.
 *
 * ~~A numbered medal on the first three of the "most popular" shelf~~ — gone
 * (§151): the shelf's order already says it, and "N booked" is the honest
 * number.
 */
export function ServiceCard({
  service,
  price,
  width,
  onPress,
  onSave,
}: {
  service: DiscoveredService;
  /** Already formatted. */
  price: string;
  width: number;
  onPress: () => void;
  /** Toggles the heart. The heart shows only when `service.saved` is known (signed in). */
  onSave?: () => void;
}) {
  const away = distanceLabel(service.location.distanceKm);
  // "Kimironko Branch" says more than "Gasabo" to someone who knows the city,
  // so the branch's own name is used when it has one; a branch that only
  // repeats the business's name falls back to its district.
  const shopName = service.business.name ?? service.location.name;
  // "Branch" is dropped: on a card this narrow it is the word that pushes the
  // actual place name off the end.
  const place =
    service.location.name !== shopName
      ? service.location.name.replace(/\s+branch$/i, '')
      : (service.location.district?.name ?? service.location.name);
  const rated = service.location.ratingCount > 0 && service.location.ratingAvg !== null;
  const sale = service.discount;

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.96}
      accessibilityRole="button"
      accessibilityLabel={`${service.name} at ${service.business.name ?? service.location.name}, ${price}${sale ? `, ${sale.percent} percent off` : ''}`}
      style={[styles.card, { width }]}
      // The heart (§158), only for a signed-in reader — `saved` is absent
      // otherwise, and the button draws nothing for undefined. On top of the
      // card rather than in it: it is a button of its own.
      overlay={
        onSave && (
          <View style={styles.heart}>
            <SaveButton saved={service.saved} onPress={onSave} onPhoto small />
          </View>
        )
      }
    >
      <View>
        <Cover
          uri={service.imageUrl ?? service.business.coverImageUrl}
          categoryIcon={service.business.category?.icon}
          style={[styles.cover, { height: Math.round(width * 0.72) }]}
          iconSize={30}
        />

        {/* The business's logo, on the photo's corner — only when the
            business uploaded one (§150). Nothing stands in for it: a card
            with no logo badge is a business that has not added one. */}
        {service.business.logoUrl && (
          <View style={[styles.logo, sale && styles.logoUnderSale]}>
            <Image source={{ uri: service.business.logoUrl }} style={styles.logoImage} />
          </View>
        )}


        {/* On sale (§186): the percentage in the top corner, the logo under
            it. The crossed-out old price is on the service's own page — a card
            this narrow cannot hold two prices without cutting one short. */}
        {sale && (
          <View style={styles.sale}>
            <SaleBadge percent={sale.percent} />
          </View>
        )}

        {/* How long the sale has left, ticking (§283) — on the picture, so a
            shelf of cards keeps one straight line along the bottom. */}
        {sale?.endsAt && <SaleEndsChip endsAt={sale.endsAt} onPhoto style={styles.saleClock} />}

        {/* How long it takes, on the picture: it is the second thing people
            ask after the price, and it costs no row of its own here. */}
        <View style={[styles.duration, sale?.endsAt && styles.durationAboveClock]}>
          <Icon name="time-outline" size={11} color="#FFFFFF" />
          <Text style={styles.durationText}>{duration(service.durationMinutes)}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>
          {service.name}
        </Text>
        <Text style={styles.shop} numberOfLines={1}>
          {service.business.name ?? service.location.name}
        </Text>

        {/* WHERE (§146): the branch, or its district when the branch is simply
            named after the business — and how far, once that is known (§139).
            The place gives way first, because a distance cut short is not a
            distance. */}
        <View style={styles.whereRow}>
          <Icon name="location" size={11} color={theme.accent} />
          <Text style={[styles.where, styles.whereName]} numberOfLines={1}>
            {place}
          </Text>
          {away && (
            <Text style={styles.away} numberOfLines={1}>
              {away}
            </Text>
          )}
        </View>

        {/* The price has a line to itself: it is the one thing on the card
            that must never be cut short, and "RWF 7,0…" is not a price. */}
        <Text
          style={[styles.price, sale && styles.priceSale]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
        >
          {price}
        </Text>

        {/* The proof that other people picked it: how the shop is rated and
            how often this was booked. Each shown only when there is some —
            "0 booked" is an argument against. The row keeps its height either
            way, so a shelf of cards is one straight line along the bottom. */}
        <View style={styles.proof}>
          {rated && (
            <View style={styles.meta}>
              <Icon name="star" size={11} color={theme.star} />
              <Text style={styles.metaText}>{service.location.ratingAvg?.toFixed(1)}</Text>
            </View>
          )}
          {service.bookingCount > 0 && (
            <View style={styles.meta}>
              <Icon name="flame" size={11} color={theme.accent} />
              <Text style={styles.booked}>{service.bookingCount} booked</Text>
            </View>
          )}
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 6,
    ...shadow.card,
  },
  cover: { borderRadius: radius.md, width: '100%' },
  // The card's padding (6) and the photo's corner inset (7).
  heart: { position: 'absolute', top: 13, right: 13 },
  logo: {
    position: 'absolute',
    top: 7,
    left: 7,
    width: 30,
    height: 30,
    borderRadius: 15,
    padding: 2,
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  logoImage: { width: '100%', height: '100%', borderRadius: 13 },
  duration: {
    position: 'absolute',
    right: 7,
    bottom: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(31,42,31,0.72)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  durationText: { fontFamily: font.bold, fontSize: 10.5, color: '#FFFFFF' },
  body: { paddingHorizontal: 5, paddingTop: 8, paddingBottom: 5, gap: 2 },
  name: { fontFamily: font.bold, fontSize: 13.5, lineHeight: 17.5, color: theme.ink, minHeight: 35 },
  shop: { fontFamily: font.medium, fontSize: 11.5, color: theme.muted },
  whereRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  where: { fontFamily: font.semibold, fontSize: 11, color: theme.ink2 },
  whereName: { flex: 1 },
  away: { flexShrink: 0, fontFamily: font.bold, fontSize: 11, color: theme.ink2 },
  price: { fontFamily: font.extrabold, fontSize: 14, color: theme.ink, marginTop: 4 },
  priceSale: { color: theme.accentDeep },
  sale: { position: 'absolute', left: 7, top: 7 },
  saleClock: { position: 'absolute', left: 7, bottom: 7 },
  // A card this narrow cannot hold the countdown and the length side by side.
  durationAboveClock: { bottom: 33 },
  logoUnderSale: { top: 34 },
  proof: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 16 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaText: { fontFamily: font.bold, fontSize: 11.5, color: theme.ink2 },
  booked: { fontFamily: font.bold, fontSize: 11, color: theme.accent },
});
