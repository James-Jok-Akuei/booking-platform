import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardScroll } from '../../src/useKeyboardScroll';
import { createTicket, listTickets, type TicketCategory } from '../../src/api/tickets';
import { reservationNo } from '../../src/booking/format';
import { TICKET_STATUS } from '../../src/ticketStatus';
import { font, radius, shadow, theme, type } from '../../src/theme';
import { Button } from '../../src/ui/Button';
import { Chip } from '../../src/ui/Chip';
import { FadeIn } from '../../src/ui/FadeIn';
import { Icon } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { Pill } from '../../src/ui/Pill';
import { PressableScale } from '../../src/ui/PressableScale';
import { TopBar } from '../../src/ui/TopBar';
import { requireSignIn } from '../../src/components/SignInWall';
import { showProblem } from '../../src/ui/Dialog';

/** The three things a customer with a booking actually needs help with. */
const ABOUT: Array<{ value: TicketCategory; label: string; subject: string }> = [
  { value: 'PAYMENT_ISSUE', label: 'A payment', subject: 'Problem with a payment' },
  { value: 'APPOINTMENT_DISPUTE', label: 'This booking', subject: 'Problem with my booking' },
  { value: 'OTHER', label: 'Something else', subject: 'I need help' },
];

/**
 * Help with one booking (§137).
 *
 * Writes a support ticket tied to the booking, so whoever answers already has
 * the times and the payment in front of them and the customer is not asked to
 * type out what the app knows. The platform's support team reads these — not
 * the shop, which is what the Message button is for; the line under the title
 * says so, because the two are easy to confuse and go to different people.
 *
 * Requests already made about this booking are listed underneath, so a second
 * visit continues a conversation instead of starting another.
 */
function Help() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Keeps the field being typed into above the keyboard (§168).
  const keys = useKeyboardScroll();
  const layout = useLayout();
  const queryClient = useQueryClient();
  const [about, setAbout] = useState(ABOUT[1]);
  const [body, setBody] = useState('');

  const tickets = useQuery({ queryKey: ['tickets'], queryFn: listTickets });
  const mine = (tickets.data?.tickets ?? []).filter((t) => t.appointmentId === id);

  const send = useMutation({
    mutationFn: () =>
      createTicket({
        category: about.value,
        subject: `${about.subject} (${reservationNo(id)})`,
        body: body.trim(),
        appointmentId: id,
      }),
    onSuccess: (ticket) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      setBody('');
      router.push(`/ticket/${ticket.id}`);
    },
    onError: (error) =>
      showProblem('Not sent', error),
  });

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      // Padding on BOTH platforms (§166). Android used to resize the window
      // for the keyboard by itself, which is why this was left undefined
      // there; with edge-to-edge screens that resize no longer happens, and
      // the composer sat under the keyboard.
      behavior="padding"
    >
      <TopBar title="Get help" subtitle={`Reservation ${reservationNo(id)}`} />
      <ScrollView
        ref={keys.ref}
        onScroll={keys.track}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28, width: layout.contentWidth, alignSelf: 'center' },
        ]}
      >
        <FadeIn style={styles.card}>
          <Text style={type.heading}>What is it about?</Text>
          <View style={styles.chips}>
            {ABOUT.map((option) => (
              <Chip
                key={option.value}
                tone="accent"
                label={option.label}
                active={about.value === option.value}
                onPress={() => setAbout(option)}
              />
            ))}
          </View>

          <Text style={type.label}>Tell us what happened</Text>
          <TextInput
            onFocus={keys.reveal}
            style={styles.input}
            value={body}
            onChangeText={setBody}
            placeholder="The more you tell us, the faster we can sort it out."
            placeholderTextColor={theme.muted}
            multiline
            maxLength={5000}
            textAlignVertical="top"
          />

          <Button
            icon="send"
            busy={send.isPending}
            disabled={body.trim().length < 3}
            label={send.isPending ? 'Sending…' : 'Send to support'}
            onPress={() => send.mutate()}
          />
          <View style={styles.note}>
            <Icon name="information-circle-outline" size={16} color={theme.ink2} />
            <Text style={styles.noteText}>
              This goes to our support team, with your booking attached. To reach the shop
              itself, use Message on the reservation.
            </Text>
          </View>
        </FadeIn>

        {mine.length > 0 && (
          <FadeIn delay={80} style={styles.group}>
            <Text style={type.heading}>Your requests about this booking</Text>
            {mine.map((ticket) => {
              const status = TICKET_STATUS[ticket.status];
              return (
                <PressableScale
                  key={ticket.id}
                  haptic
                  onPress={() => router.push(`/ticket/${ticket.id}`)}
                  accessibilityRole="button"
                  style={styles.ticket}
                >
                  <View style={styles.flex}>
                    <Text style={type.subheading} numberOfLines={1}>
                      {ticket.subject}
                    </Text>
                    <Text style={type.small}>{ticket.reference}</Text>
                  </View>
                  <Pill label={status.label} tone={status.tone} />
                  <Icon name="chevron-forward" size={16} color={theme.muted} />
                </PressableScale>
              );
            })}
          </FadeIn>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 6, gap: 18 },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 18,
    gap: 13,
    ...shadow.card,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    minHeight: 130,
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    padding: 14,
    fontFamily: font.medium,
    fontSize: 15,
    lineHeight: 21,
    color: theme.ink,
    marginTop: -5,
  },
  note: { flexDirection: 'row', gap: 8 },
  noteText: { flex: 1, fontFamily: font.medium, fontSize: 12.5, lineHeight: 17.5, color: theme.ink2 },
  group: { gap: 10 },
  ticket: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 14,
    ...shadow.card,
  },
});

export default requireSignIn(Help, {
  icon: 'help-buoy-outline',
  title: 'Sign in to get help',
  text: 'Help is tied to your booking, so we need to know it is you.',
});
