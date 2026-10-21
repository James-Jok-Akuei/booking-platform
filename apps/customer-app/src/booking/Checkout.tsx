import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Appointment, PaymentStatus } from '../api/booking';
import { explainFailedDeposit, toMsisdn } from '../api/booking';
import { duration } from '../duration';
import { font, radius, shadow, theme, type } from '../theme';
import { Chip } from '../ui/Chip';
import { Cover } from '../ui/Cover';
import { FadeIn } from '../ui/FadeIn';
import { Icon } from '../ui/Icon';
import { MomoLogo, MOMO_NAME } from '../ui/Momo';
import { Pulse } from '../ui/Motion';
import { PressableScale } from '../ui/PressableScale';
import { balanceMinor, dayOf, howMany, minutesOf, timeRange, type Bought } from './format';
import { BookedChoices } from './BookedChoices';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

/** How long the server holds an unpaid slot (`PENDING_PAYMENT_TTL_MS`). */
const HOLD_MS = 5 * 60 * 1000;

/**
 * Paying (§137).
 *
 * Laid out the way a checkout is everywhere, because that familiarity is most
 * of what makes one feel safe: WHAT you are buying, with its picture, at the
 * top; the sum worked out line by line; then how you pay; and the amount and
 * the button fixed at the bottom where the thumb already is.
 *
 * The picture matters more than it looks. By this screen the customer has left
 * the service's page, and a payment form with only a name and a number on it
 * asks them to trust their memory of what they chose.
 */
