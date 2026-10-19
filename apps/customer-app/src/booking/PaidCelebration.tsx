import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Appointment } from '../api/booking';
import { font, radius, shadow, theme, type } from '../theme';
import { Button } from '../ui/Button';
import { Cover } from '../ui/Cover';
import { FadeIn } from '../ui/FadeIn';
import { Icon } from '../ui/Icon';
import { dayOf, howMany, reservationNo, timeRange, type Bought } from './format';
import { askForPush, pushState, type PushState } from '../push';
import { followWords, useFollow } from '../useFollow';
import { PressableScale } from '../ui/PressableScale';
import { AppSwitch } from '../ui/AppSwitch';

const CONFETTI = ['#F0532D', '#FFB020', '#0E9F54', '#2456C7', '#D03A6E', '#6B3FD4'];

/**
 * The moment the money lands (§137).
 *
 * Its own screen, shown once, because it answers the only question anyone has
 * for the ten seconds after approving a payment on their phone: DID IT WORK.
 * A green tick that grows, the amount, and what was bought — then two ways on.
 * It used to be a small "Confirmed" row that appeared in the middle of the
 * payment form while the form was still on screen.
 *
 * Shown only when the payment is seen to succeed in this sitting. Opening a
 * booking paid last week goes straight to the reservation: celebrating again
 * would be noise.
 */
export function PaidCelebration({
  a,
  bought,
  format,
  onView,
  onExplore,
}: {
  a: Appointment;
  bought: Bought;
  format: (minor: number | null | undefined, currency?: string) => string;
  onView: () => void;
  onExplore: () => void;
}) {
  const insets = useSafeAreaInsets();
  const tick = useRef(new Animated.Value(0)).current;
  const rings = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(tick, {
      toValue: 1,
      useNativeDriver: true,
      speed: 7,
      bounciness: 16,
    }).start();
    Animated.timing(burst, {
      toValue: 1,
      duration: 1500,
      delay: 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const loop = Animated.loop(
      Animated.timing(rings, {
        toValue: 1,
        duration: 2200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [tick, rings, burst]);

  // Eighteen pieces thrown outward from the tick, each on its own line. Fixed
  // once, so they do not jump when the screen re-renders.
  const pieces = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        const angle = (i / 18) * Math.PI * 2 + (i % 2 ? 0.18 : -0.12);
        const reach = 92 + (i % 4) * 22;
        return {
          x: Math.cos(angle) * reach,
          y: Math.sin(angle) * reach,
          color: CONFETTI[i % CONFETTI.length],
          size: 6 + (i % 3) * 2,
          round: i % 2 === 0,
          spin: `${(i % 2 ? 1 : -1) * (160 + i * 14)}deg`,
        };
      }),
    [],
  );

  const many = howMany(a);

  return (
    <ScrollView
      style={styles.screen}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 28 },
      ]}
    >
      <View style={styles.stage}>
        {[0, 0.5].map((offset) => {
          // Two rings a beat apart, so there is always one on its way out.
          const phase = Animated.modulo(Animated.add(rings, offset), 1);
          return (
            <Animated.View
              key={offset}
              style={[
                styles.ring,
                {
                  opacity: phase.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
                  transform: [
                    { scale: phase.interpolate({ inputRange: [0, 1], outputRange: [1, 2.3] }) },
                  ],
                },
              ]}
            />
          );
        })}

        {pieces.map((piece, i) => (
          <Animated.View
            key={i}
            style={[
              styles.piece,
              {
                width: piece.size,
                height: piece.round ? piece.size : piece.size * 1.8,
                borderRadius: piece.round ? piece.size / 2 : 2,
                backgroundColor: piece.color,
                opacity: burst.interpolate({ inputRange: [0, 0.08, 0.7, 1], outputRange: [0, 1, 1, 0] }),
                transform: [
                  { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, piece.x] }) },
                  {
                    // Out, and then a little down: thrown, not floated.
                    translateY: burst.interpolate({
                      inputRange: [0, 0.6, 1],
                      outputRange: [0, piece.y, piece.y + 34],
                    }),
                  },
                  { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', piece.spin] }) },
                ],
              },
            ]}
          />
        ))}

        <Animated.View style={[styles.tick, { opacity: tick, transform: [{ scale: tick }] }]}>
          <Icon name="checkmark" size={46} color="#FFFFFF" />
        </Animated.View>
      </View>

      <FadeIn delay={220} style={styles.words}>
        <Text style={[type.display, styles.centre]}>Payment successful</Text>
        <Text style={[type.body, styles.centre]}>
          {format(a.depositAmountMinor, a.currency)} paid with MTN Mobile Money. Your slot is
          confirmed.
        </Text>
      </FadeIn>

      {/* The receipt: enough to know it is the right booking at a glance. */}
      <FadeIn delay={340} style={styles.receipt}>
        <View style={styles.item}>
          <Cover
            uri={bought.cover}
            categoryIcon={bought.categoryIcon}
            style={styles.photo}
            iconSize={24}
          />
          <View style={styles.flex}>
            <Text style={type.subheading} numberOfLines={2}>
              {a.service.name}
            </Text>
            <Text style={type.small} numberOfLines={1}>
              {bought.businessName}
              {many ? ` · ${many}` : ''}
            </Text>
          </View>
        </View>

        <View style={styles.dashed} />

        <Row label="When" value={`${dayOf(a.startTime)}\n${timeRange(a)}`} />
        <Row label="Where" value={a.location.name} />
        <Row label="Reservation no." value={reservationNo(a.id)} strong />
      </FadeIn>

      {/* The moment the reason is plain (§287): a reminder before it, and the
          shop's offers — asked here, not when the app first opened. */}
      <FadeIn delay={420}>
        <StayInTouch shop={bought.businessName} businessId={a.location.businessId} />
      </FadeIn>

      <FadeIn delay={460} style={styles.actions}>
        <Button label="View my reservation" icon="ticket-outline" onPress={onView} />
        <Button kind="ghost" label="Explore more services" onPress={onExplore} />
      </FadeIn>
    </ScrollView>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={type.small}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong]} selectable={strong}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  touch: { marginTop: 18, borderRadius: radius.lg, backgroundColor: theme.panel, ...shadow.card, overflow: 'hidden' },
  touchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  touchDivider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line, marginLeft: 64 },
  touchIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  touchTitle: { fontFamily: font.bold, fontSize: 15, color: theme.ink },
  touchBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: theme.ask },
  touchBtnText: { fontFamily: font.extrabold, fontSize: 13.5, color: '#FFFFFF' },
  touchOn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: theme.okSoft },
  touchOnText: { fontFamily: font.bold, fontSize: 13, color: theme.ok },
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  centre: { textAlign: 'center' },
  content: {
    flexGrow: 1,
    paddingHorizontal: 22,
    gap: 22,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  stage: { height: 190, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: theme.ok,
  },
  piece: { position: 'absolute' },
  tick: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: theme.ok,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  words: { gap: 8 },
  receipt: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 18,
    gap: 13,
    ...shadow.card,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  photo: { width: 62, height: 62, borderRadius: radius.md },
  dashed: { borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: theme.line },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  rowValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: font.bold,
    fontSize: 13.5,
    lineHeight: 19,
    color: theme.ink,
  },
  rowStrong: { fontFamily: font.extrabold, fontSize: 15, letterSpacing: 1.2 },
  actions: { gap: 6, marginTop: 'auto' },
});

