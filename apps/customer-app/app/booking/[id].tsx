import { useState } from 'react';
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
  getAppointment,
  getPaymentStatus,
  initiateDeposit,
} from '../../src/api/booking';
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

  const awaitingPayment = appointment.data?.status === 'PENDING_PAYMENT';

  const payment = useQuery({
    queryKey: ['payment-status', id],
    queryFn: () => getPaymentStatus(id),
    // Only while there is something to wait for. A booking that is paid or
    // cancelled has nothing more to say, and polling it forever drains a phone.
    enabled: awaitingPayment,
    refetchInterval: awaitingPayment ? 4000 : false,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['appointment', id] });
    queryClient.invalidateQueries({ queryKey: ['payment-status', id] });
  };

  const pay = useMutation({
    mutationFn: () => initiateDeposit(id, phone.trim()),
    onSuccess: refresh,
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
    return <ActivityIndicator style={styles.spinner} color={theme.accent} />;
  }
  if (!appointment.data) {
    return (
      <View style={styles.screen}>
        <Text style={styles.empty}>That booking could not be found.</Text>
      </View>
    );
  }

  const a = appointment.data;
  const paid = a.depositPaidAt !== null;

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

            <Pressable
              style={[styles.cta, (pay.isPending || phone.trim().length < 9) && styles.ctaOff]}
              disabled={pay.isPending || phone.trim().length < 9}
              onPress={() => pay.mutate()}
            >
              <Text style={styles.ctaText}>
                {pay.isPending ? 'Asking your phone…' : 'Pay with mobile money'}
              </Text>
            </Pressable>

            {/* Approval happens on the handset, not here. Saying so stops the
                screen looking stuck while someone types their PIN. */}
            {payment.data?.paymentInitiatedAt && (
              <View style={styles.waiting}>
                <ActivityIndicator color={theme.accent} />
                <Text style={styles.muted}>
                  Check your phone and approve the payment. This updates on its own.
                </Text>
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
  cancel: { padding: 14, alignItems: 'center' },
  cancelText: { color: theme.danger, fontWeight: '500' },
  empty: { color: theme.muted, textAlign: 'center', padding: 28 },
});