export function Checkout({
  a,
  bought,
  format,
  phone,
  onPhone,
  savedNumbers,
  stage,
  failureReason,
  onOpenPhoto,
  onFieldFocus,
}: {
  a: Appointment;
  bought: Bought;
  format: (minor: number | null | undefined, currency?: string) => string;
  phone: string;
  onPhone: (next: string) => void;
  savedNumbers: Array<{ id: string; label?: string | null; phoneNumber: string }>;
  stage: PaymentStatus['paymentStatus'] | undefined;
  failureReason?: string;
  onOpenPhoto: (index: number) => void;
  /** Keeps the number field above the keyboard (§168). */
  onFieldFocus?: () => void;
}) {
  const many = howMany(a);
  const balance = balanceMinor(a);

  return (
    <>
      <Steps />

      {stage !== 'PENDING' && <HoldTimer createdAt={a.createdAt} />}

      {/* WHAT. */}
      <FadeIn style={styles.card}>
        <View style={styles.item}>
          <PressableScale
            onPress={() => bought.images.length > 0 && onOpenPhoto(0)}
            scaleTo={0.96}
            accessibilityRole="imagebutton"
            accessibilityLabel={t`Photos of ${a.service.name}`}
          >
            <Cover
              uri={bought.cover}
              categoryIcon={bought.categoryIcon}
              style={styles.itemPhoto}
              iconSize={30}
            />
            {bought.images.length > 1 && (
              <View style={styles.more}>
                <Icon name="images-outline" size={11} color="#FFFFFF" />
                <Text style={styles.moreText}>{bought.images.length}</Text>
              </View>
            )}
          </PressableScale>

          <View style={styles.flex}>
            <Text style={type.subheading} numberOfLines={2}>
              {a.service.name}
            </Text>
            <Text style={type.small} numberOfLines={1}>
              {bought.businessName}
            </Text>
            <View style={styles.tags}>
              {many && (
                <View style={styles.tag}>
                  <Text style={styles.tagText}>{many}</Text>
                </View>
              )}
              <View style={styles.tag}>
                <Text style={styles.tagText}>{duration(minutesOf(a))}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* The rest of the photos, small. One tap opens them properly. */}
        {bought.images.length > 1 && (
          <View style={styles.strip}>
            {bought.images.slice(0, 5).map((photo, index) => (
              <PressableScale key={photo.id} onPress={() => onOpenPhoto(index)} scaleTo={0.94}>
                <Image source={{ uri: photo.url }} style={styles.stripPhoto} />
              </PressableScale>
            ))}
          </View>
        )}

        <View style={styles.rule} />

        <Fact icon="calendar-outline" main={dayOf(a.startTime)} sub={timeRange(a)} />
        <Fact icon="location-outline" main={a.location.name} sub={a.location.address} />

        {/* What was picked (§300), so nobody pays for a booking they cannot see. */}
        {(a.choices?.length || a.healthChoices?.length || a.customerNote) && (
          <>
            <View style={styles.rule} />
            <BookedChoices a={a} format={format} />
          </>
        )}
      </FadeIn>

      {/* THE SUM. Every line a person would otherwise work out in their head. */}
      <FadeIn delay={60} style={styles.card}>
        <Text style={type.heading}><Trans>Payment summary</Trans></Text>

        {a.unitPriceMinor !== null && (a.quantity > 1 || a.choicesPriceMinor !== 0) && (
          <Line
            label={a.quantity > 1 ? `${a.service.name} × ${a.quantity}` : a.service.name}
            hint={a.quantity > 1 ? t`${format(a.unitPriceMinor, a.currency)} each` : undefined}
            value={format(a.unitPriceMinor * a.quantity, a.currency)}
          />
        )}
        {/* Each answer that moved the price (§300.3), once for the booking. */}
        {(a.choices ?? [])
          .filter((pick) => pick.priceMinor !== 0)
          .map((pick) => (
            <Line
              key={pick.optionId}
              label={pick.option}
              hint={pick.group}
              value={`${pick.priceMinor < 0 ? '−' : '+'}${format(Math.abs(pick.priceMinor), a.currency)}`}
            />
          ))}
        {/* The sale it was booked under (§186), said as a saving. */}
        {a.discountPercent !== null && a.listPriceMinor !== null && a.servicePriceMinor !== null && (
          <Line
            label={t`Discount · ${a.discountPercent}% off`}
            hint={t`Was ${format(a.listPriceMinor, a.currency)}`}
            value={`−${format(a.listPriceMinor - a.servicePriceMinor, a.currency)}`}
            saving
          />
        )}
        {a.servicePriceMinor !== null && (
          <Line label={t`Total`} value={format(a.servicePriceMinor, a.currency)} />
        )}
        {balance !== null && (
          <Line
            label={t`Pay at the shop`}
            hint={t`After your visit`}
            value={format(balance, a.currency)}
            muted
          />
        )}

        <View style={styles.dashed} />

        <View style={styles.due}>
          <View style={styles.flex}>
            <Text style={styles.dueLabel}><Trans>Pay now</Trans></Text>
            <Text style={type.small}>
              {a.depositPercentage !== null
                ? t`${Number(a.depositPercentage)}% deposit · confirms your time`
                : t`Deposit · confirms your time`}
            </Text>
          </View>
          <Text style={styles.dueValue}>{format(a.depositAmountMinor, a.currency)}</Text>
        </View>

        {/* Said HERE, before the money moves, not discovered on cancelling. */}
        <View style={styles.policy}>
          <Icon name="information-circle-outline" size={16} color={theme.ink2} />
          <Text style={styles.policyText}>
            <Trans>
              The deposit is not refunded if you cancel. If the shop cancels, you get all of it
              back.
            </Trans>
          </Text>
        </View>
      </FadeIn>

      {/* HOW. One method, shown as a chosen one: it says whose mobile money
          this is before a number is typed (§134.3). */}
      <FadeIn delay={120} style={styles.card}>
        <Text style={type.heading}><Trans>Pay with</Trans></Text>

        <View style={styles.method}>
          <MomoLogo size={44} />
          <View style={styles.flex}>
            <Text style={type.subheading}>{MOMO_NAME}</Text>
            <Text style={type.small}><Trans>You approve it on your own phone</Trans></Text>
          </View>
          <View style={styles.radio}>
            <View style={styles.radioDot} />
          </View>
        </View>

        {/* Saved numbers first, so the usual one is a tap rather than ten
            digits typed at the least patient moment there is (§124.2). */}
        {savedNumbers.length > 0 && (
          <View style={styles.saved}>
            {savedNumbers.map((number) => (
              <Chip
                key={number.id}
                tone="accent"
                icon="phone-portrait-outline"
                label={number.label ?? number.phoneNumber}
                active={toMsisdn(phone) === number.phoneNumber}
                onPress={() => onPhone(number.phoneNumber)}
              />
            ))}
          </View>
        )}

        <Text style={type.label}><Trans>MoMo number</Trans></Text>
        <View style={styles.field}>
          <Icon name="call-outline" size={18} color={theme.muted} />
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={onPhone}
            onFocus={onFieldFocus}
            placeholder={t`07xx xxx xxx`}
            placeholderTextColor={theme.muted}
            keyboardType="phone-pad"
            editable={stage !== 'PENDING'}
          />
          {toMsisdn(phone).length >= 9 && (
            <Icon name="checkmark-circle" size={20} color={theme.ok} />
          )}
        </View>

        {/* Said beside the number, where people decide whether to trust it
            (§278) — it used to be a card on the service page. */}
        {stage !== 'PENDING' && (
          <View style={styles.secure}>
            <Icon name="lock-closed" size={13} color={theme.ok} />
            <Text style={styles.secureText}>
              <Trans>Your PIN goes only into your phone. This app never asks for it.</Trans>
            </Text>
          </View>
        )}

        {/* Approval happens on the handset, not here. Saying so, step by step,
            stops the screen looking stuck while someone types their PIN. */}
        {stage === 'PENDING' && (
          <View style={styles.waiting}>
            <View style={styles.waitingHead}>
              <Pulse />
              <Text style={[type.subheading, styles.flex]}><Trans>Check your phone</Trans></Text>
            </View>
            <Text style={type.body}><Trans>1. A payment request appears on your phone.</Trans></Text>
            <Text style={type.body}><Trans>2. Enter your MoMo PIN to approve it.</Trans></Text>
            <Text style={type.body}><Trans>3. This screen updates on its own.</Trans></Text>
          </View>
        )}

        {/* A failure clears the reference server-side precisely so another
            attempt is possible, so this is an invitation, not an error. */}
        {stage === 'FAILED' && (
          <View style={styles.failedBox}>
            <Icon name="alert-circle-outline" size={19} color={theme.danger} />
            <View style={styles.flex}>
              <Text style={styles.failed}>
                {explainFailedDeposit(failureReason)}
              </Text>
              {/* The operator's own code, kept small. It is unreadable as copy
                  and essential on a support ticket. */}
              {failureReason && <Text style={styles.failedCode}>{failureReason}</Text>}
            </View>
          </View>
        )}
      </FadeIn>
    </>
  );
}