/** A reminder before the appointment, and this shop's offers (§287). */
function StayInTouch({ shop, businessId }: { shop: string; businessId: string }) {
  const [push, setPush] = useState<PushState | null>(null);
  const follow = useFollow(businessId);
  useEffect(() => {
    void pushState().then(setPush);
  }, []);
  const showPush = push === 'undecided' || push === 'on';
  return (
    <View style={styles.touch}>
      {showPush && (
        <View style={styles.touchRow}>
          <View style={[styles.touchIcon, { backgroundColor: theme.askSoft }]}>
            <Icon name="alarm-outline" size={18} color={theme.ask} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.touchTitle}>Remind me before it</Text>
            <Text style={type.small}>An alert on this phone the day before.</Text>
          </View>
          {push === 'on' ? (
            <View style={styles.touchOn}>
              <Icon name="checkmark" size={14} color={theme.ok} />
              <Text style={styles.touchOnText}>On</Text>
            </View>
          ) : (
            <PressableScale
              onPress={async () => setPush(await askForPush())}
              haptic
              style={styles.touchBtn}
              accessibilityRole="button"
            >
              <Text style={styles.touchBtnText}>Turn on</Text>
            </PressableScale>
          )}
        </View>
      )}
      {showPush && <View style={styles.touchDivider} />}
      <View style={styles.touchRow}>
        <View style={[styles.touchIcon, { backgroundColor: theme.accentSoft }]}>
          <Icon name="storefront-outline" size={18} color={theme.accentDeep} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.touchTitle}>Hear {shop}’s offers</Text>
          <Text style={type.small}>“{followWords(shop)}”</Text>
        </View>
        <AppSwitch
          value={follow.following}
          disabled={follow.pending}
          accessibilityLabel={`Follow ${shop}`}
          onValueChange={() => follow.toggle()}
        />
      </View>
    </View>
  );
}
