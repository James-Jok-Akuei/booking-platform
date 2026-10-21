import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import Svg, { Defs, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { font, theme } from '../theme';
import { tick } from './haptic';
import { leaveWebIntro } from './webIntro';
import { Trans } from '@lingui/react/macro';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The tile on the phone's launch screen: 240 wide in app.json, the tile 46% of it. */
const TILE = 110;
const CORNER = TILE * (32 / 136);
/** How far the mark rises to make room for the name. */
const LIFT = 50;
/** The mark's two lines, measured, so each is drawn from nothing. */
const B_LENGTH = 185;
const CHECK_LENGTH = 59;
const B = 'M30 18 C28 40 27 62 29 88 C31 100 40 106 50 104 C66 100 74 86 70 70 C66 58 50 54 36 64';
const CHECK = 'M72 70 L82 82 L106 46';
const ORANGE = '#FD7511';

/**
 * A thousand hills: two pale veils on the night, and the night's own lower
 * edge — the front hill — with the paper ground below it. (Below the front
 * hill the veils lie on the paper, where paper on paper cannot be seen.)
 */
const VEILS = [
  'M0 80C40 64 76 54 112 56C156 58 186 88 232 90C276 92 320 34 400 30C470 26 520 58 560 66C578 70 590 72 600 72V200H0Z',
  'M0 112C24 104 44 100 66 102C110 106 140 134 190 132C232 130 250 94 300 92C356 90 384 128 432 132C470 135 494 118 524 116C556 114 580 124 600 130V200H0Z',
];
const VEIL_FILLS = ['rgba(246,244,240,0.07)', 'rgba(246,244,240,0.14)'];
const SKY = 'M0 0H600V150C566 142 516 130 456 134C396 138 362 160 300 160C240 160 210 139 150 132C96 126 40 134 0 146Z';

const out = Easing.bezier(0.33, 1, 0.68, 1);
const writing = Easing.bezier(0.45, 0.05, 0.3, 1);
/** A curtain flown out: slow to start, then away. */
const lifting = Easing.bezier(0.32, 0, 0.67, 0);

export type IntroProps = {
  /** The typeface is in, so the name can be written in it. */
  fontsReady: boolean;
  /** The app is in place underneath, so the intro may go. */
  appReady: boolean;
  /** A good moment to build the app underneath. */
  onBegin: () => void;
  onGone: () => void;
};

/**
 * The opening picture (§302) — the first thing anybody sees, so it is made
 * to be looked at, and never to be waited for.
 *
 * It begins exactly where the phone's launch screen ends — the white tile on
 * the night, the same size in the same place — so the handover cannot be
 * seen. Then the "b" is written, the orange check lands with a pop, two rings
 * and a small tick under the finger; the sun comes up behind, the mark rises,
 * a thousand hills come up from below, and the name and the line come in.
 * To leave, the paper ground melts into the app underneath while the night
 * lifts away like a curtain, the hills its edge — so what appears is the
 * app itself, never a blank screen.
 *
 * About two and a half seconds, and a tap ends it early once the app is
 * ready. The lines are drawn by the JavaScript side, so the app is built
 * underneath only once they are drawn — everything after runs on the phone's
 * own side and cannot stutter while the first screen is put together. With
 * "reduce motion" the finished picture simply shows, then fades.
 *
 * On the web the page draws the same picture itself (`public/index.html`),
 * so it plays while the app downloads; here it is only taken away.
 */
export function Intro(props: IntroProps) {
  return Platform.OS === 'web' ? <WebIntro {...props} /> : <PhoneIntro {...props} />;
}

function WebIntro({ appReady, onGone }: IntroProps) {
  useEffect(() => {
    // Safe to ask twice: it leaves once.
    if (appReady) void leaveWebIntro().then(onGone);
  }, [appReady, onGone]);
  return null;
}

const values = () => ({
  b: new Animated.Value(0),
  check: new Animated.Value(0),
  pop: new Animated.Value(1),
  rings: [new Animated.Value(0), new Animated.Value(0)],
  glow: new Animated.Value(0),
  lift: new Animated.Value(0),
  veils: VEILS.map(() => new Animated.Value(0)),
  /** The night's hilly edge coming up from below the screen. */
  dawn: new Animated.Value(0),
  name: new Animated.Value(0),
  line: new Animated.Value(0),
  ground: new Animated.Value(1),
  away: new Animated.Value(0),
  fade: new Animated.Value(1),
});

let launchScreenHidden = false;
/** Once the first frame is down: it is the launch screen to the dot. */
const hideLaunchScreen = () => {
  if (launchScreenHidden) return;
  launchScreenHidden = true;
  SplashScreen.hideAsync().catch(() => undefined);
};

function PhoneIntro({ fontsReady, appReady, onBegin, onGone }: IntroProps) {
  // Measured, not read from the window: on some Androids the window leaves out
  // the bars, and the tile must sit exactly where the launch screen put it.
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  /** "Reduce motion" — unknown until the phone answers, and it decides which intro plays. */
  const [still, setStill] = useState<boolean | null>(null);
  const [landed, setLanded] = useState(false);
  const [posed, setPosed] = useState(false);
  const [skipped, setSkipped] = useState(false);
  /** Read where a change must not restart anything. */
  const skippedNow = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [v] = useState(values);

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((on) => {
        if (live) setStill((was) => was ?? on);
      });
    // A phone that never answers gets the moving picture, not a frozen one.
    const timer = setTimeout(() => setStill((was) => was ?? false), 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  // The "b", then the check.
  useEffect(() => {
    if (still === null) return;
    if (still) {
      for (const value of [v.b, v.check, v.glow, v.lift, ...v.veils, v.dawn, v.name, v.line]) value.setValue(1);
      setLanded(true);
      // Long enough to be seen, rather than a flash.
      const timer = setTimeout(() => setPosed(true), 700);
      return () => clearTimeout(timer);
    }
    const lines = Animated.parallel([
      // A beat first, for the launch screen's own fade to finish.
      Animated.timing(v.b, { toValue: 1, delay: 120, duration: 600, easing: writing, useNativeDriver: false }),
      Animated.timing(v.check, { toValue: 1, delay: 660, duration: 280, easing: out, useNativeDriver: false }),
    ]);
    lines.start(({ finished }) => {
      if (finished) setLanded(true);
    });
    return () => lines.stop();
  }, [still, v]);

  // Booked: the pop, the rings, the sun, the hills — and the app goes in underneath.
  useEffect(() => {
    if (!landed) return;
    onBegin();
    // Tapped away before the check landed: no "booked" on the way out.
    if (still || skippedNow.current) return;
    tick();
    const scene = Animated.parallel([
      Animated.sequence([
        Animated.timing(v.pop, { toValue: 1.08, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(v.pop, { toValue: 1, speed: 14, bounciness: 12, useNativeDriver: true }),
      ]),
      ...v.rings.map((ring, i) =>
        Animated.timing(ring, { toValue: 1, delay: i * 160, duration: 900, easing: out, useNativeDriver: true }),
      ),
      Animated.timing(v.glow, { toValue: 1, duration: 800, easing: out, useNativeDriver: true }),
      Animated.timing(v.lift, { toValue: 1, delay: 80, duration: 560, easing: out, useNativeDriver: true }),
      ...[...v.veils, v.dawn].map((layer, i) =>
        Animated.timing(layer, { toValue: 1, delay: i * 80, duration: 660, easing: out, useNativeDriver: true }),
      ),
    ]);
    scene.start();
    return () => scene.stop();
  }, [landed, still, v, onBegin]);

  // The name and the line, once the typeface is in.
  useEffect(() => {
    if (!landed || !fontsReady || still) return;
    const words = Animated.parallel([
      Animated.timing(v.name, { toValue: 1, delay: 200, duration: 480, easing: out, useNativeDriver: true }),
      Animated.timing(v.line, { toValue: 1, delay: 360, duration: 400, easing: out, useNativeDriver: true }),
    ]);
    words.start(({ finished }) => {
      if (finished) setPosed(true);
    });
    return () => words.stop();
  }, [landed, fontsReady, still, v]);

  // Still loading once the picture is complete: a slow ring, so it never looks stuck.
  useEffect(() => {
    if (!posed || appReady || still || leaving) return;
    const [ring] = v.rings;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.timing(ring, { toValue: 1, duration: 1800, easing: out, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [posed, appReady, still, leaving, v]);

  // Go: after a beat on the finished picture, or at once when tapped away.
  useEffect(() => {
    if (leaving || !appReady || !(posed || skipped)) return;
    const timer = setTimeout(() => setLeaving(true), skipped || still ? 0 : 220);
    return () => clearTimeout(timer);
  }, [posed, skipped, appReady, leaving, still]);

  useEffect(() => {
    if (!leaving) return;
    const go = still
      ? Animated.timing(v.fade, { toValue: 0, duration: 260, easing: Easing.linear, useNativeDriver: true })
      : Animated.parallel([
          Animated.timing(v.ground, { toValue: 0, duration: 220, easing: out, useNativeDriver: true }),
          Animated.timing(v.away, { toValue: 1, duration: 600, easing: lifting, useNativeDriver: true }),
        ]);
    go.start(() => onGone());
    return () => go.stop();
  }, [leaving, still, v, onGone]);

  const skip = () => {
    if (leaving) return;
    onBegin();
    skippedNow.current = true;
    setSkipped(true);
  };

  const measure = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox((was) => (was && was.width === width && was.height === height ? was : { width, height }));
  };

  const from = (value: Animated.Value, distance: number) =>
    value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] });

  let picture = null;
  if (box) {
    const { width, height } = box;
    const middle = height / 2;
    const hillHeight = Math.round(Math.min(270, Math.max(150, height * 0.27)));
    const nameSize = Math.min(36, Math.max(24, Math.round(width * 0.082)));
    const lineSize = Math.min(16, Math.max(13, Math.round(width * 0.038)));
    // Leaving: everything on the night goes up with it, far enough for its
    // hilly edge to clear the top.
    const up = v.away.interpolate({ inputRange: [0, 1], outputRange: [0, -(height + hillHeight)] });
    picture = (
      <>
        <Animated.View style={[StyleSheet.absoluteFill, styles.ground, { opacity: v.ground }]} />
        <Animated.View
          style={[
            styles.sky,
            {
              top: -hillHeight,
              height: height + hillHeight,
              transform: [{ translateY: Animated.add(from(v.dawn, hillHeight), up) }],
            },
          ]}
        >
          <View style={styles.night} />
          <Svg width={width} height={hillHeight} viewBox="0 0 600 200" preserveAspectRatio="none">
            <Path d={SKY} fill={theme.night} />
          </Svg>
        </Animated.View>

        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: v.glow,
              transform: [
                { translateY: up },
                { scale: v.glow.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
              ],
            },
          ]}
        >
          <Svg width={width} height={height}>
            <Defs>
              <RadialGradient
                id="sun"
                cx={width / 2}
                cy={middle - LIFT}
                r={Math.hypot(width / 2, middle + LIFT)}
                gradientUnits="userSpaceOnUse"
              >
                <Stop offset="0" stopColor={ORANGE} stopOpacity={0.34} />
                <Stop offset="0.24" stopColor={ORANGE} stopOpacity={0.12} />
                <Stop offset="0.54" stopColor={ORANGE} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect width={width} height={height} fill="url(#sun)" />
          </Svg>
        </Animated.View>

        {VEILS.map((d, i) => (
          <Animated.View
            key={d}
            style={[
              styles.veil,
              {
                top: height - hillHeight,
                height: hillHeight,
                opacity: v.ground,
                transform: [{ translateY: Animated.add(from(v.veils[i], hillHeight), up) }],
              },
            ]}
          >
            <Svg width={width} height={hillHeight} viewBox="0 0 600 200" preserveAspectRatio="none">
              <Path d={d} fill={VEIL_FILLS[i]} />
            </Svg>
          </Animated.View>
        ))}

        <Animated.View
          style={[
            styles.mark,
            {
              left: width / 2 - TILE / 2,
              top: middle - TILE / 2,
              transform: [
                {
                  translateY: Animated.add(
                    v.lift.interpolate({ inputRange: [0, 1], outputRange: [0, -LIFT] }),
                    up,
                  ),
                },
              ],
            },
          ]}
        >
          {v.rings.map((ring, i) => (
            <Animated.View
              key={i}
              style={[
                styles.ring,
                {
                  opacity: ring.interpolate({ inputRange: [0, 0.04, 1], outputRange: [0, 0.6, 0] }),
                  transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
                },
              ]}
            />
          ))}
          <Animated.View onLayout={hideLaunchScreen} style={[styles.tile, { transform: [{ scale: v.pop }] }]}>
            <Svg width={TILE} height={TILE} viewBox="0 0 136 136">
              <G
                transform="translate(20 20) scale(0.8)"
                fill="none"
                strokeWidth={9}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <AnimatedPath
                  d={B}
                  stroke={theme.ink}
                  strokeDasharray={[B_LENGTH, B_LENGTH + 20]}
                  strokeDashoffset={v.b.interpolate({ inputRange: [0, 1], outputRange: [B_LENGTH + 6, 0] })}
                />
                <AnimatedPath
                  d={CHECK}
                  stroke={ORANGE}
                  strokeDasharray={[CHECK_LENGTH, CHECK_LENGTH + 20]}
                  strokeDashoffset={v.check.interpolate({ inputRange: [0, 1], outputRange: [CHECK_LENGTH + 6, 0] })}
                />
              </G>
            </Svg>
          </Animated.View>
        </Animated.View>

        {/* The name as it is written (§239): one word, the second half orange. */}
        {fontsReady && (
          <Animated.View
            style={[
              styles.words,
              { top: middle - LIFT + TILE / 2 + 26, transform: [{ translateY: up }] },
            ]}
          >
            <Animated.Text
              numberOfLines={1}
              style={[
                styles.name,
                {
                  fontSize: nameSize,
                  lineHeight: Math.round(nameSize * 1.15),
                  letterSpacing: -0.03 * nameSize,
                  opacity: v.name,
                  transform: [{ translateY: from(v.name, 14) }],
                },
              ]}
            ><Trans>Bwangu<Text style={styles.orange}>Reservations</Text></Trans>
            </Animated.Text>
            <Animated.Text
              style={[
                styles.line,
                {
                  fontSize: lineSize,
                  lineHeight: Math.round(lineSize * 1.4),
                  opacity: v.line,
                  transform: [{ translateY: from(v.line, 14) }],
                },
              ]}
            >
              <Trans>
                Book your next appointment, easily.
              </Trans>
            </Animated.Text>
          </Animated.View>
        )}
      </>
    );
  }

  return (
    <Pressable
      onPress={skip}
      onLayout={measure}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      {/* The night alone until measured: the launch screen's colour, under the launch screen. */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.clip, !box && styles.dark, { opacity: v.fade }]}>
        {picture}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  dark: { backgroundColor: theme.night },
  ground: { backgroundColor: theme.bg },
  sky: { position: 'absolute', left: 0, right: 0 },
  night: { flex: 1, marginBottom: -1, backgroundColor: theme.night },
  veil: { position: 'absolute', left: 0, right: 0 },
  mark: { position: 'absolute', width: TILE, height: TILE },
  tile: { position: 'absolute', inset: 0, borderRadius: CORNER, backgroundColor: '#FFFFFF' },
  ring: { position: 'absolute', inset: 0, borderRadius: CORNER, borderWidth: 2, borderColor: ORANGE },
  words: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  name: { fontFamily: font.extrabold, color: '#FFFFFF' },
  orange: { color: ORANGE },
  line: { marginTop: 10, fontFamily: font.medium, color: 'rgba(255,255,255,0.66)', textAlign: 'center' },
});
