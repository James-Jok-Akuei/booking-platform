import { StyleSheet, Text, View } from 'react-native';
import { font, radius, shadow, theme, type } from '../theme';
import { FadeIn } from '../ui/FadeIn';
import { RichText } from '../ui/RichText';
import { Trans } from '@lingui/react/macro';

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
      <Text style={type.heading}><Trans>Before you come</Trans></Text>
      <RichText text={text} style={styles.text} />
      <Text style={type.tiny}><Trans>From the shop</Trans></Text>
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
  text: { fontFamily: font.medium, fontSize: 14.5, lineHeight: 22, color: theme.ink },
});
