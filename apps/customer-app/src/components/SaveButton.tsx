import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { shadow, theme } from '../theme';
import { thump } from '../ui/haptic';
import { Icon } from '../ui/Icon';
import { t } from '@lingui/core/macro';

/**
 * The heart. One component so the places it appears cannot drift.
 *
 * Renders nothing when `saved` is undefined, which is what the server sends to a
 * signed-out reader (§120): an empty heart that does nothing when tapped is
 * worse than no heart at all.
 *
 * It POPS when it fills (§133) — a quick overshoot and settle. The save is
 * optimistic, so the heart has already changed by the time the request leaves;
 * the pop is what makes that feel like a response to the tap rather than a
 * colour that happened to change.
 */
export function SaveButton({
  saved,
  onPress,
  large,
  small,
  onPhoto,
}: {
  saved: boolean | undefined;
  onPress: () => void;
  large?: boolean;
  /** For a small card's corner. */
  small?: boolean;
  /** A white disc behind it, so it reads on top of any photograph. */
  onPhoto?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    // Not on mount: a list of saved places should not all pop as it appears.
    if (first.current) {
      first.current = false;
      return;
    }
    if (!saved) return;
    scale.setValue(0.6);
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 14,
      bounciness: 16,
    }).start();
  }, [saved, scale]);

  if (saved === undefined) return null;

  const size = large ? 44 : small ? 30 : 38;

  return (
    <Pressable
      onPress={() => {
        thump();
        onPress();
      }}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={saved ? t`Remove from saved` : t`Save this`}
      style={[
        styles.tap,
        { width: size, height: size, borderRadius: size / 2 },
        onPhoto ? [styles.disc, shadow.card] : styles.plain,
      ]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon
          name={saved ? 'heart' : 'heart-outline'}
          size={large ? 23 : small ? 16 : 20}
          color={saved ? theme.accent : theme.ink}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tap: { alignItems: 'center', justifyContent: 'center' },
  disc: { backgroundColor: 'rgba(255,255,255,0.96)' },
  plain: { backgroundColor: theme.panel, borderWidth: 1.5, borderColor: theme.line },
});
