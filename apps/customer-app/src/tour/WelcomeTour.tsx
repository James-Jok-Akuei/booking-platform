import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
  type LayoutChangeEvent,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMe, setMyDisplayName, tourDone, type Me } from '../api/auth';
import { useSignedIn } from '../api/client';
import { askForPush, pushState, type PushState } from '../push';
import { font, radius, theme } from '../theme';
import { Button } from '../ui/Button';
import { tick } from '../ui/haptic';
import { Icon, type IconName } from '../ui/Icon';
import { useReducedMotion } from '../ui/Motion';
import { PressableScale } from '../ui/PressableScale';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

/**
 * The welcome story (§307): what somebody sees the first time they are signed
 * in to the app — four moments of booking, on the app's real screens, told
 * like stories (a bar for each, tap the right to go on, the left to go back,
 * hold to pause), then one screen to make it theirs: the name on their
 * reviews, and reminders before each booking.
 *
 * It waits for a calm moment: never over the opening picture, the sign-in, or
 * a booking half made — only on one of the tabs. Seen or put aside, the server
 * keeps that, so no other phone shows it again; Account → "How booking works"
 * plays it again whenever someone wants it.
 */

type Spot = { x: number; y: number; w: number; h: number };
type Slide = {
  key: string;
  image: ImageSourcePropType;
  title: string;
  text: string;
  spot: Spot;
  chip: { icon: IconName; title: string; text: string; tone: string };
};

/** The real screens, captured from this app (§260's rule): a place, a time, the deposit, the code. */
const SLIDES: Slide[] = [
  {
    key: 'find',
    image: require('../../assets/tour/find.jpg'),

    get title() { return t`Find a place near you`; },
    get text() { return t`Barbers, salons, spas and more — with their real photos, prices and reviews.`; },
    spot: { x: 3, y: 34, w: 94, h: 22 },

    chip: {
      icon: 'location',

      get title() { return t`Near you`; },
      get text() { return t`Closest places first`; },
      tone: theme.night
    }
  },
  {
    key: 'pick',
    image: require('../../assets/tour/pick.jpg'),

    get title() { return t`Pick a time that suits you`; },
    get text() { return t`Every free time is there to see. Choose yours with a tap.`; },
    spot: { x: 7, y: 35, w: 86, h: 39 },

    chip: {
      icon: 'time',

      get title() { return t`Fri 23 Oct, 10:00`; },
      get text() { return t`Yours to choose`; },
      tone: theme.accent
    }
  },
  {
    key: 'pay',
    image: require('../../assets/tour/pay.jpg'),

    get title() { return t`Hold it with a small deposit`; },
    get text() { return t`A part of the price, by mobile money, approved on your own phone. The rest you pay at the shop.`; },
    spot: { x: 6, y: 22, w: 88, h: 8.5 },

    chip: {
      icon: 'shield-checkmark',

      get title() { return t`Deposit paid`; },
      get text() { return t`The time is truly yours`; },
      tone: theme.ok
    }
  },
  {
    key: 'code',
    image: require('../../assets/tour/code.jpg'),

    get title() { return t`Show your code when you arrive`; },
    get text() { return t`Six digits, on your booking and in your email. That is all the shop needs.`; },
    spot: { x: 9, y: 48.5, w: 82, h: 14.5 },

    chip: {
      icon: 'ticket',

      get title() { return t`Checked in`; },
      get text() { return t`Six digits, and you are in`; },
      tone: theme.accent
    }
  },
];

/** How long each moment plays before the next. */
const MOMENT_MS = 6000;
/** The phone's own proportions, which the screenshots were taken at. */
const PHONE_RATIO = 390 / 844;

// Asked for from Account: played again, whether or not it is owed.
const askers = new Set<() => void>();
export function playWelcomeTour() {
  askers.forEach((ask) => ask());
}

