import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMe, signOut } from '../src/api/auth';
import { tokens } from '../src/api/client';
import { theme } from '../src/theme';

const joined = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/**
 * Who you are signed in as, and the way out.
 *
 * Signing out existed in the client from the first day and was reachable from
 * nowhere (§113). On a phone that is shared — which in this market is most of
 * them — an account you cannot leave is an account somebody else is using.
 */
export default function Account() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const signedIn = Boolean(tokens.access);

  const me = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: signedIn });

  if (!signedIn) {
    return (
      <>
        <Stack.Screen options={{ title: 'Account' }} />
        <View style={styles.centre}>
          <Text style={styles.emptyTitle}>You are not signed in</Text>
          <Text style={styles.muted}>
            Signing in keeps your bookings and messages with your account, so they
            follow you to any phone.
          </Text>
          <Pressable style={styles.cta} onPress={() => router.push('/sign-in?next=/account')}>
            <Text style={styles.ctaText}>Sign in</Text>
          </Pressable>
        </View>
      </>
    );
  }

  const leave = () =>
    Alert.alert(
      'Sign out?',
      'Your bookings and messages stay with your account. You will need a new code to get back in.',
      [
        { text: 'Stay signed in', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            // Everything cached was fetched AS that person. Left in place, the
            // next person to open the app would see the last one's bookings
            // until each query happened to refetch.
            queryClient.clear();
            router.replace('/');
          },
        },
      ],
    );

  return (
    <>
      <Stack.Screen options={{ title: 'Account' }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {me.isLoading && <ActivityIndicator color={theme.accent} />}

        {me.data && (
          <View style={styles.block}>
            <Text style={styles.label}>Signed in as</Text>
            <Text style={styles.value}>{me.data.email}</Text>

            <Text style={styles.label}>The name on your reviews</Text>
            <Text style={styles.value}>{me.data.displayName ?? 'Anonymous'}</Text>
            {/* True, and worth saying: the name belongs to the account, so there
                is no separate place to change it. Writing or editing a review is
                where it is set (§31). */}
            <Text style={styles.note}>
              {me.data.displayName
                ? 'Shown on every review you leave. Change it when you write or edit one.'
                : 'Reviews you leave show as Anonymous until you give a name, which you can do when you write one.'}
            </Text>

            <Text style={styles.label}>With us since</Text>
            <Text style={styles.value}>{joined(me.data.createdAt)}</Text>
          </View>
        )}

        <Pressable style={styles.signOut} onPress={leave}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 14 },
  block: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    padding: 16,
    gap: 4,
  },
  label: { color: theme.muted, fontSize: 12, fontWeight: '600', marginTop: 10 },
  value: { color: theme.ink, fontSize: 16, fontWeight: '600' },
  note: { color: theme.muted, fontSize: 12, lineHeight: 18, marginTop: 2 },
  muted: { color: theme.muted, textAlign: 'center', lineHeight: 20 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: theme.ink },
  cta: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 13,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  signOut: {
    borderWidth: 1,
    borderColor: theme.danger,
    borderRadius: theme.radius,
    paddingVertical: 14,
    alignItems: 'center',
  },
  signOutText: { color: theme.danger, fontWeight: '700', fontSize: 15 },
});
