import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { theme } from '../theme';

/**
 * The phone's "reduce motion" setting (§176, §183). Anything that drifts,
 * sweeps or turns on its own stops when it is on.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => live && setReduced(on))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/**
 * Something that lands with a little bounce (§133) — the tick when a booking is
 * confirmed. Used once or twice in the whole app, for the moments that are
 * actually good news; a screen where everything bounces is a screen where
 * nothing does.
 */
export function PopIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      delay,
      useNativeDriver: true,
      speed: 10,
      bounciness: 14,
    }).start();
  }, [scale, delay]);

  return (
    <Animated.View style={[style, { transform: [{ scale }], opacity: scale }]}>
      {children}
    </Animated.View>
  );
}

/**
 * A dot with rings spreading out of it, for "waiting on something that is
 * happening somewhere else" — the customer approving a payment on their own
 * handset. A spinner says the APP is busy; this says the app is listening.
 */
export function Pulse({ color = theme.accent, size = 14 }: { color?: string; size?: number }) {
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(ring, {
        toValue: 1,
        duration: 1400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [ring]);

  const box = size * 3;
  return (
    <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          styles.ring,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
            transform: [
              { scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 3] }) },
            ],
          },
        ]}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute' },
});
