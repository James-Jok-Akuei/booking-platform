import { useRef, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { tick } from './haptic';

/**
 * Anything tappable, with the give of a real button (§133).
 *
 * It sinks a few percent under the finger and springs back. That is the whole
 * effect, and it is the difference between a screen that feels drawn and one
 * that feels built: the reply comes BEFORE the navigation does.
 *
 * On the native driver, so it stays smooth while JavaScript is busy doing the
 * thing the tap asked for.
 */
export function PressableScale({
  children,
  style,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  scaleTo = 0.97,
  haptic = false,
  overlay,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** How far it sinks. Big cards barely move; small chips move more. */
  scaleTo?: number;
  haptic?: boolean;
  /**
   * Buttons of their own on top — the heart on a card. They sink with it but
   * are not inside it: on the web a button is a `<button>`, and one inside
   * another is not allowed. Placed by the caller, from the top-left corner.
   */
  overlay?: ReactNode;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const to = (value: number) =>
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();

  const handlers = {
    onPressIn: (event: GestureResponderEvent) => {
      to(scaleTo);
      onPressIn?.(event);
    },
    onPressOut: (event: GestureResponderEvent) => {
      to(1);
      onPressOut?.(event);
    },
    onPress: (event: GestureResponderEvent) => {
      if (haptic) tick();
      onPress?.(event);
    },
  };

  if (overlay) {
    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable {...rest} disabled={disabled} {...handlers}>
          <View style={style}>{children}</View>
        </Pressable>
        {overlay}
      </Animated.View>
    );
  }

  return (
    <Pressable {...rest} disabled={disabled} {...handlers}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
