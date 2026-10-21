import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardScroll } from '../../src/useKeyboardScroll';
import {
  cancelAppointment,
  changeChoices,
  explainFailedDeposit,
  getAppointment,
  getPaymentStatus,
  initiateDeposit,
  resendVerificationCode,
  toMsisdn,
  type PaymentStatus,
} from '../../src/api/booking';
import { threadForAppointment } from '../../src/api/chat';
import { getRoute, getShop } from '../../src/api/discovery';
import { routeLabel } from '../../src/routeLabel';
import { useNearMe } from '../../src/useNearMe';
import { listSavedNumbers, saveNumber } from '../../src/api/auth';
import { Checkout } from '../../src/booking/Checkout';
import { ChangeChoicesSheet } from '../../src/booking/BookedChoices';
import { isWish } from '../../src/booking/choices';
import type { Bought } from '../../src/booking/format';
import { PaidCelebration } from '../../src/booking/PaidCelebration';
import { Reservation } from '../../src/booking/Reservation';
import { useMoney } from '../../src/money';
import { font, radius, shadow, theme, type } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { EmptyState } from '../../src/ui/EmptyState';
import { cheer } from '../../src/ui/haptic';
import { Icon } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { PhotoViewer } from '../../src/ui/PhotoViewer';
import { Skeleton } from '../../src/ui/Skeleton';
import { TopBar } from '../../src/ui/TopBar';
import { requireSignIn } from '../../src/components/SignInWall';
import { showDialog, showProblem } from '../../src/ui/Dialog';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

/**
 * One booking: pay the deposit, then show the arrival code.
 *
 * The slot is held but NOT confirmed until the deposit lands. Payment is
 * approved on the customer's own handset, off this device, so the only way to
 * know is to poll — which is why `paymentStatus` refetches while the booking
 * is still PENDING_PAYMENT and stops the moment it is not.
 *
 * One route, three faces (§137), because they are three moments of the same
 * booking and every link to a booking should land on whichever is true now:
 *
 *   - not paid      → `Checkout`, a payment screen and nothing else
 *   - just paid     → `PaidCelebration`, once, when the money is seen to land
 *   - everything else → `Reservation`, the page you come back to
 *
 * This file holds the data and the actions; the faces only draw.
 */
