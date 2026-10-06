import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardScroll } from '../../src/useKeyboardScroll';
import { getAvailability, getShop } from '../../src/api/discovery';
import { createAppointment } from '../../src/api/booking';
import { ApiError, useSignedIn } from '../../src/api/client';
import { duration } from '../../src/duration';
import { useMoney } from '../../src/money';
import { font, radius, shadow, theme, type } from '../../src/theme';
import { Avatar } from '../../src/ui/Avatar';
import { Button } from '../../src/ui/Button';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { cheer } from '../../src/ui/haptic';
import { Icon } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { PhotoViewer, type ViewerOrigin } from '../../src/ui/PhotoViewer';
import { PressableScale } from '../../src/ui/PressableScale';
import { Skeleton } from '../../src/ui/Skeleton';
import { Stepper } from '../../src/ui/Stepper';
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

/**
 * Pick a day, pick a time, hold the slot.
 *
 * Availability is asked for with the SERVICE's duration, not the default grid:
 * a 60-minute service cannot start 45 minutes before closing, and the default
 * would offer starts that booking then refuses.
 *
 * The slots come back as local times in the SHOP's time zone. They are sent
 * back as the same wall-clock time rather than converted through the phone's
 * zone — a customer in Kigali and a phone set to London must mean 10:00 at the
 * shop when they tap 10:00.
 *
 * Laid out as the two questions it asks (§133): a row of days to swipe through,
 * then a grid of times in even columns. The button at the bottom never moves
 * and always says what it will do next — "Pick a time" until there is one, then
 * the time and what it costs to hold it.
 */
