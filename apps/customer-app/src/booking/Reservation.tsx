import { StyleSheet, Text, View } from 'react-native';
import type { Appointment } from '../api/booking';
import { BOOKING_STATUS } from '../bookingStatus';
import { duration } from '../duration';
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
import { BeforeYouCome } from './BeforeYouCome';
import { canCancelNow, freeNow, freeUntil, missedByItself } from './cancelRules';
import { BookedChoices } from './BookedChoices';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { MOMO_NAME } from '../ui/Momo';

const WHO_CANCELLED: Record<string, string> = {
  get CUSTOMER() { return t`You cancelled this`; },
  get BUSINESS() { return t`The shop cancelled this`; },
  get SYSTEM_EXPIRY() { return t`It was not paid in time`; },
};

/** What our support team did on a booking (§297), as the customer reads it. */
const SUPPORT_STEP: Partial<Record<string, string>> = {
  get CHECK_IN() { return t`Checked you in`; },
  get COMPLETE() { return t`Marked it done`; },
  get FIX_NO_SHOW() { return t`Changed “missed” to done — you came`; },
  get CANCEL_FOR_CUSTOMER() { return t`Cancelled it, as you asked`; },
  get CANCEL_FOR_SHOP() { return t`Cancelled it on the shop’s side`; },
  get RESEND_CODE() { return t`Sent you a new arrival code`; },
  get READ_MESSAGES() { return t`Read your conversation with the shop, to help`; },
  get READ_HEALTH_CHOICES() { return t`Read your private answers, to help`; },
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
  way,
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
  onChangeChoices,
}: {
  a: Appointment;
  bought: Bought;
  format: (minor: number | null | undefined, currency?: string) => string;
  onOpenPhoto: (index: number) => void;
  onShop: () => void;
  /** "4.1 km by road · about 12 min by car", once the phone's position is known. */
  way: string | null;
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
  /** Offered while wishes and the note can still change (§300.7). */
  onChangeChoices?: () => void;
}) {
  const layout = useLayout();
  const status = BOOKING_STATUS[a.status];
  const paid = a.depositPaidAt !== null;
  const live = a.status === 'BOOKED' || a.status === 'IN_PROGRESS';
  // Until the start (§313); free at least 24 hours before.
  const canCancel = canCancelNow(a);
  const free = freeNow(a);
  const deadline = freeUntil(a).toISOString();
  const deadlineWords = `${dayOf(deadline)}, ${timeOf(deadline)}`;
  const deposit = format(a.depositAmountMinor, a.currency);
  // Its time has begun and nobody has checked them in: it cannot be cancelled now.
  const started = a.status === 'BOOKED' && !canCancel;
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
          accessibilityLabel={t`Photos of ${a.service.name}`}
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
            <Text style={type.label}><Trans>Show this code when you arrive</Trans></Text>
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
          label={t`Message`}
          onPress={onMessage}
          off={messageBusy}
        />
        <Action icon="navigate-outline" label={t`Directions`} onPress={onDirections} />
        <Action icon="help-buoy-outline" label={t`Get help`} onPress={onHelp} />
        {a.status === 'COMPLETED' ? (
          <Action icon="star-outline" label={a.review ? t`My review` : t`Review`} onPress={onReview} />
        ) : (
          canCancel && <Action icon="close-circle-outline" label={t`Cancel`} onPress={onCancel} danger />
        )}
      </FadeIn>

      {/* WHAT TO KNOW BEFORE COMING (§180), live from the service: the day
          before the visit is when "come ten minutes early" matters most, so
          it is here until the visit is over. */}
      {a.service.instructions && (live || canCancel) && (
        <BeforeYouCome text={a.service.instructions} delay={120} />
      )}

      {/* WHAT YOU CHOSE (§300): the answers as the booking keeps them, the
          private ones apart, and the note — with a way to change the wishes
          while there is time. */}
      {(a.choices?.length || a.healthChoices?.length || a.customerNote || a.healthChoicesRemovedAt || onChangeChoices) && (
        <FadeIn delay={130} style={styles.card}>
          {a.choices?.length || a.healthChoices?.length || a.customerNote || a.healthChoicesRemovedAt ? (
            <BookedChoices a={a} format={format} onChange={onChangeChoices} />
          ) : (
            <PressableScale haptic scaleTo={0.98} onPress={onChangeChoices} accessibilityRole="button" style={styles.addWish}>
              <Icon name="create-outline" size={17} color={theme.accentDeep} />
              <Text style={[type.subheading, styles.flex]}><Trans>Add a wish or a note for the shop</Trans></Text>
              <Icon name="chevron-forward" size={16} color={theme.muted} />
            </PressableScale>
          )}
        </FadeIn>
      )}

      {/* THE FACTS. */}
      <FadeIn delay={140} style={styles.card}>
        <Text style={type.heading}><Trans>Reservation details</Trans></Text>
        <Row label={t`Reservation no.`} value={reservationNo(a.id)} strong />
        <Row label={t`Date`} value={dayOf(a.startTime)} />
        <Row label={t`Time`} value={timeRange(a)} />
        <Row label={t`Length`} value={duration(minutesOf(a), true)} />
        {a.quantity > 1 && (
          <Row label={t`People`} value={String(a.quantity)} />
        )}
        <Row label={t`Place`} value={`${a.location.name}\n${a.location.address}`} />
        {way && <Row label={t`Getting there`} value={way} />}
        <Row label={t`Booked on`} value={`${dayOf(a.createdAt)}, ${timeOf(a.createdAt)}`} />
      </FadeIn>

      {/* THE MONEY. */}
      <FadeIn delay={180} style={styles.card}>
        <Text style={type.heading}><Trans>Payment</Trans></Text>
        {a.unitPriceMinor !== null && (a.quantity > 1 || a.choicesPriceMinor !== 0) && (
          <Row
            label={a.quantity > 1 ? `${a.quantity} × ${format(a.unitPriceMinor, a.currency)}` : a.service.name}
            value={format(a.unitPriceMinor * a.quantity, a.currency)}
          />
        )}
        {/* Each answer that moved the price (§300.3), once for the booking. */}
        {(a.choices ?? [])
          .filter((pick) => pick.priceMinor !== 0)
          .map((pick) => (
            <Row
              key={pick.optionId}
              label={pick.option}
              value={`${pick.priceMinor < 0 ? '−' : '+'}${format(Math.abs(pick.priceMinor), a.currency)}`}
            />
          ))}
        {/* The sale it was booked under (§186). */}
        {a.discountPercent !== null && a.listPriceMinor !== null && a.servicePriceMinor !== null && (
          <Row
            label={t`Discount · ${a.discountPercent}% off`}
            value={`−${format(a.listPriceMinor - a.servicePriceMinor, a.currency)}`}
          />
        )}
        {a.servicePriceMinor !== null && (
          <Row label={t`Total`} value={format(a.servicePriceMinor, a.currency)} />
        )}
        <View style={styles.dashed} />
        <View style={styles.paidRow}>
          <Icon
            name={paid ? 'checkmark-circle' : 'ellipse-outline'}
            size={19}
            color={paid ? theme.ok : theme.muted}
          />
          <View style={styles.flex}>
            <Text style={styles.paidLabel}>{paid ? t`Deposit paid` : t`Deposit not paid`}</Text>
            {a.depositPaidAt && (
              <Text style={type.tiny}>
                <Trans>{dayOf(a.depositPaidAt)}, {timeOf(a.depositPaidAt)} · {MOMO_NAME}</Trans>
              </Text>
            )}
          </View>
          <Text style={styles.paidValue}>{format(a.depositAmountMinor, a.currency)}</Text>
        </View>
        {balance !== null && a.status !== 'CANCELLED' && a.status !== 'NO_SHOW' && (
          <View style={styles.paidRow}>
            <Icon name="storefront-outline" size={19} color={theme.ink2} />
            <View style={styles.flex}>
              <Text style={styles.paidLabel}>
                {/* Not "paid": what happens at the till is between the two
                    of them, and nothing here records it. */}
                {a.status === 'COMPLETED' ? t`Balance at the shop` : t`To pay at the shop`}
              </Text>
            </View>
            <Text style={styles.paidValue}>{format(balance, a.currency)}</Text>
          </View>
        )}
      </FadeIn>

      {/* THE RULES — or, once it is over, how it ended (§313). */}
      {a.status === 'CANCELLED' ? (
        <FadeIn delay={220} style={styles.card}>
          <Text style={type.heading}>
            {(a.cancelledBy && WHO_CANCELLED[a.cancelledBy]) ?? t`Cancelled`}
          </Text>
          {a.cancelledAt && (
            <Text style={type.small}>
              {dayOf(a.cancelledAt)}, {timeOf(a.cancelledAt)}
            </Text>
          )}
          {a.cancelledBy === 'BUSINESS' && paid && (
            <Text style={type.body}>
              <Trans>Because the shop cancelled, your deposit is refunded in full.</Trans>
            </Text>
          )}
          {a.cancelledBy === 'CUSTOMER' && paid && a.refund && (
            <Text style={type.body}>
              <Trans>You cancelled more than 24 hours before, so your whole deposit is refunded.</Trans>
            </Text>
          )}
          {a.cancelledBy === 'CUSTOMER' && paid && !a.refund && (
            <Text style={type.body}><Trans>You cancelled less than 24 hours before, so the deposit is not refunded.</Trans></Text>
          )}
          {a.refund && <RefundState refund={a.refund} format={format} />}
        </FadeIn>
      ) : a.status === 'NO_SHOW' ? (
        <FadeIn delay={220} style={styles.card}>
          <Text style={type.heading}><Trans>Marked as missed</Trans></Text>
          <Text style={type.body}>
            {missedByItself(a)
              ? t`Nobody checked you in, so the booking was marked as missed a day after its time.`
              : t`The shop marked this booking as missed: you were not checked in.`}
            {paid ? ` ${t`The deposit is not refunded for a missed booking.`}` : ''}
          </Text>
          <Rule icon="chatbubble-ellipses-outline" text={t`Think this is a mistake? Write to the shop, or ask us for help.`} />
          <View style={styles.twoButtons}>
            <Button kind="ghost" compact icon="chatbubble-ellipses-outline" label={t`Message the shop`} onPress={onMessage} />
            <Button kind="ghost" compact icon="help-buoy-outline" label={t`Get help`} onPress={onHelp} />
          </View>
        </FadeIn>
      ) : canCancel ? (
        <FadeIn delay={220} style={styles.card}>
          <Text style={type.heading}><Trans>Cancelling</Trans></Text>
          <Rule
            icon="person-outline"
            text={
              !paid
                ? t`Nothing has been paid, so cancelling costs nothing.`
                : free
                  ? t`Cancel before ${deadlineWords} and your whole deposit of ${deposit} comes back to you.`
                  : t`It is less than 24 hours before, so if you cancel now your deposit of ${deposit} is not refunded.`
            }
          />
          {paid && (
            <Rule
              icon="time-outline"
              text={t`If you don’t come, the booking is marked as missed and the deposit is not refunded.`}
            />
          )}
          <Rule
            icon="storefront-outline"
            text={t`If the shop cancels, you get your whole deposit back.`}
          />
          <Button kind="quietDanger" label={t`Cancel this reservation`} onPress={onCancel} />
        </FadeIn>
      ) : (
        started && (
          <FadeIn delay={220} style={styles.card}>
            <Text style={type.heading}><Trans>Running late, or can’t come?</Trans></Text>
            <Text style={type.body}>
              <Trans>Your time has started, so the booking can no longer be cancelled. Write to the shop — they can still check you in while your time is running.</Trans>
            </Text>
            <Button kind="ghost" compact icon="chatbubble-ellipses-outline" label={t`Message the shop`} onPress={onMessage} />
          </FadeIn>
        )
      )}

      {/* What our support team did on it (§297) — said, so nothing on a
          booking changes without the customer seeing why. */}
      {a.supportActions.length > 0 && (
        <FadeIn delay={240} style={styles.card}>
          <Text style={type.heading}><Trans>Our support team helped</Trans></Text>
          {a.supportActions.map((step, i) => (
            <View key={i} style={styles.rule}>
              <Icon name="help-buoy-outline" size={17} color={theme.accent} />
              <View style={styles.flex}>
                <Text style={type.body}>{SUPPORT_STEP[step.kind] ?? t`Helped with this booking`}</Text>
                <Text style={type.small}>
                  {dayOf(step.createdAt)}, {timeOf(step.createdAt)}
                </Text>
              </View>
            </View>
          ))}
        </FadeIn>
      )}

      {/* The visit is over, so what the customer thought is the useful thing
          left to do here (§111). */}
      {a.status === 'COMPLETED' && (
        <FadeIn delay={220} style={styles.card}>
          <Text style={type.heading}>{a.review ? t`Your review` : t`How was it?`}</Text>
          {a.review ? (
            <>
              <Stars rating={a.review.rating} size={22} />
              {a.review.comment && <Text style={type.body}>{a.review.comment}</Text>}
            </>
          ) : (
            <Text style={type.small}>
              <Trans>A few words help the next person decide. It takes a moment.</Trans>
            </Text>
          )}
          <Button
            kind="outline"
            icon="star-outline"
            label={a.review ? t`See or change it` : t`Write a review`}
            onPress={onReview}
          />
        </FadeIn>
      )}

      <Button kind="soft" icon="search" label={t`Explore more services`} onPress={onExplore} />
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

/** Where a refund has got to (§313): on its way, sent, or with our team. */
function RefundState({
  refund,
  format,
}: {
  refund: NonNullable<Appointment['refund']>;
  format: (minor: number | null | undefined, currency?: string) => string;
}) {
  const amount = format(refund.amountMinor, refund.currency);
  const done = refund.status === 'SENT';
  const when = refund.doneAt ?? refund.sentAt;
  return (
    <View style={[styles.refund, done && styles.refundDone]}>
      <Icon name={done ? 'checkmark-circle' : 'time-outline'} size={18} color={done ? theme.ok : theme.ink2} />
      <Text style={[type.body, styles.flex]}>
        {done
          ? when
            ? t`${amount} sent back on ${dayOf(when)} to the number that paid.`
            : t`${amount} sent back to the number that paid.`
          : refund.status === 'FAILED'
            ? t`${amount} is taking longer than usual to send — our team is sending it to you.`
            : t`${amount} is on its way back to the number that paid.`}
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
  refund: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  refundDone: { backgroundColor: theme.okSoft },
  twoButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  addWish: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
    backgroundColor: 'rgba(31,42,31,0.72)',
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
