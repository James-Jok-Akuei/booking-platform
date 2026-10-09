import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
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
import { getAvailability, getRoute, getShop } from '../../src/api/discovery';
import { createAppointment } from '../../src/api/booking';
import { openInquiry } from '../../src/api/chat';
import { useSignedIn } from '../../src/api/client';
import { BeforeYouCome } from '../../src/booking/BeforeYouCome';
import { endOf, groupByPeriod } from '../../src/booking/periods';
import { PhotoMosaic } from '../../src/components/PhotoMosaic';
import { SaleBadge, saleUntil } from '../../src/components/Sale';
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
import { MomoLogo } from '../../src/ui/Momo';
import { PopIn } from '../../src/ui/Motion';
import { PhotoViewer, type ViewerOrigin } from '../../src/ui/PhotoViewer';
import { Pill } from '../../src/ui/Pill';
import { PressableScale } from '../../src/ui/PressableScale';
import { Skeleton } from '../../src/ui/Skeleton';
import { Stepper } from '../../src/ui/Stepper';
import { Ticker } from '../../src/ui/Ticker';
import { TopBar } from '../../src/ui/TopBar';
import { showProblem } from '../../src/ui/Dialog';

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

/** The deal card's own padding; rows that bleed to its edge subtract it. */
const CARD_PAD = 18;

