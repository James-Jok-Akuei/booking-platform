import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelAppointment,
  explainFailedDeposit,
  getAppointment,
  getPaymentStatus,
  initiateDeposit,
  toMsisdn,
  type PaymentStatus,
} from '../../src/api/booking';
import { threadForAppointment } from '../../src/api/chat';
import { ApiError } from '../../src/api/client';
import { useMoney } from '../../src/money';
import { theme } from '../../src/theme';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });

/**
 * One booking: pay the deposit, then show the arrival code.
 *
 * The slot is held but NOT confirmed until the deposit lands. Payment is
 * approved on the customer's own handset, off this device, so the only way to
 * know is to poll — which is why `paymentStatus` refetches while the booking
 * is still PENDING_PAYMENT and stops the moment it is not.
 */
export default function Booking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const money = useMoney();
  const queryClient = useQueryClient();
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
      queryClient.invalidateQueries({ queryKey: ['appointment', id] });
    }
  }, [stage, payment.data?.appointmentStatus, id, queryClient]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['appointment', id] });
    queryClient.invalidateQueries({ queryKey: ['payment-status', id] });
  };

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
    },
    onError: (error) =>
      Alert.alert(
        'Could not start the payment',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  const cancel = useMutation({
    mutationFn: (reason: string) => cancelAppointment(id, reason),
    onSuccess: () => {
      refresh();
      router.replace('/');
    },
    onError: (error) =>
      Alert.alert(
        'Could not cancel',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  if (appointment.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Your booking' }} />
        <ActivityIndicator style={styles.spinner} color={theme.accent} />
      </>
    );
  }
  if (!appointment.data) {
    return (
      <>
        {/* Same reason as the review screen: without this the header reads
            "booking/[id]". */}
        <Stack.Screen options={{ title: 'Your booking' }} />
        <View style={styles.screen}>
          <Text style={styles.empty}>
            That booking could not be found. If you have signed out, sign in
            again and open it from My bookings.
          </Text>
        </View>
      </>
    );
  }

  const a = appointment.data;
  const paid = a.depositPaidAt !== null;

  // Digits only, because that is what is sent. Counting the typed string let
  // "07 88" through as four characters and "0788 123 456" through as twelve.
  const phoneLooksUsable = toMsisdn(phone).length >= 9;
  // One prompt at a time: a second tap while the first is in flight would ask
  // the operator to charge the same handset twice.
  const payBusy = pay.isPending || stage === 'PENDING';

  return (
    <>
      <Stack.Screen options={{ title: 'Your booking' }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.block}>
          <Text style={styles.title}>{a.service.name}</Text>
          <Text style={styles.when}>{when(a.startTime)}</Text>
          <Text style={styles.muted}>
            {a.location.name} · {a.location.address}
          </Text>
        </View>

        {awaitingPayment && !paid && (
          <View style={styles.block}>
            <Text style={styles.heading}>Pay the deposit to confirm</Text>
            <Text style={styles.muted}>
              Your slot is held, not booked, until this is paid.
            </Text>

            <View style={styles.amountRow}>
              <Text style={styles.amount}>
                {money.format(a.depositAmountMinor, a.currency)}
              </Text>
              {a.servicePriceMinor !== null && (
                <Text style={styles.muted}>
                  of {money.format(a.servicePriceMinor, a.currency)} — the rest at the shop
                </Text>
              )}
            </View>

            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="07xx xxx xxx"
              placeholderTextColor={theme.muted}
              keyboardType="phone-pad"
            />

            {/* The operator takes digits only. The field invites spaces, so they
                are stripped on the way out rather than refused here — nobody
                should be told off for typing a phone number the readable way. */}
            <Pressable
              style={[styles.cta, (payBusy || !phoneLooksUsable) && styles.ctaOff]}
              disabled={payBusy || !phoneLooksUsable}
              onPress={() => pay.mutate()}
            >
              <Text style={styles.ctaText}>
                {pay.isPending
                  ? 'Asking your phone…'
                  : stage === 'PENDING'
                    ? 'Waiting for your approval…'
                    : stage === 'FAILED'
                      ? 'Try again'
                      : 'Pay with mobile money'}
              </Text>
            </Pressable>

            {/* Approval happens on the handset, not here. Saying so stops the
                screen looking stuck while someone types their PIN. */}
            {stage === 'PENDING' && (
              <View style={styles.waiting}>
                <ActivityIndicator color={theme.accent} />
                <Text style={styles.muted}>
                  Check your phone and approve the payment. This updates on its own.
                </Text>
              </View>
            )}

            {/* A failure clears the reference server-side precisely so another
                attempt is possible, so this is an invitation, not an error. */}
            {stage === 'FAILED' && (
              <View style={styles.failedBox}>
                <Text style={styles.failed}>
                  {explainFailedDeposit(payment.data?.failureReason)} You can try again.
                </Text>
                {/* The operator's own code, kept small. It is unreadable as copy
                    and essential on a support ticket. */}
                {payment.data?.failureReason && (
                  <Text style={styles.failedCode}>{payment.data.failureReason}</Text>
                )}
              </View>
            )}
          </View>
        )}

        {paid && (
          <View style={styles.block}>
            <Text style={styles.heading}>Confirmed</Text>
            <Text style={styles.muted}>
              Deposit of {money.format(a.depositAmountMinor, a.currency)} received.
            </Text>

            {/* Read out at the shop. It is in the email too, so this screen is
                a convenience rather than the only copy (§54). */}
            {a.verificationCode && (
              <View style={styles.codeBox}>
                <Text style={styles.codeLabel}>Show this when you arrive</Text>
                <Text style={styles.code}>{a.verificationCode}</Text>
              </View>
            )}
          </View>
        )}

        {/* Every booking is created with a conversation attached (§21.1), which
            until now nothing could open. It is the right place for "running
            late" and "can I bring my son too". */}
        <Pressable
          style={styles.secondary}
          disabled={thread.isLoading}
          onPress={() => {
            if (thread.data) router.push(`/thread/${thread.data.id}`);
            else router.push('/messages');
          }}
        >
          <Text style={styles.secondaryText}>
            {thread.isLoading ? 'Opening…' : `Message ${a.location.name}`}
          </Text>
        </Pressable>

        {/* The visit is over, so the useful thing on this screen is no longer the
            arrival code but what the customer thought (§111). */}
        {a.status === 'COMPLETED' && (
          <View style={styles.block}>
            <Text style={styles.heading}>
              {a.review ? 'Your review' : 'How was it?'}
            </Text>
            {a.review ? (
              <>
                <Text style={styles.stars}>
                  {'★'.repeat(a.review.rating)}
                  <Text style={styles.starsOff}>{'★'.repeat(5 - a.review.rating)}</Text>
                </Text>
                {a.review.comment && <Text style={styles.muted}>{a.review.comment}</Text>}
              </>
            ) : (
              <Text style={styles.muted}>
                A few words help the next person decide. It takes a moment.
              </Text>
            )}
            <Pressable
              style={styles.secondary}
              onPress={() => router.push(`/review/${id}`)}
            >
              <Text style={styles.secondaryText}>
                {a.review ? 'See or change it' : 'Write a review'}
              </Text>
            </Pressable>
          </View>
        )}

        {(a.status === 'PENDING_PAYMENT' || a.status === 'BOOKED') && (
          <Pressable
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
          >
            <Text style={styles.cancelText}>Cancel this booking</Text>
          </Pressable>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 12 },
  spinner: { marginTop: 40 },
  block: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    padding: 16,
    gap: 7,
  },
  title: { fontSize: 19, fontWeight: '700', color: theme.ink },
  when: { fontSize: 15, color: theme.ink, fontWeight: '500' },
  muted: { color: theme.muted, fontSize: 13, lineHeight: 19 },
  heading: { fontWeight: '700', color: theme.ink, fontSize: 16 },
  amountRow: { gap: 2, marginVertical: 4 },
  amount: { fontSize: 26, fontWeight: '700', color: theme.ink },
  input: {
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: theme.ink,
  },
  cta: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaOff: { backgroundColor: theme.line },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 6 },
  codeBox: {
    backgroundColor: theme.bg,
    borderRadius: theme.radius,
    padding: 16,
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  codeLabel: { color: theme.muted, fontSize: 13 },
  code: { fontSize: 34, fontWeight: '700', letterSpacing: 7, color: theme.ink },
  stars: { fontSize: 22, color: '#f0a202', letterSpacing: 2 },
  starsOff: { color: theme.line },
  secondary: {
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  secondaryText: { color: theme.accent, fontWeight: '700', fontSize: 15 },
  cancel: { padding: 14, alignItems: 'center' },
  failedBox: { gap: 3, marginTop: 4 },
  failed: { color: theme.danger, fontSize: 13, lineHeight: 19 },
  failedCode: { color: theme.muted, fontSize: 11 },
  cancelText: { color: theme.danger, fontWeight: '500' },
  empty: { color: theme.muted, textAlign: 'center', padding: 28 },
});