/** Where you are: the two steps behind you, and this one. */
function Steps() {
  const steps = [t`Service`, t`Time`, t`Payment`];
  return (
    <View style={styles.steps}>
      {steps.map((label, index) => {
        const now = index === steps.length - 1;
        return (
          <View key={label} style={styles.step}>
            {index > 0 && <View style={styles.stepLine} />}
            <View style={[styles.stepDot, now && styles.stepDotNow]}>
              {now ? (
                <Text style={styles.stepNum}>{index + 1}</Text>
              ) : (
                <Icon name="checkmark" size={12} color="#FFFFFF" />
              )}
            </View>
            <Text style={[styles.stepLabel, now && styles.stepLabelNow]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * How long the slot is still held.
 *
 * A real deadline, not a nudge: an unpaid booking is released after five
 * minutes so nobody can sit on a slot for free. Showing the clock is fairer
 * than letting the customer find out by paying for a slot that has gone.
 */
function HoldTimer({ createdAt }: { createdAt: string }) {
  const left = () => Math.max(0, new Date(createdAt).getTime() + HOLD_MS - Date.now());
  const [ms, setMs] = useState(left);

  useEffect(() => {
    const timer = setInterval(() => setMs(left()), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createdAt]);

  const total = Math.ceil(ms / 1000);
  const urgent = total <= 60;
  const clock = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;

  return (
    <View style={[styles.hold, urgent && styles.holdUrgent]}>
      <Icon name="time-outline" size={17} color={urgent ? theme.danger : theme.warn} />
      <Text style={[styles.holdText, styles.flex]}>
        {total > 0 ? t`Your slot is held for` : t`The hold has ended. Pay now if the slot is still free.`}
      </Text>
      {total > 0 && (
        <Text style={[styles.holdClock, urgent && { color: theme.danger }]}>{clock}</Text>
      )}
    </View>
  );
}

function Fact({
  icon,
  main,
  sub,
}: {
  icon: 'calendar-outline' | 'location-outline';
  main: string;
  sub: string;
}) {
  return (
    <View style={styles.fact}>
      <View style={styles.factIcon}>
        <Icon name={icon} size={17} color={theme.accent} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.factMain}>{main}</Text>
        <Text style={type.small}>{sub}</Text>
      </View>
    </View>
  );
}

function Line({
  label,
  hint,
  value,
  muted,
  saving,
}: {
  label: string;
  hint?: string;
  value: string;
  muted?: boolean;
  /** Money taken off — a sale (§186) — in green. */
  saving?: boolean;
}) {
  return (
    <View style={styles.line}>
      <View style={styles.flex}>
        <Text style={[styles.lineLabel, muted && { color: theme.ink2 }]} numberOfLines={1}>
          {label}
        </Text>
        {hint && <Text style={type.tiny}>{hint}</Text>}
      </View>
      <Text
        style={[styles.lineValue, muted && { color: theme.ink2 }, saving && { color: theme.ok }]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 18,
    gap: 13,
    ...shadow.card,
  },

  steps: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 2 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepLine: { width: 22, height: 2, borderRadius: 1, backgroundColor: theme.ok, marginHorizontal: 6 },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.ok,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotNow: { backgroundColor: theme.accent },
  stepNum: { fontFamily: font.extrabold, fontSize: 11.5, color: '#FFFFFF' },
  stepLabel: { fontFamily: font.semibold, fontSize: 12.5, color: theme.muted },
  stepLabelNow: { fontFamily: font.bold, color: theme.ink },

  hold: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: theme.warnSoft,
    borderRadius: radius.md,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  holdUrgent: { backgroundColor: theme.dangerSoft },
  holdText: { fontFamily: font.semibold, fontSize: 13, lineHeight: 18, color: theme.ink2 },
  holdClock: {
    fontFamily: font.extrabold,
    fontSize: 17,
    color: theme.warn,
    fontVariant: ['tabular-nums'],
  },

  item: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  itemPhoto: { width: 92, height: 92, borderRadius: radius.md },
  more: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(31,42,31,0.72)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  moreText: { fontFamily: font.bold, fontSize: 10.5, color: '#FFFFFF' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tag: {
    backgroundColor: theme.sunken,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagText: { fontFamily: font.bold, fontSize: 11.5, color: theme.ink2 },
  strip: { flexDirection: 'row', gap: 8 },
  stripPhoto: { width: 52, height: 52, borderRadius: 12, backgroundColor: theme.line },
  rule: { height: 1, backgroundColor: theme.line },

  fact: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  factIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  factMain: { fontFamily: font.bold, fontSize: 14, color: theme.ink, marginBottom: 1 },

  line: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lineLabel: { fontFamily: font.semibold, fontSize: 14, color: theme.ink },
  lineValue: { fontFamily: font.bold, fontSize: 14.5, color: theme.ink },
  dashed: {
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.line,
    marginVertical: 2,
  },
  due: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dueLabel: { fontFamily: font.extrabold, fontSize: 16, color: theme.ink },
  dueValue: { fontFamily: font.extrabold, fontSize: 24, color: theme.accent, letterSpacing: -0.5 },
  policy: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    padding: 11,
  },
  policyText: { flex: 1, fontFamily: font.medium, fontSize: 12.5, lineHeight: 17.5, color: theme.ink2 },

  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderColor: theme.accent,
    backgroundColor: theme.accentSoft,
    borderRadius: radius.lg,
    padding: 12,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: theme.accent },
  saved: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 54,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: theme.sunken,
    marginTop: -5,
  },
  secure: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -2 },
  secureText: { flex: 1, fontFamily: font.semibold, fontSize: 12, lineHeight: 17, color: theme.ink2 },
  input: {
    flex: 1,
    fontFamily: font.bold,
    fontSize: 16.5,
    letterSpacing: 0.4,
    color: theme.ink,
    paddingVertical: 0,
  },
  waiting: {
    backgroundColor: theme.accentSoft,
    borderRadius: radius.lg,
    padding: 14,
    gap: 4,
  },
  waitingHead: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: -8 },
  failedBox: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: theme.dangerSoft,
    borderRadius: radius.lg,
    padding: 13,
  },
  failed: { fontFamily: font.semibold, fontSize: 13, lineHeight: 19, color: theme.danger },
  failedCode: { fontFamily: font.medium, fontSize: 11, color: theme.muted, marginTop: 3 },
});