/** Rendered once at the root: decides when the story is owed, and shows it then. */
export function WelcomeTourHost({ ready }: { ready: boolean }) {
  const signedIn = useSignedIn();
  const me = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: signedIn });
  const queryClient = useQueryClient();
  const segments = useSegments();
  const [open, setOpen] = useState<null | 'first' | 'again'>(null);
  const shown = useRef(false);

  const due = signedIn && (me.data?.toursDue?.includes('customer') ?? false);
  // On a tab, and nowhere else: not over signing in, not halfway through a booking.
  const calm = ready && segments[0] === '(tabs)';

  useEffect(() => {
    if (!due || !calm || shown.current || open) return;
    // A moment for the tab to draw first, so the story opens over the app.
    const timer = setTimeout(() => {
      shown.current = true;
      setOpen('first');
    }, 700);
    return () => clearTimeout(timer);
  }, [due, calm, open]);

  useEffect(() => {
    const ask = () => setOpen('again');
    askers.add(ask);
    return () => {
      askers.delete(ask);
    };
  }, []);

  const close = useCallback(() => {
    setOpen(null);
    if (!due) return;
    tourDone('customer')
      .then(({ toursDue }) => queryClient.setQueryData<Me>(['me'], (old) => (old ? { ...old, toursDue } : old)))
      .catch(() => undefined);
  }, [due, queryClient]);

  if (!open) return null;
  return <Story first={open === 'first'} me={me.data ?? null} onClose={close} />;
}

