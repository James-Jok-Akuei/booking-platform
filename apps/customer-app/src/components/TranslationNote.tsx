import { StyleSheet, Text, View } from 'react-native';
import { Trans } from '@lingui/react/macro';
import { radius, theme, type } from '../theme';
import { Icon } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';

/**
 * Beside a legal document read in translation (§308.5): where a translation
 * and the English differ, the English applies — said plainly, with the
 * English one tap away. Reading the English, the same tap goes back.
 */
export function TranslationNote({ english, onToggle }: { english: boolean; onToggle?: () => void }) {
  return (
    <View style={styles.box}>
      <Icon name="language-outline" size={18} color={theme.ink2} />
      <View style={styles.words}>
        <Text style={type.small}>
          {english ? (
            <Trans>This is the English, which applies wherever a translation differs.</Trans>
          ) : (
            <Trans>This is a translation. If it ever differs from the English, the English applies.</Trans>
          )}
        </Text>
        {onToggle && (
          <PressableScale onPress={onToggle} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>{english ? <Trans>Read it in my language</Trans> : <Trans>Read the English</Trans>}</Text>
          </PressableScale>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: theme.sunken, borderRadius: radius.md, padding: 12 },
  words: { flex: 1, minWidth: 0, gap: 6 },
  link: { ...type.small, color: theme.accent, fontWeight: '700', alignSelf: 'flex-start' },
});
