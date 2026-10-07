import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardScroll } from '../../src/useKeyboardScroll';
import {
  getAvailability,
  getRoute,
  getShop,
  getShopReviews,
  type PublicReview,
} from '../../src/api/discovery';
import { createAppointment } from '../../src/api/booking';
import { openInquiry } from '../../src/api/chat';
import { ApiError, useSignedIn } from '../../src/api/client';
import { BeforeYouCome } from '../../src/booking/BeforeYouCome';
import { endOf, groupByPeriod } from '../../src/booking/periods';
import { PhotoMosaic } from '../../src/components/PhotoMosaic';
import { SaveButton } from '../../src/components/SaveButton';
import { distanceLabel } from '../../src/distance';
import { duration } from '../../src/duration';
import { useMoney } from '../../src/money';
import { shareService } from '../../src/share';
import { font, radius, shadow, theme, type } from '../../src/theme';
import { useNearMe } from '../../src/useNearMe';
import { useSavedService } from '../../src/useSavedService';
import { Avatar } from '../../src/ui/Avatar';
import { Button } from '../../src/ui/Button';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { cheer, tick } from '../../src/ui/haptic';
import { Icon, type IconName } from '../../src/ui/Icon';
import { IconButton } from '../../src/ui/IconButton';
import { useLayout } from '../../src/ui/layout';
import { PopIn } from '../../src/ui/Motion';
import { PhotoViewer, type ViewerOrigin } from '../../src/ui/PhotoViewer';
import { Pill } from '../../src/ui/Pill';
import { PressableScale } from '../../src/ui/PressableScale';
import { Skeleton } from '../../src/ui/Skeleton';
import { Stars } from '../../src/ui/Stars';
import { Stepper } from '../../src/ui/Stepper';
import { Ticker } from '../../src/ui/Ticker';
import { TopBar } from '../../src/ui/TopBar';

/**
 * The next 14 days, as the YYYY-MM-DD the endpoint takes.
 *
 * Built from the phone's LOCAL date parts (§133.8). It used `toISOString()`,
 * which is UTC — and Kigali is two hours ahead of UTC, so between midnight and
 * 2am the first day offered was YESTERDAY, a day nobody can book and the server
 * can only refuse.
 */
const nextDays = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  });

const dayLabel = (ymd: string) => {
  const date = new Date(`${ymd}T12:00:00Z`);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }),
    day: date.toLocaleDateString(undefined, { day: 'numeric' }),
    month: date.toLocaleDateString(undefined, { month: 'short' }),
  };
};

const niceDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

const monthOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

/** The deal card's own padding; rows that bleed to its edge subtract it. */
const CARD_PAD = 18;

/**
 * One service, as the page that decides whether it is booked (§179, §181).
 *
 * Four things, in the order the user asked for so a buyer is never confused
 * about what belongs to what:
 *
 * 1. **The photos**, several at once — one large and a grid of small ones.
 * 2. **The deal, in ONE card**: what it is, what it costs (the deposit drawn
 *    as a share of it), choosing how many, which day and what time — grouped
 *    into morning, afternoon and evening — the booking read back the moment a
 *    time is chosen, then the shop's "Before you come" note and its
 *    description.
 * 3. **The place**: who is doing it, with their rating and how far they are,
 *    and what other people said.
 * 4. **The assurances**, last: paid with MoMo, confirmed the moment you pay,
 *    refunded if the shop cancels.
 *
 * The bar at the bottom is the running answer to "what will this cost me":
 * the total rolls as "how many" changes, the deposit sits under it, and the
 * button never goes dead — with no time chosen it takes you to the times.
 *
 * Availability is asked for with the SERVICE's duration, and the chosen slot
 * is sent back as the shop's own wall-clock time (§133.8), as before.
 */
