import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, theme, type } from '../theme';
import { IconButton } from './IconButton';
import { useLayout } from './layout';
import { t } from '@lingui/core/macro';

/**
 * The top of a screen that was pushed onto the stack (§133).
 *
 * Drawn by the app rather than by the navigator, so every screen has the same
 * round back button in the same place and the title is in the app's own type.
 * The native header could do neither.
 *
 * Back falls through to home when there is nothing to go back TO — which is
 * what happens when a screen is opened from a notification or a deep link, and
 * the alternative is a back button that does nothing.
 */
export function TopBar({
  title,
  subtitle,
  right,
  onBack,
  noBack,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
  noBack?: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const back = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
      {noBack ? (
        <View style={styles.side} />
      ) : (
        <IconButton icon="chevron-back" label={t`Go back`} onPress={back} flat />
      )}
      <View style={styles.middle}>
        {title && (
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        )}
        {subtitle && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      <View style={styles.side}>{right}</View>
    </View>
  );
}

/**
 * The top of a TAB screen: a large title, no back button, and whatever belongs
 * on the right. The size is the point — it says where you are before you have
 * read anything else.
 */
export function BigTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // In line with the page's column, which is centred on a wide screen.
  const layout = useLayout();
  return (
    <View style={[styles.big, { paddingTop: insets.top + 14, width: layout.contentWidth, alignSelf: 'center' }]}>
      <View style={styles.bigText}>
        {/* A long word (§308) shrinks to fit rather than breaking in two. */}
        <Text style={type.display} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
          {title}
        </Text>
        {subtitle && <Text style={[type.small, styles.bigSub]}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: theme.bg,
  },
  side: { minWidth: 44, alignItems: 'flex-end' },
  middle: { flex: 1, alignItems: 'center' },
  title: { fontFamily: font.bold, fontSize: 17, color: theme.ink },
  subtitle: { fontFamily: font.medium, fontSize: 12.5, color: theme.muted, marginTop: 1 },
  big: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: theme.bg,
  },
  bigText: { flex: 1 },
  bigSub: { marginTop: 3 },
});
