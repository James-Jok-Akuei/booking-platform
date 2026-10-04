import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
} from '../../src/api/auth';
import { pickImage } from '../../src/pickImage';
import { ApiError, useSignedIn } from '../../src/api/client';
import { shareApp } from '../../src/share';
import { font, radius, shadow, TAB_BAR_CLEARANCE, theme, type } from '../../src/theme';
import { Avatar } from '../../src/ui/Avatar';
import { Button } from '../../src/ui/Button';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { Icon, type IconName } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { MomoBanner, MomoLogo } from '../../src/ui/Momo';
import { PressableScale } from '../../src/ui/PressableScale';
import { Skeleton } from '../../src/ui/Skeleton';
import { BigTitle } from '../../src/ui/TopBar';

const joined = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/**
 * Who you are signed in as, and the way out.
 *
 * Grouped the way a person thinks about it (§133): who I am, how I pay, the
 * small print, my data, and leaving. Each group is one card; each thing you can
 * DO is a row with an icon and a chevron, so the screen reads as a short menu
 * rather than a page of paragraphs with buttons scattered through it.
 *
 * Signing out existed in the client from the first day and was reachable from
 * nowhere (§113). On a phone that is shared — which in this market is most of
 * them — an account you cannot leave is an account somebody else is using.
 */
export default function Account() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const signedIn = useSignedIn();

  const me = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: signedIn });

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

  // AFTER every hook, never before (§133.11). Signed-in state changes while this
  // tab stays mounted, so an early return above the hooks ran a different
  // number of them on the next render — which React refuses, loudly.
  if (!signedIn) {
    return (
      <View style={styles.screen}>
        <BigTitle title="Account" />
        <EmptyState
          icon="person-outline"
          title="You are not signed in"
          text="Signing in keeps your bookings and messages with your account, so they follow you to any phone."
          action="Sign in"
          onAction={() => router.push('/sign-in?next=/account')}
        />
      </View>
    );
  }

  const nameShown = me.data?.displayName ?? 'Anonymous';

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 14,
            paddingBottom: TAB_BAR_CLEARANCE + insets.bottom,
            width: layout.contentWidth,
            paddingHorizontal: layout.gutter,
          },
        ]}
      >
        <Text style={type.display}>Account</Text>

        {me.isLoading && <Skeleton height={190} round={radius.xl} />}

        {me.data && (
          <FadeIn style={[styles.card, styles.profile]}>
            {/* Shown to them and to nobody else (§124.1). A shop needs a name to
                call out and an arrival code, not a face. */}
            <PressableScale
              disabled={picture.isPending}
              onPress={() => picture.mutate()}
              accessibilityRole="button"
              accessibilityLabel={me.data.imageUrl ? 'Change picture' : 'Add a picture'}
              scaleTo={0.95}
            >
              <Avatar
                uri={me.data.imageUrl}
                name={me.data.displayName ?? me.data.email}
                size={92}
              />
              <View style={styles.cameraBadge}>
                <Icon name="camera" size={15} color="#FFFFFF" />
              </View>
            </PressableScale>

            <Text style={[type.heading, styles.centre]}>{nameShown}</Text>
            <Text style={[type.small, styles.centre]}>{me.data.email}</Text>

            <View style={styles.pictureLinks}>
              <PressableScale disabled={picture.isPending} onPress={() => picture.mutate()} hitSlop={8}>
                <Text style={styles.link}>
                  {picture.isPending
                    ? 'Uploading…'
                    : me.data.imageUrl
                      ? 'Change picture'
                      : 'Add a picture'}
                </Text>
              </PressableScale>
              {me.data.imageUrl && (
                <PressableScale onPress={() => clearPicture.mutate()} hitSlop={8}>
                  <Text style={styles.linkMuted}>Remove</Text>
                </PressableScale>
              )}
            </View>

            {/* On Android the picker's own crop screen is the last step and
                its button says "Crop", not "Done" — which reads as though
                something else is still expected. Said here so nobody taps it
                and then looks for an upload button that does not exist. */}
            {picture.isPending && <Text style={type.small}>Sending it now…</Text>}
            <Text style={[type.small, styles.centre]}>
              Only you see this. On Android, tapping Crop is what sends it —
              there is no separate upload button.
            </Text>
          </FadeIn>
        )}

        {me.data && (
          <FadeIn delay={60} style={styles.card}>
            <Fact icon="mail-outline" label="Signed in as" value={me.data.email} />
            <View style={styles.divider} />
            <Fact
              icon="create-outline"
              label="The name on your reviews"
              value={nameShown}
              // True, and worth saying: the name belongs to the account, so there
              // is no separate place to change it. Writing or editing a review is
              // where it is set (§31).
              note={
                me.data.displayName
                  ? 'Shown on every review you leave. Change it when you write or edit one.'
                  : 'Reviews you leave show as Anonymous until you give a name, which you can do when you write one.'
              }
            />
            <View style={styles.divider} />
            <Fact icon="calendar-outline" label="With us since" value={joined(me.data.createdAt)} />
          </FadeIn>
        )}

        {/* A keyboard shortcut, not a stored payment method, and the screen says
            so — nothing kept here can be charged without the handset (§124.2). */}
        <FadeIn delay={120} style={styles.card}>
          <Text style={type.heading}>Numbers you pay from</Text>
          {/* Says which mobile money this is before anyone reads a word (§134.3). */}
          <MomoBanner note="Deposits are paid with MoMo." />
          <Text style={type.small}>
            Saved so you do not retype them. Nothing can be charged without the
            prompt on your phone, so saving one is safe.
          </Text>

          {numbers.data?.map((number) => (
            <View key={number.id} style={styles.numberRow}>
              <MomoLogo size={40} />
              <View style={styles.flex}>
                <Text style={styles.value}>{number.phoneNumber}</Text>
                {number.lastUsedAt && (
                  <Text style={type.small}>
                    Last used {new Date(number.lastUsedAt).toLocaleDateString()}
                  </Text>
                )}
              </View>
              <PressableScale onPress={() => dropNumber.mutate(number.id)} hitSlop={8}>
                <Text style={styles.linkMuted}>Remove</Text>
              </PressableScale>
            </View>
          ))}

          {numbers.data?.length === 0 && <Text style={type.small}>None saved yet.</Text>}

          <View style={styles.numberAdd}>
            <TextInput
              style={styles.numberInput}
              value={newNumber}
              onChangeText={setNewNumber}
              placeholder="07xx xxx xxx"
              placeholderTextColor={theme.muted}
              keyboardType="phone-pad"
            />
            <Button
              compact
              label="Save"
              busy={addNumber.isPending}
              disabled={newNumber.replace(/\D/g, '').length < 9}
              onPress={() => addNumber.mutate()}
            />
          </View>
        </FadeIn>

        <FadeIn delay={180} style={[styles.card, styles.menu]}>
          <MenuRow
            icon="document-text-outline"
            label="Terms and privacy"
            onPress={() => router.push('/legal')}
          />
          <View style={styles.divider} />
          <MenuRow
            icon="share-social-outline"
            label="Tell a friend about this app"
            onPress={shareApp}
          />
        </FadeIn>

        {/* Offered BEFORE the close, and said so in the closing dialogue: the
            moment someone is leaving is the only moment they want this. */}
        <FadeIn delay={240} style={styles.card}>
          <Text style={type.heading}>Your data</Text>
          <Text style={type.small}>
            A copy of everything we hold about you — your bookings, your reviews,
            your messages and your support tickets.
          </Text>
          <Button
            kind="outline"
            icon="download-outline"
            busy={exportData.isPending}
            label={exportData.isPending ? 'Preparing…' : 'Get a copy of my data'}
            onPress={() => exportData.mutate()}
          />
        </FadeIn>

        <Button kind="danger" icon="log-out-outline" label="Sign out" onPress={leave} />

        {/* Plainer than Sign out, deliberately. The irreversible thing should
            not be the loudest button on the screen. */}
        <PressableScale
          style={styles.closeAccount}
          disabled={close.isPending}
          onPress={confirmClose}
        >
          <Text style={styles.closeAccountText}>
            {close.isPending ? 'Closing…' : 'Close my account'}
          </Text>
        </PressableScale>
        <Text style={[type.small, styles.centre]}>
          Closing is permanent. Signing out is not — you can come back any time
          with a new code.
        </Text>
      </ScrollView>
    </View>
  );
}

