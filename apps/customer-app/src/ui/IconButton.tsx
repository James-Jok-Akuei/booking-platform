import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { shadow, theme } from '../theme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';

/**
 * A round button holding one icon (§133) — back, share, the things that float
 * over a photo.
 *
 * `label` is required and never shown: an icon with no words is invisible to a
 * screen reader, and "button" is not a description.
 */
export function IconButton({
  icon,
  label,
  onPress,
  size = 44,
  color = theme.ink,
  background = theme.panel,
  flat,
  style,
}: {
  icon: IconName;
  /** Read out by a screen reader. Never drawn. */
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
  background?: string;
  /** No shadow, for one sitting on a plain surface rather than over a photo. */
  flat?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic
      scaleTo={0.9}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.base,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: background },
        flat ? styles.flat : shadow.card,
        style,
      ]}
    >
      <Icon name={icon} size={Math.round(size * 0.46)} color={color} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  flat: { borderWidth: 1.5, borderColor: theme.line },
});
