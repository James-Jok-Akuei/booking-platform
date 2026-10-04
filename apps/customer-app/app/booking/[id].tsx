import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  cancelAppointment,
  explainFailedDeposit,
  getAppointment,
  getPaymentStatus,
  initiateDeposit,
  resendVerificationCode,
  toMsisdn,
  type PaymentStatus,
} from '../../src/api/booking';
import { threadForAppointment } from '../../src/api/chat';
import { listSavedNumbers, saveNumber } from '../../src/api/auth';
import { ApiError } from '../../src/api/client';
import { BOOKING_STATUS } from '../../src/bookingStatus';
import { useMoney } from '../../src/money';
import { font, radius, shadow, theme, type } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Chip } from '../../src/ui/Chip';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { cheer } from '../../src/ui/haptic';
import { Icon } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { PopIn, Pulse } from '../../src/ui/Motion';
import { Pill } from '../../src/ui/Pill';
import { Skeleton } from '../../src/ui/Skeleton';
import { Stars } from '../../src/ui/Stars';
import { TopBar } from '../../src/ui/TopBar';

const whenDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'full' });
const whenTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { timeStyle: 'short' });

/**
 * One booking: pay the deposit, then show the arrival code.
 *
 * The slot is held but NOT confirmed until the deposit lands. Payment is
 * approved on the customer's own handset, off this device, so the only way to
 * know is to poll — which is why `paymentStatus` refetches while the booking
 * is still PENDING_PAYMENT and stops the moment it is not.
 *
 * Drawn as a ticket (§133): what, when and where on the stub at the top, and
 * below it whichever one thing matters now — the amount to pay, or the code to
 * read out at the counter, set large enough to read at arm's length.
 */