function Booking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const money = useMoney();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  // Keeps the field being typed into above the keyboard (§168).
  const keys = useKeyboardScroll();
  const layout = useLayout();
  const [phone, setPhone] = useState('');
  /** True from the moment the payment is SEEN to succeed until it is dismissed. */
  const [celebrating, setCelebrating] = useState(false);
  const [photo, setPhoto] = useState<number | null>(null);
  // Changing wishes after booking (§300.7).
  const [changing, setChanging] = useState(false);
  const changeWishes = useMutation({
    mutationFn: (input: { optionIds: string[]; note: string | null }) => changeChoices(id, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(['appointment', id], updated);
      setChanging(false);
    },
    onError: (error) => showProblem(t`Could not change that`, error),
  });

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

  // What is being bought, to look at (§137). Read from the shop, because the
  // appointment carries the service's name and no picture. Allowed to fail: a
  // shop that has closed since answers 404, and the booking is still shown.
  const locationId = appointment.data?.location.id;
  const shop = useQuery({
    queryKey: ['shop', locationId],
    queryFn: () => getShop(locationId!),
    enabled: Boolean(locationId),
    retry: false,
  });

  // How far, by road, and how long by car (§157) — for the reservation, where
  // "can I make it by 11?" is the question. Only with a position already
  // allowed; this screen never asks.
  const nearMe = useNearMe();
  const position = nearMe.state.status === 'on' ? nearMe.state : null;
  const route = useQuery({
    queryKey: ['route', locationId, position?.lat.toFixed(3), position?.lng.toFixed(3)],
    queryFn: () => getRoute(locationId!, { lat: position!.lat, lng: position!.lng }),
    enabled: Boolean(locationId) && position !== null,
    staleTime: 10 * 60_000,
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
      if (stage === 'SUCCESSFUL') {
        cheer();
        setCelebrating(true);
      }
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
      showProblem(t`Could not start the payment`, error),
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
      showDialog({
        tone: 'ok',
        icon: 'mail',
        title: t`Sent`,
        message: t`A new code is on its way to your email.`,
      });
    },
    onError: (error) =>
      showProblem(t`Not sent`, error),
  });

  const cancel = useMutation({
    mutationFn: (reason: string) => cancelAppointment(id, reason),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['my-appointments'] });
      router.dismissTo('/');
    },
    onError: (error) =>
      showProblem(t`Could not cancel`, error),
  });

  if (appointment.isLoading) {
    return (
      <View style={styles.screen}>
        <TopBar title={t`Your booking`} />
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
        <TopBar title={t`Your booking`} />
        <EmptyState
          icon="calendar-outline"
          title={t`That booking could not be found.`}
          text={t`If you have signed out, sign in again and open it from My bookings.`}
        />
      </View>
    );
  }

  const a = appointment.data;
  const paid = a.depositPaidAt !== null;

  const listed = shop.data?.services.find((s) => s.id === a.service.id);
  // Wishes and the note can change until 2 hours before (§300.7) — the
  // service's wish questions as it asks them now.
  const wishes = (listed?.choiceGroups ?? []).filter(isWish);
  const canChangeWishes =
    (a.status === 'BOOKED' || a.status === 'PENDING_PAYMENT') &&
    new Date(a.startTime).getTime() - Date.now() >= 2 * 60 * 60 * 1000 &&
    (wishes.length > 0 || Boolean(listed?.noteEnabled));
  const bought: Bought = {
    images: listed?.images ?? [],
    cover: listed?.images[0]?.url ?? shop.data?.business.coverImageUrl ?? null,
    categoryIcon: shop.data?.business.category?.icon ?? null,
    logoUrl: shop.data?.business.logoUrl ?? null,
    businessName: shop.data?.business.name ?? a.location.name,
    latitude: shop.data?.latitude ?? null,
    longitude: shop.data?.longitude ?? null,
  };

  // Digits only, because that is what is sent. Counting the typed string let
  // "07 88" through as four characters and "0788 123 456" through as twelve.
  const phoneLooksUsable = toMsisdn(phone).length >= 9;
  // One prompt at a time: a second tap while the first is in flight would ask
  // the operator to charge the same handset twice.
  const payBusy = pay.isPending || stage === 'PENDING';

  const explore = () => router.dismissTo('/');

  const askToCancel = () =>
    showDialog({
      tone: 'danger',
      icon: 'close',
      title: t`Cancel this booking?`,
      message: paid
        ? t`Your deposit is not refunded when you cancel. That is what holds the slot.`
        : t`Nothing has been paid, so nothing is lost.`,
      actions: [
        { label: t`Keep it`, role: 'cancel' },
        {
          label: t`Cancel booking`,
          role: 'primary',
          onPress: () => cancel.mutate('Cancelled by the customer.'),
        },
      ],
    });

  /**
   * Hands the place to the phone's own maps app, which is where people already
   * have their routes, their traffic and their way of getting about. The pin
   * when the shop has one; its written address when it does not.
   */
  const directions = () => {
    const pin =
      bought.latitude !== null && bought.longitude !== null
        ? `${bought.latitude},${bought.longitude}`
        : null;
    const label = encodeURIComponent(`${a.location.name}, ${a.location.address}`);
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?daddr=${pin ?? label}`
        : `https://www.google.com/maps/dir/?api=1&destination=${pin ?? label}`;
    Linking.openURL(url).catch(() =>
      showDialog({
        tone: 'warn',
        icon: 'map',
        title: t`Could not open maps`,
        message: `${a.location.name}\n${a.location.address}`,
      }),
    );
  };

  const viewer = (
    <PhotoViewer photos={bought.images} openAt={photo} onClose={() => setPhoto(null)} />
  );

  // ---- just paid ----
  if (celebrating) {
    return (
      <PaidCelebration
        a={a}
        bought={bought}
        format={money.format}
        onView={() => setCelebrating(false)}
        onExplore={explore}
      />
    );
  }

  // ---- not paid: a checkout ----
  if (awaitingPayment && !paid) {
    return (
      <KeyboardAvoidingView style={styles.screen} behavior="padding">
        <TopBar title={t`Checkout`} />
        {viewer}
        <ScrollView
          ref={keys.ref}
          onScroll={keys.track}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            { paddingBottom: 24, width: layout.contentWidth, alignSelf: 'center' },
          ]}
        >
          <Checkout
            a={a}
            bought={bought}
            format={money.format}
            phone={phone}
            onPhone={setPhone}
            savedNumbers={saved.data ?? []}
            stage={stage}
            failureReason={payment.data?.failureReason}
            onOpenPhoto={setPhoto}
            onFieldFocus={keys.reveal}
          />
          <Button kind="quietDanger" label={t`Cancel this booking`} onPress={askToCancel} />
        </ScrollView>

        {/* The amount and the button, fixed where the thumb is. The total is
            repeated beside the button on purpose: it is the last thing read
            before the tap, and it should be the number being agreed to. */}
        <View style={[styles.payBar, { paddingBottom: insets.bottom + 12 }]}>
          <View style={[styles.payInner, { width: Math.min(layout.contentWidth, 560) }]}>
            <View style={styles.payRow}>
              <View>
                <Text style={type.small}><Trans>Pay now</Trans></Text>
                <Text style={styles.payAmount}>
                  {money.format(a.depositAmountMinor, a.currency)}
                </Text>
              </View>
              <View style={styles.flex}>
                {/* The operator takes digits only. The field invites spaces, so
                    they are stripped on the way out rather than refused. */}
                <Button
                  icon={payBusy ? undefined : 'lock-closed'}
                  disabled={payBusy || !phoneLooksUsable}
                  onPress={() => pay.mutate()}
                  label={
                    pay.isPending
                      ? t`Asking your phone…`
                      : stage === 'PENDING'
                        ? t`Waiting for approval…`
                        : stage === 'FAILED'
                          ? t`Try again`
                          : t({ message: 'Pay now', context: 'button: pay the deposit' })
                  }
                />
              </View>
            </View>
            <View style={styles.secure}>
              <Icon name="shield-checkmark-outline" size={13} color={theme.muted} />
              <Text style={type.tiny}>
                {phoneLooksUsable
                  ? t`You approve the payment with your MoMo PIN, on your phone.`
                  : t`Enter your MoMo number above to pay.`}
              </Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ---- the reservation ----
  return (
    <View style={styles.screen}>
      <TopBar title={t`Reservation`} />
      {viewer}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32, width: layout.contentWidth, alignSelf: 'center' },
        ]}
      >
        <Reservation
          a={a}
          bought={bought}
          format={money.format}
          onOpenPhoto={setPhoto}
          onShop={() => router.push(`/shop/${a.location.id}`)}
          way={routeLabel(route.data)}
          // Every booking is created with a conversation attached (§21.1). It
          // is the right place for "running late" and "can I bring my son too".
          messageBusy={thread.isLoading}
          onMessage={() => {
            if (thread.data) router.push(`/thread/${thread.data.id}`);
            else router.push('/messages');
          }}
          onDirections={directions}
          onHelp={() => router.push(`/help/${id}`)}
          onCancel={askToCancel}
          onReview={() => router.push(`/review/${id}`)}
          // Sending again replaces the code, so the one shown changes (§117.3).
          onResend={() => resend.mutate()}
          resendOff={resend.isPending || resendCooling}
          resendLabel={
            resend.isPending
              ? t`Sending…`
              : resendCooling
                ? t`Just sent — check your email`
                : t`Email me this code again`
          }
          onExplore={explore}
          onChangeChoices={canChangeWishes ? () => setChanging(true) : undefined}
        />
      </ScrollView>
      {listed && changing && (
        <ChangeChoicesSheet
          open={changing}
          onClose={() => setChanging(false)}
          a={a}
          wishes={wishes}
          noteEnabled={listed.noteEnabled}
          notePrompt={listed.notePrompt}
          busy={changeWishes.isPending}
          onSave={(input) => changeWishes.mutate(input)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 6, gap: 16 },
  payBar: {
    backgroundColor: theme.panel,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    ...shadow.float,
  },
  payInner: { maxWidth: '100%', gap: 8 },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  payAmount: { fontFamily: font.extrabold, fontSize: 21, color: theme.ink, letterSpacing: -0.4 },
  secure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
});

export default requireSignIn(Booking, {
  icon: 'calendar-outline',
  get title() { return t`Sign in to see this booking`; },
  get text() { return t`Bookings are kept with your account, so only you can open them.`; },
});
