import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '../theme';

/**
 * The heart. One component so the two places it appears cannot drift.
 *
 * Renders nothing when `saved` is undefined, which is what the server sends to a
 * signed-out reader (§120): an empty heart that does nothing when tapped is
 * worse than no heart at all.
 */
export function SaveButton({
  saved,
  onPress,
  large,
}: {
  saved: boolean | undefined;
  onPress: () => void;
  large?: boolean;
}) {
  if (saved === undefined) return null;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={saved ? 'Remove from saved' : 'Save this place'}
      style={styles.tap}
    >
      <Text style={[large ? styles.large : styles.small, saved && styles.on]}>
        {saved ? '♥' : '♡'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tap: { paddingHorizontal: 4 },
  small: { fontSize: 20, color: theme.muted },
  large: { fontSize: 26, color: theme.muted },
  on: { color: theme.danger },
});
