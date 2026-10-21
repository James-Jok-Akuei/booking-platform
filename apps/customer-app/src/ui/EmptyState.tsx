import { StyleSheet, Text, View } from 'react-native';
import { theme, type } from '../theme';
import { Button } from './Button';
import { FadeIn } from './FadeIn';
import { Icon, type IconName } from './Icon';

/**
 * A screen with nothing on it yet (§133).
 *
 * An empty list is the first thing most people see of most screens, so it gets
 * a picture, a sentence that says what WILL be here, and — where there is one —
 * the button that fills it. A grey line of text in the middle of a blank screen
 * reads as something having gone wrong.
 */
export function EmptyState({
  icon,
  title,
  text,
  action,
  onAction,
  secondary,
  onSecondary,
}: {
  icon: IconName;
  title: string;
  text?: string;
  action?: string;
  onAction?: () => void;
  /** A quieter second way on, under the first. */
  secondary?: string;
  onSecondary?: () => void;
}) {
  return (
    <FadeIn style={styles.wrap}>
      <View style={styles.halo}>
        <View style={styles.disc}>
          <Icon name={icon} size={30} color={theme.accent} />
        </View>
      </View>
      <Text style={[type.heading, styles.centre]}>{title}</Text>
      {text && <Text style={[type.body, styles.centre, styles.text]}>{text}</Text>}
      {action && onAction && (
        <Button label={action} onPress={onAction} style={styles.action} compact />
      )}
      {secondary && onSecondary && <Button label={secondary} kind="ghost" onPress={onSecondary} compact />}
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 36, paddingVertical: 44, gap: 8 },
  halo: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  disc: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: theme.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centre: { textAlign: 'center' },
  text: { color: theme.muted, maxWidth: 300 },
  action: { marginTop: 14, minWidth: 170 },
});
