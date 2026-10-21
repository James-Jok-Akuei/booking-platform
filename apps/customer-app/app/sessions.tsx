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
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { dateLocale } from '../src/i18n/format';
import { plural } from '@lingui/core/macro';

/** "an unknown device" → "An unknown device", for the start of a line. */
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const markOf = (device: string): IconName =>
  /iPhone|iPad|Android|the app/.test(device) ? 'phone-portrait-outline' : 'desktop-outline';

/** "today", "yesterday", "3 days ago", then the date. */
function when(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return t`today`;
  if (days === 1) return t`yesterday`;
  if (days < 7) return plural(days, { one: '# day ago', other: '# days ago' });
  return new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });
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
    onError: (error) => showProblem(t`Could not sign out there`, error),
  });
  const others = useMutation({
    mutationFn: endOtherSessions,
    onSuccess: refresh,
    onError: (error) => showProblem(t`Could not sign out the others`, error),
  });
  const list = sessions.data ?? [];

  const askEnd = (s: SignInSession) =>
    showDialog({
      tone: 'accent',
      icon: 'log-out',
      title: t`Sign out on ${s.device}?`,
      message: t`Whoever has it will need a new code, sent to your email, to get back in.`,
      actions: [
        { label: t`Keep it`, role: 'cancel' },
        { label: t`Sign out there`, role: 'primary', onPress: async () => void (await end.mutateAsync(s.id)) },
      ],
    });

  return (
    <View style={styles.screen}>
      <TopBar title={t`Where you are signed in`} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32, width: layout.contentWidth, alignSelf: 'center' },
        ]}
      >
        <Text style={type.body}>
          <Trans>
            Every phone and browser where your account is open. Sign out any you do not recognise.
          </Trans>
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
                          <Text style={styles.hereText}>{Platform.OS === 'web' ? t`This one` : t`This phone`}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={type.small}>
                      {s.current ? t`Now` : t`Last used ${when(s.lastUsedAt)}`}<Trans>· signed in {when(s.createdAt)}</Trans>
                    </Text>
                  </View>
                  {!s.current && (
                    <PressableScale style={styles.out} onPress={() => askEnd(s)} disabled={end.isPending}>
                      <Text style={styles.outText}><Trans>Sign out</Trans></Text>
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
            label={others.isPending ? t`Signing out…` : t`Sign out everywhere else`}
            onPress={() => others.mutate()}
          />
        )}

        <View style={styles.tips}>
          <View style={styles.tip}>
            <Icon name="mail-outline" size={16} color={theme.accent} />
            <Text style={[type.small, styles.flex]}>
              <Trans>
                A new phone or browser? We email you, and tell your other phones, each time one signs in.
              </Trans>
            </Text>
          </View>
          <View style={styles.tip}>
            <Icon name="help-buoy-outline" size={16} color={theme.accent} />
            <Text style={[type.small, styles.flex]}>
              <Trans>
                Not you? Sign it out here, then write to us from Help — we will look at it with you.
              </Trans>
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
