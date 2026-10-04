import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { font, theme } from '../theme';

/**
 * A small number on a coloured dot (§134).
 *
 * Renders nothing at zero — a badge reading "0" is noise. Stops counting at 99,
 * because past that the exact figure tells nobody anything and the badge would
 * grow wider than the icon it sits on.
 */
export function CountBadge({
  count,
  ring = theme.panel,
  inverse,
  style,
}: {
  count: number;
  /** The colour of the outline, which should match whatever is behind it. */
  ring?: string;
  /** White with coral digits, for sitting ON the accent colour. */
  inverse?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (count <= 0) return null;
  return (
    <View
      style={[
        styles.badge,
        { borderColor: ring },
        inverse && { backgroundColor: '#FFFFFF' },
        style,
      ]}
    >
      <Text style={[styles.text, inverse && { color: theme.accent }]}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 2,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontFamily: font.extrabold, fontSize: 10.5, lineHeight: 13, color: '#FFFFFF' },
});
