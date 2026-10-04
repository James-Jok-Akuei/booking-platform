import { Image, StyleSheet, Text, View } from 'react-native';
import { font, theme } from '../theme';

/**
 * A round picture, or the first letter of a name where there is none (§133).
 *
 * The colour behind the letter is picked from the name itself, so the same shop
 * is the same colour everywhere it appears and a list of conversations is not
 * a column of identical grey circles.
 */
const TINTS: Array<{ bg: string; fg: string }> = [
  { bg: '#FFEEE8', fg: '#D7421E' },
  { bg: '#EAF1FF', fg: '#2456C7' },
  { bg: '#E6F8EE', fg: '#0E8A4A' },
  { bg: '#F2EBFF', fg: '#6B3FD4' },
  { bg: '#FFF1DF', fg: '#B5630A' },
  { bg: '#E6F6FA', fg: '#0F7C97' },
  { bg: '#FFECF2', fg: '#D03A6E' },
];

const tintFor = (name: string) => {
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum += name.charCodeAt(i);
  return TINTS[sum % TINTS.length];
};

export function Avatar({
  uri,
  name,
  size = 48,
}: {
  uri?: string | null;
  name: string | null | undefined;
  size?: number;
}) {
  const label = (name ?? '?').trim();
  const tint = tintFor(label);
  const shape = { width: size, height: size, borderRadius: size / 2 };

  if (uri) return <Image source={{ uri }} style={[shape, styles.image]} />;

  return (
    <View style={[shape, styles.empty, { backgroundColor: tint.bg }]}>
      <Text style={{ fontFamily: font.extrabold, fontSize: size * 0.4, color: tint.fg }}>
        {label[0]?.toUpperCase() ?? '?'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: theme.line },
  empty: { alignItems: 'center', justifyContent: 'center' },
});
