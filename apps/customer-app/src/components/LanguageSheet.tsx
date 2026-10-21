import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '@lingui/core/macro';
import { chooseLocale, offeredLanguages, useAppLocale } from '../i18n';
import { font, radius, theme } from '../theme';
import { tick } from '../ui/haptic';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';

/**
 * Choosing the app's language (§308). Each language is written in itself —
 * "Ikinyarwanda", "Français" — so a person finds theirs whatever the app is
 * in now, with its English name beneath for everyone else. Only languages
 * whose translation is finished and checked are offered.
 */
export function LanguageSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const current = useAppLocale();
  return (
    <Sheet open={open} title={t`Language`} onClose={onClose}>
      <View style={styles.list}>
        {offeredLanguages().map((language) => {
          const on = language.code === current;
          return (
            <Pressable
              key={language.code}
              onPress={() => {
                tick();
                onClose();
                if (!on) void chooseLocale(language.code);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={language.native}
              style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && styles.pressed]}
            >
              <View style={styles.flex}>
                <Text style={styles.native}>{language.native}</Text>
                {language.name !== language.native && <Text style={styles.name}>{language.name}</Text>}
              </View>
              <View style={[styles.radio, on && styles.radioOn]}>
                {on && <Icon name="checkmark" size={15} color="#FFFFFF" />}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

/** The language in use, by its own name. */
export function useLanguageName() {
  const current = useAppLocale();
  return offeredLanguages().find((language) => language.code === current)?.native ?? 'English';
}

/** Whether there is a choice to offer at all: one language is not a choice. */
export const languagesToChoose = () => offeredLanguages().length > 1;

const styles = StyleSheet.create({
  list: { gap: 8, paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: theme.line,
    backgroundColor: theme.panel,
  },
  rowOn: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
  pressed: { opacity: 0.85 },
  flex: { flex: 1 },
  native: { fontFamily: font.bold, fontSize: 16, color: theme.ink },
  name: { marginTop: 2, fontFamily: font.medium, fontSize: 13, color: theme.muted },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: theme.accent, backgroundColor: theme.accent },
});