/**
 * One service, as the page that decides whether it is booked (§179, §181, §182).
 *
 * In the order the user asked for, so a buyer is never confused about what
 * belongs to what:
 *
 * 1. **The photos**, several at once — one large and a grid of small ones.
 * 2. **The title** the shop wrote (§185), then **About this service** and
 *    **Before you come** — the shop's own words, on the page itself rather
 *    than in a card, read before anything is chosen.
 * 3. **The deal, in ONE card**: what it is, what it costs (the deposit drawn
 *    as a share of it), how many, which day and what time — grouped into
 *    morning, afternoon and evening — and the booking read back the moment a
 *    time is chosen.
 * 4. **The place**: who is doing it, with their rating and how far they are.
 * 5. **Safe to book**, last: three promises, each true of every booking.
 *
 * Reviews are on the shop's page, not here (§182).
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
    // Asked again for every quantity: three people need three places, and a
    // time with two left is free for two but not for three (§189).
    queryKey: ['availability', id, date, serviceId, quantity],
    queryFn: () => getAvailability(id, date, { serviceId, quantity }),
    enabled: Boolean(service),
    // Same day, different number of people: the times stay on screen while
    // the new answer comes, instead of flashing back to grey boxes. A new DAY
    // waits for its own times — the old day's would be wrong.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === date ? previous : undefined,
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
      showProblem('Could not book that', error),
  });

  // A question before booking (§167): the thing most people have, and the
  // reason they do not book when there is nowhere to ask it.
  const openChat = useMutation({
    mutationFn: () => openInquiry(shop.data!.business.id),
    onSuccess: (thread) => router.push(`/thread/${thread.id}`),
    onError: (error) =>
      showProblem('Could not open that', error),
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

  // How many people one booking can be for is the BRANCH's to say (§189): as
  // many as it serves at once. A branch serving one asks nothing.
  const places = Math.max(1, s.capacity);
  const several = places > 1;
  // Everything is for the WHOLE booking (§136): the price is one times how
  // many, and the deposit is its share of that total.
  const unitWord = several ? 'per person' : null;
  const countWord = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
  const totalMinor = service.priceMinor * quantity;
  const depositPct = Math.max(0, Math.min(100, Math.round(Number(service.depositPercentage))));
  const depositMinor = Math.round((totalMinor * Number(service.depositPercentage)) / 100);
  const restMinor = Math.max(0, totalMinor - depositMinor);
  const split = depositMinor < totalMinor;
  const format = (minor: number) => money.format(minor, service.currency);
  // A sale on today (§186). `service.priceMinor` is already the price after it.
  const sale = service.discount;
  const savedMinor = sale ? (sale.listPriceMinor - service.priceMinor) * quantity : 0;

  // Everyone in a booking is served at the same time (§189), so it lasts the
  // service's own length however many come.
  const minutes = service.durationMinutes;
  const slots = availability.data?.slots ?? [];
  // Every open time, booked ones too (§189): a full time says "Booked" rather
  // than vanishing, and a nearly full one says how many places are left.
  const times = availability.data?.times ?? [];
  const periods = groupByPeriod(times, (t) => t.time);
  /** Why no time can be chosen, when none can — the shop's reason first. */
  const noTimeReason = (() => {
    const data = availability.data;
    if (!data || slots.length > 0) return null;
    if (data.reason) return data.reason;
    if (data.source.startsWith('CLOSED')) return 'Closed on this day.';
    if (times.length > 0) {
      return times.every((t) => t.placesLeft === 0)
        ? 'Every time is booked on this day. Pick another day.'
        : `No time has room for ${countWord(quantity)} on this day. Try fewer people, or another day.`;
    }
    // An empty TODAY is almost always the clock, not the shop (§156).
    if (date === days[0]) {
      return data.closeTime
        ? `Closed for today — the shop shuts at ${data.closeTime}. Pick another day.`
        : 'No times left today. Pick another day.';
    }
    return 'Fully booked on this day.';
  })();

  // The page's inner width, and the width inside the deal card. Even columns
  // of times that fill the row: four on a normal phone, three on a narrow one,
  // more on a tablet.
  const inner = layout.contentWidth - 40;
  const inCard = inner - CARD_PAD * 2;
  const perRow = layout.wide ? 6 : inCard < 300 ? 3 : 4;
  const slotWidth = (inCard - 10 * (perRow - 1)) / perRow;

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

          {/* 2. THE SHOP'S OWN WORDS, on the page and not in a card (§182):
              the headline first (§185), then what it is, then what to know
              before coming. */}
          {service.title && (
            <FadeIn delay={20} style={styles.words}>
              <Text style={[styles.headline, layout.compact && styles.headlineCompact]}>
                {service.title}
              </Text>
            </FadeIn>
          )}
          {service.description && (
            <FadeIn delay={30} style={styles.words}>
              <Text style={type.heading}>About this service</Text>
              <Text style={styles.wordsText} numberOfLines={expanded ? undefined : 4}>
                {service.description}
              </Text>
              {service.description.length > 200 && (
                <PressableScale
                  onPress={() => setExpanded((was) => !was)}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.link}>{expanded ? 'Show less' : 'Read more'}</Text>
                </PressableScale>
              )}
            </FadeIn>
          )}
          {service.instructions && (
            <View style={styles.words}>
              <BeforeYouCome text={service.instructions} inset delay={60} />
            </View>
          )}

          {/* 3. THE DEAL, in one card. */}
          <FadeIn delay={90} style={styles.deal}>
            <View style={styles.pills}>
              {/* The main kind as customers read it — the shop's own words under "Other" (§267). */}
              {category && (
                <Pill
                  label={s.business.kinds[0]?.otherLabel || s.business.subcategory?.name || category.name}
                  tone="accent"
                />
              )}
              {s.openNow && <Pill label="Open now" tone="ok" dot />}
              {several && (
                <Pill label={`Up to ${places} people`} tone="neutral" icon="people-outline" />
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
                <Text
                  style={[styles.price, layout.compact && styles.priceCompact, sale && styles.priceSale]}
                >
                  {format(service.priceMinor)}
                </Text>
                {unitWord && <Text style={styles.priceUnit}>{unitWord}</Text>}
              </View>
              {/* On sale (§186): how much off, for how long, and what it saves
                  on THIS booking — the saving grows as "how many" does. */}
              {sale && (
                <View style={styles.saleLine}>
                  <SaleBadge percent={sale.percent} large />
                  <View style={styles.flex}>
                    <Text style={styles.saleText}>
                      Was <Text style={styles.was}>{format(sale.listPriceMinor)}</Text>
                      {sale.endsOn ? ` · sale ${saleUntil(sale)}` : ' · on sale now'}
                    </Text>
                    <Text style={styles.saleSave}>
                      You save {format(savedMinor)}
                      {quantity > 1 ? ` on ${countWord(quantity)}` : ''}
                    </Text>
                  </View>
                </View>
              )}
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

              {/* Asked only where the branch serves more than one at once
                  (§189). Before the day and the time, because the answer
                  changes which times have room. */}
              {several && (
                // On a narrow phone the question sits above the − / +, so it
                // reads on one line instead of three.
                <View style={[styles.howMany, inCard < 300 && styles.howManyStacked]}>
                  <View style={inCard < 300 ? undefined : styles.flex}>
                    <Text style={type.subheading}>How many people?</Text>
                    <Text style={type.small}>Up to {places}, all at once</Text>
                  </View>
                  <Stepper
                    value={quantity}
                    max={places}
                    label="people"
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

              {noTimeReason && (
                <View style={styles.closed}>
                  <View style={styles.closedIcon}>
                    <Icon
                      name={times.length > 0 ? 'people-outline' : 'moon-outline'}
                      size={18}
                      color={theme.ink2}
                    />
                  </View>
                  {/* The server says WHY, and it is more useful than "no
                      slots". */}
                  <Text style={[type.body, styles.flex]}>{noTimeReason}</Text>
                </View>
              )}

              {/* Morning, afternoon, evening (§179): the parts of a day a
                  person thinks in. */}
              {periods.map((period) => (
                <View key={period.key} style={styles.period}>
                  <View style={styles.periodHead}>
                    <Icon name={period.icon} size={15} color={theme.ink2} />
                    <Text style={styles.periodLabel}>{period.label}</Text>
                    <Text style={type.tiny}>
                      {period.slots.filter((t) => t.placesLeft >= quantity).length || 'None'} free
                    </Text>
                  </View>
                  <View style={styles.slots}>
                    {period.slots.map(({ time, placesLeft }) => {
                      const active = slot === time;
                      // Room for everyone in this booking (§189).
                      const fits = placesLeft >= quantity;
                      const full = placesLeft === 0;
                      // "2 left" only where it is news: some places already
                      // taken, and only a few remaining.
                      const few = several && !full && placesLeft < places && placesLeft <= 5;
                      const note = full ? 'Booked' : few ? `${placesLeft} left` : null;
                      return (
                        <PressableScale
                          key={time}
                          haptic={fits}
                          scaleTo={fits ? 0.92 : 1}
                          disabled={!fits}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active, disabled: !fits }}
                          accessibilityLabel={
                            full
                              ? `${time}, booked`
                              : few
                                ? `${time}, ${placesLeft} ${placesLeft === 1 ? 'place' : 'places'} left`
                                : time
                          }
                          onPress={() => choose(time)}
                          style={[
                            styles.slot,
                            { width: slotWidth },
                            !fits && styles.slotTaken,
                            active && styles.slotActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.slotText,
                              !fits && styles.slotTextTaken,
                              full && styles.slotStruck,
                              active && styles.onAccent,
                            ]}
                          >
                            {time}
                          </Text>
                          {note && (
                            <Text
                              style={[
                                styles.slotNote,
                                fits ? styles.slotNoteFew : styles.slotNoteTaken,
                                active && styles.onAccentSoft,
                              ]}
                            >
                              {note}
                            </Text>
                          )}
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
                      {sale && (
                        <Text style={styles.summarySave}>
                          {sale.percent}% off · you save {format(savedMinor)}
                        </Text>
                      )}
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

          </FadeIn>

          {/* 4. THE PLACE. The way to their page (§135.5), with the two things
              that decide whether to trust them: what others rate them, and
              how far they are. Their reviews are one tap away, on that page. */}
          <FadeIn delay={120} style={styles.who}>
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

          {/* 5. SAFE TO BOOK, last (§182). Three promises, each true of every
              booking, in one card read top to bottom — each with room for
              its own sentence, and its own colour so the three are told
              apart at a glance. */}
          <FadeIn delay={150} style={styles.promises}>
            <View style={styles.promisesHead}>
              <View style={styles.promisesShield}>
                <Icon name="shield-checkmark" size={18} color="#FFFFFF" />
              </View>
              <View style={styles.flex}>
                <Text style={type.heading}>Safe to book</Text>
                <Text style={type.small}>Every booking here comes with these</Text>
              </View>
            </View>
            <Assurance
              mark={<MomoLogo size={40} />}
              title="Pay with MTN MoMo"
              text="You approve the deposit on your own phone. This app never asks for your PIN."
            />
            <Assurance
              icon="flash"
              color={theme.ok}
              tint={theme.okSoft}
              title="Confirmed the moment you pay"
              text="The time is yours as soon as the deposit goes through."
            />
            <Assurance
              icon="refresh"
              color={theme.ask}
              tint={theme.askSoft}
              title="Refunded if the shop cancels"
              text="Your whole deposit goes back to the number that paid."
            />
          </FadeIn>
        </ScrollView>
      </View>

      {/* The running answer to "what will this cost me", and the one button. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.footerInner}>
          <View style={styles.flex}>
            <Text style={styles.footerLabel} numberOfLines={1}>
              {quantity > 1 ? `Total for ${countWord(quantity)}` : 'Total'}
              {sale ? ` · ${sale.percent}% off` : ''}
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

/**
 * One assurance (§182): its mark in its own colour, what it is, and what it
 * means for the customer in one sentence.
 */
function Assurance({
  mark,
  icon,
  color,
  tint,
  title,
  text,
}: {
  /** A ready-made mark, such as the MoMo logo, in place of an icon. */
  mark?: ReactNode;
  icon?: IconName;
  color?: string;
  tint?: string;
  title: string;
  text: string;
}) {
  return (
    <View style={styles.promise}>
      {mark ?? (
        <View style={[styles.promiseMark, { backgroundColor: tint }]}>
          <Icon name={icon!} size={20} color={color} />
        </View>
      )}
      <View style={styles.flex}>
        <Text style={styles.promiseTitle}>{title}</Text>
        <Text style={styles.promiseText}>{text}</Text>
      </View>
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

  // ---- 2. the shop's words, on the page ----
  words: { gap: 10, paddingHorizontal: 2 },
  wordsText: { fontFamily: font.medium, fontSize: 14.5, lineHeight: 22, color: theme.ink },
  headline: {
    fontFamily: font.extrabold,
    fontSize: 27,
    lineHeight: 33,
    letterSpacing: -0.6,
    color: theme.ink,
  },
  headlineCompact: { fontSize: 24, lineHeight: 30 },

  // ---- 3. the deal ----
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
  priceSale: { color: theme.accentDeep },
  was: { fontFamily: font.bold, color: theme.muted, textDecorationLine: 'line-through' },
  saleLine: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: -2 },
  saleText: { fontFamily: font.semibold, fontSize: 13, lineHeight: 18, color: theme.ink2 },
  saleSave: { fontFamily: font.extrabold, fontSize: 13, lineHeight: 18, color: theme.ok },
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
  howManyStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 10 },
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
  // A time without room for this booking (§189): flat and quiet, so the free
  // ones stand out, but still there to read.
  slotTaken: { backgroundColor: theme.sunken, borderColor: theme.sunken },
  slotTextTaken: { color: theme.muted },
  slotStruck: { textDecorationLine: 'line-through' },
  slotNote: { fontFamily: font.bold, fontSize: 10, lineHeight: 12, marginTop: 1 },
  slotNoteFew: { color: theme.warn },
  slotNoteTaken: { color: theme.muted },
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
  summarySave: { fontFamily: font.bold, fontSize: 12, color: '#7CE8BF', marginTop: 2 },
  link: { fontFamily: font.bold, fontSize: 13.5, color: theme.accent },

  // ---- 4. the place ----
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

  // ---- 5. safe to book ----
  promises: {
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: CARD_PAD,
    gap: 16,
    ...shadow.card,
  },
  promisesHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
  },
  promisesShield: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.ok,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promise: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  promiseMark: {
    width: 40,
    height: 40,
    borderRadius: 10.4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promiseTitle: { fontFamily: font.bold, fontSize: 15, lineHeight: 20, color: theme.ink },
  promiseText: {
    fontFamily: font.medium,
    fontSize: 13,
    lineHeight: 18.5,
    color: theme.ink2,
    marginTop: 2,
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
