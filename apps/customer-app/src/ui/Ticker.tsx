import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, type StyleProp, type TextStyle } from 'react-native';

/**
 * A number that rolls to its new value instead of jumping (§179).
 *
 * For a total that changes when "how many" changes: the eye follows the roll
 * and understands that the two are connected, where a figure that simply
 * becomes a different figure has to be re-read. The first value is shown at
 * once — nothing rolls up from zero on arrival.
 */
export function Ticker({
  value,
  render,
  style,
  duration = 520,
}: {
  value: number;
  /** The number as text: money, usually. */
  render: (value: number) => string;
  style?: StyleProp<TextStyle>;
  duration?: number;
}) {
  const [shown, setShown] = useState(value);
  const counter = useRef(new Animated.Value(value)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = counter.addListener(({ value: v }) => setShown(Math.round(v)));
    const roll = Animated.timing(counter, {
      toValue: value,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    roll.start(({ finished }) => {
      if (finished) setShown(value);
    });
    return () => {
      roll.stop();
      counter.removeListener(id);
    };
  }, [value, counter, duration]);

  // A price is never broken over two lines: smaller, if the phone can, before that.
  return (
    <Text style={style} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
      {render(shown)}
    </Text>
  );
}