export default function Book() {
  const { id, serviceId } = useLocalSearchParams<{ id: string; serviceId: string }>();
  const router = useRouter();
  const money = useMoney();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const signedIn = useSignedIn();
  const savedService = useSavedService();
  const nearMe = useNearMe();
  // Keeps the typed number above the keyboard (§168).
  const keys = useKeyboardScroll({ pad: true });

  const [viewer, setViewer] = useState<{ index: number; origin: ViewerOrigin | null } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const days = useMemo(() => nextDays(14), []);
  const [date, setDate] = useState(days[0]);
  const [slot, setSlot] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

  const offset = useRef(0);
  const frameRef = useRef<View>(null);
  const timesRef = useRef<View>(null);

  const shop = useQuery({ queryKey: ['shop', id], queryFn: () => getShop(id) });
  const service = shop.data?.services.find((s) => s.id === serviceId);

  // What others said, for the page that has to persuade (§179).
  const reviews = useQuery({
    queryKey: ['shop-reviews', id, 'few'],
    queryFn: () => getShopReviews(id, 6),
    enabled: (shop.data?.rating.count ?? 0) > 0,
  });

  // The real road from here, once the phone has said where here is (§157).
  const position = nearMe.state.status === 'on' ? nearMe.state : null;
  const route = useQuery({
    queryKey: ['route', id, position?.lat, position?.lng],
    queryFn: () => getRoute(id, { lat: position!.lat, lng: position!.lng }),
    enabled: position !== null && shop.data?.latitude !== null && shop.data !== undefined,
  });
  // Short, for a card: "8.5 km · 14 min by car", or the straight line as such.
  const way = route.data
    ? route.data.by === 'road' && route.data.minutes !== null
      ? `${distanceLabel(route.data.distanceKm)} · ${route.data.minutes} min by car`
      : `${distanceLabel(route.data.distanceKm)} in a straight line`
    : null;

  /**
   * Opened after closing time, today is done. Rather than open on a day that
   * says so, move on to tomorrow — once, and only when the customer has not
   * chosen a day themselves (§156).
   */
  const movedOn = useRef(false);
  const availability = useQuery({
    // Asked again for every quantity: three people need three places, or
    // three turns, and the free times are different either way (§136).
    queryKey: ['availability', id, date, serviceId, quantity],
    queryFn: () => getAvailability(id, date, { serviceId, quantity }),
    enabled: Boolean(service),
  });

  useEffect(() => {
    const today = availability.data;
    if (
      movedOn.current ||
      !today ||
      date !== days[0] ||
      today.slots.length > 0 ||
      today.source.startsWith('CLOSED') ||
      days.length < 2
    ) {
      return;
    }
    movedOn.current = true;
    setDate(days[1]);
  }, [availability.data, date, days]);

  const book = useMutation({
    mutationFn: () =>
      createAppointment({
        locationId: id,
        serviceId,
        // The shop's wall clock, sent as-is. The server knows the location's
        // zone and resolves it; converting here would shift the booking.
        startTime: `${date}T${slot}:00`,
        ...(quantity > 1 ? { quantity } : {}),
      }),
    onSuccess: (appointment) => {
      cheer();
      router.replace(`/booking/${appointment.id}`);
    },
    onError: (error) =>
      Alert.alert(
        'Could not book that',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  // A question before booking (§167): the thing most people have, and the
  // reason they do not book when there is nowhere to ask it.
  const openChat = useMutation({
    mutationFn: () => openInquiry(shop.data!.business.id),
    onSuccess: (thread) => router.push(`/thread/${thread.id}`),
    onError: (error) =>
      Alert.alert(
        'Could not open that',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  if (shop.isLoading) {
    return (
      <View style={styles.screen}>
        <TopBar title="Book" />
        <View style={[styles.content, { width: layout.contentWidth, alignSelf: 'center' }]}>
          <Skeleton height={200} round={radius.lg} />
          <Skeleton height={420} round={radius.lg} />
          <Skeleton height={84} round={radius.lg} />
        </View>
      </View>
    );
  }
  if (!shop.data || !service) {
    return (
      <View style={styles.screen}>
        <TopBar title="Book" />
        <EmptyState icon="calendar-outline" title="That service is no longer offered here." />
      </View>
    );
  }

  const s = shop.data;
  const businessName = s.business.name ?? s.name;
  const district = s.district?.name ?? null;
  const category = s.business.category;

  // Everything is for the WHOLE booking (§136): the price is one times how
  // many, and the deposit is its share of that total.
  const several = service.quantityMode !== 'SINGLE';
  const people = service.quantityMode === 'PEOPLE';
  const unitWord = people ? 'per person' : several ? 'each' : null;
  const countWord = (n: number) => (people ? `${n} ${n === 1 ? 'person' : 'people'}` : `× ${n}`);
  const totalMinor = service.priceMinor * quantity;
  const depositPct = Math.max(0, Math.min(100, Math.round(Number(service.depositPercentage))));
  const depositMinor = Math.round((totalMinor * Number(service.depositPercentage)) / 100);
  const restMinor = Math.max(0, totalMinor - depositMinor);
  const split = depositMinor < totalMinor;
  const format = (minor: number) => money.format(minor, service.currency);

  // How long the whole booking takes comes from the server, which knows how
  // many places the shop has. Until it answers, one sitting is the best guess.
  const minutes = availability.data?.durationMinutes ?? service.durationMinutes;
  const slots = availability.data?.slots ?? [];
  const periods = groupByPeriod(slots);

  // The page's inner width, and the width inside the deal card. Even columns
  // of times that fill the row: four on a normal phone, three on a narrow one,
  // more on a tablet.
  const inner = layout.contentWidth - 40;
  const inCard = inner - CARD_PAD * 2;
  const perRow = layout.wide ? 6 : inCard < 300 ? 3 : 4;
  const slotWidth = (inCard - 10 * (perRow - 1)) / perRow;

  const withWords = (reviews.data?.reviews ?? []).filter((r) => r.comment);
  const shownReviews = (withWords.length > 0 ? withWords : (reviews.data?.reviews ?? [])).slice(0, 2);

  /**
   * A time chosen is read back in the card under the times (§179), so the
   * page glides down a little to show it after it has popped in.
   */
  const choose = (time: string) => {
    setSlot(time);
    setTimeout(() => keys.ref.current?.scrollTo({ y: offset.current + 180, animated: true }), 140);
  };

  /** With no time chosen, the button takes you to the times instead of doing nothing. */
  const goToTimes = () => {
    tick();
    const section = timesRef.current;
    const frame = frameRef.current;
    if (!section || !frame) return;
    frame.measureInWindow((_fx, frameY) =>
      section.measureInWindow((_x, y) => {
        if (!Number.isFinite(y) || !Number.isFinite(frameY)) return;
        keys.ref.current?.scrollTo({
          y: Math.max(0, y - frameY + offset.current - 12),
          animated: true,
        });
      }),
    );
  };

  const share = () =>
    shareService({
      locationId: id,
      serviceId,
      name: service.name,
      businessName,
      branchName: s.name,
      price: format(service.priceMinor),
      length: duration(service.durationMinutes),
    });

  const here = `/book/${id}?serviceId=${serviceId}`;

  return (
    <View style={styles.screen}>
      <PhotoViewer
        photos={service.images}
        openAt={viewer?.index ?? null}
        origin={viewer?.origin}
        onClose={() => setViewer(null)}
      />

      <TopBar
        title={service.name}
        subtitle={businessName}
        right={
          <View style={styles.topRight}>
            <IconButton icon="share-outline" label="Share this service" onPress={share} flat />
            <SaveButton
              saved={service.saved}
              onPress={() => savedService.toggle(service.id, id, service.saved ?? false, here)}
            />
          </View>
        }
      />

      <View ref={frameRef} collapsable={false} style={styles.flex}>
        <ScrollView
          ref={keys.ref}
          onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
            offset.current = event.nativeEvent.contentOffset.y;
            keys.track(event);
          }}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.content,
            { width: layout.contentWidth, alignSelf: 'center' },
            keys.padding > 0 && { paddingBottom: keys.padding + 28 },
          ]}
        >
          {/* 1. THE PHOTOS, several at once (§181). */}
          <FadeIn style={styles.photos}>
            <PhotoMosaic
              photos={service.images}
              fallbackUri={s.business.coverImageUrl}
              categoryIcon={category?.icon}
              width={inner - 12}
              wide={layout.wide}
              onOpen={(index, origin) => setViewer({ index, origin })}
            />
          </FadeIn>

          {/* 2. THE DEAL, in one card. */}
          <FadeIn delay={40} style={styles.deal}>
            <View style={styles.pills}>
              {category && (
                <Pill label={s.business.subcategory?.name ?? category.name} tone="accent" />
              )}
              {s.openNow && <Pill label="Open now" tone="ok" dot />}
              {people && (
                <Pill label={`Up to ${service.maxQuantity} people`} tone="neutral" icon="people-outline" />
              )}
            </View>
            <Text style={type.title}>{service.name}</Text>
            <View style={styles.meta}>
              <Icon name="time-outline" size={15} color={theme.muted} />
              <Text style={type.small}>{duration(service.durationMinutes, true)}</Text>
              <Text style={styles.metaDot}>·</Text>
              <Icon name="location-outline" size={15} color={theme.muted} />
              <Text style={[type.small, styles.flex]} numberOfLines={1}>
                {s.name}
                {district ? `, ${district}` : ''}
              </Text>
            </View>

            <View style={styles.rule} />

            {/* WHAT IT COSTS. The deposit is DRAWN as a share of the price,
                not only said: it is the part of paying a deposit people get
                wrong, and a bar is read faster than a sentence. */}
            <View style={styles.section}>
              <View style={styles.priceRow}>
                <Text style={[styles.price, layout.compact && styles.priceCompact]}>
                  {format(service.priceMinor)}
                </Text>
                {unitWord && <Text style={styles.priceUnit}>{unitWord}</Text>}
              </View>
              {split ? (
                <>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.max(4, depositPct)}%` }]} />
                  </View>
                  <View style={styles.split}>
                    <View style={styles.flex}>
                      <Text style={styles.splitLabel}>
                        Pay now{quantity > 1 ? ` · ${countWord(quantity)}` : ''}
                      </Text>
                      <Ticker value={depositMinor} render={format} style={styles.splitNow} />
                    </View>
                    <View style={styles.splitRight}>
                      <Text style={styles.splitLabel}>At the shop</Text>
                      <Ticker value={restMinor} render={format} style={styles.splitLater} />
                    </View>
                  </View>
                  <View style={styles.holdLine}>
                    <Icon name="shield-checkmark" size={15} color={theme.ok} />
                    <Text style={styles.holdText}>
                      A {depositPct}% deposit holds the time for you. The rest is paid at the shop.
                    </Text>
                  </View>
                </>
              ) : (
                <View style={styles.holdLine}>
                  <Icon name="shield-checkmark" size={15} color={theme.ok} />
                  <Text style={styles.holdText}>Paid in full now, and the time is yours.</Text>
                </View>
              )}
            </View>

            <View style={styles.rule} />

            {/* CHOOSE A TIME: how many, which day, what time. */}
            <View ref={timesRef} collapsable={false} style={styles.section}>
              <Text style={type.heading}>Choose a time</Text>

              {/* Asked only where the shop allows more than one, in the
                  shop's own sense of it (§136). Before the day and the time,
                  because the answer changes which times are free. */}
              {several && (
                <View style={styles.howMany}>
                  <View style={styles.flex}>
                    <Text style={type.subheading}>{people ? 'How many people?' : 'How many?'}</Text>
                    <Text style={type.small}>Up to {service.maxQuantity} in one booking</Text>
                  </View>
                  <Stepper
                    value={quantity}
                    max={service.maxQuantity}
                    label={people ? 'people' : 'items'}
                    onFocus={keys.reveal}
                    onChange={(next) => {
                      setQuantity(next);
                      // A time that was free for two may not be free for three.
                      setSlot(null);
                    }}
                  />
                </View>
              )}

              <Text style={type.label}>Day</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.bleed}
                contentContainerStyle={styles.days}
              >
                {days.map((ymd, i) => {
                  const label = dayLabel(ymd);
                  const active = ymd === date;
                  return (
                    <PressableScale
                      key={ymd}
                      haptic
                      scaleTo={0.93}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${i === 0 ? 'Today, ' : ''}${label.weekday} ${label.day} ${label.month}`}
                      onPress={() => {
                        setDate(ymd);
                        setSlot(null);
                      }}
                      style={[styles.day, active && styles.dayActive]}
                    >
                      <Text style={[styles.dayWeek, active && styles.onAccent]}>
                        {i === 0 ? 'Today' : label.weekday}
                      </Text>
                      <Text style={[styles.dayNum, active && styles.onAccent]}>{label.day}</Text>
                      <Text style={[styles.dayMonth, active && styles.onAccentSoft]}>
                        {label.month}
                      </Text>
                    </PressableScale>
                  );
                })}
              </ScrollView>

              <Text style={type.label}>Time</Text>

              {availability.isLoading && (
                <View style={styles.slots}>
                  {Array.from({ length: perRow * 2 }, (_, i) => (
                    <Skeleton key={i} width={slotWidth} height={46} round={radius.md} />
                  ))}
                </View>
              )}

              {availability.data && slots.length === 0 && (
                <View style={styles.closed}>
                  <View style={styles.closedIcon}>
                    <Icon name="moon-outline" size={18} color={theme.ink2} />
                  </View>
                  <Text style={[type.body, styles.flex]}>
                    {/* The server says WHY, and it is more useful than "no
                        slots". An empty TODAY is almost always the clock, not
                        the shop (§156). */}
                    {availability.data.reason ??
                      (availability.data.source.startsWith('CLOSED')
                        ? 'Closed on this day.'
                        : date === days[0]
                          ? availability.data.closeTime
                            ? `Closed for today — the shop shuts at ${availability.data.closeTime}. Pick another day.`
                            : 'No times left today. Pick another day.'
                          : 'Fully booked on this day.')}
                  </Text>
                </View>
              )}

              {/* Morning, afternoon, evening (§179): the parts of a day a
                  person thinks in. */}
              {periods.map((period) => (
                <View key={period.key} style={styles.period}>
                  <View style={styles.periodHead}>
                    <Icon name={period.icon} size={15} color={theme.ink2} />
                    <Text style={styles.periodLabel}>{period.label}</Text>
                    <Text style={type.tiny}>{period.slots.length} free</Text>
                  </View>
                  <View style={styles.slots}>
                    {period.slots.map((time) => {
                      const active = slot === time;
                      return (
                        <PressableScale
                          key={time}
                          haptic
                          scaleTo={0.92}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          onPress={() => choose(time)}
                          style={[styles.slot, { width: slotWidth }, active && styles.slotActive]}
                        >
                          <Text style={[styles.slotText, active && styles.onAccent]}>{time}</Text>
                        </PressableScale>
                      );
                    })}
                  </View>
                </View>
              ))}

              {availability.data?.timeZone && slots.length > 0 && (
                <Text style={type.small}>
                  Times are local to the shop ({availability.data.timeZone}).
                </Text>
              )}

              {/* READ BACK. The booking in one card the moment a time is
                  chosen: where the customer checks they have what they meant. */}
              {slot && (
                <PopIn key={`${date}-${slot}-${quantity}`} style={styles.summary}>
                  <View style={styles.summaryGlow} />
                  <View style={styles.summaryHead}>
                    <View style={styles.summaryTick}>
                      <Icon name="checkmark" size={15} color="#FFFFFF" />
                    </View>
                    <Text style={styles.summaryTitle}>Your booking</Text>
                  </View>
                  <Text style={styles.summaryWhen}>
                    {niceDate(date)} · {slot} – {endOf(slot, minutes)}
                  </Text>
                  <Text style={styles.summaryWhat} numberOfLines={2}>
                    {service.name}
                    {quantity > 1 ? ` · ${countWord(quantity)}` : ''} · {duration(minutes)} ·{' '}
                    {businessName}
                  </Text>
                  <View style={styles.summaryRule} />
                  <View style={styles.summaryMoney}>
                    <View style={styles.flex}>
                      <Text style={styles.summaryLabel}>Total</Text>
                      <Text style={styles.summaryValue}>{format(totalMinor)}</Text>
                    </View>
                    <View>
                      <Text style={styles.summaryLabel}>Pay now</Text>
                      <Text style={[styles.summaryValue, styles.summaryNow]}>
                        {format(depositMinor)}
                      </Text>
                    </View>
                  </View>
                </PopIn>
              )}
            </View>

            {/* WHAT TO KNOW BEFORE COMING (§180), the shop's own note. */}
            {service.instructions && (
              <>
                <View style={styles.rule} />
                <BeforeYouCome text={service.instructions} inset />
              </>
            )}

            {/* WHAT THEY SAY ABOUT IT. */}
            {service.description && (
              <>
                <View style={styles.rule} />
                <View style={styles.section}>
                  <Text style={type.heading}>About this service</Text>
                  <Text style={type.body} numberOfLines={expanded ? undefined : 3}>
                    {service.description}
                  </Text>
                  {service.description.length > 150 && (
                    <PressableScale
                      onPress={() => setExpanded((was) => !was)}
                      hitSlop={8}
                      accessibilityRole="button"
                    >
                      <Text style={styles.link}>{expanded ? 'Show less' : 'Read more'}</Text>
                    </PressableScale>
                  )}
                </View>
              </>
            )}
          </FadeIn>

          {/* 3. THE PLACE. The way to their page (§135.5), with the two things
              that decide whether to trust them: what others rate them, and
              how far they are. */}
          <FadeIn delay={100} style={styles.who}>
            <PressableScale
              onPress={() => router.push(`/shop/${id}`)}
              haptic
              scaleTo={0.98}
              accessibilityRole="button"
              accessibilityLabel={`${businessName}, view shop`}
              style={styles.shop}
            >
              <Avatar uri={s.business.logoUrl} name={businessName} size={50} />
              <View style={styles.flex}>
                <Text style={type.subheading} numberOfLines={1}>
                  {businessName}
                </Text>
                <Text style={type.small} numberOfLines={1}>
                  {s.name}
                  {district ? ` · ${district}` : ''}
                </Text>
                {(s.rating.count > 0 || way) && (
                  <View style={styles.shopFacts}>
                    {s.rating.count > 0 && (
                      <View style={styles.fact}>
                        <Icon name="star" size={13} color={theme.star} />
                        <Text style={styles.factStrong}>{s.rating.average?.toFixed(1)}</Text>
                        <Text style={type.tiny}>({s.rating.count})</Text>
                      </View>
                    )}
                    {way && (
                      <View style={styles.fact}>
                        <Icon name="car-outline" size={13} color={theme.accent} />
                        <Text style={styles.way} numberOfLines={1}>
                          {way}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
              <View style={styles.shopGo}>
                <Icon name="chevron-forward" size={16} color={theme.accent} />
              </View>
            </PressableScale>

            {signedIn && (
              <PressableScale
                onPress={() => openChat.mutate()}
                disabled={openChat.isPending}
                haptic
                scaleTo={0.98}
                accessibilityRole="button"
                accessibilityLabel="Message the shop with a question"
                style={styles.ask}
              >
                <Icon name="chatbubble-ellipses-outline" size={16} color={theme.ask} />
                <Text style={styles.askText} numberOfLines={1}>
                  {openChat.isPending
                    ? 'Opening…'
                    : layout.compact
                      ? 'Ask the shop a question'
                      : 'Have a question? Message the shop'}
                </Text>
                <Icon name="chevron-forward" size={14} color={theme.ask} />
              </PressableScale>
            )}
          </FadeIn>

          {/* WHAT OTHERS SAID about the place. Only once somebody has (§153). */}
          {s.rating.count > 0 && s.rating.average !== null && (
            <FadeIn delay={140} style={styles.group}>
              <View style={styles.rowBetween}>
                <Text style={type.heading}>What people say</Text>
                {s.rating.count > shownReviews.length && (
                  <PressableScale
                    onPress={() => router.push(`/shop/${id}?tab=reviews`)}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <Text style={styles.link}>See all {s.rating.count} →</Text>
                  </PressableScale>
                )}
              </View>
              <View style={styles.ratingRow}>
                <Text style={styles.ratingBig}>{s.rating.average.toFixed(1)}</Text>
                <View style={styles.ratingWords}>
                  <Stars rating={s.rating.average} size={16} />
                  <Text style={type.small}>
                    from {s.rating.count} {s.rating.count === 1 ? 'review' : 'reviews'}
                  </Text>
                </View>
              </View>
              {reviews.isLoading && <Skeleton height={96} round={radius.lg} />}
              {shownReviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </FadeIn>
          )}

          {/* 4. THE ASSURANCES, last. Three facts, each true of every booking. */}
          <FadeIn delay={180} style={styles.trust}>
            <Trust icon="phone-portrait-outline" title="MTN MoMo" text="secure payment" />
            <Trust icon="flash-outline" title="Confirmed" text="the moment you pay" />
            <Trust icon="refresh-circle-outline" title="Refunded" text="if the shop cancels" />
          </FadeIn>
        </ScrollView>
      </View>

      {/* The running answer to "what will this cost me", and the one button. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.footerInner}>
          <View style={styles.flex}>
            <Text style={styles.footerLabel} numberOfLines={1}>
              {quantity > 1 ? `Total for ${countWord(quantity)}` : 'Total'}
            </Text>
            <Ticker
              value={totalMinor}
              render={format}
              style={[styles.footerPrice, layout.compact && styles.footerPriceCompact]}
            />
            {split && (
              <Text style={styles.footerNow} numberOfLines={1}>
                {format(depositMinor)} now
              </Text>
            )}
          </View>
          <Button
            style={[styles.cta, layout.compact && styles.ctaCompact]}
            kind={slot ? 'primary' : 'dark'}
            busy={book.isPending}
            icon={
              layout.compact
                ? undefined
                : !slot
                  ? 'calendar-outline'
                  : signedIn
                    ? undefined
                    : 'log-in-outline'
            }
            label={
              !slot
                ? layout.compact
                  ? 'Pick a time'
                  : 'Choose a time'
                : signedIn
                  ? `Book ${slot}`
                  : 'Sign in to book'
            }
            onPress={() => {
              if (!slot) return goToTimes();
              // Signing in is required to hold a slot, but not to get here —
              // asking earlier loses people who were only looking (§170).
              if (!signedIn) {
                router.push(`/sign-in?next=${here}`);
                return;
              }
              book.mutate();
            }}
          />
        </View>
      </View>
    </View>
  );
}

/** One of the three assurances: an icon, a word, and why it matters. */
function Trust({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <View style={styles.trustTile}>
      <View style={styles.trustIcon}>
        <Icon name={icon} size={17} color={theme.accent} />
      </View>
      <Text style={styles.trustTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.trustText} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

/** One review, short: who, when, the stars, and what they said. */
function ReviewCard({ review }: { review: PublicReview }) {
  return (
    <View style={styles.review}>
      <View style={styles.reviewHead}>
        <Avatar name={review.displayName} size={34} />
        <View style={styles.flex}>
          <Text style={styles.reviewName} numberOfLines={1}>
            {review.displayName}
          </Text>
          <Text style={type.tiny}>{monthOf(review.createdAt)}</Text>
        </View>
        <Stars rating={review.rating} size={12} />
      </View>
      {review.comment && (
        <Text style={type.body} numberOfLines={4}>
          {review.comment}
        </Text>
      )}
      {review.responseText && (
        <View style={styles.reply}>
          <Text style={type.label}>Reply from the shop</Text>
          <Text style={type.small} numberOfLines={3}>
            {review.responseText}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 28, gap: 18 },
  bleed: { marginHorizontal: -CARD_PAD, flexGrow: 0 },

  // ---- 1. photos ----
  photos: {
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 6,
    ...shadow.card,
  },

  // ---- 2. the deal ----
  deal: {
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: CARD_PAD,
    gap: 16,
    ...shadow.card,
  },
  rule: { height: 1, backgroundColor: theme.line },
  section: { gap: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaDot: { fontFamily: font.bold, color: theme.muted, marginHorizontal: 2 },
  priceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
  price: { fontFamily: font.extrabold, fontSize: 30, color: theme.ink, letterSpacing: -0.7 },
  priceCompact: { fontSize: 26 },
  priceUnit: { fontFamily: font.semibold, fontSize: 13.5, color: theme.muted },
  track: { height: 8, borderRadius: 4, backgroundColor: theme.sunken, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: theme.accent },
  split: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  splitRight: { alignItems: 'flex-end' },
  splitLabel: {
    fontFamily: font.bold,
    fontSize: 10.5,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: theme.muted,
    marginBottom: 2,
  },
  splitNow: { fontFamily: font.extrabold, fontSize: 18, color: theme.accent, letterSpacing: -0.3 },
  splitLater: { fontFamily: font.bold, fontSize: 15, color: theme.ink2 },
  holdLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: theme.okSoft,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  holdText: { flex: 1, fontFamily: font.semibold, fontSize: 12.5, lineHeight: 18, color: '#0B6B3A' },
  howMany: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    padding: 12,
  },
  days: { paddingHorizontal: CARD_PAD, gap: 10, paddingVertical: 4 },
  day: {
    width: 64,
    paddingVertical: 12,
    borderRadius: radius.lg,
    backgroundColor: theme.panel,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1.5,
    borderColor: theme.line,
  },
  dayActive: { backgroundColor: theme.accent, borderColor: theme.accent, ...shadow.raised },
  dayWeek: { fontFamily: font.semibold, fontSize: 12, color: theme.muted },
  dayNum: { fontFamily: font.extrabold, fontSize: 21, color: theme.ink },
  dayMonth: { fontFamily: font.medium, fontSize: 11, color: theme.muted },
  onAccent: { color: '#FFFFFF' },
  onAccentSoft: { color: 'rgba(255,255,255,0.8)' },
  period: { gap: 8, marginTop: 2 },
  periodHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  periodLabel: { flex: 1, fontFamily: font.bold, fontSize: 14, color: theme.ink },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  slot: {
    height: 46,
    borderRadius: radius.md,
    backgroundColor: theme.panel,
    borderWidth: 1.5,
    borderColor: theme.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotActive: { backgroundColor: theme.accent, borderColor: theme.accent, ...shadow.raised },
  slotText: { fontFamily: font.bold, fontSize: 14.5, color: theme.ink },
  closed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    padding: 14,
  },
  closedIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summary: {
    backgroundColor: theme.night,
    borderRadius: radius.lg,
    padding: 18,
    gap: 6,
    overflow: 'hidden',
    marginTop: 4,
  },
  summaryGlow: {
    position: 'absolute',
    top: -70,
    right: -50,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: theme.accent,
    opacity: 0.22,
  },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  summaryTick: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryTitle: { fontFamily: font.bold, fontSize: 13, color: 'rgba(255,255,255,0.75)' },
  summaryWhen: { fontFamily: font.extrabold, fontSize: 19, color: '#FFFFFF', letterSpacing: -0.3 },
  summaryWhat: { fontFamily: font.medium, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.72)' },
  summaryRule: { height: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: 8 },
  summaryMoney: { flexDirection: 'row', alignItems: 'flex-end', gap: 16 },
  summaryLabel: {
    fontFamily: font.bold,
    fontSize: 10.5,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 2,
  },
  summaryValue: { fontFamily: font.extrabold, fontSize: 17, color: '#FFFFFF' },
  summaryNow: { color: '#FFB59E' },
  link: { fontFamily: font.bold, fontSize: 13.5, color: theme.accent },

  // ---- 3. the place ----
  who: { gap: 8 },
  shop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 14,
    ...shadow.card,
  },
  shopFacts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 4 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  factStrong: { fontFamily: font.bold, fontSize: 13, color: theme.ink },
  way: { fontFamily: font.semibold, fontSize: 12, color: theme.accent },
  shopGo: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ask: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.askSoft,
    borderRadius: radius.md,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  askText: { flex: 1, fontFamily: font.semibold, fontSize: 13, color: theme.ask },
  group: { gap: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ratingBig: { fontFamily: font.extrabold, fontSize: 40, color: theme.ink, letterSpacing: -1 },
  ratingWords: { gap: 3 },
  review: {
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 14,
    gap: 10,
    ...shadow.card,
  },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewName: { fontFamily: font.bold, fontSize: 14, color: theme.ink },
  reply: {
    gap: 3,
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },

  // ---- 4. the assurances ----
  trust: { flexDirection: 'row', gap: 10 },
  trustTile: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderWidth: 1.5,
    borderColor: theme.line,
  },
  trustIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  trustTitle: { fontFamily: font.bold, fontSize: 12.5, color: theme.ink },
  trustText: {
    fontFamily: font.medium,
    fontSize: 11,
    lineHeight: 14,
    color: theme.muted,
    textAlign: 'center',
  },

  // ---- the bar ----
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: theme.panel,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadow.float,
  },
  footerInner: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  footerLabel: {
    fontFamily: font.bold,
    fontSize: 10.5,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: theme.muted,
  },
  footerPrice: { fontFamily: font.extrabold, fontSize: 21, color: theme.ink, letterSpacing: -0.4 },
  footerPriceCompact: { fontSize: 18 },
  footerNow: { fontFamily: font.semibold, fontSize: 12, color: theme.accent, marginTop: 1 },
  cta: { minWidth: 156, flexShrink: 0 },
  ctaCompact: { minWidth: 120, paddingHorizontal: 16 },
});
