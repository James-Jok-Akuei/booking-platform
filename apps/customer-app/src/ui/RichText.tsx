import { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { parseRich, type RichLine } from '../richText';
import { font, theme } from '../theme';
import { PressableScale } from './PressableScale';

/** The face for bold, italic or both, from the face the words are set in. */
function faceFor(base: string | undefined, bold?: boolean, italic?: boolean) {
  if (bold && italic) return font.boldItalic;
  if (bold) return font.bold;
  if (italic) return base === font.regular ? font.italic : font.mediumItalic;
  return base;
}

/**
 * A shop's formatted words, as a customer reads them (§271): paragraphs,
 * bullet and numbered lists, *bold* and _italic_, from the plain text the
 * shop wrote (`src/richText.ts`, the same rules as the business app).
 *
 * With `collapsedLines`, it starts that many lines tall with the words
 * fading out, and "Read more" opens it — only when there is more to read.
 */
export function RichText({
  text,
  style,
  collapsedLines,
  fadeTo = theme.bg,
}: {
  text: string | null | undefined;
  /** The paragraph style: face, size, line height, colour. */
  style?: StyleProp<TextStyle>;
  collapsedLines?: number;
  /** The colour behind the words, for the fade at a collapsed bottom. */
  fadeTo?: string;
}) {
  const base = StyleSheet.flatten(style) ?? {};
  const lineHeight = base.lineHeight ?? 22;
  const [expanded, setExpanded] = useState(false);
  const [fullHeight, setFullHeight] = useState(0);

  const blocks = parseRich(text);
  if (blocks.length === 0) return null;

  const runs = (line: RichLine) =>
    line.map((r, i) =>
      r.bold || r.italic ? (
        <Text key={i} style={{ fontFamily: faceFor(base.fontFamily, r.bold, r.italic), color: r.bold ? theme.ink : undefined }}>
          {r.text}
        </Text>
      ) : (
        r.text
      ),
    );

  const body = (
    <View style={styles.blocks}>
      {blocks.map((b, i) =>
        b.kind === 'p' ? (
          <Text key={i} style={style}>
            {b.lines.map((line, n) => [n > 0 ? '\n' : null, ...runs(line)])}
          </Text>
        ) : (
          <View key={i} style={styles.list}>
            {b.items.map((item, n) => (
              <View key={n} style={styles.item}>
                <Text style={[style, styles.marker, b.kind === 'ol' && styles.number]}>
                  {b.kind === 'ul' ? '•' : `${b.start + n}.`}
                </Text>
                <Text style={[style, styles.itemText]}>{runs(item)}</Text>
              </View>
            ))}
          </View>
        ),
      )}
    </View>
  );

  if (!collapsedLines) return body;

  const limit = collapsedLines * lineHeight;
  const more = fullHeight > limit + 4;
  // Held short until measured, so long words never flash open first.
  const clipped = !expanded && (fullHeight === 0 || more);
  return (
    <View style={styles.collapsible}>
      <View style={clipped ? { maxHeight: limit, overflow: 'hidden' } : undefined}>
        <View onLayout={(e) => setFullHeight(e.nativeEvent.layout.height)}>{body}</View>
        {clipped && more && (
          <LinearGradient
            colors={[`${fadeTo}00`, fadeTo]}
            style={[styles.fade, { height: Math.min(lineHeight * 1.6, limit) }]}
            pointerEvents="none"
          />
        )}
      </View>
      {more && (
        <PressableScale onPress={() => setExpanded((was) => !was)} hitSlop={8} accessibilityRole="button">
          <Text style={styles.link}>{expanded ? 'Show less' : 'Read more'}</Text>
        </PressableScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: 8 },
  list: { gap: 4 },
  item: { flexDirection: 'row', gap: 8 },
  marker: { color: theme.accent, fontFamily: font.extrabold, minWidth: 10 },
  number: { minWidth: 18 },
  itemText: { flex: 1 },
  collapsible: { gap: 10 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  link: { fontFamily: font.bold, fontSize: 13.5, color: theme.accent },
});
