import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { font, radius, theme } from '../theme';
import { Icon } from '../ui/Icon';
import { Pulse } from '../ui/Motion';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

const DAY = 24 * 60 * 60 * 1000;

/**
 * One clock for every countdown on the screen (§283): a shelf of twenty sales
 * ticks once a second, not twenty times. It runs only while something shows a
 * countdown.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now = Date.now();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const useSecond = () => useSyncExternalStore(subscribe, () => now);

/** What is left: whole days, hours, minutes and seconds. */
function parts(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

const two = (n: number) => String(n).padStart(2, '0');

/**
 * How long a sale has left (§283), on the service's own page: days, hours,
 * minutes and seconds, ticking. The end is the server's — midnight after the
 * sale's last day, where the platform is — so it reaches zero exactly when the
 * price changes back. On the last day it turns to the deepest coral with a
 * pulse. At zero it says the sale has ended, and `onEnded` fetches the price
 * again.
 */
export function SaleCountdown({
  endsAt,
  onEnded,
  style,
}: {
  endsAt: string;
  onEnded?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const at = useSecond();
  const left = Date.parse(endsAt) - at;
  const over = left <= 0;

  useEffect(() => {
    if (over) onEnded?.();
    // Once, as it crosses zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over]);

  if (over) {
    return (
      <View style={[styles.ended, style]}>
        <Icon name="time-outline" size={15} color={theme.ink2} />
        <Text style={styles.endedText}><Trans>This discount has ended — the price is back to normal.</Trans></Text>
      </View>
    );
  }

  const { d, h, m, s } = parts(left);
  const urgent = left < DAY;

  return (
    <View
      style={[styles.box, urgent && styles.boxUrgent, style]}
      accessible
      accessibilityLabel={t`Discount ends in ${d} days, ${h} hours and ${m} minutes`}
    >
      <View style={styles.head}>
        {urgent ? <Pulse color="#FFFFFF" size={8} /> : <Icon name="flash" size={14} color={theme.accentDeep} />}
        <Text style={[styles.headText, urgent && styles.onUrgent]}>
          {urgent ? t`Last day of the discount — ends in` : t`Discount ends in`}
        </Text>
      </View>
      <View style={styles.segments}>
        <Segment value={d} label={d === 1 ? t`day` : t`days`} urgent={urgent} />
        <Colon urgent={urgent} />
        <Segment value={h} label={t`hrs`} urgent={urgent} />
        <Colon urgent={urgent} />
        <Segment value={m} label={t`min`} urgent={urgent} />
        <Colon urgent={urgent} />
        <Segment value={s} label={t`sec`} urgent={urgent} />
      </View>
    </View>
  );
}

/** One number of the countdown: it drops in as it changes. */
function Segment({ value, label, urgent }: { value: number; label: string; urgent: boolean }) {
  const drop = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    drop.setValue(0);
    Animated.timing(drop, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [value, drop]);

  return (
    <View style={styles.segment}>
      <View style={[styles.digits, urgent && styles.digitsUrgent]}>
        <Animated.Text
          style={[
            styles.number,
            urgent && styles.numberUrgent,
            {
              opacity: drop.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }),
              transform: [{ translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [-7, 0] }) }],
            },
          ]}
        >
          {two(value)}
        </Animated.Text>
      </View>
      <Text style={[styles.label, urgent && styles.onUrgentSoft]}>{label}</Text>
    </View>
  );
}

function Colon({ urgent }: { urgent: boolean }) {
  return <Text style={[styles.colon, urgent && styles.onUrgentSoft]}>:</Text>;
}

/**
 * The same, small (§283): for a card's picture (`onPhoto`) or a line in a
 * list — "2d 05:13:09", ticking. Nothing once the sale is over; the list
 * catches up on its next fetch.
 */
export function SaleEndsChip({
  endsAt,
  onPhoto = false,
  style,
}: {
  endsAt: string;
  onPhoto?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const at = useSecond();
  const left = Date.parse(endsAt) - at;
  if (left <= 0) return null;

  const { d, h, m, s } = parts(left);
  const urgent = left < DAY;
  const clock = `${d > 0 ? `${d}d ` : ''}${two(h)}:${two(m)}:${two(s)}`;

  return (
    <View
      style={[styles.chip, onPhoto ? styles.chipPhoto : styles.chipList, urgent && styles.chipUrgent, style]}
      accessible
      accessibilityLabel={
        d > 0 ? t`Discount ends in ${d} days, ${h} hours and ${m} minutes` : t`Discount ends in ${h} hours and ${m} minutes`
      }
    >
      <Icon name="time" size={onPhoto ? 10 : 12} color={onPhoto || urgent ? '#FFFFFF' : theme.accentDeep} />
      <Text style={[styles.chipText, onPhoto ? styles.chipTextPhoto : styles.chipTextList, urgent && styles.onUrgent]}>
        {onPhoto ? clock : t`Ends in ${clock}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    // Its own shape on a wide screen, not four long bars.
    width: '100%',
    maxWidth: 460,
    gap: 10,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: theme.accentSoft,
  },
  boxUrgent: { backgroundColor: theme.accentDeep },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: -2 },
  headText: { fontFamily: font.bold, fontSize: 13, color: theme.accentDeep },
  onUrgent: { color: '#FFFFFF' },
  onUrgentSoft: { color: 'rgba(255,255,255,0.78)' },
  segments: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  segment: { flex: 1, alignItems: 'center', gap: 4 },
  digits: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
    borderRadius: 12,
    backgroundColor: theme.panel,
    overflow: 'hidden',
  },
  digitsUrgent: { backgroundColor: 'rgba(255,255,255,0.16)' },
  number: {
    fontFamily: font.extrabold,
    fontSize: 22,
    color: theme.accentDeep,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  numberUrgent: { color: '#FFFFFF' },
  label: { fontFamily: font.semibold, fontSize: 11, color: theme.ink2 },
  colon: { fontFamily: font.extrabold, fontSize: 18, lineHeight: 46, color: theme.accentDeep },
  ended: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: theme.sunken,
  },
  endedText: { flex: 1, fontFamily: font.semibold, fontSize: 13, color: theme.ink2 },

  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, borderRadius: 999 },
  chipPhoto: { backgroundColor: 'rgba(31,42,31,0.72)', paddingHorizontal: 7, paddingVertical: 3 },
  chipList: { backgroundColor: theme.accentSoft, paddingHorizontal: 9, paddingVertical: 4 },
  chipUrgent: { backgroundColor: theme.accentDeep },
  chipText: { fontFamily: font.bold, fontVariant: ['tabular-nums'] },
  chipTextPhoto: { fontSize: 10.5, color: '#FFFFFF' },
  chipTextList: { fontSize: 12, color: theme.accentDeep },
});
