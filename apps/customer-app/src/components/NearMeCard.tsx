import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { NearMeState } from '../useNearMe';
import { font, radius, theme, type } from '../theme';
import { Button } from '../ui/Button';
import { FadeIn } from '../ui/FadeIn';
import { Icon } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';

type Words = { title: string; text: string; action: string };

const WORDS = {
  off: {
    title: 'See what is near you',
    text: 'Use where you are right now to show places close by and how far each one is. Only while the app is open, and never saved.',
    action: 'Use my location',
  },
  retry: {
    title: 'Location is off',
    text: 'Without it we cannot show what is near you. Everything else still works.',
    action: 'Try again',
  },
  settings: {
    title: 'Location is off for this app',
    text: "Turn it on in your phone's Settings to see what is near you. Everything else still works.",
    action: 'Open Settings',
  },
  failed: {
    title: 'Could not find you just now',
    text: 'Your phone could not get a position. Try again, outside or near a window.',
    action: 'Try again',
  },
} satisfies Record<string, Words>;

/**
 * The invitation to use location, at the top of Home (§171).
 *
 * It replaces the quiet row at the bottom of the screen (§139) — the app now
 * narrows by distance, and that only works for people who say yes, so the
 * question is asked where it is seen. Still the customer's question: the
 * phone's own prompt appears only when "Use my location" is pressed (§107.3),
 * never when the app opens.
 *
 * It says what happens on every answer — no, never-again, or no signal — and
 * "Not now" puts it away for good on this phone.
 */
export function NearMeCard({
  state,
  onUse,
  onSettings,
  onNotNow,
}: {
  state: NearMeState;
  onUse: () => void;
  onSettings: () => void;
  onNotNow: () => void;
}) {
  const words =
    state.status === 'denied'
      ? state.canAskAgain
        ? WORDS.retry
        : WORDS.settings
      : state.status === 'failed'
        ? WORDS.failed
        : WORDS.off;
  const toSettings = state.status === 'denied' && !state.canAskAgain;
  const asking = state.status === 'asking';

  return (
    <FadeIn delay={90}>
      <LinearGradient
        colors={[theme.accentSoft, theme.panel]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={styles.top}>
          <Radar still={state.status === 'denied'} />
          <View style={styles.words}>
            <Text style={type.subheading}>{words.title}</Text>
            <Text style={styles.text}>{words.text}</Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Button
            compact
            icon={toSettings ? 'settings-outline' : 'navigate'}
            label={asking ? 'Finding you…' : words.action}
            busy={asking}
            onPress={toSettings ? onSettings : onUse}
          />
          {!asking && (
            <PressableScale
              onPress={onNotNow}
              hitSlop={10}
              accessibilityRole="button"
              style={styles.later}
            >
              <Text style={styles.laterText}>Not now</Text>
            </PressableScale>
          )}
        </View>
      </LinearGradient>
    </FadeIn>
  );
}

/**
 * A pin sending out two rings, one after the other: "looking for you". Held
 * still when location is refused, because then nothing is looking.
 */
function Radar({ still }: { still: boolean }) {
  const wave = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (still) {
      wave.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(wave, {
        toValue: 1,
        duration: 2200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [wave, still]);

  // Two rings half a cycle apart, each growing and fading on its own half.
  const ring = (offset: number) => {
    const t = Animated.modulo(Animated.add(wave, offset), 1);
    return {
      opacity: still ? 0 : t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.4, 0] }),
      transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.9] }) }],
    };
  };

  return (
    <View style={styles.radar}>
      <Animated.View style={[styles.ring, ring(0)]} />
      <Animated.View style={[styles.ring, ring(0.5)]} />
      <View style={[styles.pin, still && styles.pinStill]}>
        <Icon name={still ? 'location-outline' : 'navigate'} size={20} color="#FFFFFF" />
      </View>
    </View>
  );
}

const PIN = 44;

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#FBDCD2',
    padding: 16,
    gap: 14,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  words: { flex: 1, gap: 3 },
  text: { fontFamily: font.medium, fontSize: 13, lineHeight: 18.5, color: theme.ink2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  later: { paddingVertical: 8, paddingHorizontal: 4 },
  laterText: { fontFamily: font.semibold, fontSize: 14, color: theme.ink2 },
  radar: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    backgroundColor: theme.accent,
  },
  pin: {
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinStill: { backgroundColor: theme.muted },
});
