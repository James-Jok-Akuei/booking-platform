import { StyleSheet, Text, View } from 'react-native';
import { font, theme } from '../theme';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

/**
 * A number you change one at a time (§136).
 *
 * Two big buttons and the number between them, rather than a field to type in:
 * the range is small, a thumb is all it takes, and it cannot be given a value
 * that is not allowed. At either end the button that would go further fades
 * and stops answering, which is the whole explanation of the limit.
 */
export function Stepper({
  value,
  min = 1,
  max,
  onChange,
  label,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (next: number) => void;
  /** What is being counted, for a screen reader: "people". */
  label: string;
}) {
  const down = value > min;
  const up = value < max;
  return (
    <View style={styles.row} accessibilityRole="adjustable" accessibilityLabel={label}>
      <PressableScale
        haptic
        scaleTo={0.88}
        disabled={!down}
        onPress={() => onChange(value - 1)}
        accessibilityRole="button"
        accessibilityLabel={`Fewer ${label}`}
        style={[styles.button, !down && styles.off]}
      >
        <Icon name="remove" size={20} color={theme.ink} />
      </PressableScale>

      <Text style={styles.value}>{value}</Text>

      <PressableScale
        haptic
        scaleTo={0.88}
        disabled={!up}
        onPress={() => onChange(value + 1)}
        accessibilityRole="button"
        accessibilityLabel={`More ${label}`}
        style={[styles.button, styles.plus, !up && styles.off]}
      >
        <Icon name="add" size={20} color="#FFFFFF" />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  button: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: { backgroundColor: theme.accent },
  off: { opacity: 0.35 },
  value: {
    minWidth: 38,
    textAlign: 'center',
    fontFamily: font.extrabold,
    fontSize: 20,
    color: theme.ink,
  },
});