export default function Booking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const money = useMoney();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const [phone, setPhone] = useState('');

  const appointment = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => getAppointment(id),
  });

  // Looked up by appointment rather than paged for: with more threads than a
  // page holds, a client-side search silently opens the wrong one (§112.2).
  const thread = useQuery({
    queryKey: ['thread-for', id],
    queryFn: () => threadForAppointment(id),
    enabled: Boolean(appointment.data),
  });

  const awaitingPayment = appointment.data?.status === 'PENDING_PAYMENT';

  const payment = useQuery({
    queryKey: ['payment-status', id],
    queryFn: () => getPaymentStatus(id),
    enabled: awaitingPayment,
    // Only while the operator has something in flight. NOT_STARTED means the
    // customer has not tapped Pay yet; SUCCESSFUL and FAILED have nothing more
    // to say. Polling on `awaitingPayment` alone never stopped, because the
    // thing that ends the wait is this very query (§109.1).
    refetchInterval: ({ state }) => (state.data?.paymentStatus === 'PENDING' ? 4000 : false),
  });

  const stage = payment.data?.paymentStatus;

  /**
   * The appointment is what makes this screen say "confirmed": `depositPaidAt`
   * and the arrival code live there, not on the payment status. Nothing else
   * refetches it while polling, so the moment the operator says the money
   * landed, ask again — otherwise the customer pays and the screen keeps
   * offering the Pay button forever (§109.1).
   */
  useEffect(() => {
    if (stage === 'SUCCESSFUL' || payment.data?.appointmentStatus === 'CANCELLED') {
      if (stage === 'SUCCESSFUL') cheer();
      queryClient.invalidateQueries({ queryKey: ['appointment', id] });
    }
  }, [stage, payment.data?.appointmentStatus, id, queryClient]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['appointment', id] });
    queryClient.invalidateQueries({ queryKey: ['payment-status', id] });
  };

  const saved = useQuery({ queryKey: ['payment-numbers'], queryFn: listSavedNumbers });

  const pay = useMutation({
    mutationFn: () => initiateDeposit(id, phone),
    onSuccess: (started) => {
      // The reply already says PENDING, so seed it rather than refetching: the
      // "approve on your phone" line then appears with the handset prompt
      // instead of up to four seconds later.
      const seeded: PaymentStatus = {
        appointmentId: started.appointmentId,
        appointmentStatus: started.status,
        paymentStatus: started.paymentStatus,
        providerReferenceId: started.providerReferenceId,
      };
      queryClient.setQueryData(['payment-status', id], seeded);
      // Remember it for next time, best-effort. A payment that worked must not
      // be reported as failed because a convenience row could not be written.
      saveNumber({ phoneNumber: toMsisdn(phone) })
        .then(() => queryClient.invalidateQueries({ queryKey: ['payment-numbers'] }))
        .catch(() => undefined);
    },
    onError: (error) =>
      Alert.alert(
        'Could not start the payment',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  /**
   * The server allows one a minute and five in total. The cooldown is mirrored
   * here so the button is simply unavailable rather than offering something
   * the server answers with "a code was just sent"; the five-send limit is NOT
   * mirrored, because the count is not exposed and the server's refusal already
   * says what to do instead — ask the shop to verify you in person.
   */
  const sentAt = appointment.data?.verificationCodeSentAt;
  const resendCooling =
    sentAt !== null && sentAt !== undefined &&
    Date.now() - new Date(sentAt).getTime() < 60_000;

  const resend = useMutation({
    mutationFn: () => resendVerificationCode(id),
    onSuccess: () => {
      // The code CHANGED. Showing the old one next to "sent" would have the
      // customer read out a number that no longer verifies.
      queryClient.invalidateQueries({ queryKey: ['appointment', id] });
      Alert.alert('Sent', 'A new code is on its way to your email.');
    },
    onError: (error) =>
      Alert.alert(
        'Not sent',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  const cancel = useMutation({
    mutationFn: (reason: string) => cancelAppointment(id, reason),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['my-appointments'] });
      router.dismissTo('/');
    },
    onError: (error) =>
      Alert.alert(
        'Could not cancel',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  if (appointment.isLoading) {
    return (
      <View style={styles.screen}>
        <TopBar title="Your booking" />
        <View style={styles.content}>
          <Skeleton height={170} round={radius.xl} />
          <Skeleton height={230} round={radius.xl} />
          <Skeleton height={54} round={27} />
        </View>
      </View>
    );
  }
  if (!appointment.data) {
    return (
      <View style={styles.screen}>
        <TopBar title="Your booking" />
        <EmptyState
          icon="calendar-outline"
          title="That booking could not be found."
          text="If you have signed out, sign in again and open it from My bookings."
        />
      </View>
    );
  }

  const a = appointment.data;
  const paid = a.depositPaidAt !== null;
  const status = BOOKING_STATUS[a.status];

  // Digits only, because that is what is sent. Counting the typed string let
  // "07 88" through as four characters and "0788 123 456" through as twelve.
  const phoneLooksUsable = toMsisdn(phone).length >= 9;
  // One prompt at a time: a second tap while the first is in flight would ask
  // the operator to charge the same handset twice.
  const payBusy = pay.isPending || stage === 'PENDING';

  return (
    <View style={styles.screen}>
      <TopBar title="Your booking" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32, width: layout.contentWidth, alignSelf: 'center' },
        ]}
      >
        {/* The stub: what, when, where. */}
        <FadeIn style={styles.ticket}>
          <Pill label={status.label} tone={status.tone} dot={a.status === 'BOOKED'} />
          <Text style={[type.title, styles.ticketTitle]}>{a.service.name}</Text>

          <View style={styles.fact}>
            <View style={styles.factIcon}>
              <Icon name="calendar-outline" size={18} color={theme.accent} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.factMain}>{whenDate(a.startTime)}</Text>
              <Text style={type.small}>{whenTime(a.startTime)}</Text>
            </View>
          </View>

          <View style={styles.fact}>
            <View style={styles.factIcon}>
              <Icon name="location-outline" size={18} color={theme.accent} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.factMain}>{a.location.name}</Text>
              <Text style={type.small}>{a.location.address}</Text>
            </View>
          </View>
        </FadeIn>

        {awaitingPayment && !paid && (
          <FadeIn delay={80} style={styles.card}>
            <Text style={type.heading}>Pay the deposit to confirm</Text>
            <Text style={type.small}>
              Your slot is held, not booked, until this is paid.
            </Text>

            <View style={styles.amountBox}>
              <Text style={styles.amount}>
                {money.format(a.depositAmountMinor, a.currency)}
              </Text>
              {a.servicePriceMinor !== null && (
                <Text style={[type.small, styles.centre]}>
                  of {money.format(a.servicePriceMinor, a.currency)} — the rest at the shop
                </Text>
              )}
            </View>

            {/* Saved numbers first, so the usual one is a tap rather than ten
                digits typed at the least patient moment there is (§124.2). */}
            {(saved.data?.length ?? 0) > 0 && (
              <View style={styles.savedRow}>
                {saved.data?.map((number) => (
                  <Chip
                    key={number.id}
                    tone="accent"
                    icon="phone-portrait-outline"
                    label={number.label ?? number.phoneNumber}
                    active={toMsisdn(phone) === number.phoneNumber}
                    onPress={() => setPhone(number.phoneNumber)}
                  />
                ))}
              </View>
            )}

            <View style={styles.field}>
              <Icon name="phone-portrait-outline" size={19} color={theme.muted} />
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="07xx xxx xxx"
                placeholderTextColor={theme.muted}
                keyboardType="phone-pad"
              />
            </View>

            {/* The operator takes digits only. The field invites spaces, so they
                are stripped on the way out rather than refused here — nobody
                should be told off for typing a phone number the readable way. */}
            <Button
              disabled={payBusy || !phoneLooksUsable}
              onPress={() => pay.mutate()}
              label={
                pay.isPending
                  ? 'Asking your phone…'
                  : stage === 'PENDING'
                    ? 'Waiting for your approval…'
                    : stage === 'FAILED'
                      ? 'Try again'
                      : 'Pay with mobile money'
              }
            />

            {/* Approval happens on the handset, not here. Saying so stops the
                screen looking stuck while someone types their PIN. */}
            {stage === 'PENDING' && (
              <View style={styles.waiting}>
                <Pulse />
                <Text style={[type.body, styles.flex]}>
                  Check your phone and approve the payment. This updates on its own.
                </Text>
              </View>
            )}

            {/* A failure clears the reference server-side precisely so another
                attempt is possible, so this is an invitation, not an error. */}
            {stage === 'FAILED' && (
              <View style={styles.failedBox}>
                <Icon name="alert-circle-outline" size={19} color={theme.danger} />
                <View style={styles.flex}>
                  <Text style={styles.failed}>
                    {explainFailedDeposit(payment.data?.failureReason)} You can try again.
                  </Text>
                  {/* The operator's own code, kept small. It is unreadable as copy
                      and essential on a support ticket. */}
                  {payment.data?.failureReason && (
                    <Text style={styles.failedCode}>{payment.data.failureReason}</Text>
                  )}
                </View>
              </View>
            )}
          </FadeIn>
        )}

        {paid && (
          <FadeIn delay={80} style={styles.card}>
            <View style={styles.confirmedHead}>
              <PopIn>
                <View style={styles.tick}>
                  <Icon name="checkmark" size={26} color="#FFFFFF" />
                </View>
              </PopIn>
              <View style={styles.flex}>
                <Text style={type.heading}>Confirmed</Text>
                <Text style={type.small}>
                  Deposit of {money.format(a.depositAmountMinor, a.currency)} received.
                </Text>
              </View>
            </View>

            {/* Read out at the shop. It is in the email too, so this screen is
                a convenience rather than the only copy (§54). */}
            {a.verificationCode && (
              <View style={styles.codeBox}>
                <Text style={type.label}>Show this when you arrive</Text>
                <Text
                  style={[styles.code, layout.compact && styles.codeCompact]}
                  selectable
                  adjustsFontSizeToFit
                  numberOfLines={1}
                >
                  {a.verificationCode}
                </Text>
              </View>
            )}

            {/* Until now there was no way back to a code that had been deleted
                (§117.3). It is in the email, and an email is exactly what gets
                lost — the endpoint has existed since §53.2 with nothing calling
                it. Sending again replaces the code, so the one above changes. */}
            {a.verificationCode && (
              <>
                <Button
                  kind="outline"
                  icon="mail-outline"
                  disabled={resend.isPending || resendCooling}
                  onPress={() => resend.mutate()}
                  label={
                    resend.isPending
                      ? 'Sending…'
                      : resendCooling
                        ? 'Just sent — check your email'
                        : 'Email me this code again'
                  }
                />
                <Text style={type.small}>
                  Sending a new one replaces the number above. Check your spam
                  folder before asking for another.
                </Text>
              </>
            )}
          </FadeIn>
        )}

        {/* Every booking is created with a conversation attached (§21.1), which
            until now nothing could open. It is the right place for "running
            late" and "can I bring my son too". */}
        <FadeIn delay={140}>
          <Button
            kind="soft"
            icon="chatbubble-ellipses-outline"
            disabled={thread.isLoading}
            label={thread.isLoading ? 'Opening…' : `Message ${a.location.name}`}
            onPress={() => {
              if (thread.data) router.push(`/thread/${thread.data.id}`);
              else router.push('/messages');
            }}
          />
        </FadeIn>

        {/* The visit is over, so the useful thing on this screen is no longer the
            arrival code but what the customer thought (§111). */}
        {a.status === 'COMPLETED' && (
          <FadeIn delay={180} style={styles.card}>
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
              onPress={() => router.push(`/review/${id}`)}
            />
          </FadeIn>
        )}

        {(a.status === 'PENDING_PAYMENT' || a.status === 'BOOKED') && (
          <Button
            kind="quietDanger"
            label="Cancel this booking"
            style={styles.cancel}
            onPress={() =>
              Alert.alert(
                'Cancel this booking?',
                paid
                  ? 'Your deposit is not refunded when you cancel. That is what holds the slot.'
                  : 'Nothing has been paid, so nothing is lost.',
                [
                  { text: 'Keep it', style: 'cancel' },
                  {
                    text: 'Cancel booking',
                    style: 'destructive',
                    onPress: () => cancel.mutate('Cancelled by the customer.'),
                  },
                ],
              )
            }
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  centre: { textAlign: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 6, gap: 16 },
  ticket: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 20,
    gap: 14,
    ...shadow.card,
  },
  ticketTitle: { marginTop: -2 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  factIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  factMain: { fontFamily: font.bold, fontSize: 14.5, color: theme.ink, marginBottom: 1 },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 20,
    gap: 12,
    ...shadow.card,
  },
  amountBox: {
    backgroundColor: theme.sunken,
    borderRadius: radius.lg,
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: 'center',
    gap: 4,
  },
  amount: { fontFamily: font.extrabold, fontSize: 34, color: theme.ink, letterSpacing: -0.8 },
  savedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 54,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: theme.sunken,
  },
  input: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 16,
    color: theme.ink,
    paddingVertical: 0,
  },
  waiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.accentSoft,
    borderRadius: radius.lg,
    padding: 10,
    paddingRight: 14,
  },
  failedBox: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: theme.dangerSoft,
    borderRadius: radius.lg,
    padding: 13,
  },
  failed: { fontFamily: font.semibold, fontSize: 13, lineHeight: 19, color: theme.danger },
  failedCode: { fontFamily: font.medium, fontSize: 11, color: theme.muted, marginTop: 3 },
  confirmedHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  tick: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.ok,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBox: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: theme.line,
    backgroundColor: theme.sunken,
    borderRadius: radius.lg,
    paddingVertical: 20,
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
  cancel: { marginTop: 2 },
});