function Story({ first, me, onClose }: { first: boolean; me: Me | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const still = useReducedMotion();
  // The last moment, for somebody new: making it theirs.
  const count = SLIDES.length + (first ? 1 : 0);
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const progress = useRef(new Animated.Value(0)).current;
  // Where the story is, as one number (2.4 = the third moment, 40% through):
  // every bar reads it, so none is ever left holding an old width.
  const step = useRef(new Animated.Value(0)).current;
  const along = useRef(Animated.add(step, progress)).current;
  const enter = useRef(new Animated.Value(0)).current;
  const opened = useRef(new Animated.Value(0)).current;
  const paused = useRef(false);
  // Carries on a paused moment from where its bar stopped.
  const resume = useRef<() => void>(() => undefined);
  const slide = SLIDES[index] ?? null;
  const last = index === count - 1;

  const go = useCallback(
    (to: number) => {
      if (to < 0) return;
      if (to >= count) return onClose();
      tick();
      setIndex(to);
    },
    [count, onClose],
  );

  useEffect(() => {
    Animated.timing(opened, { toValue: 1, duration: still ? 0 : 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [opened, still]);

  // Each moment: in with a lift, then its bar fills, and the next follows.
  useEffect(() => {
    enter.setValue(0);
    step.setValue(index);
    Animated.timing(enter, { toValue: 1, duration: still ? 0 : 480, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    progress.setValue(still || !slide ? 1 : 0);
    if (still || !slide) return;
    // The last screen waits on its button rather than closing by itself.
    const run = (from: number) =>
      Animated.timing(progress, { toValue: 1, duration: MOMENT_MS * (1 - from), easing: Easing.linear, useNativeDriver: false }).start(
        ({ finished }) => finished && !paused.current && index < SLIDES.length - 1 && go(index + 1),
      );
    run(0);
    resume.current = () => progress.stopAnimation((value) => run(value));
    return () => progress.stopAnimation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, still]);

  const hold = () => {
    paused.current = true;
    progress.stopAnimation();
  };
  const letGo = () => {
    if (!paused.current) return;
    paused.current = false;
    if (!still && slide) resume.current();
  };

  // The phone as large as the room allows, at its true proportions.
  const phoneH = Math.min(stage.height - 8, (stage.width - 40) / PHONE_RATIO, 600);
  const phoneW = phoneH * PHONE_RATIO;
  const wide = window.width >= 640;
  // A short screen keeps the room for the phone: smaller words, no labels.
  const short = !wide && window.height < 720;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[styles.root, { opacity: opened }]}>
        <View
          style={[styles.frame, wide ? [styles.frameWide, { height: Math.min(window.height - 48, 860) }] : styles.frameFull]}
          accessibilityViewIsModal
          testID="welcome-tour"
        >
          <LinearGradient colors={['#2A372A', theme.night, '#182018']} style={StyleSheet.absoluteFill} />
          {/* A soft light behind the phone, in the logo's orange. */}
          <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <RadialGradient id="welcomeGlow" cx="50%" cy="40%" rx="75%" ry="42%">
                <Stop offset="0" stopColor="#FD7511" stopOpacity="0.2" />
                <Stop offset="0.55" stopColor="#FD7511" stopOpacity="0.06" />
                <Stop offset="1" stopColor="#FD7511" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#welcomeGlow)" />
          </Svg>

          {/* The bars: one per moment, the one playing filling up. */}
          <View style={[styles.bars, { paddingTop: (wide ? 0 : insets.top) + 12 }]}>
            {Array.from({ length: count }, (_, i) => (
              <View key={i} style={styles.bar}>
                <Animated.View
                  style={[
                    styles.barFill,
                    { width: along.interpolate({ inputRange: [i, i + 1], outputRange: ['0%', '100%'], extrapolate: 'clamp' }) },
                  ]}
                />
              </View>
            ))}
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={styles.close}
              accessibilityRole="button"
              accessibilityLabel={first ? t`Skip the welcome` : t`Close`}
            >
              <Icon name="close" size={20} color="#FFFFFF" />
            </Pressable>
          </View>

          {!short && <Text style={styles.eyebrow}>{first ? t`Welcome to BwanguReservations` : t`How booking works`}</Text>}

          {slide ? (
            <>
              <View style={styles.stage} onLayout={(e: LayoutChangeEvent) => setStage(e.nativeEvent.layout)}>
                {stage.height > 0 && (
                  <Animated.View
                    key={slide.key}
                    style={{
                      opacity: enter,
                      transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
                    }}
                  >
                    <Phone slide={slide} width={phoneW} height={phoneH} progress={progress} still={still} />
                  </Animated.View>
                )}
                {/* Tap the right to go on, the left to go back; hold anywhere to pause. */}
                <View style={StyleSheet.absoluteFill}>
                  <View style={styles.zones}>
                    <Pressable
                      style={styles.zoneBack}
                      onPress={() => go(index - 1)}
                      onLongPress={hold}
                      onPressOut={letGo}
                      delayLongPress={220}
                      accessibilityRole="button"
                      accessibilityLabel={t`Back`}
                    />
                    <Pressable
                      style={styles.zoneNext}
                      onPress={() => go(index + 1)}
                      onLongPress={hold}
                      onPressOut={letGo}
                      delayLongPress={220}
                      accessibilityRole="button"
                      accessibilityLabel={t`Next`}
                    />
                  </View>
                </View>
              </View>

              <Animated.View
                style={[
                  styles.caption,
                  {
                    opacity: enter,
                    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
                  },
                ]}
              >
                {!short && (
                  <Text style={styles.step}>
                    {index + 1}<Trans>of {SLIDES.length}</Trans>
                  </Text>
                )}
                <Text style={[styles.title, short && styles.titleShort]} accessibilityRole="header">
                  {slide.title}
                </Text>
                <Text style={[styles.text, short && styles.textShort]}>{slide.text}</Text>
              </Animated.View>
            </>
          ) : (
            <Animated.View
              style={[
                styles.yours,
                {
                  opacity: enter,
                  transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
                },
              ]}
            >
              <MakeItYours me={me} onDone={onClose} />
            </Animated.View>
          )}

          {slide && (
            <View style={[styles.foot, { paddingBottom: (wide ? 0 : insets.bottom) + 18 }]}>
              <Button
                label={last ? (first ? t`Start exploring` : t`Done`) : index === SLIDES.length - 1 && first ? t`One more thing` : t`Next`}
                icon={last ? 'checkmark' : undefined}
                onPress={() => go(index + 1)}
              />
              {first && (
                <Pressable onPress={onClose} hitSlop={8} style={styles.skip} accessibilityRole="button">
                  <Text style={styles.skipText}><Trans>Skip — I’ll look around</Trans></Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

/**
 * A moment's real screen in a phone: it eases in on the part that matters,
 * the rest dims around a coral ring, and a note floats in beside it.
 */
function Phone({
  slide,
  width,
  height,
  progress,
  still,
}: {
  slide: Slide;
  width: number;
  height: number;
  progress: Animated.Value;
  still: boolean;
}) {
  const bezel = 7;
  const screenW = width - bezel * 2;
  const screenH = height - bezel * 2;
  const { x, y, w, h } = slide.spot;
  const spot = { left: (x / 100) * screenW, top: (y / 100) * screenH, width: (w / 100) * screenW, height: (h / 100) * screenH };
  // Scaled about the middle of what matters, so it stays put as the screen comes closer.
  const zoom = still ? 1 : 1.12;
  const scale = progress.interpolate({ inputRange: [0, 0.12, 1], outputRange: [1, 1, zoom] });
  const cx = spot.left + spot.width / 2 - screenW / 2;
  const cy = spot.top + spot.height / 2 - screenH / 2;
  const lit = still ? 1 : progress.interpolate({ inputRange: [0, 0.12, 0.24, 1], outputRange: [0, 0, 1, 1] });
  const chip = still ? 1 : progress.interpolate({ inputRange: [0, 0.1, 0.2, 1], outputRange: [0, 0, 1, 1] });
  const RING = 600;

  return (
    <View style={{ width, height }}>
      <View style={[styles.phone, { width, height, padding: bezel, borderRadius: width * 0.13 }]}>
        <View style={[styles.screen, { borderRadius: width * 0.13 - bezel }]}>
          <Animated.View
            style={{
              width: screenW,
              height: screenH,
              transform: [
                { translateX: Animated.multiply(Animated.subtract(1, scale), cx) },
                { translateY: Animated.multiply(Animated.subtract(1, scale), cy) },
                { scale },
              ],
            }}
          >
            <Image source={slide.image} style={{ width: screenW, height: screenH }} resizeMode="cover" accessibilityIgnoresInvertColors />
            {/* The dim around the part that matters: a ring of shade whose hole is the part. */}
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: spot.left - RING,
                top: spot.top - RING,
                width: spot.width + RING * 2,
                height: spot.height + RING * 2,
                borderWidth: RING,
                borderRadius: RING + 12,
                borderColor: 'rgba(31,42,31,0.42)',
                opacity: lit,
              }}
            />
            <Animated.View pointerEvents="none" style={[styles.ring, spot, { opacity: lit }]} />
          </Animated.View>
        </View>
        <View pointerEvents="none" style={[styles.notch, { width: width * 0.3, top: bezel + 8 }]} />
      </View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.chip,
          {
            // Its own width: left to shrink, a small phone squeezed its words out of it.
            width: 206,
            top: spot.top + spot.height + bezel + 10 > height - 70 ? undefined : spot.top + spot.height + bezel + 10,
            bottom: spot.top + spot.height + bezel + 10 > height - 70 ? height - spot.top - bezel + 10 : undefined,
            opacity: chip,
            transform: [{ translateY: typeof chip === 'number' ? 0 : Animated.multiply(Animated.subtract(1, chip), 10) }],
          },
        ]}
      >
        <View style={[styles.chipIcon, { backgroundColor: slide.chip.tone }]}>
          <Icon name={slide.chip.icon} size={15} color="#FFFFFF" />
        </View>
        <View style={styles.flex}>
          <Text style={styles.chipTitle} numberOfLines={1}>
            {slide.chip.title}
          </Text>
          <Text style={styles.chipText} numberOfLines={2}>
            {slide.chip.text}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * The last moment, the first time: the name shown on reviews they write
 * (§31), and reminders before each booking — asked for here, where the
 * reason is plain, rather than by the phone out of nowhere.
 */
function MakeItYours({ me, onDone }: { me: Me | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(me?.displayName ?? '');
  const [alerts, setAlerts] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    pushState()
      .then((state) => live && setAlerts(state))
      .catch(() => live && setAlerts('unavailable'));
    return () => {
      live = false;
    };
  }, []);

  const finish = async () => {
    const wanted = name.trim();
    if (wanted && wanted !== (me?.displayName ?? '')) {
      setBusy(true);
      try {
        await setMyDisplayName(wanted);
        await queryClient.invalidateQueries({ queryKey: ['me'] });
      } catch {
        // Not worth stopping anyone over: it can be set in Account.
      }
      setBusy(false);
    }
    onDone();
  };

  return (
    <View style={styles.yoursInner}>
      <View style={styles.yoursBadge}>
        <Icon name="sparkles" size={26} color={theme.accent} />
      </View>
      <Text style={[styles.title, styles.center]}><Trans>Make it yours</Trans></Text>
      <Text style={[styles.text, styles.center]}>
        {alerts && alerts !== 'unavailable'
          ? t`Two small things — you can change both in Account.`
          : t`One small thing — you can change it in Account.`}
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}><Trans>The name on your reviews</Trans></Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t`e.g. Aline U.`}
          placeholderTextColor="rgba(255,255,255,0.4)"
          style={styles.input}
          maxLength={40}
          autoCapitalize="words"
          returnKeyType="done"
        />
        <Text style={styles.cardNote}><Trans>Left empty, your reviews say “Anonymous”.</Trans></Text>
      </View>

      {alerts && alerts !== 'unavailable' && (
        <View style={[styles.card, styles.cardRow]}>
          <View style={styles.cardIcon}>
            <Icon name="notifications" size={18} color={theme.accent} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}><Trans>Reminders before each booking</Trans></Text>
            <Text style={styles.cardNote}>
              {alerts === 'on'
                ? t`On. We will remind you, and tell you when a shop replies.`
                : alerts === 'denied'
                  ? t`Turned off in your phone’s settings.`
                  : t`And a note when a shop replies to you.`}
            </Text>
          </View>
          {alerts === 'undecided' && (
            <PressableScale
              onPress={() => {
                void askForPush().then(setAlerts);
              }}
              style={styles.turnOn}
              accessibilityRole="button"
            >
              <Text style={styles.turnOnText}><Trans>Turn on</Trans></Text>
            </PressableScale>
          )}
          {alerts === 'on' && <Icon name="checkmark-circle" size={22} color="#5BD38F" />}
        </View>
      )}

      <Button label={t`Start exploring`} busy={busy} onPress={() => void finish()} style={styles.start} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(15, 20, 15, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: { overflow: 'hidden', backgroundColor: theme.night },
  // A phone: the whole screen. Anything wider: a phone-sized card in the middle.
  frameFull: { flex: 1, alignSelf: 'stretch' },
  frameWide: { width: 440, borderRadius: radius.xl },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 16 },
  bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#FFFFFF', borderRadius: 2 },
  close: {
    width: 36,
    height: 36,
    marginLeft: 8,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  eyebrow: {
    marginTop: 10,
    textAlign: 'center',
    fontFamily: font.bold,
    fontSize: 11.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.6)',
  },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  zones: { flex: 1, flexDirection: 'row' },
  zoneBack: { flex: 3 },
  zoneNext: { flex: 7 },
  phone: {
    backgroundColor: '#121812',
    borderWidth: 1.5,
    borderColor: '#3B453B',
    ...Platform.select({
      web: { boxShadow: '0 30px 60px -24px rgba(0,0,0,0.75)' },
      default: { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 18 }, elevation: 12 },
    }),
  },
  screen: { flex: 1, overflow: 'hidden', backgroundColor: theme.bg },
  notch: { position: 'absolute', alignSelf: 'center', height: 16, borderRadius: 8, backgroundColor: '#121812' },
  ring: { position: 'absolute', borderRadius: 12, borderWidth: 2, borderColor: theme.accent },
  chip: {
    position: 'absolute',
    right: -18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingLeft: 9,
    paddingRight: 14,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    ...Platform.select({
      web: { boxShadow: '0 18px 36px -16px rgba(0,0,0,0.55)' },
      default: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
    }),
  },
  chipIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  chipTitle: { fontFamily: font.extrabold, fontSize: 13, color: theme.ink },
  chipText: { fontFamily: font.medium, fontSize: 11.5, color: theme.muted },
  caption: { paddingHorizontal: 24, paddingTop: 16, alignItems: 'center' },
  step: { fontFamily: font.bold, fontSize: 12, letterSpacing: 0.6, color: '#FD7511', marginBottom: 6 },
  title: { fontFamily: font.extrabold, fontSize: 24, lineHeight: 30, letterSpacing: -0.5, color: '#FFFFFF', textAlign: 'center' },
  text: { marginTop: 6, fontFamily: font.medium, fontSize: 14.5, lineHeight: 21, color: 'rgba(255,255,255,0.7)', textAlign: 'center' },
  titleShort: { fontSize: 20, lineHeight: 25 },
  textShort: { fontSize: 13.5, lineHeight: 19 },
  center: { textAlign: 'center' },
  foot: { paddingHorizontal: 20, paddingTop: 10, gap: 4 },
  skip: { alignSelf: 'center', paddingVertical: 10 },
  skipText: { fontFamily: font.semibold, fontSize: 14, color: 'rgba(255,255,255,0.66)' },
  yours: { flex: 1, justifyContent: 'center' },
  yoursInner: { paddingHorizontal: 22, gap: 12, paddingBottom: 18 },
  yoursBadge: {
    alignSelf: 'center',
    width: 62,
    height: 62,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(240,83,45,0.14)',
    marginBottom: 4,
  },
  card: {
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(240,83,45,0.14)' },
  cardLabel: { fontFamily: font.bold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' },
  cardTitle: { fontFamily: font.bold, fontSize: 15, color: '#FFFFFF' },
  cardNote: { marginTop: 4, fontFamily: font.medium, fontSize: 12.5, lineHeight: 17, color: 'rgba(255,255,255,0.55)' },
  input: {
    marginTop: 10,
    height: 50,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: '#FFFFFF',
    fontFamily: font.semibold,
    fontSize: 16,
  },
  turnOn: { paddingHorizontal: 14, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent },
  turnOnText: { fontFamily: font.bold, fontSize: 13.5, color: '#FFFFFF' },
  flex: { flex: 1 },
  start: { marginTop: 8 },
});
