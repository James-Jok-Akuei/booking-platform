import { StyleSheet, View } from 'react-native';

import { t } from '@lingui/core/macro';

/**
 * The flag of Rwanda, drawn (§147).
 *
 * Drawn rather than an emoji, because the emoji flag is a different picture
 * on every phone — and on some Android phones it is the letters "RW". The
 * official proportions are kept: blue for the upper half, then yellow and
 * green a quarter each, and the sun in the blue, towards the fly. At this
 * size the sun is a disc; its twenty-four rays are a detail for a bigger one.
 */
export function RwandaFlag({ width = 18 }: { width?: number }) {
  const height = Math.round((width * 2) / 3);
  const sun = Math.round(height * 0.34);
  return (
    <View
      style={[styles.flag, { width, height, borderRadius: Math.max(2, width / 9) }]}
      accessibilityLabel={t`Rwanda`}
    >
      <View style={[styles.blue, { height: height / 2 }]}>
        <View
          style={[
            styles.sun,
            {
              width: sun,
              height: sun,
              borderRadius: sun / 2,
              right: Math.round(width * 0.1),
              top: Math.round(height * 0.08),
            },
          ]}
        />
      </View>
      <View style={[styles.yellow, { height: height / 4 }]} />
      <View style={[styles.green, { height: height / 4 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  flag: { overflow: 'hidden' },
  blue: { backgroundColor: '#00A1DE' },
  yellow: { backgroundColor: '#FAD201' },
  green: { backgroundColor: '#20603D' },
  sun: { position: 'absolute', backgroundColor: '#FAD201' },
});
