import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTicket, replyToTicket } from '../../src/api/tickets';
import { TICKET_STATUS } from '../../src/ticketStatus';
import { font, radius, shadow, theme, type } from '../../src/theme';
import { EmptyState } from '../../src/ui/EmptyState';
import { Icon } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { Pill } from '../../src/ui/Pill';
import { PressableScale } from '../../src/ui/PressableScale';
import { Skeleton } from '../../src/ui/Skeleton';
import { TopBar } from '../../src/ui/TopBar';
import { requireSignIn } from '../../src/components/SignInWall';
import { showProblem } from '../../src/ui/Dialog';

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * One support request, as a conversation (§137).
 *
 * A ticket nobody can read the answer to is a suggestion box. This is where the
 * answer arrives and where the customer can say more — the same two-sided
 * bubbles as a chat, because that is what it is, with support on the left.
 *
 * Checked again every twenty seconds while open: replies come from a person,
 * minutes or hours apart, and that is often enough to feel live without
 * hammering the server.
 */
function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');

  const ticket = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => getTicket(id),
    refetchInterval: 20_000,
  });

  const send = useMutation({
    mutationFn: () => replyToTicket(id, text.trim()),
    onSuccess: () => {
      setText('');
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
    onError: (error) =>
      showProblem('Not sent', error),
  });

  if (ticket.isLoading) {
    return (
      <View style={styles.screen}>
        <TopBar title="Your request" />
        <View style={styles.list}>
          <Skeleton height={70} round={radius.lg} />
          <Skeleton height={90} round={radius.lg} />
        </View>
      </View>
    );
  }
  if (!ticket.data) {
    return (
      <View style={styles.screen}>
        <TopBar title="Your request" />
        <EmptyState icon="help-buoy-outline" title="That request could not be found." />
      </View>
    );
  }

  const t = ticket.data;
  const status = TICKET_STATUS[t.status];
  const open = t.status !== 'CLOSED';
  const canSend = text.trim().length > 0 && !send.isPending;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      // Padding on BOTH platforms (§166). Android used to resize the window
      // for the keyboard by itself, which is why this was left undefined
      // there; with edge-to-edge screens that resize no longer happens, and
      // the composer sat under the keyboard.
      behavior="padding"
    >
      <TopBar title={t.reference} subtitle={status.label} />
      <ScrollView
        style={styles.flex}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.list, { width: layout.contentWidth, alignSelf: 'center' }]}
      >
        <View style={styles.head}>
          <Text style={[type.subheading, styles.flex]}>{t.subject}</Text>
          <Pill label={status.label} tone={status.tone} />
        </View>

        {t.messages.map((message) => {
          const mine = message.authorType === 'REPORTER';
          return (
            <View key={message.id} style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                {!mine && <Text style={styles.who}>Support</Text>}
                <Text style={[styles.body, mine && styles.bodyMine]}>{message.body}</Text>
                <Text style={[styles.time, mine && styles.timeMine]}>{when(message.createdAt)}</Text>
              </View>
            </View>
          );
        })}

        {/* Before anyone has answered, say that someone will — an empty left
            side reads as "nobody is there". */}
        {t.messages.every((m) => m.authorType === 'REPORTER') && open && (
          <View style={styles.waiting}>
            <Icon name="time-outline" size={16} color={theme.ink2} />
            <Text style={[type.small, styles.flex]}>
              We have your message. A reply will appear here, and you can add more below.
            </Text>
          </View>
        )}

        {t.resolutionNote && (
          <View style={styles.resolved}>
            <Icon name="checkmark-circle" size={18} color={theme.ok} />
            <Text style={[type.body, styles.flex]}>{t.resolutionNote}</Text>
          </View>
        )}
      </ScrollView>

      {open ? (
        <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Add a message"
            placeholderTextColor={theme.muted}
            multiline
            maxLength={5000}
          />
          <PressableScale
            haptic
            scaleTo={0.9}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
            onPress={() => send.mutate()}
            style={[styles.send, !canSend && styles.sendOff]}
          >
            {send.isPending ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Icon name="arrow-up" size={21} color={canSend ? '#FFFFFF' : theme.muted} />
            )}
          </PressableScale>
        </View>
      ) : (
        <View style={[styles.closed, { paddingBottom: insets.bottom + 14 }]}>
          <Text style={type.small}>This request is closed.</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  list: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 6,
    ...shadow.card,
  },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '84%', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  mine: { backgroundColor: theme.accent, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: theme.panel, borderBottomLeftRadius: 6, ...shadow.card },
  who: { fontFamily: font.bold, fontSize: 11.5, color: theme.accent },
  body: { fontFamily: font.medium, color: theme.ink, fontSize: 15, lineHeight: 21 },
  bodyMine: { color: '#FFFFFF' },
  time: { fontFamily: font.medium, color: theme.muted, fontSize: 11, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(255,255,255,0.78)' },
  waiting: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 8,
  },
  resolved: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: theme.okSoft,
    borderRadius: radius.md,
    padding: 13,
    marginTop: 8,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: theme.panel,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    ...shadow.float,
  },
  input: {
    flex: 1,
    fontFamily: font.medium,
    backgroundColor: theme.sunken,
    borderRadius: 23,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 46,
    maxHeight: 120,
    fontSize: 15,
    color: theme.ink,
  },
  send: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { backgroundColor: theme.sunken },
  closed: { alignItems: 'center', paddingTop: 14, backgroundColor: theme.panel },
});

export default requireSignIn(TicketScreen, {
  icon: 'help-buoy-outline',
  title: 'Sign in to see this request',
  text: 'Help requests are kept with your account, so only you can open them.',
});
