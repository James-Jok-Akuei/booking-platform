import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { ApiError } from '../api/client';
import { font, shadow, theme } from '../theme';
import { caution, cheer, tick } from './haptic';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';

export type DialogTone = 'danger' | 'warn' | 'ok' | 'info' | 'accent';

export type DialogAction = {
  label: string;
  /**
   * `primary` is the filled button. `secondary` is a real choice drawn in the
   * tone's soft colour, for when two of them would otherwise shout equally.
   * `cancel` is the quiet one, and also what the back button and a tap
   * outside do. A dialog without a `cancel` and with more than one action can
   * only be left by choosing.
   */
  role?: 'primary' | 'secondary' | 'cancel';
  /** May return a promise: the button then spins until it settles, and the dialog closes after. */
  onPress?: () => unknown;
};

export type DialogSpec = {
  title: string;
  message?: string;
  tone?: DialogTone;
  icon?: IconName;
  /** Left out: a single "OK". */
  actions?: DialogAction[];
};

/** Each tone: its strong colour, its tint, and the icon it uses when none is given. */
const TONES: Record<DialogTone, { solid: string; soft: string; icon: IconName }> = {
  danger: { solid: theme.danger, soft: theme.dangerSoft, icon: 'alert' },
  warn: { solid: theme.warn, soft: theme.warnSoft, icon: 'alert' },
  ok: { solid: theme.ok, soft: theme.okSoft, icon: 'checkmark' },
  info: { solid: theme.ask, soft: theme.askSoft, icon: 'information' },
  accent: { solid: theme.accent, soft: theme.accentSoft, icon: 'sparkles' },
};

// ---------------------------------------------------------------------------
// The queue. Module-level, so anything can ask — a screen, a hook, a mutation's
// onError — without being inside a component, the way Alert.alert could.
// ---------------------------------------------------------------------------

type Entry = DialogSpec & { id: number };
let queue: Entry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const head = () => queue[0] ?? null;
const finished = (id: number) => {
  queue = queue.filter((entry) => entry.id !== id);
  emit();
};

/** Shows a dialog; one at a time, the rest wait their turn. */
export function showDialog(spec: DialogSpec) {
  queue = [...queue, { ...spec, id: nextId++ }];
  emit();
}

/** Something did not work: the server's own sentence when it sent one. */
export function showProblem(title: string, error: unknown, fallback = 'Please try again.') {
  showDialog({
    tone: 'danger',
    icon: 'alert',
    title,
    message: error instanceof ApiError ? error.message : fallback,
  });
}

/** Asks first. Resolves `true` for yes, `false` for no, back or a tap outside. */
export function confirmDialog(spec: {
  title: string;
  message?: string;
  confirm: string;
  cancel?: string;
  tone?: DialogTone;
  icon?: IconName;
}): Promise<boolean> {
  return new Promise((resolve) =>
    showDialog({
      title: spec.title,
      message: spec.message,
      tone: spec.tone,
      icon: spec.icon,
      actions: [
        { label: spec.cancel ?? 'Not now', role: 'cancel', onPress: () => resolve(false) },
        { label: spec.confirm, role: 'primary', onPress: () => resolve(true) },
      ],
    }),
  );
}

/**
 * Where every dialog is drawn (§184). Mounted once, at the root.
 *
 * The app's own replacement for the phone's grey system alert, which looked
 * like a different app every time it appeared: a white card with a soft halo
 * and a coloured disc saying at a glance what kind of message it is — red for
 * something that cannot be undone or that failed, green for done, blue for
 * information, amber for a warning, coral for the app's own questions — then
 * the title, the words, and the buttons in the app's shape.
 *
 * It rises and settles with a small spring over a dimmed screen and leaves
 * with a quick fade. The quiet button, the back button and a tap outside all
 * mean "no". A button whose work takes a moment (signing out) spins until it
 * is done, so a second tap cannot do it twice.
 */
