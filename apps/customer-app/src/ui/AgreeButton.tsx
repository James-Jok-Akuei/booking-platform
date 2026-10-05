import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { font, shadow, theme } from '../theme';
import { cheer, tick } from './haptic';
import { Icon } from './Icon';

const HEIGHT = 56;

/**
 * The button you agree with (§142).
 *
 * Agreeing to terms is the one tap in an app that is a promise, so the button
 * answers it in three beats instead of just changing its label:
 *
 *   1. While it waits, a soft light crosses it every few seconds — enough to
 *      say "this is the thing to press" without a word or a bounce.
 *   2. Pressed, it draws itself in to a circle and turns while the answer is
 *      saved. The label is gone because there is nothing left to read.
 *   3. Saved, the circle turns green, a tick springs into it and a ring goes
 *      out from it, with the phone's own success tap. Then it reports back.
 *
 * If saving fails it opens back out into the button it was, so a failure never
 * looks like an agreement.
 *
 * The width and colour run on the JS driver (they cannot run natively); the
 * light, the tick and the ring run natively, on their own views, so they stay
 * smooth while the request is in flight.
 */
export function AgreeButton({
  label,
  onAgree,
  onDone,
  wake,
}: {
  label: string;
  /** Saves the agreement. Rejecting returns the button to how it was. */
  onAgree: () => Promise<unknown>;
  /** Called once the tick has been seen. */
  onDone: () => void;
  /** Flip to true to give the button one small lift, e.g. at the end of the text. */
  wake?: boolean;
}) {
  const [phase, setPhase] = useState<'idle' | 'busy' | 'done'>('idle');
  const [width, setWidth] = useState(0);
  const morph = useRef(new Animated.Value(0)).current;
  const tone = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;
  const shine = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;

  // The light that crosses it while it waits.
  useEffect(() => {
    if (phase !== 'idle') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1400),
        Animated.timing(shine, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(shine, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, shine]);

  // One lift when the reader reaches the end: "you have read it, here I am".
  useEffect(() => {
    if (!wake || phase !== 'idle') return;
    Animated.sequence([
      Animated.spring(press, { toValue: 1.045, useNativeDriver: true, speed: 20, bounciness: 12 }),
      Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 10 }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wake]);

  const agree = async () => {
    if (phase !== 'idle') return;
    tick();
    setPhase('busy');
    Animated.timing(morph, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    try {
      await onAgree();
    } catch {
      setPhase('idle');
      Animated.spring(morph, { toValue: 0, useNativeDriver: false, speed: 14, bounciness: 6 }).start();
      return;
    }
    setPhase('done');
    cheer();
    Animated.parallel([
      Animated.timing(tone, { toValue: 1, duration: 220, useNativeDriver: false }),
      Animated.spring(check, { toValue: 1, useNativeDriver: true, speed: 9, bounciness: 16 }),
      Animated.timing(ring, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
    setTimeout(onDone, 1050);
  };

  const to = (value: number) =>
    Animated.spring(press, { toValue: value, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

  return (
    <View style={styles.track} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {/* The ring that leaves the circle when it turns green. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            opacity: ring.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.45, 0] }),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
          },
        ]}
      />

      <Animated.View style={{ transform: [{ scale: press }] }}>
        <Pressable
          onPress={agree}
          onPressIn={() => phase === 'idle' && to(0.97)}
          onPressOut={() => to(1)}
          disabled={phase !== 'idle'}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ busy: phase === 'busy' }}
        >
          <Animated.View
            style={[
              styles.pill,
              width > 0 && {
                width: morph.interpolate({ inputRange: [0, 1], outputRange: [width, HEIGHT] }),
              },
              {
                backgroundColor: tone.interpolate({
                  inputRange: [0, 1],
                  outputRange: [theme.accent, theme.ok],
                }),
              },
            ]}
          >
            {phase === 'idle' && width > 0 && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.shine,
                  {
                    transform: [
                      {
                        translateX: shine.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-120, width + 40],
                        }),
                      },
                      { skewX: '-18deg' },
                    ],
                  },
                ]}
              >
                <LinearGradient
                  colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.38)', 'rgba(255,255,255,0)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            )}

            <Animated.View
              style={[
                styles.label,
                { opacity: morph.interpolate({ inputRange: [0, 0.45], outputRange: [1, 0], extrapolate: 'clamp' }) },
              ]}
            >
              <Icon name="shield-checkmark" size={19} color="#FFFFFF" />
              <Text style={styles.labelText} numberOfLines={1}>
                {label}
              </Text>
            </Animated.View>

            {phase === 'busy' && (
              <View style={styles.centre}>
                <ActivityIndicator color="#FFFFFF" />
              </View>
            )}

            <Animated.View
              pointerEvents="none"
              style={[styles.centre, { opacity: check, transform: [{ scale: check }] }]}
            >
              <Icon name="checkmark" size={30} color="#FFFFFF" />
            </Animated.View>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: HEIGHT, alignItems: 'center', justifyContent: 'center' },
  pill: {
    width: '100%',
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  shine: { position: 'absolute', top: -10, bottom: -10, left: 0, width: 90 },
  label: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 20 },
  labelText: { fontFamily: font.bold, fontSize: 16.5, color: '#FFFFFF' },
  centre: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    width: HEIGHT,
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    backgroundColor: theme.ok,
  },
});
