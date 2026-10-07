import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  discoverLocations,
  discoverServices,
  type DiscoveredLocation,
  type DiscoveredService,
} from '../api/discovery';
import { distanceLabel } from '../distance';
import { duration } from '../duration';
import { useMoney } from '../money';
import { font, radius, theme } from '../theme';
import { Icon, lookFor, type IconName } from '../ui/Icon';
import { tick } from '../ui/haptic';
import { useReducedMotion } from '../ui/Motion';
import { PressableScale } from '../ui/PressableScale';

/** How long each spotlight is on screen. */
const SLIDE_MS = 5200;
/**
 * Away from the app this long counts as a new visit: a closed banner comes
 * back, with a fresh set, and goes round once more.
 */
const NEW_VISIT_MS = 30 * 60 * 1000;
const DOTS_H = 22;

/**
 * Closed with the × until the next visit. Kept outside the component so
 * leaving Home and coming back within the visit does not reopen it.
 */
let closedThisVisit = false;

/**
 * Each spotlight's own look (§176): a colour of its own, an icon and a large
 * faint motif behind the picture, so six in a row never read as one card
 * repeated — and a CTA in the deepest shade of the same colour.
 */
const LOOKS = {
  booked: { from: '#8E1238', to: '#F0532D', glow: '#FFB59E', ink: '#B4232C', icon: 'flame' },
  rated: { from: '#2E0A63', to: '#7C3AED', glow: '#C9B8FF', ink: '#5B21B6', icon: 'star' },
  near: { from: '#053B2E', to: '#0E9F6E', glow: '#7CE8BF', ink: '#047857', icon: 'navigate' },
  price: { from: '#8A2C0B', to: '#F59E0B', glow: '#FFE08A', ink: '#B45309', icon: 'pricetag' },
  fresh: { from: '#13296B', to: '#3B82F6', glow: '#BCD6FF', ink: '#1D4ED8', icon: 'sparkles' },
  business: { from: '#07090F', to: '#2B3243', glow: '#F5C451', ink: '#0B0F19', icon: 'trophy' },
} satisfies Record<string, { from: string; to: string; glow: string; ink: string; icon: IconName }>;

type Kind = keyof typeof LOOKS;

type Spot = {
  key: string;
  kind: Kind;
  kicker: string;
  title: string;
  line: string;
  /** The one number that is the reason it is here: "★ 5.0", "1.3 km", "RWF 5,000". */
  stat: string;
  image: string | null;
  logo: string | null;
  categoryIcon: string | null;
  cta: string;
  label: string;
  open: () => void;
};

const shopOf = (s: DiscoveredService) => s.business.name ?? s.location.name;
const areaOf = (s: DiscoveredService) => s.location.district?.name ?? s.location.name;

/**
 * The banner at the top of Home (§176): six spotlights, each a reason to look
 * at one thing — the most booked service, the best rated, the nearest, the
 * best price, the newest, and the best rated business.
 *
 * Built from the same search the rest of Home uses, so every spotlight is a
 * real service someone can book now; none is paid for. Each service is in one
 * spotlight at most, so the six are six different things.
 *
 * It goes round each spotlight once and then STOPS, back on the first, where
 * it stays (§178): a banner that keeps moving is a distraction, and one that
 * folds itself away moves everything under the reader's finger. Swiping still
 * works. The × puts it away until the next visit, when it returns with a
 * fresh set and goes round once more. Touching it holds it still.
 */
