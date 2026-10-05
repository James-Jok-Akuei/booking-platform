import { StyleSheet, Text, View } from 'react-native';
import type { Appointment } from '../api/booking';
import { BOOKING_STATUS } from '../bookingStatus';
import { font, radius, shadow, theme, type } from '../theme';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Cover } from '../ui/Cover';
import { FadeIn } from '../ui/FadeIn';
import { Icon, type IconName } from '../ui/Icon';
import { useLayout } from '../ui/layout';
import { Pill } from '../ui/Pill';
import { PressableScale } from '../ui/PressableScale';
import { Stars } from '../ui/Stars';
import {
  balanceMinor,
  dayOf,
  howMany,
  minutesOf,
  reservationNo,
  timeOf,
  timeRange,
  type Bought,
} from './format';

const WHO_CANCELLED: Record<string, string> = {
  CUSTOMER: 'You cancelled this',
  BUSINESS: 'The shop cancelled this',
  SYSTEM_EXPIRY: 'It was not paid in time',
};

/**
 * A reservation, as the thing you come back to (§137).
 *
 * Everything a person might open this screen FOR is one tap from the top:
 * the code to show at the door, a message to the shop, the way there, help,
 * and the way out. Below that, the facts in the order someone checks them —
 * what and when, then the money, then the rules about cancelling.
 */
