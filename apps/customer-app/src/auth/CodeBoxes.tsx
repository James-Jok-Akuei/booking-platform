import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { font, theme } from '../theme';

export type CodeState = 'idle' | 'busy' | 'error' | 'ok';

/**
 * The code in whatever was pasted (§283). Copied from the email's six boxes it
 * arrives as "1 2 3 4 5 6" — digits with gaps — and from the subject as
 * "Your sign-in code: 123456". A run of exactly `length` digits wins, so other
 * numbers around it are left out; otherwise every digit is taken, in order.
 */
export function codeFrom(text: string, length: number): string {
  const run = text.match(new RegExp(`(?<!\\d)\\d{${length}}(?!\\d)`));
  return run ? run[0] : text.replace(/\D/g, '').slice(0, length);
}

/**
 * The six boxes a code is typed into (§183).
 *
 * Six boxes drawn over ONE real field, as before (§133): the field takes the
 * typing, the paste and the keyboard's own suggested code; the boxes only show
 * it. What is new is that they answer back — a digit pops in, the box waiting
 * for the next one has a blinking caret, the row breathes while the code is
 * checked, shakes and turns red when it is wrong, and turns green when it is
 * right.
 */
export function CodeBoxes({
  value,
  onChange,
  state,
  length = 6,
  compact,
  onFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  state: CodeState;
  length?: number;
  /** A narrow phone: shorter boxes. */
  compact?: boolean;
  /** Keeps the boxes above the keyboard (§168). */
  onFocus?: () => void;
}) {
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state !== 'error') return;
    shake.setValue(0);
    Animated.sequence(
      [-10, 10, -8, 8, -4, 0].map((toValue) =>
        Animated.timing(shake, { toValue, duration: 55, useNativeDriver: true }),
      ),
    ).start();
  }, [state, shake]);

  useEffect(() => {
    if (state !== 'busy') {
      breathe.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 0.55, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [state, breathe]);

  const open = state === 'idle' || state === 'error';

  return (
    <Animated.View style={{ opacity: breathe, transform: [{ translateX: shake }] }}>
      <Pressable style={styles.row} onPress={() => input.current?.focus()}>
        {Array.from({ length }, (_, i) => (
          <Box
            key={i}
            digit={value[i]}
            waiting={focused && open && i === value.length}
            state={state}
            compact={compact}
          />
        ))}
        <TextInput
          ref={input}
          style={styles.hidden}
          value={value}
          onChangeText={(text) => {
            // What was just added — typed, pasted or filled in by the phone. A
            // whole code replaces a half-typed one; otherwise it adds on (§283).
            const added = codeFrom(text.startsWith(value) ? text.slice(value.length) : text, length);
            onChange(added.length >= length ? added : codeFrom(text, length));
          }}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          // No maxLength: it cut a pasted "1 2 3 4 5 6" to its first six
          // characters — three digits — before the code ever saw it (§283).
          autoFocus
          caretHidden
          editable={open}
          accessibilityLabel={`${length}-digit code`}
        />
      </Pressable>
    </Animated.View>
  );
}

function Box({
  digit,
  waiting,
  state,
  compact,
}: {
  digit: string | undefined;
  waiting: boolean;
  state: CodeState;
  compact?: boolean;
}) {
  const pop = useRef(new Animated.Value(1)).current;
  const blink = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!digit) return;
    pop.setValue(0.55);
    Animated.spring(pop, { toValue: 1, speed: 22, bounciness: 14, useNativeDriver: true }).start();
  }, [digit, pop]);

  useEffect(() => {
    if (!waiting) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 480, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 480, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      blink.setValue(1);
    };
  }, [waiting, blink]);

  const look =
    state === 'ok'
      ? styles.boxOk
      : state === 'error'
        ? styles.boxBad
        : waiting
          ? styles.boxWaiting
          : digit
            ? styles.boxFilled
            : null;

  return (
    <View style={[styles.box, compact && styles.boxCompact, look]}>
      {digit ? (
        <Animated.Text
          style={[
            styles.digit,
            state === 'ok' && styles.digitOk,
            state === 'error' && styles.digitBad,
            { transform: [{ scale: pop }] },
          ]}
        >
          {digit}
        </Animated.Text>
      ) : waiting ? (
        <Animated.View style={[styles.caret, { opacity: blink }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  box: {
    flex: 1,
    maxWidth: 56,
    height: 64,
    borderRadius: 16,
    backgroundColor: theme.sunken,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxCompact: { height: 54, borderRadius: 14 },
  boxFilled: { backgroundColor: theme.panel, borderColor: theme.line },
  boxWaiting: { backgroundColor: theme.panel, borderColor: theme.accent },
  boxBad: { backgroundColor: theme.dangerSoft, borderColor: theme.danger },
  boxOk: { backgroundColor: theme.okSoft, borderColor: theme.ok },
  digit: { fontFamily: font.extrabold, fontSize: 26, color: theme.ink },
  digitBad: { color: theme.danger },
  digitOk: { color: theme.ok },
  caret: { width: 2.5, height: 26, borderRadius: 2, backgroundColor: theme.accent },
  // Covers the boxes and is invisible: it must still be ON SCREEN and full
  // size, or iOS will not offer the code from Mail and a tap on a box would
  // not open the keyboard.
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.02,
    color: 'transparent',
  },
});
