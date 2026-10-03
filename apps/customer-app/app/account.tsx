import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  TextInput,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
/**
 * The LEGACY entry point, deliberately.
 *
 * expo-file-system 57 replaced `cacheDirectory` + `writeAsStringAsync` with
 * `File`/`Paths` classes, and that class API does not expose a text write in its
 * published typings. The legacy module is a supported export of the same
 * package, documented, and does exactly one thing here. Guessing at an API from
 * memory is the mistake this app's AGENTS.md opens by warning about (§102.3).
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  closeMyAccount,
  exportMyData,
  getMe,
  listSavedNumbers,
  removeMyImage,
  removeSavedNumber,
  saveNumber,
  setMyImage,
  signOut,
} from '../src/api/auth';
import { pickImage } from '../src/pickImage';
import { ApiError, tokens } from '../src/api/client';
import { shareApp } from '../src/share';
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

  /**
   * A copy of everything, written to a file and handed to the share sheet
   * (§119.2) — which is the only way anything leaves a phone. Shown as JSON
   * because it is complete and nothing is quietly left out of it.
   */
  /** The picture (§124.1). Uploaded, not linked. */
  const picture = useMutation({
    mutationFn: async () => {
      // Converted to JPEG on the way out. An iPhone hands over HEIC, which the
      // server refuses and no browser can render (§125).
      const picked = await pickImage({ square: true });
      return picked ? setMyImage(picked) : null;
    },
    onSuccess: (result) => {
      // `null` means they backed out of the picker. Saying nothing at all was
      // indistinguishable from a failed upload (§125.5) — the screen simply sat
      // there, which is how a working feature came to look broken.
      if (!result) return;
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (error) =>
      Alert.alert(
        'Could not add that',
        error instanceof ApiError ? error.message : (error as Error).message,
      ),
  });

  const clearPicture = useMutation({
    mutationFn: removeMyImage,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  });

  // ---- Numbers they pay from (§124.2) ----
  const [newNumber, setNewNumber] = useState('');
  const numbers = useQuery({
    queryKey: ['payment-numbers'],
    queryFn: listSavedNumbers,
    enabled: signedIn,
  });
  const refreshNumbers = () =>
    queryClient.invalidateQueries({ queryKey: ['payment-numbers'] });

  const addNumber = useMutation({
    mutationFn: () => saveNumber({ phoneNumber: newNumber.replace(/\D/g, '') }),
    onSuccess: () => {
      setNewNumber('');
      refreshNumbers();
    },
    onError: (error) =>
      Alert.alert(
        'Not saved',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  const dropNumber = useMutation({ mutationFn: removeSavedNumber, onSuccess: refreshNumbers });

  const exportData = useMutation({
    mutationFn: exportMyData,
    onSuccess: async (data) => {
      const path = `${FileSystem.cacheDirectory}my-data.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(data, null, 2));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: 'application/json',
          dialogTitle: 'Your data',
        });
      } else {
        Alert.alert(
          'Saved',
          `Your data is in ${path}. This device cannot open a share sheet.`,
        );
      }
    },
    onError: (error) =>
      Alert.alert(
        'Could not prepare that',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  /**
   * Closing is final and is NOT a delete, and the dialogue says both.
   *
   * The server refuses while a booking is still to come, and for the only owner
   * of a business — each with a sentence saying what to do first, which is shown
   * as-is rather than replaced with "something went wrong".
   */
  const close = useMutation({
    mutationFn: closeMyAccount,
    onSuccess: async (result) => {
      await signOut();
      queryClient.clear();
      router.replace('/');
      Alert.alert('Account closed', result.message);
    },
    onError: (error) =>
      Alert.alert(
        'Not closed',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  const confirmClose = () =>
    Alert.alert(
      'Close your account?',
      'This cannot be undone.\n\nYour bookings and reviews stay with the shops ' +
        'they belong to, with your name taken off them — a shop still has its ' +
        'record of what it did and was paid for.\n\nYour email is released, so ' +
        'you can sign up again later, but it would be a new account with none of ' +
        'this.\n\nTake a copy of your data first if you want one.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Close it',
          style: 'destructive',
          onPress: () => close.mutate(),
        },
      ],
    );

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
            {/* Shown to them and to nobody else (§124.1). A shop needs a name to
                call out and an arrival code, not a face. */}
            <View style={styles.pictureRow}>
              {me.data.imageUrl ? (
                <Image source={{ uri: me.data.imageUrl }} style={styles.picture} />
              ) : (
                <View style={[styles.picture, styles.pictureEmpty]}>
                  <Text style={styles.pictureInitial}>
                    {(me.data.displayName ?? me.data.email)[0]?.toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.pictureActions}>
                <Pressable disabled={picture.isPending} onPress={() => picture.mutate()}>
                  <Text style={styles.linkText}>
                    {picture.isPending
                      ? 'Uploading…'
                      : me.data.imageUrl
                        ? 'Change picture'
                        : 'Add a picture'}
                  </Text>
                </Pressable>
                {/* On Android the picker's own crop screen is the last step and
                    its button says "Crop", not "Done" — which reads as though
                    something else is still expected. Said here so nobody taps it
                    and then looks for an upload button that does not exist. */}
                {picture.isPending && (
                  <Text style={styles.note}>Sending it now…</Text>
                )}
                {me.data.imageUrl && (
                  <Pressable onPress={() => clearPicture.mutate()}>
                    <Text style={styles.linkMuted}>Remove</Text>
                  </Pressable>
                )}
                <Text style={styles.note}>
                  Only you see this. On Android, tapping Crop is what sends it —
                  there is no separate upload button.
                </Text>
              </View>
            </View>

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

        {/* A keyboard shortcut, not a stored payment method, and the screen says
            so — nothing kept here can be charged without the handset (§124.2). */}
        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Numbers you pay from</Text>
          <Text style={styles.note}>
            Saved so you do not retype them. Nothing can be charged without the
            prompt on your phone, so saving one is safe.
          </Text>

          {numbers.data?.map((number) => (
            <View key={number.id} style={styles.numberRow}>
              <View>
                <Text style={styles.value}>{number.phoneNumber}</Text>
                {number.lastUsedAt && (
                  <Text style={styles.note}>
                    Last used {new Date(number.lastUsedAt).toLocaleDateString()}
                  </Text>
                )}
              </View>
              <Pressable onPress={() => dropNumber.mutate(number.id)} hitSlop={8}>
                <Text style={styles.linkMuted}>Remove</Text>
              </Pressable>
            </View>
          ))}

          {numbers.data?.length === 0 && (
            <Text style={styles.note}>None saved yet.</Text>
          )}

          <View style={styles.numberAdd}>
            <TextInput
              style={styles.numberInput}
              value={newNumber}
              onChangeText={setNewNumber}
              placeholder="07xx xxx xxx"
              placeholderTextColor={theme.muted}
              keyboardType="phone-pad"
            />
            <Pressable
              style={[
                styles.addButton,
                (addNumber.isPending || newNumber.replace(/\D/g, '').length < 9) &&
                  styles.addButtonOff,
              ]}
              disabled={addNumber.isPending || newNumber.replace(/\D/g, '').length < 9}
              onPress={() => addNumber.mutate()}
            >
              <Text style={styles.addButtonText}>Save</Text>
            </Pressable>
          </View>
        </View>

        <Pressable style={styles.secondary} onPress={() => router.push('/legal')}>
          <Text style={styles.secondaryText}>Terms and privacy</Text>
        </Pressable>

        <Pressable style={styles.secondary} onPress={shareApp}>
          <Text style={styles.secondaryText}>Tell a friend about this app</Text>
        </Pressable>

        {/* Offered BEFORE the close, and said so in the closing dialogue: the
            moment someone is leaving is the only moment they want this. */}
        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Your data</Text>
          <Text style={styles.note}>
            A copy of everything we hold about you — your bookings, your reviews,
            your messages and your support tickets.
          </Text>
          <Pressable
            style={styles.secondary}
            disabled={exportData.isPending}
            onPress={() => exportData.mutate()}
          >
            <Text style={styles.secondaryText}>
              {exportData.isPending ? 'Preparing…' : 'Get a copy of my data'}
            </Text>
          </Pressable>
        </View>

        <Pressable style={styles.signOut} onPress={leave}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>

        <Pressable
          style={styles.closeAccount}
          disabled={close.isPending}
          onPress={confirmClose}
        >
          <Text style={styles.closeAccountText}>
            {close.isPending ? 'Closing…' : 'Close my account'}
          </Text>
        </Pressable>
        <Text style={styles.note}>
          Closing is permanent. Signing out is not — you can come back any time
          with a new code.
        </Text>
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
  sectionTitle: { fontSize: 16, fontWeight: '700', color: theme.ink },
  pictureRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 6 },
  picture: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.line },
  pictureEmpty: { alignItems: 'center', justifyContent: 'center' },
  pictureInitial: { fontSize: 26, fontWeight: '700', color: theme.muted },
  pictureActions: { gap: 3 },
  linkText: { color: theme.accent, fontWeight: '600', fontSize: 14 },
  linkMuted: { color: theme.muted, fontSize: 13 },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
  },
  numberAdd: { flexDirection: 'row', gap: 8, marginTop: 10 },
  numberInput: {
    flex: 1,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 15,
    color: theme.ink,
  },
  addButton: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  addButtonOff: { backgroundColor: theme.line },
  addButtonText: { color: '#fff', fontWeight: '700' },
  secondary: {
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryText: { color: theme.accent, fontWeight: '700', fontSize: 15 },
  // Plainer than Sign out, deliberately. The irreversible thing should not be
  // the loudest button on the screen.
  closeAccount: { paddingVertical: 14, alignItems: 'center' },
  closeAccountText: { color: theme.muted, fontWeight: '600', fontSize: 14 },
});