export function DialogHost() {
  const entry = useSyncExternalStore(subscribe, head, head);
  const window = useWindowDimensions();
  const show = useRef(new Animated.Value(0)).current;
  const [busy, setBusy] = useState<number | null>(null);
  const leaving = useRef(false);

  useEffect(() => {
    if (!entry) return;
    leaving.current = false;
    setBusy(null);
    show.setValue(0);
    Animated.spring(show, { toValue: 1, speed: 15, bounciness: 7, useNativeDriver: true }).start();
    if (entry.tone === 'danger' || entry.tone === 'warn') caution();
    else if (entry.tone === 'ok') cheer();
    else tick();
    // The animation is per dialog, keyed on its id, not on its object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, show]);

  if (!entry) return null;

  const tone = TONES[entry.tone ?? 'info'];
  const actions: DialogAction[] = entry.actions?.length
    ? entry.actions
    : [{ label: 'OK', role: 'primary' }];
  const cancel = actions.find((a) => a.role === 'cancel');
  const escape = cancel ?? (actions.length === 1 ? actions[0] : undefined);

  const leave = () => {
    leaving.current = true;
    Animated.timing(show, {
      toValue: 0,
      duration: 170,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => finished(entry.id));
  };

  const choose = (action: DialogAction | undefined, index: number) => {
    if (leaving.current || busy !== null) return;
    const result = action?.onPress?.();
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      setBusy(index);
      (result as Promise<unknown>).catch(() => undefined).finally(leave);
    } else {
      leave();
    }
  };

  const width = Math.min(window.width - 48, 360);
  const inner = width - 44;
  // Side by side when both fit at a comfortable size; otherwise stacked, the
  // primary on top, where the thumb lands first.
  const sideBySide =
    actions.length === 2 &&
    actions.every((a) => a.label.length * 8.7 + 32 <= (inner - 10) / 2);
  const ordered = sideBySide
    ? [...actions].sort((a, b) => (a.role === 'cancel' ? -1 : b.role === 'cancel' ? 1 : 0))
    : [...actions].sort((a, b) => (a.role === 'cancel' ? 1 : b.role === 'cancel' ? -1 : 0));

  const fade = show.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => escape && choose(escape, actions.indexOf(escape))}
    >
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: fade }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => escape && choose(escape, actions.indexOf(escape))}
            accessibilityLabel={escape ? escape.label : undefined}
          />
        </Animated.View>

        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.card,
            {
              width,
              opacity: fade,
              transform: [
                { scale: show.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) },
                { translateY: show.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
              ],
            },
          ]}
        >
          <View style={[styles.halo, { backgroundColor: tone.soft }]}>
            <View style={[styles.disc, { backgroundColor: tone.solid }]}>
              <Icon name={entry.icon ?? tone.icon} size={28} color="#FFFFFF" />
            </View>
          </View>

          <Text style={styles.title} accessibilityRole="header">
            {entry.title}
          </Text>
          {entry.message ? (
            <ScrollView
              style={{ maxHeight: window.height * 0.42 }}
              contentContainerStyle={styles.messageBox}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.message}>{entry.message}</Text>
            </ScrollView>
          ) : null}

          <View style={[styles.actions, sideBySide && styles.actionsRow]}>
            {ordered.map((action) => {
              const index = actions.indexOf(action);
              const primary = action.role !== 'cancel' && action.role !== 'secondary';
              const secondary = action.role === 'secondary';
              const spinning = busy === index;
              return (
                // The press wrapper draws its style on an inner view, so the
                // share of the row is given to a plain view around it.
                <View key={`${action.label}:${index}`} style={sideBySide ? styles.half : null}>
                <PressableScale
                  onPress={() => choose(action, index)}
                  disabled={busy !== null}
                  scaleTo={0.96}
                  accessibilityRole="button"
                  accessibilityState={{ busy: spinning, disabled: busy !== null }}
                  style={[
                    styles.button,
                    primary
                      ? { backgroundColor: tone.solid }
                      : secondary
                        ? { backgroundColor: tone.soft }
                        : styles.buttonQuiet,
                    busy !== null && !spinning && styles.dim,
                  ]}
                >
                  {spinning ? (
                    <ActivityIndicator color={primary ? '#FFFFFF' : theme.ink} />
                  ) : (
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.buttonText,
                        primary ? styles.buttonTextOn : secondary ? { color: tone.solid } : null,
                      ]}
                    >
                      {action.label}
                    </Text>
                  )}
                </PressableScale>
                </View>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(15,17,22,0.55)' },
  card: {
    backgroundColor: theme.panel,
    borderRadius: 28,
    paddingTop: 26,
    paddingHorizontal: 22,
    paddingBottom: 20,
    alignItems: 'center',
    ...shadow.float,
  },
  halo: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  disc: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: font.extrabold,
    fontSize: 21,
    lineHeight: 27,
    letterSpacing: -0.3,
    color: theme.ink,
    textAlign: 'center',
  },
  messageBox: { paddingTop: 8 },
  message: {
    fontFamily: font.medium,
    fontSize: 14.5,
    lineHeight: 21.5,
    color: theme.ink2,
    textAlign: 'center',
  },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 22 },
  actionsRow: { flexDirection: 'row' },
  button: {
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  half: { flex: 1 },
  buttonQuiet: { backgroundColor: theme.sunken },
  buttonText: { fontFamily: font.bold, fontSize: 15.5, color: theme.ink },
  buttonTextOn: { color: '#FFFFFF' },
  dim: { opacity: 0.5 },
});