/** One thing the account knows about you: a label, the value, and a note if it needs one. */
function Fact({
  icon,
  label,
  value,
  note,
}: {
  icon: IconName;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <View style={styles.fact}>
      <View style={styles.rowIcon}>
        <Icon name={icon} size={18} color={theme.accent} />
      </View>
      <View style={styles.flex}>
        <Text style={type.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
        {note && <Text style={[type.small, styles.factNote]}>{note}</Text>}
      </View>
    </View>
  );
}

/** One thing you can do from here: an icon, what it is, and a chevron saying it goes somewhere. */
function MenuRow({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <PressableScale style={styles.menuRow} onPress={onPress} haptic scaleTo={0.98}>
      <View style={styles.rowIcon}>
        <Icon name={icon} size={18} color={theme.accent} />
      </View>
      <Text style={[styles.value, styles.flex]}>{label}</Text>
      <Icon name="chevron-forward" size={18} color={theme.muted} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  centre: { textAlign: 'center' },
  content: { gap: 16, alignSelf: 'center' },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 18,
    gap: 12,
    ...shadow.card,
  },
  profile: { alignItems: 'center', gap: 6, paddingVertical: 24 },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.accent,
    borderWidth: 3,
    borderColor: theme.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pictureLinks: { flexDirection: 'row', gap: 18, marginVertical: 6 },
  link: { fontFamily: font.bold, fontSize: 14, color: theme.accent },
  linkMuted: { fontFamily: font.semibold, fontSize: 13, color: theme.muted },
  divider: { height: 1, backgroundColor: theme.line },
  fact: { flexDirection: 'row', gap: 13, alignItems: 'flex-start' },
  factNote: { marginTop: 4 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: { fontFamily: font.bold, fontSize: 15, color: theme.ink, marginTop: 1 },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  numberAdd: { flexDirection: 'row', gap: 8, marginTop: 2 },
  numberInput: {
    flex: 1,
    fontFamily: font.semibold,
    backgroundColor: theme.sunken,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    height: 44,
    paddingVertical: 0,
    fontSize: 15,
    color: theme.ink,
  },
  menu: { paddingVertical: 8, gap: 0 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 10 },
  closeAccount: { paddingVertical: 8, alignItems: 'center' },
  closeAccountText: { fontFamily: font.semibold, fontSize: 14, color: theme.muted },
});
