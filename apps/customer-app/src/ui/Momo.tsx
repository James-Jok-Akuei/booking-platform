import { Image, StyleSheet, Text, View } from 'react-native';
import { font, radius, theme } from '../theme';

/**
 * The MTN mark (§134.3).
 *
 * The genuine current logo, from Wikimedia Commons (public-domain file, though
 * the mark itself remains MTN's trademark — used here the way a shop window
 * shows the cards it takes). A file, not a drawing: a hand-made lookalike of
 * somebody's logo is the thing customers are right to distrust on a payment
 * screen.
 *
 * To swap it for MTN's own "MoMo" artwork from their brand kit, replace
 * `assets/mtn-logo.jpg`. Nothing else changes.
 */
const LOGO = require('../../assets/mtn-logo.jpg');

/** The service's own name, the same in every language (§308). */
export const MOMO_NAME = 'MTN Mobile Money';

export function MomoLogo({ size = 40 }: { size?: number }) {
  return (
    <Image
      source={LOGO}
      accessibilityLabel={MOMO_NAME}
      style={{ width: size, height: size, borderRadius: size * 0.26 }}
    />
  );
}

/**
 * The logo with its name beside it, for the top of anything about paying.
 *
 * A phone-number field on its own does not say WHOSE mobile money it wants.
 * The yellow square does, before a word is read — which matters most at the
 * moment somebody is deciding whether to type their number into an app.
 */
export function MomoBanner({ note }: { note?: string }) {
  return (
    <View style={styles.banner}>
      <MomoLogo size={46} />
      <View style={styles.text}>
        <Text style={styles.name}>{MOMO_NAME}</Text>
        {note && <Text style={styles.note}>{note}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    // MTN's own yellow, very pale, so the logo sits on its own colour.
    backgroundColor: '#FFF8D6',
    borderRadius: radius.lg,
    padding: 12,
  },
  text: { flex: 1 },
  name: { fontFamily: font.extrabold, fontSize: 15, color: theme.ink },
  note: { fontFamily: font.medium, fontSize: 12.5, lineHeight: 17, color: theme.ink2, marginTop: 1 },
});
