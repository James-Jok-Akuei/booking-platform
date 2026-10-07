import { StyleSheet, Text, View } from 'react-native';
import { font, radius, shadow, theme, type } from '../theme';
import { FadeIn } from '../ui/FadeIn';
import { Icon } from '../ui/Icon';

/**
 * What the shop asks a customer to know before they come (§180): "arrive ten
 * minutes early", "park at the back" — in the shop's own words, line breaks
 * kept.
 *
 * One component, because it is read in two places and must be recognisably
 * the same note in both: on the service before booking, where it helps decide,
 * and on the reservation after, where it is needed the day before.
 */
export function BeforeYouCome({
  text,
  delay = 0,
  inset,
}: {
  text: string;
  delay?: number;
  /** Inside a larger card already (§181): the note without a card of its own. */
  inset?: boolean;
}) {
  return (
    <FadeIn delay={delay} style={inset ? styles.inset : styles.card}>
      <View style={styles.head}>
        <View style={styles.disc}>
          <Icon name="clipboard-outline" size={17} color={theme.accent} />
        </View>
        <Text style={type.heading}>Before you come</Text>
      </View>
      <Text style={styles.text}>{text}</Text>
      <Text style={type.tiny}>From the shop</Text>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 16,
    gap: 10,
    borderWidth: 1.5,
    borderColor: '#FBDCD2',
    ...shadow.card,
  },
  inset: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  disc: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontFamily: font.medium, fontSize: 14.5, lineHeight: 22, color: theme.ink },
});
