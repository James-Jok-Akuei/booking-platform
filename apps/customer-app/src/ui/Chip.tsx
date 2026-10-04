import { StyleSheet, Text } from 'react-native';
import { font, radius, theme } from '../theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';

/**
 * A filter you can see the state of (§133).
 *
 * Off is a quiet white pill; on is solid. Two looks for "on": `accent` for a
 * choice that narrows what is shown, `dark` for one that only reorders it — so
 * the row of sorts and the row of filters do not read as one long list.
 */
export function Chip({
  label,
  active,
  onPress,
  icon,
  tone = 'dark',
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: IconName;
  tone?: 'dark' | 'accent';
}) {
  const on = tone === 'accent' ? theme.accent : theme.night;
  return (
    <PressableScale
      onPress={onPress}
      haptic
      scaleTo={0.94}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.chip, active && { backgroundColor: on, borderColor: on }]}
    >
      {icon && <Icon name={icon} size={15} color={active ? '#FFFFFF' : theme.ink2} />}
      <Text style={[styles.text, active && styles.textOn]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 15,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: theme.panel,
    borderWidth: 1.5,
    borderColor: theme.line,
  },
  text: { fontFamily: font.semibold, fontSize: 13.5, color: theme.ink2 },
  textOn: { color: '#FFFFFF' },
});
