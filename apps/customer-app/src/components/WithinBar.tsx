import { StyleSheet, Text, View } from 'react-native';
import { WITHIN_STEPS } from '../nearReach';
import { font, theme } from '../theme';
import { FadeIn } from '../ui/FadeIn';
import { Icon } from '../ui/Icon';
import { Pulse } from '../ui/Motion';
import { Segmented } from '../ui/Segmented';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

const ANY = 'any';
const OPTIONS = [
  // Read when shown (§308), like every label made at the top of a file.
  ...WITHIN_STEPS.map((km) => ({
    value: String(km),
    get label() {
      return t`${km} km`;
    },
  })),
  {
    value: ANY,
    get label() { return t`Any`; },
  },
];

/**
 * How far from here (§171): 2, 5, 10 or 25 km, or any distance.
 *
 * Only drawn once the app knows where the customer is — a distance from
 * nowhere is not a filter. The thumb sits on the distance actually SHOWN, and
 * when that is further than the one asked for, the line under it says why, so
 * a list that grew never looks like the picker ignored a tap.
 *
 * The green dot is the promise behind the numbers: they are measured from
 * where the phone is now, and they follow it.
 */
export function WithinBar({
  km,
  onChange,
  note,
}: {
  km: number | null;
  onChange: (km: number | null) => void;
  note: string | null;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Icon name="navigate" size={14} color={theme.accent} />
        <Text style={styles.title}><Trans>Within</Trans></Text>
        <View style={styles.live} accessibilityLabel={t`Distances are from where you are now`}>
          <Pulse color={theme.ok} size={6} />
          <Text style={styles.liveText}><Trans>From where you are now</Trans></Text>
        </View>
      </View>
      <Segmented
        options={OPTIONS}
        value={km === null ? ANY : String(km)}
        onChange={(value) => onChange(value === ANY ? null : Number(value))}
      />
      {note && (
        <FadeIn key={note} style={styles.note}>
          <Icon name="expand-outline" size={15} color={theme.ink2} />
          <Text style={styles.noteText}>{note}</Text>
        </FadeIn>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: font.bold, fontSize: 14, color: theme.ink },
  live: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 0 },
  liveText: { fontFamily: font.semibold, fontSize: 12, color: theme.muted },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingHorizontal: 4 },
  noteText: { flex: 1, fontFamily: font.medium, fontSize: 13, lineHeight: 18, color: theme.ink2 },
});
