import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, radius, shadow, theme } from '../theme';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

export const UNDO_MS = 5000;

/**
 * "Removed · Undo" (§160), the way every mail app says it.
 *
 * A dark bar rises from the bottom with the word and a thin line that drains
 * over five seconds; while it is there, one tap puts the thing back. Then it
 * sinks away by itself. A second removal replaces the first — the bar is for
 * the last thing done, and a stack of them would be a queue nobody asked for.
 */
export function Undo({
  message,
  token,
  onUndo,
  onExpire,
}: {
  message: string | null;
  /** Changes with each new removal, so the timer restarts. */
  token: number;
  onUndo: () => void;
  onExpire: () => void;
}) {
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  const drain = useRef(new Animated.Value(1)).current;
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    if (!message) {
      Animated.timing(rise, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      return;
    }
    drain.setValue(1);
    Animated.spring(rise, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 6 }).start();
    Animated.timing(drain, { toValue: 0, duration: UNDO_MS, useNativeDriver: true }).start();
    const timer = setTimeout(() => expire.current(), UNDO_MS);
    return () => clearTimeout(timer);
  }, [message, token, rise, drain]);

  return (
    <Animated.View
      pointerEvents={message ? 'auto' : 'none'}
      style={[
        styles.wrap,
        { bottom: insets.bottom + 16 },
        {
          opacity: rise,
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
        },
      ]}
    >
      <View style={styles.bar}>
        <Icon name="trash-outline" size={16} color="rgba(255,255,255,0.8)" />
        <Text style={styles.text} numberOfLines={1}>
          {message ?? ''}
        </Text>
        <PressableScale
          onPress={onUndo}
          haptic
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Undo"
          style={styles.undo}
        >
          <Text style={styles.undoText}>Undo</Text>
        </PressableScale>
        <Animated.View style={[styles.line, { transform: [{ scaleX: drain }] }]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 20, right: 20, alignItems: 'center' },
  bar: {
    width: '100%',
    maxWidth: 480,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.night,
    borderRadius: radius.lg,
    paddingVertical: 13,
    paddingLeft: 16,
    paddingRight: 10,
    overflow: 'hidden',
    ...shadow.float,
  },
  text: { flex: 1, fontFamily: font.semibold, fontSize: 14, color: '#FFFFFF' },
  undo: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  undoText: { fontFamily: font.extrabold, fontSize: 13.5, color: theme.star },
  line: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: theme.accent,
    transformOrigin: 'left',
  },
});