export default function Book() {
  const { id, serviceId } = useLocalSearchParams<{ id: string; serviceId: string }>();
  const router = useRouter();
  const money = useMoney();
  const insets = useSafeAreaInsets();
  // Keeps the field being typed into above the keyboard (§168).
  const keys = useKeyboardScroll({ pad: true });
  const layout = useLayout();
  const signedIn = useSignedIn();
  const [viewer, setViewer] = useState<{ index: number; origin: ViewerOrigin | null } | null>(null);

  const days = useMemo(() => nextDays(14), []);
  const [date, setDate] = useState(days[0]);
  const [slot, setSlot] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

  const shop = useQuery({ queryKey: ['shop', id], queryFn: () => getShop(id) });
  const service = shop.data?.services.find((s) => s.id === serviceId);

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

  if (shop.isLoading) {
    return (
      <View style={styles.screen}>
        <TopBar title="Book" />
        <View style={styles.content}>
          <Skeleton height={150} round={radius.lg} />
          <Skeleton width="40%" height={18} />
          <Skeleton height={84} round={radius.lg} />
          <Skeleton width="40%" height={18} />
          <Skeleton height={120} round={radius.lg} />
        </View>
      </View>
    );
  }
  if (!service) {
    return (
      <View style={styles.screen}>
        <TopBar title="Book" />
        <EmptyState icon="calendar-outline" title="That service is no longer offered here." />
      </View>
    );
  }

  // Everything is for the WHOLE booking (§136): the price is one times how
  // many, and the deposit is its share of that total.
  const several = service.quantityMode !== 'SINGLE';
  const people = service.quantityMode === 'PEOPLE';
  const totalMinor = service.priceMinor * quantity;
  const depositMinor = Math.round((totalMinor * Number(service.depositPercentage)) / 100);
  // How long the whole booking takes comes from the server, which knows how
  // many places the shop has. Until it answers, one sitting is the best guess.
  const minutes = availability.data?.durationMinutes ?? service.durationMinutes;
  const slots = availability.data?.slots ?? [];

  // Even columns that fill the row: four on a normal phone, three on a narrow
  // one, more on a tablet. A ragged wrap of different-width times is hard to
  // scan for "the one after lunch".
  const inner = layout.contentWidth - 40;
  /**
   * The photos share the width between them, and never go narrower than 220
   * (§135.4). So ONE photo is as wide as the screen's content, two fill a
   * tablet side by side, and a set too long to fit stays at 220 each and
   * scrolls — with the next one peeking in at the edge. A fixed 220 left a
   * lone photo sitting beside an empty half of the screen.
   */
  const photoCount = service?.images.length ?? 0;
  const photoWidth = Math.max(220, Math.floor((inner - 10 * (photoCount - 1)) / (photoCount || 1)));
  const photoHeight = Math.max(160, Math.min(280, Math.round(photoWidth * 0.58)));
  const perRow = layout.wide ? 6 : inner < 330 ? 3 : 4;
  const slotWidth = (inner - 10 * (perRow - 1)) / perRow;

  return (
    <View style={styles.screen}>
      <PhotoViewer
        photos={service.images}
        openAt={viewer?.index ?? null}
        origin={viewer?.origin}
        onClose={() => setViewer(null)}
      />
      <TopBar title={service.name} subtitle={shop.data?.business.name ?? shop.data?.name} />

      <ScrollView
        ref={keys.ref}
        onScroll={keys.track}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { width: layout.contentWidth, alignSelf: 'center' },
          keys.padding > 0 && { paddingBottom: keys.padding + 28 },
        ]}
      >
        {/* Every photo of this service (§132), not just the cover: by this
            screen the customer has chosen it and is deciding whether to pay,
            which is the moment the pictures are worth most. Horizontal so a
            long list does not push the price and the slots off the screen. */}
        {service.images.length > 0 && (
          <FadeIn>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.bleed}
              contentContainerStyle={styles.photoStrip}
            >
              {service.images.map((photo, index) => (
                // Tapping a photo opens it properly (§135.7). Where the
                // thumbnail sits on screen is measured at the tap, so the
                // photo can grow out of exactly that spot.
                <PressableScale
                  key={photo.id}
                  scaleTo={0.98}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={`Photo ${index + 1} of ${service.images.length}`}
                  onPress={(e) => {
                    // Asked of the thumbnail itself rather than worked out
                    // from the touch: the touch's own offsets are not reported
                    // the same way everywhere, and a wrong origin is worse
                    // than none.
                    const target = e.currentTarget as unknown as {
                      measureInWindow?: (
                        done: (x: number, y: number, w: number, h: number) => void,
                      ) => void;
                    };
                    if (!target?.measureInWindow) return setViewer({ index, origin: null });
                    target.measureInWindow((x, y, width, height) =>
                      setViewer({
                        index,
                        origin: [x, y, width, height].every(Number.isFinite)
                          ? { x, y, width, height }
                          : null,
                      }),
                    );
                  }}
                >
                  <Image
                    source={{ uri: photo.url }}
                    style={[styles.photo, { width: photoWidth, height: photoHeight }]}
                  />
                </PressableScale>
              ))}
            </ScrollView>
          </FadeIn>
        )}

        {/* WHOSE service this is, and the way to their page (§135.5). The home
            shelves bring people straight here, past the shop — so this screen
            has to be able to send them there, or the only way to see the
            shop's hours, photos and reviews was to go back and hunt for it.
            Always shown, photo or no photo. */}
        {shop.data && (
          <FadeIn delay={20}>
            <PressableScale
              onPress={() => router.push(`/shop/${id}`)}
              haptic
              accessibilityRole="button"
              accessibilityLabel={`${shop.data.business.name ?? shop.data.name}, view shop`}
              style={styles.shopRow}
            >
              <Avatar
                uri={shop.data.business.logoUrl}
                name={shop.data.business.name ?? shop.data.name}
                size={46}
              />
              <View style={styles.shopText}>
                <Text style={type.subheading} numberOfLines={1}>
                  {shop.data.business.name ?? shop.data.name}
                </Text>
                <Text style={type.small} numberOfLines={1}>
                  {shop.data.name}
                </Text>
              </View>
              {/* On a narrow phone the words would cut the shop's name short,
                  and the name matters more; the arrow says the same thing. */}
              {!layout.compact && <Text style={styles.shopLink}>View shop</Text>}
              <Icon name="chevron-forward" size={16} color={theme.accent} />
            </PressableScale>
          </FadeIn>
        )}

        <FadeIn delay={40} style={styles.card}>
          <Text style={type.heading}>{service.name}</Text>
          <View style={styles.line}>
            <Icon name="time-outline" size={15} color={theme.muted} />
            <Text style={type.small}>
              {duration(minutes, true)} at {shop.data?.name}
            </Text>
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{money.format(totalMinor, service.currency)}</Text>
            <Text style={type.small}>total</Text>
          </View>
          {quantity > 1 && (
            <Text style={type.small}>
              {quantity} × {money.format(service.priceMinor, service.currency)}
            </Text>
          )}
          {/* The split is stated before anything is chosen. It is the part
              people get wrong about a deposit. */}
          <View style={styles.depositNote}>
            <Icon name="shield-checkmark-outline" size={17} color={theme.accent} />
            <Text style={styles.depositText}>
              You pay {money.format(depositMinor, service.currency)} now to hold the
              slot. The rest is paid at the shop.
            </Text>
          </View>
        </FadeIn>

        {/* HOW MANY, asked only where the shop allows more than one, and in
            the shop's own sense of it (§136): people for a haircut, just a
            number for passport photos. Before the day and the time, because
            the answer changes which times are free. */}
        {several && (
          <FadeIn delay={70} style={[styles.card, styles.howMany]}>
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
          </FadeIn>
        )}

        <FadeIn delay={100} style={styles.group}>
          <Text style={type.heading}>Which day?</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.bleed}
            contentContainerStyle={styles.days}
          >
            {days.map((ymd) => {
              const label = dayLabel(ymd);
              const active = ymd === date;
              return (
                <PressableScale
                  key={ymd}
                  haptic
                  scaleTo={0.93}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    setDate(ymd);
                    setSlot(null);
                  }}
                  style={[styles.day, active && styles.dayActive]}
                >
                  <Text style={[styles.dayWeek, active && styles.onAccent]}>{label.weekday}</Text>
                  <Text style={[styles.dayNum, active && styles.onAccent]}>{label.day}</Text>
                  <Text style={[styles.dayMonth, active && styles.onAccentSoft]}>{label.month}</Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </FadeIn>

        <FadeIn delay={160} style={styles.group}>
          <Text style={type.heading}>What time?</Text>

          {availability.isLoading && (
            <View style={styles.slots}>
              {Array.from({ length: perRow * 2 }, (_, i) => (
                <Skeleton key={i} width={slotWidth} height={46} round={radius.md} />
              ))}
            </View>
          )}

          {availability.data && slots.length === 0 && (
            <View style={styles.closed}>
              <Icon name="moon-outline" size={20} color={theme.muted} />
              <Text style={[type.body, styles.flex]}>
                {/* The server says WHY, and it is more useful than "no slots".
                    An empty TODAY is almost always the clock, not the shop
                    (§156): the shop has closed, or its last slot has gone, and
                    "nothing free" read as "I never get a day off". */}
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

          <View style={styles.slots}>
            {slots.map((time) => {
              const active = slot === time;
              return (
                <PressableScale
                  key={time}
                  haptic
                  scaleTo={0.92}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setSlot(time)}
                  style={[styles.slot, { width: slotWidth }, active && styles.slotActive]}
                >
                  <Text style={[styles.slotText, active && styles.onAccent]}>{time}</Text>
                </PressableScale>
              );
            })}
          </View>

          {availability.data?.timeZone && slots.length > 0 && (
            <Text style={type.small}>
              Times are local to the shop ({availability.data.timeZone}).
            </Text>
          )}
        </FadeIn>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        <Button
          style={{ width: Math.min(layout.contentWidth - 40, 520), alignSelf: 'center' }}
          disabled={!slot}
          busy={book.isPending}
          // Signed out, the button says what tapping it will do (§170): the
          // times are worth seeing first, the booking needs an account.
          icon={slot && !signedIn ? 'log-in-outline' : undefined}
          label={
            !slot
              ? 'Pick a time'
              : signedIn
                ? `Book ${slot} · pay ${money.format(depositMinor, service.currency)}`
                : `Sign in to book ${slot}`
          }
          onPress={() => {
            // Signing in is required to hold a slot, but not to get here —
            // asking earlier loses people who were only looking.
            if (!signedIn) {
              router.push(`/sign-in?next=/book/${id}?serviceId=${serviceId}`);
              return;
            }
            book.mutate();
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 28, gap: 22 },
  bleed: { marginHorizontal: -20, flexGrow: 0 },
  photoStrip: { paddingHorizontal: 20, gap: 10 },
  photo: {
    borderRadius: radius.lg,
    backgroundColor: theme.line,
  },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 18,
    gap: 6,
    ...shadow.card,
  },
  shopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...shadow.card,
  },
  shopText: { flex: 1, gap: 1 },
  shopLink: { fontFamily: font.bold, fontSize: 13, color: theme.accent },
  howMany: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 7, marginTop: 6 },
  price: { fontFamily: font.extrabold, fontSize: 26, color: theme.ink, letterSpacing: -0.5 },
  depositNote: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: theme.accentSoft,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 8,
  },
  depositText: { flex: 1, fontFamily: font.semibold, fontSize: 13, lineHeight: 19, color: theme.accentDeep },
  group: { gap: 12 },
  days: { paddingHorizontal: 20, gap: 10, paddingVertical: 4 },
  day: {
    width: 64,
    paddingVertical: 12,
    borderRadius: radius.lg,
    backgroundColor: theme.panel,
    alignItems: 'center',
    gap: 2,
    ...shadow.card,
  },
  dayActive: { backgroundColor: theme.accent, ...shadow.raised },
  dayWeek: { fontFamily: font.semibold, fontSize: 12, color: theme.muted },
  dayNum: { fontFamily: font.extrabold, fontSize: 21, color: theme.ink },
  dayMonth: { fontFamily: font.medium, fontSize: 11, color: theme.muted },
  onAccent: { color: '#FFFFFF' },
  onAccentSoft: { color: 'rgba(255,255,255,0.8)' },
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
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 16,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    backgroundColor: theme.panel,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadow.float,
  },
});
