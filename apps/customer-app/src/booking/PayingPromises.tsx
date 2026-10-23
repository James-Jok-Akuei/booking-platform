import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { font, theme } from '../theme';
import { Icon, type IconName } from '../ui/Icon';
import { MomoLogo } from '../ui/Momo';
import { t } from '@lingui/core/macro';

/**
 * How paying works, said once (§182, §278): the three promises true of every
 * booking — paid on your own phone, confirmed the moment it is paid, all of it
 * back if you cancel 24 hours ahead or the shop cancels (§313).
 *
 * They used to close the service page as a "Safe to book" card. That page is
 * for choosing, so they moved: each one is said where it matters at checkout
 * (the PIN beside the number, the refund rule beside the amount), and the whole
 * set lives here, under Account → How paying works.
 */
export function PayingPromises() {
  return (
    <View style={styles.list}>
      <Pledge
        mark={<MomoLogo size={40} />}
        title={t`Pay with MTN MoMo`}
        text={t`You approve the deposit on your own phone. This app never asks for your PIN.`}
      />
      <Pledge
        icon="flash"
        color={theme.ok}
        tint={theme.okSoft}
        title={t`Confirmed the moment you pay`}
        text={t`The time is yours as soon as the deposit goes through.`}
      />
      <Pledge
        icon="refresh"
        color={theme.ask}
        tint={theme.askSoft}
        title={t`Free to cancel up to 24 hours before`}
        text={t`Cancel at least 24 hours before, or if the shop cancels, and your whole deposit goes back to the number that paid. Later, or if you don’t come, the shop keeps it.`}
      />
      <Pledge
        icon="storefront-outline"
        color={theme.accentDeep}
        tint={theme.accentSoft}
        title={t`The rest is paid at the shop`}
        text={t`The deposit only holds your time. You pay what is left after your visit, the way the shop takes it.`}
      />
    </View>
  );
}

/** One promise: its mark in its own colour, what it is, and one sentence. */
function Pledge({
  mark,
  icon,
  color,
  tint,
  title,
  text,
}: {
  /** A ready-made mark, such as the MoMo logo, in place of an icon. */
  mark?: ReactNode;
  icon?: IconName;
  color?: string;
  tint?: string;
  title: string;
  text: string;
}) {
  return (
    <View style={styles.promise}>
      {mark ?? (
        <View style={[styles.mark, { backgroundColor: tint }]}>
          <Icon name={icon!} size={20} color={color} />
        </View>
      )}
      <View style={styles.flex}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.text}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: 18 },
  promise: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  mark: { width: 40, height: 40, borderRadius: 10.4, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: font.bold, fontSize: 15, lineHeight: 20, color: theme.ink },
  text: { fontFamily: font.medium, fontSize: 13, lineHeight: 18.5, color: theme.ink2, marginTop: 2 },
});
