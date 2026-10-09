import { useRef, useState } from 'react';
import { Animated, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getRoute, getShop, getShopReviews, type ShopService } from '../../src/api/discovery';
import { routeLabel } from '../../src/routeLabel';
import { useNearMe } from '../../src/useNearMe';
import { openInquiry } from '../../src/api/chat';
import { useSaved } from '../../src/useSaved';
import { useSavedService } from '../../src/useSavedService';
import { shareShop } from '../../src/share';
import { SaveButton } from '../../src/components/SaveButton';
import { SaleBadge } from '../../src/components/Sale';
import { useSignedIn } from '../../src/api/client';
import { duration } from '../../src/duration';
import { useMoney } from '../../src/money';
import { font, radius, shadow, theme, type } from '../../src/theme';
import { Avatar } from '../../src/ui/Avatar';
import { Button } from '../../src/ui/Button';
import { Cover } from '../../src/ui/Cover';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { Icon } from '../../src/ui/Icon';
import { IconButton } from '../../src/ui/IconButton';
import { useLayout } from '../../src/ui/layout';
import { PhotoViewer } from '../../src/ui/PhotoViewer';
import { Pill } from '../../src/ui/Pill';
import { PressableScale } from '../../src/ui/PressableScale';
import { Segmented } from '../../src/ui/Segmented';
import { Skeleton } from '../../src/ui/Skeleton';
import { Stars } from '../../src/ui/Stars';
import { TopBar } from '../../src/ui/TopBar';
import { showProblem } from '../../src/ui/Dialog';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** How tall the picture at the top is. The sheet below overlaps its last 28pt. */
const HERO = 300;

const niceDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

/**
 * One shop: what it does, what it costs, and what people said.
 *
 * The deposit is spelled out on every service, because it is the number that
 * surprises people. The platform takes a percentage at booking and the rest is
 * paid at the shop (§2) — a price with no mention of that reads as the whole
 * amount being due now.
 *
 * The picture fills the top of the screen and the page rides up over it as a
 * rounded sheet (§133). Scrolling moves the picture at half speed, and pulling
 * down stretches it — small things, but they are what make a photograph feel
 * like the place rather than a banner above some text.
 */
