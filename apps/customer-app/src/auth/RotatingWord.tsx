import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, type StyleProp, type TextStyle } from 'react-native';
import { useReducedMotion } from '../ui/Motion';

/**
 * One word that keeps changing (§183): "haircut." rises away and "massage."
 * rises in after it, with a small overshoot, every couple of seconds — the
 * headline saying, without a list, how many kinds of thing there are to book.
 *
 * Held on the first word when the phone asks for less motion.
 */
export function RotatingWord({
  words,
  style,
  every = 2300,
}: {
  words: string[];
  style?: StyleProp<TextStyle>;
  every?: number;
}) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  // 0 below and hidden, 1 in place, 2 above and hidden.
  const place = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduced || words.length < 2) return;
    let live = true;
    const timer = setInterval(() => {
      Animated.timing(place, {
        toValue: 2,
        duration: 240,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        if (!live) return;
        setIndex((i) => (i + 1) % words.length);
        place.setValue(0);
        Animated.timing(place, {
          toValue: 1,
          duration: 380,
          easing: Easing.out(Easing.back(1.6)),
          useNativeDriver: true,
        }).start();
      });
    }, every);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [reduced, words.length, every, place]);

  return (
    <Animated.Text
      style={[
        style,
        {
          opacity: place.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] }),
          transform: [
            { translateY: place.interpolate({ inputRange: [0, 1, 2], outputRange: [18, 0, -18] }) },
          ],
        },
      ]}
    >
      {/* The list can grow once the categories arrive (§284). */}
      {words[index % words.length]}
    </Animated.Text>
  );
}
