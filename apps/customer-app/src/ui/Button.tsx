import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { font, radius, shadow, theme } from '../theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';

type Kind = 'primary' | 'dark' | 'soft' | 'outline' | 'ghost' | 'danger' | 'quietDanger';

const LOOK: Record<Kind, { bg: string; fg: string; border?: string }> = {
  primary: { bg: theme.accent, fg: '#FFFFFF' },
  dark: { bg: theme.night, fg: '#FFFFFF' },
  soft: { bg: theme.accentSoft, fg: theme.accent },
  outline: { bg: theme.panel, fg: theme.ink, border: theme.line },
  ghost: { bg: 'transparent', fg: theme.accent },
  danger: { bg: theme.dangerSoft, fg: theme.danger },
  // Red words and nothing else, for the irreversible thing that should not be
  // the loudest button on the screen.
  quietDanger: { bg: 'transparent', fg: theme.danger },
};

/**
 * The button (§133).
 *
 * One component, seven looks, because the app had the same four style blocks
 * copied into fourteen screens and they had already drifted. A disabled button
 * keeps its shape and loses its colour — it never disappears, so the screen
 * does not rearrange itself as a form is filled in.
 */
export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  busy,
  disabled,
  compact,
  style,
}: {
  label: string;
  onPress?: () => void;
  kind?: Kind;
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
  /** Shorter, for a button that sits in a row rather than closing a screen. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const look = LOOK[kind];
  const off = Boolean(disabled || busy);
  const solid = kind === 'primary' || kind === 'dark';

  return (
    <PressableScale
      onPress={onPress}
      disabled={off}
      haptic
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: Boolean(busy) }}
      style={[
        styles.base,
        compact && styles.compact,
        { backgroundColor: off && solid ? theme.line : look.bg },
        look.border ? { borderWidth: 1.5, borderColor: look.border } : null,
        // Only a live, filled button casts a shadow: depth says "this is the
        // thing to press", and a greyed-out one should not say it.
        solid && !off ? shadow.raised : null,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={solid ? (off ? theme.muted : '#FFFFFF') : look.fg} />
      ) : (
        <View style={styles.row}>
          {icon && <Icon name={icon} size={18} color={off && solid ? theme.muted : look.fg} />}
          {/* Two lines before a word is cut (§308): Kinyarwanda can be long. */}
          <Text
            numberOfLines={2}
            style={[styles.label, { color: off ? theme.muted : look.fg }]}
          >
            {label}
          </Text>
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    borderRadius: radius.pill,
    paddingHorizontal: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compact: { minHeight: 44, paddingHorizontal: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
  label: { fontFamily: font.bold, fontSize: 15.5, lineHeight: 19, textAlign: 'center', flexShrink: 1 },
});