export function Reservation({
  a,
  bought,
  format,
  onOpenPhoto,
  onShop,
  onMessage,
  messageBusy,
  onDirections,
  onHelp,
  onCancel,
  onReview,
  onResend,
  resendLabel,
  resendOff,
  onExplore,
}: {
  a: Appointment;
  bought: Bought;
  format: (minor: number | null | undefined, currency?: string) => string;
  onOpenPhoto: (index: number) => void;
  onShop: () => void;
  onMessage: () => void;
  messageBusy: boolean;
  onDirections: () => void;
  onHelp: () => void;
  onCancel: () => void;
  onReview: () => void;
  onResend: () => void;
  resendLabel: string;
  resendOff: boolean;
  onExplore: () => void;
}) {
  const layout = useLayout();
  const status = BOOKING_STATUS[a.status];
  const paid = a.depositPaidAt !== null;
  const live = a.status === 'BOOKED' || a.status === 'IN_PROGRESS';
  const canCancel = a.status === 'BOOKED' || a.status === 'PENDING_PAYMENT';
  const many = howMany(a);
  const balance = balanceMinor(a);

  return (
    <>
      {/* WHAT, with its picture. */}
      <FadeIn style={styles.hero}>
        <PressableScale
          scaleTo={0.985}
          onPress={() => bought.images.length > 0 && onOpenPhoto(0)}
          accessibilityRole="imagebutton"
          accessibilityLabel={`Photos of ${a.service.name}`}
        >
          <Cover
            uri={bought.cover}
            categoryIcon={bought.categoryIcon}
            style={styles.heroPhoto}
            iconSize={40}
          />
          <View style={styles.heroPill}>
            <Pill label={status.label} tone={status.tone} dot={a.status === 'BOOKED'} solid />
          </View>
          {bought.images.length > 1 && (
            <View style={styles.more}>
              <Icon name="images-outline" size={12} color="#FFFFFF" />
              <Text style={styles.moreText}>{bought.images.length}</Text>
            </View>
          )}
        </PressableScale>

        <View style={styles.heroBody}>
          <Text style={type.title}>{a.service.name}</Text>
          {many && <Text style={type.body}>{many}</Text>}

          <PressableScale onPress={onShop} haptic style={styles.shop} accessibilityRole="button">
            <Avatar uri={bought.logoUrl} name={bought.businessName} size={36} />
            <View style={styles.flex}>
              <Text style={type.subheading} numberOfLines={1}>
                {bought.businessName}
              </Text>
              <Text style={type.small} numberOfLines={1}>
                {a.location.name}
              </Text>
            </View>
            <Icon name="chevron-forward" size={16} color={theme.muted} />
          </PressableScale>
        </View>
      </FadeIn>

      {/* THE CODE. Read out at the shop; it is in the email too, so this is a
          convenience rather than the only copy (§54). */}
      {paid && live && a.verificationCode && (
        <FadeIn delay={60} style={styles.card}>
          <View style={styles.codeBox}>
            <Text style={type.label}>Show this code when you arrive</Text>
            <Text
              style={[styles.code, layout.compact && styles.codeCompact]}
              selectable
              adjustsFontSizeToFit
              numberOfLines={1}
            >
              {a.verificationCode}
            </Text>
          </View>
          <Button
            kind="ghost"
            compact
            icon="mail-outline"
            disabled={resendOff}
            onPress={onResend}
            label={resendLabel}
          />
        </FadeIn>
      )}

      {/* WHAT YOU CAN DO, as four round buttons — the row a banking app puts
          under a balance, for the same reason: these are why people open it. */}
      <FadeIn delay={100} style={styles.actions}>
        <Action
          icon="chatbubble-ellipses-outline"
          label="Message"
          onPress={onMessage}
          off={messageBusy}
        />
        <Action icon="navigate-outline" label="Directions" onPress={onDirections} />
        <Action icon="help-buoy-outline" label="Get help" onPress={onHelp} />
        {a.status === 'COMPLETED' ? (
          <Action icon="star-outline" label={a.review ? 'My review' : 'Review'} onPress={onReview} />
        ) : (
          canCancel && <Action icon="close-circle-outline" label="Cancel" onPress={onCancel} danger />
        )}
      </FadeIn>

      {/* THE FACTS. */}
      <FadeIn delay={140} style={styles.card}>
        <Text style={type.heading}>Reservation details</Text>
        <Row label="Reservation no." value={reservationNo(a.id)} strong />
        <Row label="Date" value={dayOf(a.startTime)} />
        <Row label="Time" value={timeRange(a)} />
        <Row label="Length" value={`${minutesOf(a)} minutes`} />
        {a.quantity > 1 && (
          <Row
            label={a.service.quantityMode === 'PEOPLE' ? 'People' : 'How many'}
            value={String(a.quantity)}
          />
        )}
        <Row label="Place" value={`${a.location.name}\n${a.location.address}`} />
        <Row label="Booked on" value={`${dayOf(a.createdAt)}, ${timeOf(a.createdAt)}`} />
      </FadeIn>

      {/* THE MONEY. */}
      <FadeIn delay={180} style={styles.card}>
        <Text style={type.heading}>Payment</Text>
        {a.unitPriceMinor !== null && a.quantity > 1 && (
          <Row
            label={`${a.quantity} × ${format(a.unitPriceMinor, a.currency)}`}
            value={format(a.servicePriceMinor, a.currency)}
          />
        )}
        {a.servicePriceMinor !== null && (
          <Row label="Total" value={format(a.servicePriceMinor, a.currency)} />
        )}
        <View style={styles.dashed} />
        <View style={styles.paidRow}>
          <Icon
            name={paid ? 'checkmark-circle' : 'ellipse-outline'}
            size={19}
            color={paid ? theme.ok : theme.muted}
          />
          <View style={styles.flex}>
            <Text style={styles.paidLabel}>{paid ? 'Deposit paid' : 'Deposit not paid'}</Text>
            {a.depositPaidAt && (
              <Text style={type.tiny}>
                {dayOf(a.depositPaidAt)}, {timeOf(a.depositPaidAt)} · MTN Mobile Money
              </Text>
            )}
          </View>
          <Text style={styles.paidValue}>{format(a.depositAmountMinor, a.currency)}</Text>
        </View>
        {balance !== null && a.status !== 'CANCELLED' && (
          <View style={styles.paidRow}>
            <Icon name="storefront-outline" size={19} color={theme.ink2} />
            <View style={styles.flex}>
              <Text style={styles.paidLabel}>
                {/* Not "paid": what happens at the till is between the two
                    of them, and nothing here records it. */}
                {a.status === 'COMPLETED' ? 'Balance at the shop' : 'To pay at the shop'}
              </Text>
            </View>
            <Text style={styles.paidValue}>{format(balance, a.currency)}</Text>
          </View>
        )}
      </FadeIn>

      {/* THE RULES — or, once it is over, how it ended. */}
      {a.status === 'CANCELLED' ? (
        <FadeIn delay={220} style={styles.card}>
          <Text style={type.heading}>
            {(a.cancelledBy && WHO_CANCELLED[a.cancelledBy]) ?? 'Cancelled'}
          </Text>
          {a.cancelledAt && (
            <Text style={type.small}>
              {dayOf(a.cancelledAt)}, {timeOf(a.cancelledAt)}
            </Text>
          )}
          {a.cancelledBy === 'BUSINESS' && paid && (
            <Text style={type.body}>
              Because the shop cancelled, your deposit is refunded in full.
            </Text>
          )}
          {a.cancelledBy === 'CUSTOMER' && paid && (
            <Text style={type.body}>The deposit is not refunded when you cancel.</Text>
          )}
        </FadeIn>
      ) : (
        canCancel && (
          <FadeIn delay={220} style={styles.card}>
            <Text style={type.heading}>Cancelling</Text>
            <Rule
              icon="person-outline"
              text={
                paid
                  ? `If you cancel, your deposit of ${format(a.depositAmountMinor, a.currency)} is not refunded. It is what holds the slot.`
                  : 'Nothing has been paid, so cancelling costs nothing.'
              }
            />
            <Rule
              icon="storefront-outline"
              text="If the shop cancels, you get your whole deposit back."
            />
            <Button kind="quietDanger" label="Cancel this reservation" onPress={onCancel} />
          </FadeIn>
        )
      )}

      {/* The visit is over, so what the customer thought is the useful thing
          left to do here (§111). */}
      {a.status === 'COMPLETED' && (
        <FadeIn delay={220} style={styles.card}>
          <Text style={type.heading}>{a.review ? 'Your review' : 'How was it?'}</Text>
          {a.review ? (
            <>
              <Stars rating={a.review.rating} size={22} />
              {a.review.comment && <Text style={type.body}>{a.review.comment}</Text>}
            </>
          ) : (
            <Text style={type.small}>
              A few words help the next person decide. It takes a moment.
            </Text>
          )}
          <Button
            kind="outline"
            icon="star-outline"
            label={a.review ? 'See or change it' : 'Write a review'}
            onPress={onReview}
          />
        </FadeIn>
      )}

      <Button kind="soft" icon="search" label="Explore more services" onPress={onExplore} />
    </>
  );
}

