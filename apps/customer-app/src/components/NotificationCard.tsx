import { useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import type { Notification } from '../api/notifications';
import { font, radius, shadow, theme, type } from '../theme';
import { thump } from '../ui/haptic';
import { Icon, type IconName } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';

export type Look = { icon: IconName; fg: string; bg: string; label: string };

/**
 * A picture and a word for each kind of news, so the list can be scanned by
 * colour before a line is read. Green is good news, red needs attention, coral
 * is "something for you to read", amber is about reviews. A kind this app does
 * not know yet gets the bell — the server adds kinds, and an unknown one must
 * still be readable.
 */
export const LOOKS: Partial<Record<Notification['type'], Look>> = {
  DEPOSIT_CONFIRMED: { icon: 'checkmark-circle', fg: theme.ok, bg: theme.okSoft, label: 'Confirmed' },
  APPOINTMENT_BOOKED: { icon: 'calendar', fg: theme.ok, bg: theme.okSoft, label: 'Booked' },
  APPOINTMENT_REMINDER: { icon: 'alarm', fg: theme.accent, bg: theme.accentSoft, label: 'Reminder' },
  APPOINTMENT_CANCELLED: { icon: 'close-circle', fg: theme.danger, bg: theme.dangerSoft, label: 'Cancelled' },
  APPOINTMENT_NO_SHOW: { icon: 'alert-circle', fg: theme.danger, bg: theme.dangerSoft, label: 'Missed' },
  DEPOSIT_FAILED: { icon: 'card', fg: theme.danger, bg: theme.dangerSoft, label: 'Payment' },
  APPOINTMENT_MANUALLY_VERIFIED: { icon: 'shield-checkmark', fg: theme.ok, bg: theme.okSoft, label: 'Verified' },
  NEW_MESSAGE: { icon: 'chatbubble-ellipses', fg: theme.accent, bg: theme.accentSoft, label: 'Message' },
  TICKET_MESSAGE: { icon: 'help-buoy', fg: theme.accent, bg: theme.accentSoft, label: 'Support' },
  TICKET_STATUS_CHANGED: { icon: 'help-buoy', fg: theme.ink2, bg: theme.sunken, label: 'Support' },
  REVIEW_RESPONSE: { icon: 'star', fg: theme.warn, bg: theme.warnSoft, label: 'Review' },
  REVIEW_HIDDEN: { icon: 'eye-off', fg: theme.warn, bg: theme.warnSoft, label: 'Review' },
  DISPLAY_NAME_CLEARED: { icon: 'eye-off', fg: theme.warn, bg: theme.warnSoft, label: 'Account' },
};
export const FALLBACK: Look = { icon: 'notifications', fg: theme.accent, bg: theme.accentSoft, label: 'News' };

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
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  // Calendar days, not 24-hour blocks: a card under "Yesterday" must say
  // "1 d", not "2 d" because it was sent early that morning.
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(new Date(iso))) / 86_400_000);
  if (days < 7) return `${days} d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const REMOVE_AT = 96;

/**
 * One notification (§159).
 *
 * The card reads in one glance: a coloured disc says what KIND, the subject
 * says what, the first line says enough, the time sits top-right, and an
 * unread one is bolder with a coral dot — never a different card, so the list
 * does not jump when something is read.
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
  onRemove,
}: {
  item: Notification;
  important: boolean;
  onPress: () => void;
  onRemove: () => void;
}) {
  const look = LOOKS[item.type] ?? FALLBACK;
  const unread = item.readAt === null;
  const x = useRef(new Animated.Value(0)).current;
  const gone = useRef(false);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
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
        <Text style={styles.behindText}>Remove</Text>
      </Animated.View>

      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        <PressableScale
          scaleTo={0.985}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`${unread ? 'Unread. ' : ''}${look.label}: ${item.subject}`}
          accessibilityHint="Opens it. Swipe left to remove."
          style={[styles.card, important && styles.cardImportant]}
        >
          <View style={[styles.disc, { backgroundColor: look.bg }]}>
            <Icon name={look.icon} size={20} color={look.fg} />
          </View>

          <View style={styles.main}>
            <View style={styles.top}>
              <Text style={[styles.kind, { color: look.fg }]}>{look.label}</Text>
              <Text style={[styles.when, unread && styles.whenUnread]}>{ago(item.createdAt)}</Text>
            </View>
            <Text style={[styles.subject, unread && styles.subjectUnread]} numberOfLines={2}>
              {item.subject}
            </Text>
            <Text style={type.small} numberOfLines={1}>
              {item.body.replace(/\s*\n+\s*/g, ' · ')}
            </Text>
          </View>

          {unread && <View style={styles.dot} />}
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
  cardImportant: { borderLeftWidth: 4, borderLeftColor: theme.accent, paddingLeft: 12 },
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
  subject: { fontFamily: font.semibold, fontSize: 14.5, lineHeight: 20, color: theme.ink2 },
  subjectUnread: { fontFamily: font.extrabold, color: theme.ink },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.accent, marginTop: 4 },
});