export function Spotlights({
  width,
  position,
  gap = 0,
}: {
  width: number;
  position: { lat: number; lng: number } | null;
  /** The parent's gap, given back while folded so no empty band is left. */
  gap?: number;
}) {
  const router = useRouter();
  const money = useMoney();
  const reduced = useReducedMotion();

  const fresh = { staleTime: 5 * 60_000 };
  const booked = useQuery({
    queryKey: ['spotlight', 'popular'],
    queryFn: () => discoverServices({ sort: 'popular', limit: 8 }),
    ...fresh,
  });
  const rated = useQuery({
    queryKey: ['spotlight', 'rating'],
    queryFn: () => discoverServices({ sort: 'rating', limit: 8 }),
    ...fresh,
  });
  const cheap = useQuery({
    queryKey: ['spotlight', 'price'],
    queryFn: () => discoverServices({ sort: 'price', limit: 4 }),
    ...fresh,
  });
  const newest = useQuery({
    queryKey: ['spotlight', 'newest'],
    queryFn: () => discoverServices({ sort: 'newest', limit: 8 }),
    ...fresh,
  });
  const nearest = useQuery({
    queryKey: ['spotlight', 'distance', position?.lat, position?.lng],
    queryFn: () =>
      discoverServices({ sort: 'distance', lat: position!.lat, lng: position!.lng, limit: 4 }),
    enabled: position !== null,
    ...fresh,
  });
  const business = useQuery({
    queryKey: ['spotlight', 'business'],
    queryFn: () => discoverLocations({ sort: 'rating', limit: 3 }),
    ...fresh,
  });

  const spots = useMemo(() => {
    const used = new Set<string>();
    const usedBusiness = new Set<string>();
    /** "Haircut at Kigali Barbers" — the same thing to a reader, whichever branch. */
    const seen = new Set<string>();
    const same = (s: DiscoveredService) => `${s.business.id}|${s.name.trim().toLowerCase()}`;
    const take = (s: DiscoveredService | undefined) => {
      if (!s) return undefined;
      used.add(`${s.id}:${s.location.id}`);
      usedBusiness.add(s.business.id);
      seen.add(same(s));
      return s;
    };
    const open = (list: DiscoveredService[] | undefined, ok: (s: DiscoveredService) => boolean) =>
      list?.filter((s) => !used.has(`${s.id}:${s.location.id}`) && ok(s)) ?? [];
    /**
     * EXACT: the first that qualifies, because the label has to stay true —
     * "Most booked" is the most booked. If that is something already shown
     * (the most booked haircut is also the cheapest), the spotlight is left
     * out rather than repeated or replaced by something it is not.
     */
    const exact = (list: DiscoveredService[] | undefined, ok: (s: DiscoveredService) => boolean) => {
      const first = open(list, ok)[0];
      return first && !seen.has(same(first)) ? take(first) : undefined;
    };
    /** VARIED: any that qualifies, a business not shown yet first. */
    const varied = (list: DiscoveredService[] | undefined, ok: (s: DiscoveredService) => boolean) => {
      const options = open(list, ok).filter((s) => !seen.has(same(s)));
      return take(options.find((s) => !usedBusiness.has(s.business.id)) ?? options[0]);
    };
    const service = (s: DiscoveredService) => ({
      key: `${s.id}:${s.location.id}`,
      title: s.name,
      image: s.imageUrl ?? s.business.coverImageUrl,
      logo: s.business.logoUrl,
      categoryIcon: s.business.category?.icon ?? null,
      cta: 'Book now',
      open: () => router.push(`/book/${s.location.id}?serviceId=${s.id}`),
    });

    const top = business.data?.locations.find(
      (l: DiscoveredLocation) => l.ratingCount > 0 && l.ratingAvg !== null,
    );
    if (top) usedBusiness.add(top.business.id);
    const b = exact(booked.data?.services, (s) => s.bookingCount > 0);
    const p = exact(cheap.data?.services, () => true);
    const n = exact(nearest.data?.services, (s) => typeof s.location.distanceKm === 'number');
    // "Top rated" is true of anything rated 4.5 or more, so it may choose.
    const r = varied(
      rated.data?.services,
      (s) => s.location.ratingCount > 0 && (s.location.ratingAvg ?? 0) >= 4.5,
    );
    const f = varied(newest.data?.services, () => true);

    const out: Spot[] = [];

    if (b) {
      out.push({
        ...service(b),
        kind: 'booked',
        kicker: 'Most booked',
        stat: `${b.bookingCount} booked`,
        line: `${shopOf(b)} · ${areaOf(b)}`,
        label: `Most booked: ${b.name} at ${shopOf(b)}, ${b.bookingCount} bookings.`,
      });
    }
    if (r) {
      const avg = (r.location.ratingAvg ?? 0).toFixed(1);
      out.push({
        ...service(r),
        kind: 'rated',
        kicker: 'Top rated',
        stat: `★ ${avg}`,
        line: `${shopOf(r)} · ${r.location.ratingCount} ${r.location.ratingCount === 1 ? 'review' : 'reviews'}`,
        label: `Top rated: ${r.name} at ${shopOf(r)}, rated ${avg}.`,
      });
    }
    if (n) {
      const away = distanceLabel(n.location.distanceKm) ?? '';
      out.push({
        ...service(n),
        kind: 'near',
        kicker: 'Near you',
        stat: away,
        line: `${shopOf(n)} · ${areaOf(n)}`,
        label: `Near you: ${n.name} at ${shopOf(n)}, ${away} away.`,
      });
    }
    if (p) {
      const price = money.format(p.priceMinor);
      out.push({
        ...service(p),
        kind: 'price',
        kicker: 'Best price',
        stat: price,
        line: `${shopOf(p)} · ${duration(p.durationMinutes)}`,
        label: `Best price: ${p.name} at ${shopOf(p)}, ${price}.`,
      });
    }
    if (f) {
      out.push({
        ...service(f),
        kind: 'fresh',
        kicker: 'Just added',
        stat: 'New',
        line: `New at ${shopOf(f)} · ${areaOf(f)}`,
        label: `Just added: ${f.name} at ${shopOf(f)}.`,
      });
    }
    if (top) {
      const avg = (top.ratingAvg ?? 0).toFixed(1);
      const name = top.business.name ?? top.name;
      out.push({
        key: `business:${top.id}`,
        kind: 'business',
        kicker: 'Top business',
        title: name,
        stat: `★ ${avg}`,
        line: `${top.ratingCount} ${top.ratingCount === 1 ? 'review' : 'reviews'} · ${top.district?.name ?? top.name}`,
        image: top.business.coverImageUrl ?? top.business.logoUrl,
        logo: top.business.logoUrl,
        categoryIcon: top.business.category?.icon ?? null,
        cta: 'Visit',
        label: `Top business: ${name}, rated ${avg} from ${top.ratingCount} reviews.`,
        open: () => router.push(`/shop/${top.id}`),
      });
    }
    return out;
  }, [booked.data, rated.data, nearest.data, cheap.data, newest.data, business.data, money, router]);

  /**
   * The set on show is fixed for a whole round (§176). The six searches land
   * one by one, and a slide slipped in ahead of the one being looked at would
   * move it out from under the reader — so nothing shows until all have
   * answered, and a new set is taken only at the start of a new visit.
   */
  const settled =
    [booked, rated, cheap, newest, business].every((q) => !q.isPending) &&
    (position === null || !nearest.isPending);
  const [round, setRound] = useState<Spot[]>([]);
  const latest = useRef(spots);
  latest.current = spots;
  useEffect(() => {
    if (settled && round.length === 0 && spots.length > 0) setRound(spots);
  }, [settled, round.length, spots]);

  const height = width < 320 ? 156 : width > 600 ? 196 : 172;
  const count = round.length;

  const [index, setIndex] = useState(0);
  /** Round done: back on the first spotlight and still. */
  const [finished, setFinished] = useState(false);
  const [closed, setClosed] = useState(closedThisVisit);
  const [held, setHeld] = useState(false);
  const scroller = useRef<ScrollView>(null);

  // Shown: 0 folded away, 1 open. Height can only be animated off the native
  // thread, so this one is JS-driven; everything inside the slides is native.
  /** The room the banner takes: 0 none, 1 all. JS-driven, because it is height. */
  const room = useRef(new Animated.Value(0)).current;
  /** The banner itself: fade, rise and scale. Native-driven. */
  const card = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  /**
   * Coming and going in two steps, so nothing jumps (§177).
   *
   * Arriving: the room opens first — the rows below ease down — and the
   * banner rises into it a moment later, fading in from a little small, with
   * a slight settle. Leaving is the same backwards: the banner fades and lifts
   * away first, THEN the room closes, so the rows below never slide under a
   * banner that is still there.
   */
  const open = count > 0 && !closed;
  useEffect(() => {
    const motion = open
      ? Animated.parallel([
          Animated.timing(room, {
            toValue: 1,
            duration: 460,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
          Animated.sequence([
            Animated.delay(reduced ? 0 : 170),
            Animated.spring(card, {
              toValue: 1,
              speed: 11,
              bounciness: reduced ? 0 : 5,
              useNativeDriver: true,
            }),
          ]),
        ])
      : Animated.sequence([
          Animated.timing(card, {
            toValue: 0,
            duration: reduced ? 1 : 260,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(room, {
            toValue: 0,
            duration: 420,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: false,
          }),
        ]);
    motion.start();
    return () => motion.stop();
  }, [open, room, card, reduced]);

  // One slow turn shared by every slide's motif, rather than six loops.
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 24_000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, spin]);

  // The round: each spotlight for SLIDE_MS, once, then back to the first.
  useEffect(() => {
    if (finished) {
      progress.setValue(1);
      return;
    }
    if (!open || held || count === 0) return;
    progress.setValue(0);
    const fill = Animated.timing(progress, {
      toValue: 1,
      duration: SLIDE_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    fill.start();
    const timer = setTimeout(() => {
      if (index + 1 < count) {
        setIndex(index + 1);
        scroller.current?.scrollTo({ x: (index + 1) * width, animated: true });
      } else {
        setFinished(true);
        setIndex(0);
        scroller.current?.scrollTo({ x: 0, animated: true });
      }
    }, SLIDE_MS);
    return () => {
      clearTimeout(timer);
      fill.stop();
    };
  }, [open, held, index, count, width, progress, finished]);

  /**
   * A new visit (§178): back from half an hour or more away, the banner
   * returns if it was closed, takes a fresh set, and goes round once more.
   */
  const awaySince = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        awaySince.current ??= Date.now();
        return;
      }
      const since = awaySince.current;
      awaySince.current = null;
      if (since === null || Date.now() - since < NEW_VISIT_MS) return;
      closedThisVisit = false;
      if (latest.current.length > 0) setRound(latest.current);
      setIndex(0);
      scroller.current?.scrollTo({ x: 0, animated: false });
      setFinished(false);
      setClosed(false);
    });
    return () => sub.remove();
  }, []);

  const close = () => {
    tick();
    closedThisVisit = true;
    setClosed(true);
  };

  // A spotlight that disappears (the nearest needs a position) cannot leave
  // the index pointing past the end.
  useEffect(() => {
    if (index >= count && count > 0) {
      setIndex(0);
      scroller.current?.scrollTo({ x: 0, animated: false });
    }
  }, [count, index]);

  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    setIndex(Math.max(0, Math.min(count - 1, next)));
    setHeld(false);
  };

  if (count === 0) return null;

  return (
    <Animated.View
      style={{
        height: room.interpolate({ inputRange: [0, 1], outputRange: [0, height + DOTS_H] }),
        marginBottom: room.interpolate({ inputRange: [0, 1], outputRange: [-gap, 0] }),
        overflow: 'hidden',
      }}
    >
      <Animated.View
        style={{
          opacity: card.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.9, 1] }),
          transform: [
            { translateY: card.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
            { scale: card.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) },
          ],
        }}
      >
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          style={{ width, height, borderRadius: radius.xl }}
          onScrollBeginDrag={() => setHeld(true)}
          onMomentumScrollEnd={settle}
          // Web and a gentle drag that does not fling still have to land.
          onScrollEndDrag={(event) => {
            if (!event.nativeEvent.velocity || Math.abs(event.nativeEvent.velocity.x) < 0.05) {
              settle(event);
            }
          }}
          scrollEventThrottle={16}
        >
          {round.map((spot, i) => (
            <Slide
              key={spot.key}
              spot={spot}
              width={width}
              height={height}
              active={i === index && open}
              reduced={reduced}
              spin={spin}
              onPressIn={() => setHeld(true)}
              onPressOut={() => setHeld(false)}
            />
          ))}
        </ScrollView>

        {/* Put it away until the next visit (§178). Over the card, not in a
            slide, so it stays put while the slides move under it. */}
        <View style={styles.closeSpot} pointerEvents="box-none">
          <PressableScale
            onPress={close}
            hitSlop={12}
            scaleTo={0.85}
            accessibilityRole="button"
            accessibilityLabel="Hide spotlights"
            style={styles.close}
          >
            <Icon name="close" size={14} color="#FFFFFF" />
          </PressableScale>
        </View>

        {count > 1 && (
          <View style={styles.dots}>
            {round.map((spot, i) =>
              i === index ? (
                <View key={spot.key} style={styles.dotOn}>
                  <Animated.View
                    style={[
                      styles.dotFill,
                      {
                        backgroundColor: LOOKS[spot.kind].to,
                        transform: [
                          {
                            translateX: progress.interpolate({
                              inputRange: [0, 1],
                              outputRange: [-24, 0],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                </View>
              ) : (
                <View key={spot.key} style={styles.dot} />
              ),
            )}
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );
}

function Slide({
  spot,
  width,
  height,
  active,
  reduced,
  spin,
  onPressIn,
  onPressOut,
}: {
  spot: Spot;
  width: number;
  height: number;
  active: boolean;
  reduced: boolean;
  spin: Animated.Value;
  onPressIn: () => void;
  onPressOut: () => void;
}) {
  const look = LOOKS[spot.kind];
  const enter = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const sheen = useRef(new Animated.Value(0)).current;

  // Arriving: the words rise in, the picture settles, a light passes over it
  // once, and the picture drifts slowly closer while it is on screen.
  useEffect(() => {
    if (!active) {
      enter.setValue(0);
      drift.setValue(0);
      sheen.setValue(0);
      return;
    }
    const arrive = Animated.timing(enter, {
      toValue: 1,
      duration: reduced ? 1 : 560,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    const closer = Animated.timing(drift, {
      toValue: 1,
      duration: SLIDE_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    const light = Animated.sequence([
      Animated.delay(380),
      Animated.timing(sheen, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    arrive.start();
    if (!reduced) {
      closer.start();
      light.start();
    }
    return () => {
      arrive.stop();
      closer.stop();
      light.stop();
    };
  }, [active, reduced, enter, drift, sheen]);

  const narrow = width < 330;
  // A tablet's banner is three phones wide: the picture turns landscape and
  // takes a third of it, rather than a phone-sized photo at the far end.
  const wide = width > 600;
  const photoW = narrow ? 96 : wide ? Math.round(width * 0.36) : 118;
  const photoH = wide ? height - 34 : Math.round(photoW * 1.12);
  const category = lookFor(spot.categoryIcon);
  const gold = spot.kind === 'business';

  const rise = (from: number) => ({
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }],
  });

  return (
    <PressableScale
      onPress={spot.open}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      scaleTo={0.98}
      haptic
      accessibilityRole="button"
      accessibilityLabel={`${spot.label} ${spot.cta}.`}
      style={{ width, height }}
    >
      <LinearGradient
        colors={[look.from, look.to]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, { height }]}
      >
        {/* Depth: two soft discs and the kind's own motif, very faint. */}
        <View style={[styles.discBig, { backgroundColor: 'rgba(255,255,255,0.08)' }]} />
        <View style={[styles.discSmall, { backgroundColor: look.glow, opacity: 0.16 }]} />
        {spot.kind === 'near' ? (
          <Rings color={look.glow} spin={spin} reduced={reduced} />
        ) : (
          <Animated.View
            style={[
              styles.motif,
              {
                transform: [
                  { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
                ],
              },
            ]}
            pointerEvents="none"
          >
            <Icon name={look.icon as IconName} size={height * 0.95} color="rgba(255,255,255,0.07)" />
          </Animated.View>
        )}

        <View style={styles.words}>
          <Animated.View
            style={[styles.kicker, gold && styles.kickerGold, rise(8)]}
          >
            <Icon name={look.icon as IconName} size={12} color={gold ? look.glow : '#FFFFFF'} />
            <Text style={[styles.kickerText, gold && { color: look.glow }]}>{spot.kicker}</Text>
          </Animated.View>
          <Animated.Text
            style={[styles.title, narrow && styles.titleNarrow, wide && styles.titleWide, rise(14)]}
            numberOfLines={2}
          >
            {spot.title}
          </Animated.Text>
          <Animated.Text style={[styles.line, rise(18)]} numberOfLines={1}>
            {spot.line}
          </Animated.Text>
          <Animated.View style={[styles.cta, gold && { backgroundColor: look.glow }, rise(22)]}>
            <Text style={[styles.ctaText, { color: look.ink }]}>{spot.cta}</Text>
            <Icon name="arrow-forward" size={14} color={look.ink} />
          </Animated.View>
        </View>

        <View style={[styles.stack, { width: photoW + 18, height: photoH + 10 }]}>
          <View
            style={[
              styles.ghost,
              { width: photoW, height: photoH, backgroundColor: look.glow, opacity: 0.55 },
            ]}
          />
          <Animated.View
            style={[
              styles.frame,
              {
                width: photoW,
                height: photoH,
                opacity: enter.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
                transform: [
                  { rotate: '5deg' },
                  { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
                ],
              },
            ]}
          >
            {spot.image ? (
              <Animated.Image
                source={{ uri: spot.image }}
                style={[
                  StyleSheet.absoluteFill,
                  {
                    transform: [
                      { scale: drift.interpolate({ inputRange: [0, 1], outputRange: [1.02, 1.12] }) },
                    ],
                  },
                ]}
                resizeMode="cover"
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.noPhoto, { backgroundColor: category.tint }]}>
                <Icon name={category.icon} size={photoW * 0.38} color={category.ink} />
              </View>
            )}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.sheen,
                {
                  transform: [
                    { rotate: '18deg' },
                    {
                      translateX: sheen.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-photoW * 1.6, photoW * 1.6],
                      }),
                    },
                  ],
                },
              ]}
            >
              <LinearGradient
                colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.45)', 'rgba(255,255,255,0)']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          </Animated.View>

          {spot.logo && spot.kind !== 'business' && (
            <Animated.Image source={{ uri: spot.logo }} style={[styles.logo, { opacity: enter }]} />
          )}
          <Animated.View style={[styles.stat, { opacity: enter }]}>
            <Text style={[styles.statText, { color: look.ink }]} numberOfLines={1}>
              {spot.stat}
            </Text>
          </Animated.View>
        </View>
      </LinearGradient>
    </PressableScale>
  );
}

/** "Near you" gets rings going out from a point instead of a still motif. */
function Rings({ color, spin, reduced }: { color: string; spin: Animated.Value; reduced: boolean }) {
  return (
    <View style={styles.rings} pointerEvents="none">
      {[0, 1, 2].map((ring) => {
        const t = reduced ? 0.5 : Animated.modulo(Animated.add(Animated.multiply(spin, 8), ring / 3), 1);
        return (
          <Animated.View
            key={ring}
            style={[
              styles.ring,
              { borderColor: color },
              typeof t === 'number'
                ? { opacity: 0.12 + ring * 0.05, transform: [{ scale: 0.5 + ring * 0.35 }] }
                : {
                    opacity: t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.35, 0] }),
                    transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1.5] }) }],
                  },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radius.xl,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 18,
    paddingRight: 14,
  },
  discBig: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    top: -110,
    right: -40,
  },
  discSmall: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    bottom: -60,
    left: -30,
  },
  motif: { position: 'absolute', right: -24, bottom: -36 },
  rings: {
    position: 'absolute',
    right: 10,
    top: 0,
    bottom: 0,
    width: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: { position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 2 },
  words: { flex: 1, gap: 6, paddingRight: 8 },
  kicker: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  kickerGold: { backgroundColor: 'rgba(245,196,81,0.14)', borderWidth: 1, borderColor: 'rgba(245,196,81,0.5)' },
  kickerText: {
    fontFamily: font.bold,
    fontSize: 10.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: '#FFFFFF',
  },
  title: {
    fontFamily: font.extrabold,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: '#FFFFFF',
  },
  titleNarrow: { fontSize: 17.5, lineHeight: 21 },
  titleWide: { fontSize: 27, lineHeight: 32, letterSpacing: -0.5 },
  line: { fontFamily: font.semibold, fontSize: 12.5, color: 'rgba(255,255,255,0.82)' },
  cta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 14,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: '#FFFFFF',
  },
  ctaText: { fontFamily: font.extrabold, fontSize: 13 },
  stack: { alignItems: 'center', justifyContent: 'center' },
  ghost: {
    position: 'absolute',
    borderRadius: 20,
    transform: [{ rotate: '-7deg' }, { translateX: -8 }],
  },
  frame: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    backgroundColor: theme.sunken,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  sheen: { position: 'absolute', top: -40, bottom: -40, width: 44 },
  logo: {
    position: 'absolute',
    top: -2,
    left: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
    elevation: 12,
  },
  stat: {
    position: 'absolute',
    bottom: -4,
    left: -6,
    maxWidth: 140,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
  statText: { fontFamily: font.extrabold, fontSize: 12.5 },
  // The press wrapper styles its inner view, so the corner is held by a plain
  // view around it.
  closeSpot: { position: 'absolute', top: 10, right: 10 },
  close: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,12,18,0.38)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  dots: {
    height: DOTS_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(21,23,28,0.16)' },
  dotOn: {
    width: 24,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: 'rgba(21,23,28,0.12)',
  },
  dotFill: { width: 24, height: 6, borderRadius: 3 },
});
