import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { endOtherSessions, endSignIn, listSessions, type SignInSession } from '../src/api/auth';
import { useSignedIn } from '../src/api/client';
import { font, radius, shadow, theme, type } from '../src/theme';
import { Button } from '../src/ui/Button';
import { showDialog, showProblem } from '../src/ui/Dialog';
import { FadeIn } from '../src/ui/FadeIn';
import { Icon, type IconName } from '../src/ui/Icon';
import { useLayout } from '../src/ui/layout';
import { PressableScale } from '../src/ui/PressableScale';
import { RowSkeleton } from '../src/ui/Skeleton';
import { TopBar } from '../src/ui/TopBar';

/** "an unknown device" → "An unknown device", for the start of a line. */
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const markOf = (device: string): IconName =>
  /iPhone|iPad|Android|the app/.test(device) ? 'phone-portrait-outline' : 'desktop-outline';

/** "today", "yesterday", "3 days ago", then the date. */
function when(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * Where you are signed in (§298): every phone and browser with your account
 * open, this one marked. A phone lost, or a friend's computer you used once —
 * sign it out from here. A new one signing in is told to you, and its notice
 * opens this screen.
 */
export default function SessionsScreen() {
  const signedIn = useSignedIn();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: listSessions, enabled: signedIn });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['sessions'] });
  const end = useMutation({
    mutationFn: endSignIn,
    onSuccess: refresh,
    onError: (error) => showProblem('Could not sign out there', error),
  });
  const others = useMutation({
    mutationFn: endOtherSessions,
    onSuccess: refresh,
    onError: (error) => showProblem('Could not sign out the others', error),
  });
  const list = sessions.data ?? [];

  const askEnd = (s: SignInSession) =>
    showDialog({
      tone: 'accent',
      icon: 'log-out',
      title: `Sign out on ${s.device}?`,
      message: 'Whoever has it will need a new code, sent to your email, to get back in.',
      actions: [
        { label: 'Keep it', role: 'cancel' },
        { label: 'Sign out there', role: 'primary', onPress: async () => void (await end.mutateAsync(s.id)) },
      ],
    });

  return (
    <View style={styles.screen}>
      <TopBar title="Where you are signed in" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32, width: layout.contentWidth, alignSelf: 'center' },
        ]}
      >
        <Text style={type.body}>
          Every phone and browser where your account is open. Sign out any you do not recognise.
        </Text>

        <FadeIn style={styles.card}>
          {sessions.isLoading ? (
            <>
              <RowSkeleton />
              <RowSkeleton />
            </>
          ) : (
            list.map((s, i) => (
              <View key={s.id}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.row}>
                  <View style={[styles.mark, s.current && styles.markHere]}>
                    <Icon name={markOf(s.device)} size={19} color={s.current ? theme.ok : theme.ink2} />
                  </View>
                  <View style={styles.flex}>
                    <View style={styles.titleRow}>
                      <Text style={styles.device} numberOfLines={1}>
                        {capital(s.device)}
                      </Text>
                      {s.current && (
                        <View style={styles.here}>
                          <Text style={styles.hereText}>{Platform.OS === 'web' ? 'This one' : 'This phone'}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={type.small}>
                      {s.current ? 'Now' : `Last used ${when(s.lastUsedAt)}`} · signed in {when(s.createdAt)}
                    </Text>
                  </View>
                  {!s.current && (
                    <PressableScale style={styles.out} onPress={() => askEnd(s)} disabled={end.isPending}>
                      <Text style={styles.outText}>Sign out</Text>
                    </PressableScale>
                  )}
                </View>
              </View>
            ))
          )}
        </FadeIn>

        {list.some((s) => !s.current) && (
          <Button
            kind="quietDanger"
            icon="log-out-outline"
            label={others.isPending ? 'Signing out…' : 'Sign out everywhere else'}
            onPress={() => others.mutate()}
          />
        )}

        <View style={styles.tips}>
          <View style={styles.tip}>
            <Icon name="mail-outline" size={16} color={theme.accent} />
            <Text style={[type.small, styles.flex]}>
              A new phone or browser? We email you, and tell your other phones, each time one signs in.
            </Text>
          </View>
          <View style={styles.tip}>
            <Icon name="help-buoy-outline" size={16} color={theme.accent} />
            <Text style={[type.small, styles.flex]}>
              Not you? Sign it out here, then write to us from Help — we will look at it with you.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { paddingHorizontal: 20, paddingTop: 6, gap: 16 },
  flex: { flex: 1 },
  card: { backgroundColor: theme.panel, borderRadius: radius.xl, padding: 8, ...shadow.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line, marginHorizontal: 10 },
  mark: { width: 40, height: 40, borderRadius: 13, backgroundColor: theme.sunken, alignItems: 'center', justifyContent: 'center' },
  markHere: { backgroundColor: theme.okSoft },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  device: { fontFamily: font.bold, fontSize: 15, color: theme.ink, flexShrink: 1 },
  here: { backgroundColor: theme.okSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  hereText: { fontFamily: font.bold, fontSize: 11.5, color: theme.ok },
  out: { borderRadius: 999, borderWidth: 1, borderColor: theme.line, paddingHorizontal: 12, paddingVertical: 7 },
  outText: { fontFamily: font.bold, fontSize: 13, color: theme.ink },
  tips: { gap: 10, paddingHorizontal: 4 },
  tip: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
});
