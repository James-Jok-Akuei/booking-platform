import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { font, theme } from '../theme';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

/**
 * A number you change one at a time (§136).
 *
 * Two big buttons and the number between them: for a small range a thumb is
 * all it takes, and it cannot be given a value that is not allowed. At either
 * end the button that would go further fades and stops answering, which is
 * the whole explanation of the limit.
 *
 * Past twenty the number can also be TYPED (§155): tapping "+" forty times for
 * forty prints is not a thing anyone should do. What is typed is clamped to
 * the range when the field is left, so the rule still holds.
 */
export function Stepper({
  value,
  min = 1,
  max,
  onChange,
  label,
  onFocus,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (next: number) => void;
  /** What is being counted, for a screen reader: "people". */
  label: string;
  /** For a screen keeping the typed number above the keyboard (§168). */
  onFocus?: () => void;
}) {
  const down = value > min;
  const up = value < max;
  const typeable = max > 20;
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = parseInt(draft, 10);
    const next = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
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

      {typeable ? (
        <TextInput
          style={[styles.value, styles.input]}
          value={draft}
          onChangeText={(t) => setDraft(t.replace(/\D/g, ''))}
          onFocus={onFocus}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="number-pad"
          returnKeyType="done"
          selectTextOnFocus
          maxLength={4}
          accessibilityLabel={`How many ${label}, type a number up to ${max}`}
        />
      ) : (
        <Text style={styles.value}>{value}</Text>
      )}

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
  input: {
    minWidth: 56,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: theme.sunken,
  },
  value: {
    minWidth: 38,
    textAlign: 'center',
    fontFamily: font.extrabold,
    fontSize: 20,
    color: theme.ink,
  },
});
