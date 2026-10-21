import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardScroll } from '../../src/useKeyboardScroll';
import { getAvailability, getRoute, getShop } from '../../src/api/discovery';
import { createAppointment } from '../../src/api/booking';
import { openInquiry } from '../../src/api/chat';
import { useSignedIn } from '../../src/api/client';
import { BeforeYouCome } from '../../src/booking/BeforeYouCome';
import { ChoicePicker, NoteBox } from '../../src/booking/ChoicePicker';
import { askedAs, bookingDraft, tally, toggle } from '../../src/booking/choices';
import { endOf, groupByPeriod } from '../../src/booking/periods';
import { PhotoMosaic } from '../../src/components/PhotoMosaic';
import { SaleBadge, saleUntil } from '../../src/components/Sale';
import { SaleCountdown } from '../../src/components/SaleCountdown';
import { SaveButton } from '../../src/components/SaveButton';
import { distanceLabel } from '../../src/distance';
import { duration } from '../../src/duration';
import { useMoney } from '../../src/money';
import { shareService } from '../../src/share';
import { font, radius, shadow, theme, type } from '../../src/theme';
import { useNearMe } from '../../src/useNearMe';
import { useSavedService } from '../../src/useSavedService';
import { Avatar } from '../../src/ui/Avatar';
import { RichText } from '../../src/ui/RichText';
import { Button } from '../../src/ui/Button';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { cheer, tick } from '../../src/ui/haptic';
import { Icon } from '../../src/ui/Icon';
import { IconButton } from '../../src/ui/IconButton';
import { useLayout } from '../../src/ui/layout';
import { PopIn } from '../../src/ui/Motion';
import { PhotoViewer, type ViewerOrigin } from '../../src/ui/PhotoViewer';
import { Pill } from '../../src/ui/Pill';
import { PressableScale } from '../../src/ui/PressableScale';
import { Skeleton } from '../../src/ui/Skeleton';
import { Stepper } from '../../src/ui/Stepper';
import { Ticker } from '../../src/ui/Ticker';
import { TopBar } from '../../src/ui/TopBar';
import { showProblem } from '../../src/ui/Dialog';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { dateLocale } from '../../src/i18n/format';
import { plural } from '@lingui/core/macro';

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
    weekday: date.toLocaleDateString(dateLocale(), { weekday: 'short' }),
    day: date.toLocaleDateString(dateLocale(), { day: 'numeric' }),
    month: date.toLocaleDateString(dateLocale(), { month: 'short' }),
  };
};

const niceDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString(dateLocale(), {
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
 * 1. **The photos**, several at once — one large and a grid of small ones —
 *    and right under them, in one slim line, **who does it**: the shop, its
 *    rating and how far, a tap from their page, with a small button to ask
 *    them something (§278).
 * 2. **The title** the shop wrote (§185), then **About this service** and
 *    **Before you come** — the shop's own words, on the page itself rather
 *    than in a card, read before anything is chosen.
 * 3. **The deal, in ONE card**: what it is, what it costs (the deposit drawn
 *    as a share of it), how many, which day and what time — grouped into
 *    morning, afternoon and evening — and the booking read back the moment a
 *    time is chosen. Nothing after it: the page ends where the choosing does.
 *
 * How paying works is not on this page (§278): it is said at checkout, where
 * the money moves, and in full under Account → How paying works.
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
  const queryClient = useQueryClient();
  const money = useMoney();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const signedIn = useSignedIn();
  const savedService = useSavedService();
  const nearMe = useNearMe();
  // Keeps the typed number above the keyboard (§168).
  const keys = useKeyboardScroll({ pad: true });

  const [viewer, setViewer] = useState<{ index: number; origin: ViewerOrigin | null } | null>(null);
  const days = useMemo(() => nextDays(14), []);
  const [date, setDate] = useState(days[0]);
  const [slot, setSlot] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  // What the customer picked (§300), and their note to the shop — as they
  // left them, if they went to sign in and came back.
  const draftKey = `${id}:${serviceId}`;
  const [picked, setPicked] = useState<Set<string>>(() => new Set(bookingDraft.get(draftKey)?.picked));
  const [note, setNote] = useState(() => bookingDraft.get(draftKey)?.note ?? '');
  useEffect(() => {
    bookingDraft.set(draftKey, { picked, note });
  }, [draftKey, picked, note]);
  // Set by trying to go on with a required question unanswered.
  const [flagMissing, setFlagMissing] = useState(false);

  const offset = useRef(0);
  const frameRef = useRef<View>(null);
  const timesRef = useRef<View>(null);
  const choicesRef = useRef<View>(null);

  const shop = useQuery({ queryKey: ['shop', id], queryFn: () => getShop(id) });
  const service = shop.data?.services.find((s) => s.id === serviceId);
  // The questions, and what the answers add (§300) — the server's own rules.
  const groups = service?.choiceGroups ?? [];
  const chosen = tally(groups, picked);

  // The real road from here, once the phone has said where here is (§157).
  const position = nearMe.state.status === 'on' ? nearMe.state : null;
  const route = useQuery({
    queryKey: ['route', id, position?.lat, position?.lng],
    queryFn: () => getRoute(id, { lat: position!.lat, lng: position!.lng }),
    enabled: position !== null && shop.data?.latitude !== null && shop.data !== undefined,
  });
  // Short, for one line under the photos: "14 min by car", or the distance.
  const way = route.data
    ? route.data.by === 'road' && route.data.minutes !== null
      ? t`${route.data.minutes} min by car`
      : distanceLabel(route.data.distanceKm)
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
    // …and again when the answers change how long it takes (§300.4). Keyed by
    // the minutes, so a free wish does not ask again.
    queryKey: ['availability', id, date, serviceId, quantity, chosen.minutes],
    queryFn: () => getAvailability(id, date, { serviceId, quantity, options: chosen.optionIds }),
    // Choices come first (§300): until the required ones are answered, the
    // length — and so which times fit — is not known yet.
    enabled: Boolean(service) && chosen.missing.length === 0,
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

  // A time that fitted a shorter booking may not fit this one.
  useEffect(() => setSlot(null), [chosen.minutes]);

  const book = useMutation({
    mutationFn: () =>
      createAppointment({
        locationId: id,
        serviceId,
        // The shop's wall clock, sent as-is. The server knows the location's
        // zone and resolves it; converting here would shift the booking.
        startTime: `${date}T${slot}:00`,
        ...(quantity > 1 ? { quantity } : {}),
        // The answers and the note (§300). The server checks them again.
        ...(chosen.optionIds.length > 0 ? { optionIds: chosen.optionIds } : {}),
        ...(service?.noteEnabled && note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (appointment) => {
      cheer();
      bookingDraft.clear(draftKey);
      router.replace(`/booking/${appointment.id}`);
    },
    onError: (error) =>
      showProblem(t`Could not book that`, error),
  });

  // A question before booking (§167): the thing most people have, and the
  // reason they do not book when there is nowhere to ask it.
  const openChat = useMutation({
    mutationFn: () => openInquiry(shop.data!.business.id, id),
    onSuccess: (thread) => router.push(`/thread/${thread.id}`),
    onError: (error) =>
      showProblem(t`Could not open that`, error),
  });

  if (shop.isLoading) {
    return (
      <View style={styles.screen}>
        <TopBar title={t`Book`} />
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
        <TopBar title={t`Book`} />
        <EmptyState icon="calendar-outline" title={t`That service is no longer offered here.`} />
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
  const unitWord = several ? t`per person` : null;
  const countWord = (n: number) => plural(n, { one: '# person', other: '# people' });
  // The answers are added once, whatever the number of people, and never
  // discounted (§300.3).
  const extraMinor = chosen.priceMinor;
  const totalMinor = Math.max(0, service.priceMinor * quantity + extraMinor);
  const depositPct = Math.max(0, Math.min(100, Math.round(Number(service.depositPercentage))));
  const depositMinor = Math.round((totalMinor * Number(service.depositPercentage)) / 100);
  const restMinor = Math.max(0, totalMinor - depositMinor);
  const split = depositMinor < totalMinor;
  const format = (minor: number) => money.format(minor, service.currency);
  // What the answers add, as one phrase: "+RWF 2,000 · +15 min" (§300).
  const addsWords = [
    extraMinor > 0 && `+${format(extraMinor)}`,
    extraMinor < 0 && `−${format(-extraMinor)}`,
    chosen.minutes > 0 && `+${duration(chosen.minutes)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  // A sale on today (§186). `service.priceMinor` is already the price after it.
  const sale = service.discount;
  const savedMinor = sale ? (sale.listPriceMinor - service.priceMinor) * quantity : 0;

  // Everyone in a booking is served at the same time (§189), so it lasts the
  // service's own length however many come — and the answers' minutes (§300.4).
  const minutes = service.durationMinutes + chosen.minutes;
  const missing = chosen.missing;
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
    if (data.source.startsWith('CLOSED')) return t`Closed on this day.`;
    if (times.length > 0) {
      return times.every((slot) => slot.placesLeft === 0)
        ? t`Every time is booked on this day. Pick another day.`
        : plural(quantity, {
            one: 'No time has room for # person on this day. Try fewer people, or another day.',
            other: 'No time has room for # people on this day. Try fewer people, or another day.',
          });
    }
    // An empty TODAY is almost always the clock, not the shop (§156).
    if (date === days[0]) {
      const shuts = data.closeTime;
      return shuts
        ? t`Closed for today — the shop shuts at ${shuts}. Pick another day.`
        : t`No times left today. Pick another day.`;
    }
    return t`Fully booked on this day.`;
  })();

  // The page's inner width, and the width inside the deal card. Even columns
  // of times that fill the row: four on a normal phone, three on a narrow one,
  // more on a tablet.
  const inner = layout.contentWidth - 40;
  const inCard = inner - CARD_PAD * 2;
  // Wider than a tablet (a desktop window on the web), more times to a row
  // rather than the same six stretched — about 130 points each.
  const perRow = layout.wide ? Math.max(6, Math.floor((inCard + 10) / 140)) : inCard < 300 ? 3 : 4;
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
  const goToTimes = () => scrollTo(timesRef);
  /** …or, with a question still to answer, to the questions (§300). */
  const goToChoices = () => {
    setFlagMissing(true);
    scrollTo(choicesRef);
  };

  const scrollTo = (ref: typeof timesRef) => {
    tick();
    const section = ref.current;
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
            <IconButton icon="share-outline" label={t`Share this service`} onPress={share} flat />
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

          {/* WHO DOES IT, in one slim line under the photos (§278): the way to
              their page (§135.5) with what decides whether to trust them — the
              rating and how far — and a small button to ask them. */}
          <FadeIn delay={10} style={styles.byline}>
            {/* The tap target's own box does not stretch, so this one does. */}
            <View style={styles.flex}>
              <PressableScale
                onPress={() => router.push(`/shop/${id}`)}
                haptic
                scaleTo={0.98}
                accessibilityRole="button"
                accessibilityLabel={t`${businessName}. View the shop`}
                style={styles.bylineShop}
              >
                <Avatar uri={s.business.logoUrl} name={businessName} size={36} />
                <View style={styles.flex}>
                  <View style={styles.bylineTop}>
                    <Text style={styles.bylineName} numberOfLines={1}>
                      {businessName}
                    </Text>
                    <Icon name="chevron-forward" size={14} color={theme.muted} />
                  </View>
                  {/* The branch is said in the card below; this line is about
                      them — what others rate them and how far they are. */}
                  <View style={styles.bylineFacts}>
                    {s.rating.count > 0 && (
                      <>
                        <Icon name="star" size={12} color={theme.star} />
                        <Text style={styles.bylineStrong}>{s.rating.average?.toFixed(1)}</Text>
                        <Text style={styles.bylineText}>({s.rating.count})</Text>
                      </>
                    )}
                    {s.rating.count > 0 && way && <Text style={styles.bylineDot}>·</Text>}
                    {(way || s.rating.count === 0) && (
                      <Text style={styles.bylineText} numberOfLines={1}>
                        {way ?? t`View their shop`}
                      </Text>
                    )}
                  </View>
                </View>
              </PressableScale>
            </View>

            {signedIn && (
              <PressableScale
                onPress={() => openChat.mutate()}
                disabled={openChat.isPending}
                haptic
                scaleTo={0.94}
                accessibilityRole="button"
                accessibilityLabel={t`Message the shop with a question`}
                style={styles.bylineAsk}
              >
                <Icon name="chatbubble-ellipses-outline" size={16} color={theme.ask} />
                <Text style={styles.bylineAskText}>{openChat.isPending ? '…' : t`Ask`}</Text>
              </PressableScale>
            )}
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
              <Text style={type.heading}><Trans>About this service</Trans></Text>
              {/* The shop's own formatting (§271); four lines, then "Read more". */}
              <RichText text={service.description} style={styles.wordsText} collapsedLines={4} />
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
              {s.openNow && <Pill label={t`Open now`} tone="ok" dot />}
              {several && (
                <Pill label={t`Up to ${places} people`} tone="neutral" icon="people-outline" />
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
                {/* Priced after the shop sees the job (§300.3): this is where it starts. */}
                {service.priceConfirmedAtShop && <Text style={styles.priceFrom}><Trans>from</Trans></Text>}
                <Text
                  style={[styles.price, layout.compact && styles.priceCompact, sale && styles.priceSale]}
                >
                  {format(service.priceMinor)}
                </Text>
                {unitWord && <Text style={styles.priceUnit}>{unitWord}</Text>}
              </View>
              {/* What the answers add (§300), as they are picked. */}
              {(extraMinor !== 0 || chosen.minutes > 0) && (
                <PopIn key={`${extraMinor}-${chosen.minutes}`} style={styles.extraLine}>
                  <Icon name="options-outline" size={15} color={theme.accentDeep} />
                  <Text style={styles.extraText}>
                    <Trans>
                      Your choices <Text style={styles.extraStrong}>{addsWords}</Text>
                    </Trans>
                    {quantity > 1 && extraMinor !== 0 ? t` · once, not per person` : ''}
                  </Text>
                </PopIn>
              )}
              {service.priceConfirmedAtShop && (
                <View style={styles.atShop}>
                  <Icon name="information-circle-outline" size={15} color={theme.ink2} />
                  <Text style={styles.atShopText}>
                    <Trans>
                      The shop confirms the final price after seeing the job. The deposit is on this price.
                    </Trans>
                  </Text>
                </View>
              )}
              {/* On sale (§186): how much off, for how long, and what it saves
                  on THIS booking — the saving grows as "how many" does. */}
              {sale && (
                <View style={styles.saleLine}>
                  <SaleBadge percent={sale.percent} large />
                  <View style={styles.flex}>
                    <Text style={styles.saleText}><Trans>Was <Text style={styles.was}>{format(sale.listPriceMinor)}</Text></Trans>
                      {sale.endsOn ? t` · discount ${saleUntil(sale)}` : t` · discount on now`}
                    </Text>
                    <Text style={styles.saleSave}><Trans>You save {format(savedMinor)}</Trans>
                      {quantity > 1 ? t` on ${countWord(quantity)}` : ''}
                    </Text>
                  </View>
                </View>
              )}
              {/* How long the sale has left, ticking (§283). At zero the
                  price is fetched again: the sale is over. */}
              {sale?.endsAt && (
                <SaleCountdown
                  endsAt={sale.endsAt}
                  onEnded={() => void queryClient.invalidateQueries({ queryKey: ['shop', id] })}
                />
              )}
              {split ? (
                <>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${Math.max(4, depositPct)}%` }]} />
                  </View>
                  <View style={styles.split}>
                    <View style={styles.flex}>
                      <Text style={styles.splitLabel}><Trans>Pay now</Trans>{quantity > 1 ? ` · ${countWord(quantity)}` : ''}
                      </Text>
                      <Ticker value={depositMinor} render={format} style={styles.splitNow} />
                    </View>
                    <View style={styles.splitRight}>
                      <Text style={styles.splitLabel}><Trans>At the shop</Trans></Text>
                      <Ticker value={restMinor} render={format} style={styles.splitLater} />
                    </View>
                  </View>
                  <View style={styles.holdLine}>
                    <Icon name="shield-checkmark" size={15} color={theme.ok} />
                    <Text style={styles.holdText}>
                      <Trans>
                        A {depositPct}% deposit holds the time for you. The rest is paid at the shop.
                      </Trans>
                    </Text>
                  </View>
                </>
              ) : (
                <View style={styles.holdLine}>
                  <Icon name="shield-checkmark" size={15} color={theme.ok} />
                  <Text style={styles.holdText}><Trans>Paid in full now, and the time is yours.</Trans></Text>
                </View>
              )}
            </View>

            {/* YOUR CHOICES (§300), before the time: the answers can make it
                longer, and the times offered are the ones that fit. */}
            {(groups.length > 0 || service.noteEnabled) && (
              <>
                <View style={styles.rule} />
                <View ref={choicesRef} collapsable={false} style={styles.section}>
                  {groups.length > 0 && (
                    <>
                      <Text style={type.heading}><Trans>Your choices</Trans></Text>
                      <ChoicePicker
                        groups={groups}
                        picked={picked}
                        onToggle={(group, option) => setPicked((was) => toggle(groups, was, group, option))}
                        format={format}
                        flagMissing={flagMissing}
                      />
                    </>
                  )}
                  {service.noteEnabled && (
                    <NoteBox
                      value={note}
                      onChange={setNote}
                      prompt={service.notePrompt}
                      privateAsked={groups.some((group) => group.healthRelated)}
                      onFocus={keys.reveal}
                    />
                  )}
                </View>
              </>
            )}

            <View style={styles.rule} />

            {/* CHOOSE A TIME: how many, which day, what time. */}
            <View ref={timesRef} collapsable={false} style={styles.section}>
              <Text style={type.heading}><Trans>Choose a time</Trans></Text>

              {/* Asked only where the branch serves more than one at once
                  (§189). Before the day and the time, because the answer
                  changes which times have room. */}
              {several && (
                // On a narrow phone the question sits above the − / +, so it
                // reads on one line instead of three.
                <View style={[styles.howMany, inCard < 300 && styles.howManyStacked]}>
                  <View style={inCard < 300 ? undefined : styles.flex}>
                    <Text style={type.subheading}><Trans>How many people?</Trans></Text>
                    <Text style={type.small}><Trans>Up to {places}, all at once</Trans></Text>
                  </View>
                  <Stepper
                    value={quantity}
                    max={places}
                    label={t`people`}
                    onFocus={keys.reveal}
                    onChange={(next) => {
                      setQuantity(next);
                      // A time that was free for two may not be free for three.
                      setSlot(null);
                    }}
                  />
                </View>
              )}

              {/* Choices first (§300): the times depend on the answers. */}
              {missing.length > 0 && (
                <PressableScale
                  haptic
                  scaleTo={0.98}
                  onPress={goToChoices}
                  accessibilityRole="button"
                  style={styles.closed}
                >
                  <View style={styles.closedIcon}>
                    <Icon name="arrow-up" size={18} color={theme.accentDeep} />
                  </View>
                  <Text style={[type.body, styles.flex]}>
                    {missing.length > 1
                      ? plural(missing.length - 1, {
                          one: `Answer “${askedAs(missing[0])}” first and # more — the times depend on your answers.`,
                          other: `Answer “${askedAs(missing[0])}” first and # more — the times depend on your answers.`,
                        })
                      : t`Answer “${askedAs(missing[0])}” first — the times depend on your answers.`}
                  </Text>
                </PressableScale>
              )}

              {missing.length === 0 && (
              <>
              <Text style={type.label}><Trans>Day</Trans></Text>
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
                      accessibilityLabel={
                        i === 0
                          ? t`Today, ${label.weekday} ${label.day} ${label.month}`
                          : `${label.weekday} ${label.day} ${label.month}`
                      }
                      onPress={() => {
                        setDate(ymd);
                        setSlot(null);
                      }}
                      style={[styles.day, active && styles.dayActive]}
                    >
                      <Text style={[styles.dayWeek, active && styles.onAccent]}>
                        {i === 0 ? t`Today` : label.weekday}
                      </Text>
                      <Text style={[styles.dayNum, active && styles.onAccent]}>{label.day}</Text>
                      <Text style={[styles.dayMonth, active && styles.onAccentSoft]}>
                        {label.month}
                      </Text>
                    </PressableScale>
                  );
                })}
              </ScrollView>

              <Text style={type.label}><Trans>Time</Trans></Text>

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
                      {period.slots.filter((t) => t.placesLeft >= quantity).length || t`None`}
                        <Trans>
                          free
                        </Trans>
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
                      const note = full ? t({ message: 'Booked', context: 'a time with no places left' }) : few ? t`${placesLeft} left` : null;
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
                              ? t`${time}, booked`
                              : few
                                ? t`${time}, ${placesLeft} ${placesLeft === 1 ? 'place' : 'places'} left`
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
                  <Trans>
                    Times are local to the shop ({availability.data.timeZone}).
                  </Trans>
                </Text>
              )}
              </>
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
                    <Text style={styles.summaryTitle}><Trans>Your booking</Trans></Text>
                  </View>
                  <Text style={styles.summaryWhen}>
                    {niceDate(date)} · {slot} – {endOf(slot, minutes)}
                  </Text>
                  <Text style={styles.summaryWhat} numberOfLines={2}>
                    {service.name}
                    {quantity > 1 ? ` · ${countWord(quantity)}` : ''} · {duration(minutes)} ·{' '}
                    {businessName}
                  </Text>
                  {/* What was picked (§300); private answers counted, not named. */}
                  {chosen.lines.length > 0 && (
                    <Text style={styles.summaryWhat} numberOfLines={3}>
                      {[
                        ...chosen.lines.filter((l) => !l.group.healthRelated).map((l) => l.option.label),
                        ...(chosen.lines.some((l) => l.group.healthRelated) ? [t`private answers for the shop`] : []),
                      ].join(' · ')}
                    </Text>
                  )}
                  <View style={styles.summaryRule} />
                  <View style={styles.summaryMoney}>
                    <View style={styles.flex}>
                      <Text style={styles.summaryLabel}><Trans>Total</Trans></Text>
                      <Text style={styles.summaryValue}>{format(totalMinor)}</Text>
                      {sale && (
                        <Text style={styles.summarySave}>
                          <Trans>{sale.percent}% off · you save {format(savedMinor)}</Trans>
                        </Text>
                      )}
                    </View>
                    <View>
                      <Text style={styles.summaryLabel}><Trans>Pay now</Trans></Text>
                      <Text style={[styles.summaryValue, styles.summaryNow]}>
                        {format(depositMinor)}
                      </Text>
                    </View>
                  </View>
                </PopIn>
              )}
            </View>
          </FadeIn>
        </ScrollView>
      </View>

      {/* The running answer to "what will this cost me", and the one button. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.footerInner}>
          <View style={styles.footerTotal}>
            <Text style={styles.footerLabel} numberOfLines={1}>
              {quantity > 1 ? t`Total for ${countWord(quantity)}` : t`Total`}
              {sale ? t` · ${sale.percent}% off` : ''}
              {extraMinor !== 0 ? t` · with choices` : ''}
            </Text>
            <Ticker
              value={totalMinor}
              render={format}
              style={[styles.footerPrice, layout.compact && styles.footerPriceCompact]}
            />
            {split && (
              <Text style={styles.footerNow} numberOfLines={1}>
                <Trans>
                  {format(depositMinor)} now
                </Trans>
                </Text>
            )}
          </View>
          <Button
            style={[styles.cta, layout.compact && styles.ctaCompact]}
            kind={slot && missing.length === 0 ? 'primary' : 'dark'}
            busy={book.isPending}
            icon={
              layout.compact
                ? undefined
                : missing.length > 0
                  ? 'arrow-up'
                  : !slot
                    ? 'calendar-outline'
                    : signedIn
                      ? undefined
                      : 'log-in-outline'
            }
            label={
              missing.length > 0
                ? t`Answer first`
                : !slot
                  ? layout.compact
                    ? t`Pick a time`
                    : t`Choose a time`
                  : signedIn
                    ? t`Book ${slot}`
                    : t`Sign in to book`
            }
            onPress={() => {
              if (missing.length > 0) return goToChoices();
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
  priceFrom: { fontFamily: font.bold, fontSize: 15, color: theme.muted },
  extraLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    backgroundColor: theme.accentSoft,
    marginTop: -2,
  },
  extraText: { fontFamily: font.semibold, fontSize: 12.5, color: theme.accentDeep },
  extraStrong: { fontFamily: font.extrabold },
  atShop: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  atShopText: { flex: 1, fontFamily: font.semibold, fontSize: 12.5, lineHeight: 18, color: theme.ink2 },
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

  // ---- who does it, under the photos (§278) ----
  byline: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: -6, paddingHorizontal: 2 },
  bylineShop: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  bylineTop: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  bylineName: { flexShrink: 1, fontFamily: font.bold, fontSize: 14.5, color: theme.ink },
  bylineFacts: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  bylineStrong: { fontFamily: font.bold, fontSize: 12.5, color: theme.ink },
  bylineDot: { fontFamily: font.bold, fontSize: 12.5, color: theme.muted },
  bylineText: { flexShrink: 1, fontFamily: font.medium, fontSize: 12.5, color: theme.muted },
  bylineAsk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: theme.askSoft,
  },
  bylineAskText: { fontFamily: font.bold, fontSize: 13, color: theme.ask },

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
  // The total keeps its room: the button beside it wraps first (§308).
  footerTotal: { flexGrow: 1, flexShrink: 0, maxWidth: '55%' },
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
  // Wide enough to read, never so wide that it squeezes the total (§308).
  cta: { minWidth: 112, maxWidth: '58%', flexShrink: 1 },
  ctaCompact: { minWidth: 104, paddingHorizontal: 16 },
});
