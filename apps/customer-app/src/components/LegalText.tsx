import { StyleSheet, Text, View } from 'react-native';
import { font, theme } from '../theme';

/**
 * A legal document, set so it can be read (§141).
 *
 * The text is stored as PLAIN text — the admin screen is a text box, and the
 * web apps show it as written — so this reads the few conventions a plainly
 * typed document already follows and gives each a look:
 *
 *   A LINE IN CAPITALS       the document's title (the card already shows it)
 *   3. A NUMBERED HEADING    a section
 *   4.2 A numbered clause    the number set apart from its sentence
 *   - a line with a dash     a bullet
 *   [SOMETHING IN BRACKETS]  still to be filled in, and marked so
 *
 * Anything else is a paragraph. A text that follows none of these is simply
 * shown as paragraphs, exactly as before.
 */
export function LegalText({ body }: { body: string }) {
  const lines = body.split('\n').map((line) => line.trim());

  return (
    <View style={styles.wrap}>
      {lines.map((line, index) => {
        if (line === '') return null;

        // The title, repeated from the card's own heading.
        if (index === 0 && /^[A-Z ]+$/.test(line)) return null;

        if (/^Last updated:/i.test(line)) {
          return (
            <Text key={index} style={styles.updated}>
              {line}
            </Text>
          );
        }

        const heading = /^(\d+)\.\s+([A-Z][A-Z ,'’&-]+)$/.exec(line);
        if (heading) {
          return (
            <View key={index} style={styles.headingRow}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{heading[1]}</Text>
              </View>
              <Text style={styles.heading}>{sentenceCase(heading[2])}</Text>
            </View>
          );
        }

        if (line.startsWith('- ')) {
          return (
            <View key={index} style={styles.bulletRow}>
              <View style={styles.dot} />
              <Text style={[styles.text, styles.flex]}>{marked(line.slice(2))}</Text>
            </View>
          );
        }

        const clause = /^(\d+\.\d+)\s+(.*)$/.exec(line);
        if (clause) {
          return (
            <View key={index} style={styles.clauseRow}>
              <Text style={styles.clauseNo}>{clause[1]}</Text>
              <Text style={[styles.text, styles.flex]}>{marked(clause[2])}</Text>
            </View>
          );
        }

        return (
          <Text key={index} style={styles.text}>
            {marked(line)}
          </Text>
        );
      })}
    </View>
  );
}

/** "WHO WE ARE" → "Who we are": capitals shout on a phone. */
const sentenceCase = (text: string) => text.charAt(0) + text.slice(1).toLowerCase();

/** Marks every [PLACEHOLDER] so nobody mistakes a draft for the finished text. */
function marked(text: string) {
  const parts = text.split(/(\[[A-Z][^\]]*\])/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    /^\[[A-Z][^\]]*\]$/.test(part) ? (
      <Text key={i} style={styles.todo}>
        {part}
      </Text>
    ) : (
      part
    ),
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 9 },
  flex: { flex: 1 },
  updated: { fontFamily: font.semibold, fontSize: 12, color: theme.muted },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  badge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 7,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: font.extrabold, fontSize: 12, color: theme.accent },
  heading: { flex: 1, fontFamily: font.bold, fontSize: 16, lineHeight: 21, color: theme.ink },
  text: { fontFamily: font.regular, color: theme.ink2, fontSize: 14.5, lineHeight: 22.5 },
  bulletRow: { flexDirection: 'row', gap: 10, paddingLeft: 4 },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.accent,
    marginTop: 9,
  },
  clauseRow: { flexDirection: 'row', gap: 9 },
  clauseNo: {
    width: 34,
    fontFamily: font.bold,
    fontSize: 13,
    lineHeight: 22.5,
    color: theme.ink,
  },
  todo: { fontFamily: font.bold, color: theme.warn, backgroundColor: theme.warnSoft },
});
