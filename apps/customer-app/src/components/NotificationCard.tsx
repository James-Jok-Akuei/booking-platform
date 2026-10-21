import { useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import type { Notification } from '../api/notifications';
import { font, radius, shadow, theme, type } from '../theme';
import { thump } from '../ui/haptic';
import { Icon, type IconName } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { dateLocale } from '../i18n/format';

export type Look = { icon: IconName; fg: string; bg: string; label: string };

/**
 * A picture and a word for each kind of news, so the list can be scanned by
 * colour before a line is read. Green is good news, red needs attention, coral
 * is "something for you to read", amber is about reviews. A kind this app does
 * not know yet gets the bell — the server adds kinds, and an unknown one must
 * still be readable.
 */
export const LOOKS: Partial<Record<Notification['type'], Look>> = {
  DEPOSIT_CONFIRMED: {
    icon: 'checkmark-circle',
    fg: theme.ok,
    bg: theme.okSoft,
    get label() { return t`Confirmed`; },
  },
  APPOINTMENT_BOOKED: {
    icon: 'calendar',
    fg: theme.ok,
    bg: theme.okSoft,
    get label() { return t`Booked`; },
  },
  APPOINTMENT_REMINDER: {
    icon: 'alarm',
    fg: theme.accent,
    bg: theme.accentSoft,
    get label() { return t`Reminder`; },
  },
  APPOINTMENT_CANCELLED: {
    icon: 'close-circle',
    fg: theme.danger,
    bg: theme.dangerSoft,
    get label() { return t`Cancelled`; },
  },
  APPOINTMENT_NO_SHOW: {
    icon: 'alert-circle',
    fg: theme.danger,
    bg: theme.dangerSoft,
    get label() { return t`Missed`; },
  },
  DEPOSIT_FAILED: {
    icon: 'card',
    fg: theme.danger,
    bg: theme.dangerSoft,
    get label() { return t`Payment`; },
  },
  APPOINTMENT_MANUALLY_VERIFIED: {
    icon: 'shield-checkmark',
    fg: theme.ok,
    bg: theme.okSoft,
    get label() { return t`Verified`; },
  },
  NEW_MESSAGE: {
    icon: 'chatbubble-ellipses',
    fg: theme.accent,
    bg: theme.accentSoft,
    get label() { return t`Message`; },
  },
  TICKET_MESSAGE: {
    icon: 'help-buoy',
    fg: theme.accent,
    bg: theme.accentSoft,
    get label() { return t`Support`; },
  },
  TICKET_STATUS_CHANGED: {
    icon: 'help-buoy',
    fg: theme.ink2,
    bg: theme.sunken,
    get label() { return t`Support`; },
  },
  REVIEW_RESPONSE: {
    icon: 'star',
    fg: theme.warn,
    bg: theme.warnSoft,
    get label() { return t`Review`; },
  },
  REVIEW_HIDDEN: {
    icon: 'eye-off',
    fg: theme.warn,
    bg: theme.warnSoft,
    get label() { return t`Review`; },
  },
  DISPLAY_NAME_CLEARED: {
    icon: 'eye-off',
    fg: theme.warn,
    bg: theme.warnSoft,
    get label() { return t`Account`; },
  },
  // §287
  APPOINTMENT_COMPLETED: {
    icon: 'star',
    fg: theme.warn,
    bg: theme.warnSoft,
    get label() { return t`How was it?`; },
  },
  SHOP_MESSAGE: {
    icon: 'storefront',
    fg: theme.ok,
    bg: theme.okSoft,
    get label() { return t`Offer`; },
  },
  SHOP_DISCOUNT: {
    icon: 'pricetag',
    fg: theme.accentDeep,
    bg: theme.accentSoft,
    get label() { return t`Discount`; },
  },
  ANNOUNCEMENT: {
    icon: 'megaphone',
    fg: theme.ink,
    bg: theme.sunken,
    get label() { return t`From our team`; },
  },
  // Support acted for them (§297): checked in, cancelled, signed out.
  SUPPORT_UPDATE: {
    icon: 'help-buoy',
    fg: theme.accent,
    bg: theme.accentSoft,
    get label() { return t`Support`; },
  },
  // A phone or browser not seen before signed in (§298).
  NEW_SIGN_IN: {
    icon: 'shield-checkmark',
    fg: theme.warn,
    bg: theme.warnSoft,
    get label() { return t`Sign-in`; },
  },
};
export const FALLBACK: Look = {
  icon: 'notifications',
  fg: theme.accent,
  bg: theme.accentSoft,
  get label() { return t`News`; },
};

/** The kinds that want something done, not just read (§159). */
export const NEEDS_ATTENTION: ReadonlySet<Notification['type']> = new Set([
  'APPOINTMENT_REMINDER',
  'DEPOSIT_FAILED',
  'APPOINTMENT_CANCELLED',
  'NEW_MESSAGE',
  'TICKET_MESSAGE',
]);

export const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return t`now`;
  if (minutes < 60) return t`${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t`${hours} h`;
  // Calendar days, not 24-hour blocks: a card under "Yesterday" must say
  // "1 d", not "2 d" because it was sent early that morning.
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(new Date(iso))) / 86_400_000);
  if (days < 7) return t`${days} d`;
  return new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });
};

const REMOVE_AT = 96;

/**
 * One notification (§159).
 *
 * The card reads in one glance: a coloured disc says what KIND, the subject
 * says what, the first line says enough, the time sits top-right.
 *
 * Unread and read are two different weights of card (§161): an unread one is
 * white, raised, bold, with a coral dot and "New"; a read one is flat on the
 * paper, with a thin line instead of a shadow, its disc and words faded. The
 * eye sorts the list before a word is read — and the size does not change, so
 * nothing jumps when one is opened.
 *
 * One that needs attention gets a coral edge down its left side and a word for
 * it ("Reminder"), so the eye lands on it first.
 *
 * Swipe left to remove: the card slides, red with a bin shows behind, and past
 * a third of the way it goes. Short of that it springs back. Built on
 * `PanResponder` like the photo zoom, so nothing is installed; the list keeps
 * vertical scrolling because a mostly-vertical move is never claimed.
 */
export function NotificationCard({
  item,
  important,
  onPress,
  onLongPress,
  onRemove,
  selecting,
  selected,
}: {
  item: Notification;
  important: boolean;
  onPress: () => void;
  /** Starts selecting (§162). */
  onLongPress: () => void;
  onRemove: () => void;
  /** While a selection is on, a tap selects instead of opening, and no swipe. */
  selecting: boolean;
  selected: boolean;
}) {
  const look = LOOKS[item.type] ?? FALLBACK;
  const label = look.label;
  const subject = item.subject;
  const unread = item.readAt === null;
  const x = useRef(new Animated.Value(0)).current;
  const gone = useRef(false);
  const selectingRef = useRef(selecting);
  selectingRef.current = selecting;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        !selectingRef.current && g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => x.setValue(Math.min(0, g.dx)),
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -REMOVE_AT || g.vx < -1.2) {
          if (gone.current) return;
          gone.current = true;
          thump();
          Animated.timing(x, { toValue: -600, duration: 220, useNativeDriver: true }).start(onRemove);
        } else {
          Animated.spring(x, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 6 }).start();
        }
      },
      onPanResponderTerminate: () =>
        Animated.spring(x, { toValue: 0, useNativeDriver: true, speed: 20 }).start(),
    }),
  ).current;

  // The red behind shows as the card moves; the bin grows into place.
  const reveal = x.interpolate({ inputRange: [-REMOVE_AT, 0], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.behind, { opacity: reveal }]} pointerEvents="none">
        <Animated.View style={{ transform: [{ scale: reveal }] }}>
          <Icon name="trash" size={20} color="#FFFFFF" />
        </Animated.View>
        <Text style={styles.behindText}><Trans>Remove</Trans></Text>
      </Animated.View>

      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        <PressableScale
          scaleTo={0.985}
          onPress={onPress}
          onLongPress={onLongPress}
          delayLongPress={320}
          accessibilityRole="button"
          accessibilityState={selecting ? { selected } : undefined}
          accessibilityLabel={unread ? t`Unread. ${label}: ${subject}` : t`${label}: ${subject}`}
          accessibilityHint={t`Opens it. Swipe left to remove.`}
          style={[
            styles.card,
            !unread && styles.cardRead,
            important && styles.cardImportant,
            selected && styles.cardSelected,
          ]}
        >
          {/* Selecting, the disc becomes the tick: the thing you tap is the
              thing that shows it is chosen. */}
          {selecting ? (
            <View style={[styles.disc, selected ? styles.tickOn : styles.tickOff]}>
              {selected && <Icon name="checkmark" size={22} color="#FFFFFF" />}
            </View>
          ) : (
            <View style={[styles.disc, { backgroundColor: look.bg }, !unread && styles.faded]}>
              <Icon name={look.icon} size={20} color={look.fg} />
            </View>
          )}

          <View style={styles.main}>
            <View style={styles.top}>
              <Text style={[styles.kind, { color: look.fg }, !unread && styles.faded]}>
                {look.label}
              </Text>
              <View style={styles.whenRow}>
                {unread && (
                  <View style={styles.newPill}>
                    <Text style={styles.newText}><Trans>New</Trans></Text>
                  </View>
                )}
                <Text style={[styles.when, unread && styles.whenUnread]}>{ago(item.createdAt)}</Text>
              </View>
            </View>
            <Text style={[styles.subject, unread && styles.subjectUnread]} numberOfLines={2}>
              {item.subject}
            </Text>
            <Text style={[type.small, !unread && styles.faded]} numberOfLines={1}>
              {item.body.replace(/\s*\n+\s*/g, ' · ')}
            </Text>
          </View>

          {unread ? <View style={styles.dot} /> : <View style={styles.readMark}><Icon name="checkmark-done" size={13} color={theme.muted} /></View>}
        </PressableScale>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg },
  behind: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    left: 0,
    borderRadius: radius.lg,
    backgroundColor: theme.danger,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 22,
    gap: 4,
  },
  behindText: { fontFamily: font.bold, fontSize: 11.5, color: '#FFFFFF' },
  card: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 14,
    ...shadow.card,
  },
  // Read: flat on the paper, a line for an edge, no shadow — it has been dealt with.
  cardRead: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: theme.line,
    shadowOpacity: 0,
    elevation: 0,
  },
  faded: { opacity: 0.6 },
  cardSelected: { borderWidth: 1.5, borderColor: theme.accent, backgroundColor: theme.accentSoft },
  tickOn: { backgroundColor: theme.accent },
  tickOff: { borderWidth: 2, borderColor: theme.line, backgroundColor: 'transparent' },
  cardImportant: { borderLeftWidth: 4, borderLeftColor: theme.accent, paddingLeft: 12 },
  whenRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  newPill: {
    backgroundColor: theme.accent,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  newText: { fontFamily: font.extrabold, fontSize: 10, color: '#FFFFFF', letterSpacing: 0.4 },
  readMark: { marginTop: 3 },
  disc: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: { flex: 1, gap: 3 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kind: { fontFamily: font.bold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  when: { fontFamily: font.medium, fontSize: 12, color: theme.muted },
  whenUnread: { fontFamily: font.bold, color: theme.accent },
  subject: { fontFamily: font.medium, fontSize: 14.5, lineHeight: 20, color: theme.ink2 },
  subjectUnread: { fontFamily: font.extrabold, color: theme.ink },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.accent, marginTop: 4 },
});