export default function Shop() {
  const { id, tab: openOn } = useLocalSearchParams<{ id: string; tab?: string }>();
  const money = useMoney();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const scrollY = useRef(new Animated.Value(0)).current;
  // A link can open straight on a tab — "See all reviews" on a service (§179).
  const [tab, setTab] = useState<'services' | 'hours' | 'reviews'>(
    openOn === 'reviews' || openOn === 'hours' ? openOn : 'services',
  );
  const [photo, setPhoto] = useState<number | null>(null);

  const shop = useQuery({ queryKey: ['shop', id], queryFn: () => getShop(id) });
  const reviews = useQuery({
    queryKey: ['shop-reviews', id],
    queryFn: () => getShopReviews(id),
  });

  const saved = useSaved();
  const signedIn = useSignedIn();
  const savedService = useSavedService();

  // The real road from here, once the phone has said where here is (§157).
  // Never asks for the permission itself (§107.3); it uses one already given.
  const nearMe = useNearMe();
  const position = nearMe.state.status === 'on' ? nearMe.state : null;
  const route = useQuery({
    queryKey: ['route', id, position?.lat.toFixed(3), position?.lng.toFixed(3)],
    queryFn: () => getRoute(id, { lat: position!.lat, lng: position!.lng }),
    enabled: position !== null,
    staleTime: 10 * 60_000,
  });
  const way = routeLabel(route.data);

  /**
   * Idempotent on the server (§21.1), so this is safe to tap repeatedly: a
   * customer asking a second question weeks later lands in the same thread
   * rather than starting a parallel one the shop has to notice separately.
   */
  const openChat = useMutation({
    mutationFn: () => openInquiry(shop.data!.business.id),
    onSuccess: (thread) => router.push(`/thread/${thread.id}`),
    onError: (error) =>
      showProblem('Could not open that', error),
  });

  if (shop.isLoading) {
    return (
      <View style={styles.screen}>
        <Skeleton height={HERO} round={0} />
        <View style={[styles.sheet, styles.loading]}>
          <Skeleton width="30%" height={22} round={11} />
          <Skeleton width="70%" height={26} />
          <Skeleton width="90%" />
          <Skeleton width="50%" />
          <Skeleton height={54} round={27} style={styles.loadingGap} />
          <Skeleton height={92} round={radius.lg} />
          <Skeleton height={92} round={radius.lg} />
        </View>
        <View style={[styles.floating, { top: insets.top + 8 }]}>
          <IconButton icon="chevron-back" label="Go back" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  if (shop.isError || !shop.data) {
    return (
      <View style={styles.screen}>
        <TopBar title="Place" />
        <EmptyState icon="storefront-outline" title="This place is not available right now." />
      </View>
    );
  }

  const s = shop.data;
  const today = new Date().getDay();
  const displayName = s.business.name ?? s.name;

  const share = () =>
    shareShop({
      id: s.id,
      name: s.name,
      address: s.address,
      businessName: s.business.name,
      districtName: s.district?.name ?? null,
      fromPrice:
        s.services.length > 0
          ? money.format(Math.min(...s.services.map((service) => service.priceMinor)))
          : null,
    });

  // The picture moves at half the speed of the page, and stretches when the
  // page is pulled down past its top.
  const heroShift = scrollY.interpolate({
    inputRange: [-HERO, 0, HERO],
    outputRange: [0, 0, -HERO / 2],
    extrapolate: 'clamp',
  });
  const heroScale = scrollY.interpolate({
    inputRange: [-HERO, 0],
    outputRange: [2, 1],
    extrapolateRight: 'clamp',
  });
  // The bar behind the round buttons fades in as the title scrolls under it,
  // so there is always a name on screen saying whose page this is.
  const barOpacity = scrollY.interpolate({
    inputRange: [HERO - 150, HERO - 90],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.screen}>
      <Animated.View
        style={[styles.hero, { transform: [{ translateY: heroShift }, { scale: heroScale }] }]}
      >
        <Cover
          uri={s.business.coverImageUrl}
          categoryIcon={s.business.category?.icon}
          style={styles.heroCover}
          iconSize={64}
        />
      </Animated.View>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        contentContainerStyle={{ paddingTop: HERO - 28, paddingBottom: insets.bottom + 36 }}
      >
        <View style={styles.sheet}>
          <View style={[styles.column, { maxWidth: layout.contentWidth }]}>
            <FadeIn>
              <View style={styles.pills}>
                {s.openNow ? (
                  <Pill label="Open now" tone="ok" dot />
                ) : (
                  <Pill label="Closed" tone="neutral" />
                )}
                {s.business.subcategory && (
                  <Pill label={s.business.subcategory.name} tone="accent" />
                )}
              </View>

              <View style={styles.titleRow}>
                <Text style={[type.title, styles.flex]}>{displayName}</Text>
                {s.business.logoUrl && (
                  <Avatar uri={s.business.logoUrl} name={displayName} size={52} />
                )}
              </View>

              <View style={styles.line}>
                <Icon name="location-outline" size={16} color={theme.muted} />
                <Text style={[type.body, styles.flex]}>
                  {s.name} · {s.address}
                </Text>
              </View>
              {s.district && (
                <Text style={[type.small, styles.indent]}>
                  {s.district.name}, {s.district.provinceName}
                </Text>
              )}
              {way && (
                <View style={[styles.line, styles.wayLine]}>
                  <Icon name="car-outline" size={16} color={theme.accent} />
                  <Text style={[type.small, styles.flex, styles.way]}>{way}</Text>
                </View>
              )}

              {/* Only once there is one. "No reviews yet" is not a fact about
                  the shop, and it read as a mark against it (§153). */}
              {s.rating.count > 0 && (
                <View style={[styles.line, styles.ratingLine]}>
                  <Icon name="star" size={16} color={theme.star} />
                  <Text style={styles.ratingScore}>{s.rating.average?.toFixed(1)}</Text>
                  <Text style={type.small}>from {s.rating.count} reviews</Text>
                </View>
              )}

              {s.business.description && (
                <Text style={[type.body, styles.description]}>{s.business.description}</Text>
              )}
            </FadeIn>

            {/* Before booking, not after. Most questions people have — do you take
                card, is there parking, can you do this on a Sunday — are the reason
                they do NOT book, and there was nowhere to ask them. */}
            {/* For someone signed in (§170): a conversation needs a person to
                belong to. */}
            {signedIn && (
              <FadeIn delay={80}>
                <Button
                  kind="soft"
                  icon="chatbubble-ellipses-outline"
                  label={openChat.isPending ? 'Opening…' : 'Message the shop'}
                  disabled={openChat.isPending}
                  onPress={() => openChat.mutate()}
                />
              </FadeIn>
            )}

            {/* The branch's own photos. They were sent with every shop and
                drawn by nothing; a customer could not see inside a place
                before walking to it. */}
            {/* A heading with the count, a strip of the first six that open
                the viewer (§148), and "See all" to the gallery page — the wall
                of every photo of the place and of its services (§152). */}
            {s.gallery.length > 0 && (
              <FadeIn delay={120} style={styles.section}>
                <View style={styles.galleryHead}>
                  <Text style={type.heading}>
                    Photos <Text style={styles.galleryCount}>{s.gallery.length}</Text>
                  </Text>
                  <PressableScale onPress={() => router.push(`/gallery/${s.id}`)} hitSlop={8} haptic>
                    <Text style={styles.link}>See all →</Text>
                  </PressableScale>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.bleed}
                  contentContainerStyle={styles.gallery}
                >
                  {s.gallery.slice(0, 6).map((photo, index) => {
                    const last = index === 5 && s.gallery.length > 6;
                    return (
                      <PressableScale
                        key={photo.id}
                        scaleTo={0.96}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={`Photo ${index + 1} of ${s.gallery.length}`}
                        onPress={() => setPhoto(index)}
                      >
                        <Image source={{ uri: photo.url }} style={styles.galleryPhoto} />
                        {last && (
                          <View style={styles.galleryMore}>
                            <Text style={styles.galleryMoreText}>+{s.gallery.length - 6}</Text>
                          </View>
                        )}
                      </PressableScale>
                    );
                  })}
                </ScrollView>
              </FadeIn>
            )}

            {/* Three views of one shop, switched rather than stacked (§138). A
                shop with a long list of services pushed its hours and reviews
                a long scroll down, where most people never reached them. */}
            <FadeIn delay={160}>
              <Segmented
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'services', label: 'What they do' },
                  { value: 'hours', label: 'Open hours' },
                  {
                    value: 'reviews',
                    label: reviews.data?.total ? `Reviews (${reviews.data.total})` : 'Reviews',
                  },
                ]}
              />
            </FadeIn>

            {tab === 'services' && (
            <FadeIn key="services" style={styles.section}>
              {s.services.length === 0 && (
                <Text style={type.small}>Nothing is bookable here yet.</Text>
              )}
              {s.services.map((service) => (
                <ServiceRow
                  key={service.id}
                  service={service}
                  categoryIcon={s.business.category?.icon}
                  format={money.format}
                  onPress={() => router.push(`/book/${s.id}?serviceId=${service.id}`)}
                  onSave={() =>
                    savedService.toggle(service.id, s.id, service.saved ?? false, `/shop/${s.id}`)
                  }
                />
              ))}
            </FadeIn>
            )}

            {tab === 'hours' && (
            <FadeIn key="hours" style={styles.section}>
              <View style={styles.card}>
                {s.hours.map((h) => {
                  const isToday = h.dayOfWeek === today;
                  return (
                    <View key={h.dayOfWeek} style={[styles.hourRow, isToday && styles.hourRowToday]}>
                      <Text style={[styles.day, isToday && styles.dayToday]}>
                        {DAYS[h.dayOfWeek]}
                      </Text>
                      <Text
                        style={[
                          h.isClosed ? styles.hourClosed : styles.hourText,
                          isToday && !h.isClosed && styles.dayToday,
                        ]}
                      >
                        {h.isClosed ? 'Closed' : `${h.openTime} – ${h.closeTime}`}
                      </Text>
                    </View>
                  );
                })}

                {/* Days that differ from the usual week (§91). Worth seeing before
                    choosing a date, not after. */}
                {s.upcomingExceptions.length > 0 && (
                  <View style={styles.exceptions}>
                    <Text style={type.label}>Coming up</Text>
                    {s.upcomingExceptions.map((exception) => (
                      <View key={exception.date} style={styles.hourRow}>
                        <Text style={styles.day}>{niceDate(exception.date)}</Text>
                        <Text style={exception.isClosed ? styles.closedDay : styles.hourText}>
                          {exception.isClosed
                            ? 'Closed'
                            : `${exception.customOpenTime} – ${exception.customCloseTime}`}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </FadeIn>
            )}

            {tab === 'reviews' && (
            <FadeIn key="reviews" style={styles.section}>

              {s.rating.count > 0 && (
                <View style={[styles.card, styles.summary]}>
                  <Text style={styles.summaryScore}>{s.rating.average?.toFixed(1)}</Text>
                  <View style={styles.summarySide}>
                    <Stars rating={s.rating.average ?? 0} size={18} />
                    <Text style={type.small}>from {s.rating.count} reviews</Text>
                  </View>
                </View>
              )}

              {reviews.data?.reviews.length === 0 && (
                <Text style={type.small}>Nobody has reviewed this place yet.</Text>
              )}
              {reviews.data?.reviews.map((review) => (
                <View key={review.id} style={[styles.card, styles.review]}>
                  <View style={styles.reviewHead}>
                    <Avatar name={review.displayName} size={38} />
                    <View style={styles.flex}>
                      <Text style={styles.reviewName}>{review.displayName}</Text>
                      <Stars rating={review.rating} size={13} />
                    </View>
                  </View>
                  {review.comment && <Text style={type.body}>{review.comment}</Text>}
                  {/* The shop's reply, which is often the more useful half. */}
                  {review.responseText && (
                    <View style={styles.reply}>
                      <Text style={type.label}>They replied</Text>
                      <Text style={type.body}>{review.responseText}</Text>
                    </View>
                  )}
                </View>
              ))}
            </FadeIn>
            )}
          </View>
        </View>
      </Animated.ScrollView>

      <PhotoViewer photos={s.gallery} openAt={photo} onClose={() => setPhoto(null)} />

      {/* The bar that appears once the title has scrolled away. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.bar, { height: insets.top + 60, opacity: barOpacity }]}
      >
        <Text style={[styles.barTitle, { marginTop: insets.top }]} numberOfLines={1}>
          {displayName}
        </Text>
      </Animated.View>

      {/* Floating over the picture, so they are reachable without scrolling
          back to the top. */}
      <View style={[styles.floating, { top: insets.top + 8 }]}>
        <IconButton
          icon="chevron-back"
          label="Go back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
        <View style={styles.floatingRight}>
          <IconButton icon="share-outline" label="Share this place" onPress={share} />
          <SaveButton
            saved={s.saved}
            large
            onPhoto
            onPress={() => saved.toggle(s.id, s.saved ?? false, `/shop/${s.id}`)}
          />
        </View>
      </View>
    </View>
  );
}

function ServiceRow({
  service,
  categoryIcon,
  format,
  onPress,
  onSave,
}: {
  service: ShopService;
  categoryIcon?: string | null;
  format: (minor: number | null | undefined, code?: string | null) => string;
  onPress: () => void;
  onSave: () => void;
}) {
  // Rounded the way the server does it, so the figure shown is the figure
  // charged — the deposit is a percentage of the price, taken at booking.
  const depositMinor = Math.round(
    (service.priceMinor * Number(service.depositPercentage)) / 100,
  );

  return (
    <PressableScale style={[styles.card, styles.service]} onPress={onPress} scaleTo={0.98}>
      {/* The cover photo (§132). A fixed box either way, so rows do not change
          height depending on whether a business has uploaded anything. */}
      <View>
        <Cover
          uri={service.images[0]?.url}
          categoryIcon={categoryIcon}
          style={styles.serviceThumb}
          iconSize={24}
        />
        {/* On sale (§186): the percentage on the picture's corner. */}
        {service.discount && (
          <View style={styles.thumbSale}>
            <SaleBadge percent={service.discount.percent} />
          </View>
        )}
      </View>
      <View style={styles.serviceMain}>
        <Text style={styles.serviceName} numberOfLines={2}>
          {service.name}
        </Text>
        {service.description && (
          <Text style={type.small} numberOfLines={2}>
            {service.description}
          </Text>
        )}
        <View style={styles.line}>
          <Icon name="time-outline" size={13} color={theme.muted} />
          <Text style={type.small}>{duration(service.durationMinutes, true)}</Text>
        </View>
        <View style={styles.servicePrice}>
          <Text style={[styles.price, service.discount && styles.priceSale]}>
            {format(service.priceMinor, service.currency)}
          </Text>
          {/* On sale (§186): the old price crossed out, and how much off. */}
          {service.discount && (
            <Text style={styles.was}>{format(service.discount.listPriceMinor, service.currency)}</Text>
          )}
          <Text style={styles.deposit}>pay {format(depositMinor, service.currency)} now</Text>
        </View>
      </View>
      <View style={styles.serviceSide}>
        {/* Draws nothing signed out: `saved` is absent then (§120.2). */}
        <SaveButton saved={service.saved} onPress={onSave} small />
        <View style={styles.go}>
          <Icon name="arrow-forward" size={17} color="#FFFFFF" />
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  hero: { position: 'absolute', top: 0, left: 0, right: 0, height: HERO },
  heroCover: { width: '100%', height: HERO },
  sheet: {
    backgroundColor: theme.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: 20,
    paddingTop: 22,
    minHeight: 500,
  },
  column: { width: '100%', alignSelf: 'center', gap: 22 },
  loading: { marginTop: -28, gap: 12, flex: 1 },
  loadingGap: { marginVertical: 8 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  indent: { marginLeft: 22, marginTop: 2 },
  ratingLine: { marginTop: 10 },
  wayLine: { marginTop: 8 },
  way: { fontFamily: font.bold, color: theme.ink2 },
  ratingScore: { fontFamily: font.bold, fontSize: 14.5, color: theme.ink },
  description: { marginTop: 14 },
  bleed: { marginHorizontal: -20 },
  galleryHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  galleryCount: { color: theme.muted, fontFamily: font.semibold },
  link: { fontFamily: font.bold, fontSize: 13, color: theme.accent },
  gallery: { paddingHorizontal: 20, gap: 10 },
  galleryMore: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.md,
    backgroundColor: 'rgba(31,42,31,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryMoreText: { fontFamily: font.extrabold, fontSize: 20, color: '#FFFFFF' },
  galleryPhoto: {
    width: 150,
    height: 112,
    borderRadius: radius.md,
    backgroundColor: theme.line,
  },
  section: { gap: 12 },
  serviceSide: { alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 14,
    ...shadow.card,
  },
  service: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 10 },
  serviceThumb: { width: 84, height: 96, borderRadius: radius.md },
  thumbSale: { position: 'absolute', left: 5, top: 5 },
  serviceMain: { flex: 1, gap: 4, paddingVertical: 2 },
  serviceName: { fontFamily: font.bold, fontSize: 15.5, lineHeight: 20, color: theme.ink },
  servicePrice: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 3 },
  price: { fontFamily: font.extrabold, fontSize: 15.5, color: theme.ink },
  priceSale: { color: theme.accentDeep },
  was: {
    fontFamily: font.semibold,
    fontSize: 12.5,
    color: theme.muted,
    textDecorationLine: 'line-through',
  },
  deposit: {
    fontFamily: font.bold,
    fontSize: 11.5,
    color: theme.accent,
    backgroundColor: theme.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  go: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.night,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  hourRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
  },
  hourRowToday: { backgroundColor: theme.accentSoft },
  day: { fontFamily: font.medium, fontSize: 14, color: theme.ink2 },
  dayToday: { fontFamily: font.bold, color: theme.accent },
  hourText: { fontFamily: font.semibold, fontSize: 14, color: theme.ink },
  hourClosed: { fontFamily: font.medium, fontSize: 14, color: theme.muted },
  closedDay: { fontFamily: font.bold, fontSize: 14, color: theme.danger },
  exceptions: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: 12,
    gap: 2,
  },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 18 },
  summaryScore: { fontFamily: font.extrabold, fontSize: 44, lineHeight: 50, color: theme.ink, letterSpacing: -1 },
  summarySide: { gap: 5 },
  review: { gap: 10 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  reviewName: { fontFamily: font.bold, fontSize: 14.5, color: theme.ink, marginBottom: 3 },
  reply: {
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    padding: 12,
    gap: 4,
  },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
  },
  barTitle: { fontFamily: font.bold, fontSize: 16.5, color: theme.ink, maxWidth: '50%' },
  floating: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  floatingRight: { flexDirection: 'row', gap: 10 },
});
