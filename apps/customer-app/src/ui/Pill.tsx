import { StyleSheet, Text, View } from 'react-native';
import { font, theme } from '../theme';
import { Icon, type IconName } from './Icon';

type Tone = 'ok' | 'warn' | 'danger' | 'accent' | 'neutral';

const TONES: Record<Tone, { bg: string; fg: string }> = {
  ok: { bg: theme.okSoft, fg: theme.ok },
  warn: { bg: theme.warnSoft, fg: theme.warn },
  danger: { bg: theme.dangerSoft, fg: theme.danger },
  accent: { bg: theme.accentSoft, fg: theme.accent },
  neutral: { bg: theme.sunken, fg: theme.ink2 },
};

/**
 * A small coloured label for a state — Open, Confirmed, Not paid yet (§133).
 *
 * Colour AND words, always both: the colour is for the glance, the words are
 * for everyone who cannot tell the two greens apart.
 */
export function Pill({
  label,
  tone = 'neutral',
  icon,
  dot,
  solid,
}: {
  label: string;
  tone?: Tone;
  icon?: IconName;
  /** A small filled circle before the words, for "live" states like Open. */
  dot?: boolean;
  /** White background, for sitting on top of a photograph. */
  solid?: boolean;
}) {
  const look = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: solid ? 'rgba(255,255,255,0.96)' : look.bg }]}>
      {dot && <View style={[styles.dot, { backgroundColor: look.fg }]} />}
      {icon && <Icon name={icon} size={12} color={look.fg} />}
      <Text style={[styles.text, { color: look.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontFamily: font.bold, fontSize: 11.5 },
});
