import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Content that arrives rather than appears (§133).
 *
 * A short rise and fade. Given an `index`, a list staggers itself — each row a
 * beat behind the one above — which reads as the screen being laid out for you
 * instead of dumped. Capped, so row forty does not wait two seconds for its
 * turn.
 */
export function FadeIn({
  children,
  index = 0,
  delay = 0,
  distance = 14,
  style,
}: {
  children: ReactNode;
  /** Position in a list; each step adds a short delay, up to a cap. */
  index?: number;
  delay?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 420,
      delay: delay + Math.min(index, 8) * 55,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, delay, index]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
