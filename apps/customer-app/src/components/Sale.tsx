import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { font, theme } from '../theme';
import { Icon } from '../ui/Icon';
import { t } from '@lingui/core/macro';
import { dateLocale } from '../i18n/format';

/** The sale on a service, as the server sends it (§186); `endsAt` is the moment it ends (§283). */
export type SaleInfo = { percent: number; endsOn: string | null; endsAt: string | null; listPriceMinor: number };

/** "until Sun 12 Oct", or "" when it runs until the shop ends it. */
export const saleUntil = (sale: SaleInfo) => {
  if (!sale.endsOn) return '';
  const day = new Date(`${sale.endsOn}T12:00:00Z`).toLocaleDateString(dateLocale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return t`until ${day}`;
};

/**
 * "−20%" on a photo's corner (§186): the deepest coral, so it reads on any
 * picture and is told apart at a glance from the app's ordinary coral.
 */
export function SaleBadge({
  percent,
  large,
  style,
}: {
  percent: number;
  large?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[styles.badge, large && styles.badgeLarge, style]}
      accessibilityLabel={t`${percent} percent off`}
    >
      <Icon name="pricetag" size={large ? 12 : 10} color="#FFFFFF" />
      <Text style={[styles.text, large && styles.textLarge]}>−{percent}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.accentDeep,
  },
  badgeLarge: { paddingHorizontal: 10, height: 28, borderRadius: 14, gap: 4 },
  text: { fontFamily: font.extrabold, fontSize: 11, color: '#FFFFFF' },
  textLarge: { fontSize: 13.5 },
});