function Action({
  icon,
  label,
  onPress,
  off,
  danger,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  off?: boolean;
  danger?: boolean;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic
      scaleTo={0.92}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.action, off && styles.off]}
    >
      <View style={[styles.actionDisc, danger && { backgroundColor: theme.dangerSoft }]}>
        <Icon name={icon} size={22} color={danger ? theme.danger : theme.accent} />
      </View>
      <Text style={[styles.actionLabel, danger && { color: theme.danger }]} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={type.small}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong]} selectable={strong}>
        {value}
      </Text>
    </View>
  );
}

function Rule({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.rule}>
      <Icon name={icon} size={17} color={theme.ink2} />
      <Text style={[type.body, styles.flex]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  off: { opacity: 0.45 },
  hero: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 8,
    ...shadow.card,
  },
  heroPhoto: { width: '100%', height: 170, borderRadius: radius.lg },
  heroPill: { position: 'absolute', top: 10, left: 10 },
  more: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(21,23,28,0.72)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  moreText: { fontFamily: font.bold, fontSize: 11.5, color: '#FFFFFF' },
  heroBody: { paddingHorizontal: 10, paddingTop: 14, paddingBottom: 8, gap: 4 },
  shop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    padding: 10,
    marginTop: 10,
  },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 18,
    gap: 12,
    ...shadow.card,
  },
  codeBox: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: theme.line,
    backgroundColor: theme.sunken,
    borderRadius: radius.lg,
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 8,
  },
  code: {
    fontFamily: font.extrabold,
    fontSize: 42,
    letterSpacing: 9,
    color: theme.ink,
    // The tracking adds space after the LAST digit too; this puts it back in
    // the middle.
    paddingLeft: 9,
  },
  codeCompact: { fontSize: 34, letterSpacing: 6 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    paddingVertical: 16,
    paddingHorizontal: 8,
    ...shadow.card,
  },
  action: { flex: 1, alignItems: 'center', gap: 7 },
  actionDisc: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontFamily: font.bold, fontSize: 12, color: theme.ink },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  rowValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: font.bold,
    fontSize: 13.5,
    lineHeight: 19,
    color: theme.ink,
  },
  rowStrong: { fontFamily: font.extrabold, fontSize: 15, letterSpacing: 1.2 },
  dashed: { borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: theme.line },
  paidRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  paidLabel: { fontFamily: font.bold, fontSize: 14, color: theme.ink },
  paidValue: { fontFamily: font.extrabold, fontSize: 15, color: theme.ink },
  rule: { flexDirection: 'row', gap: 10 },
});
