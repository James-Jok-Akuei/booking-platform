import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardScroll } from '../../src/useKeyboardScroll';
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
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  closeMyAccount,
  exportMyData,
  getMe,
  listSavedNumbers,
  removeMyImage,
  removeSavedNumber,
  saveNumber,
  setMyDisplayName,
  setMyImage,
  signOut,
  type AccountExport,
} from '../../src/api/auth';
import { exportDocumentHtml } from '../../src/exportDocument';
import { useMoney } from '../../src/money';
import { Sheet } from '../../src/ui/Sheet';
import { listMyAppointments } from '../../src/api/booking';
import { listFavourites } from '../../src/api/discovery';
import { OffersCard } from '../../src/components/OffersCard';
import { pickImage } from '../../src/pickImage';
import { useSignedIn } from '../../src/api/client';
import { shareApp } from '../../src/share';
import { skyForToday } from '../../src/skies';
import { font, radius, shadow, TAB_BAR_CLEARANCE, theme, type } from '../../src/theme';
import { Avatar } from '../../src/ui/Avatar';
import { Button } from '../../src/ui/Button';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { Icon, type IconName } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { MomoLogo } from '../../src/ui/Momo';
import { PressableScale } from '../../src/ui/PressableScale';
import { Skeleton } from '../../src/ui/Skeleton';
import { BigTitle } from '../../src/ui/TopBar';
import { showDialog, showProblem } from '../../src/ui/Dialog';

/** How tall the dark header is before the safe area is added. */
const HERO = 318;

const joined = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/**
 * Who you are signed in as, and the way out.
 *
 * Grouped the way a person thinks about it (§133): who I am, how I pay, the
 * small print, my data, and leaving.
 *
 * Laid out as a profile (§143). The top is the person — a dark header with
 * their picture, their name and how long they have been here — and, lapping
 * over its edge, three numbers that are theirs: bookings made, bookings to
 * come, places saved. Each is a door to the tab that holds them. Below, short
 * labelled groups of rows, the way a phone's own settings are laid out,
 * because that is the list everybody already knows how to read.
 *
 * Signing out existed in the client from the first day and was reachable from
 * nowhere (§113). On a phone that is shared — which in this market is most of
 * them — an account you cannot leave is an account somebody else is using.
 */
export default function Account() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  // Keeps the field being typed into above the keyboard (§168).
  const keys = useKeyboardScroll({ pad: true });
  const layout = useLayout();
  const money = useMoney();
  const signedIn = useSignedIn();
  const scrollY = useRef(new Animated.Value(0)).current;
  const [adding, setAdding] = useState(false);

  const me = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: signedIn });

  // The header is dark, so the clock and battery above it have to be light —
  // but only while THIS tab is the one showing, and only when the header is
  // there. Every other screen sits on pale paper and wants them dark again.
  useFocusEffect(
    useCallback(() => {
      if (!signedIn) return undefined;
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, [signedIn]),
  );

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
    onError: (error) => showProblem('Could not add that', error, (error as Error).message),
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
      setAdding(false);
      refreshNumbers();
    },
    onError: (error) =>
      showProblem('Not saved', error),
  });

  // ---- The three numbers under the header (§143) ----
  // Each reuses a list the app already fetches, asked for as small as it can
  // be: the total is what is wanted, not the rows.
  const everBooked = useQuery({
    queryKey: ['my-appointments', 'count'],
    queryFn: () => listMyAppointments({ limit: 1 }),
    enabled: signedIn,
  });
  const toCome = useQuery({
    queryKey: ['my-appointments', 'to-come'],
    queryFn: () =>
      listMyAppointments({ from: new Date().toISOString(), sort: 'soonest', limit: 50 }),
    enabled: signedIn,
  });
  const favourites = useQuery({
    queryKey: ['favourites'],
    queryFn: listFavourites,
    enabled: signedIn,
  });
  // "To come" means somebody is expecting them: not a hold nobody paid for,
  // and not one that was called off.
  const upcoming = toCome.data?.appointments.filter(
    (a) => a.status === 'BOOKED' || a.status === 'IN_PROGRESS',
  ).length;

  const dropNumber = useMutation({ mutationFn: removeSavedNumber, onSuccess: refreshNumbers });

  /**
   * A copy of everything, handed to the share sheet (§119.2) — which is the
   * only way anything leaves a phone.
   *
   * As a PDF a person can read (§144): the same complete export, set out as
   * pages. The JSON it used to be is still there as the "technical copy", for
   * the rare person who wants to MOVE their data rather than read it.
   */
  const share = async (uri: string, mimeType: string, kind: string) => {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType, dialogTitle: 'Your data', UTI: kind });
    } else {
      showDialog({
        tone: 'ok',
        icon: 'document-text',
        title: 'Saved',
        message: `Your data is in ${uri}. This device cannot open a share sheet.`,
      });
    }
  };
  const exportFailed = (error: unknown) =>
    showProblem('Could not prepare that', error);

  const exportData = useMutation({
    mutationFn: exportMyData,
    onSuccess: async (data: AccountExport) => {
      const { uri } = await Print.printToFileAsync({
        html: exportDocumentHtml(data, money.format),
      });
      // The printer names the file with a random id; a name a person will
      // recognise in their downloads a month from now is worth one move.
      const named = `${FileSystem.cacheDirectory}my-data.pdf`;
      await FileSystem.deleteAsync(named, { idempotent: true });
      await FileSystem.moveAsync({ from: uri, to: named });
      await share(named, 'application/pdf', 'com.adobe.pdf');
    },
    onError: exportFailed,
  });

  const exportJson = useMutation({
    mutationFn: exportMyData,
    onSuccess: async (data: AccountExport) => {
      const path = `${FileSystem.cacheDirectory}my-data.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(data, null, 2));
      await share(path, 'application/json', 'public.json');
    },
    onError: exportFailed,
  });

  // ---- The name on their reviews (§144) ----
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const rename = useMutation({
    mutationFn: setMyDisplayName,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      // Their byline is on reviews other screens have already fetched.
      queryClient.invalidateQueries({ queryKey: ['shop-reviews'] });
      setNaming(false);
    },
    onError: (error) =>
      showProblem('Not saved', error),
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
      showDialog({ tone: 'ok', icon: 'checkmark', title: 'Account closed', message: result.message });
    },
    onError: (error) =>
      showProblem('Not closed', error),
  });

  const confirmClose = () =>
    showDialog({
      tone: 'danger',
      icon: 'person-remove',
      title: 'Close your account?',
      message:
        'This cannot be undone.\n\nYour bookings and reviews stay with the shops ' +
        'they belong to, with your name taken off them — a shop still has its ' +
        'record of what it did and was paid for.\n\nYour email is released, so ' +
        'you can sign up again later, but it would be a new account with none of ' +
        'this.\n\nTake a copy of your data first if you want one.',
      actions: [
        { label: 'Keep my account', role: 'cancel' },
        { label: 'Close it', role: 'primary', onPress: () => close.mutate() },
      ],
    });

  const leave = () =>
    showDialog({
      tone: 'accent',
      icon: 'log-out',
      title: 'Sign out?',
      message:
        'Your bookings and messages stay with your account. You will need a new code to get back in.',
      actions: [
        { label: 'Stay signed in', role: 'cancel' },
        {
          label: 'Sign out',
          role: 'primary',
          // The button spins while this runs, so it cannot be pressed twice.
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
    });

  // AFTER every hook, never before (§133.11). Signed-in state changes while this
  // tab stays mounted, so an early return above the hooks ran a different
  // number of them on the next render — which React refuses, loudly.
  if (!signedIn) {
    return (
      <View style={styles.screen}>
        <BigTitle title="Sign in" />
        {/* What an account opens (§170): everything the visitor cannot see
            yet is listed here, once, instead of being icons that lead to
            "sign in first". */}
        <EmptyState
          icon="person-circle-outline"
          title="One account for everything"
          text="Sign in to book and pay, keep your bookings, save places and services, message shops and get your notifications. It follows you to any phone."
          action="Sign in or create an account"
          onAction={() => router.push('/sign-in?next=/')}
        />
      </View>
    );
  }

  const nameShown = me.data?.displayName ?? 'Anonymous';
  const sky = skyForToday();
  const heroHeight = HERO + insets.top;

  // The small bar that takes over once the header has scrolled away, so the
  // screen always says whose account this is.
  const barOpacity = scrollY.interpolate({
    inputRange: [heroHeight - 150, heroHeight - 90],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  // Pulling down stretches the header instead of showing a gap above it.
  const heroScale = scrollY.interpolate({
    inputRange: [-200, 0],
    outputRange: [1.5, 1],
    extrapolateRight: 'clamp',
  });
  const heroShift = scrollY.interpolate({
    inputRange: [-200, 0, heroHeight],
    outputRange: [-50, 0, heroHeight * 0.35],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.screen}>
      <Animated.ScrollView
        ref={keys.ref}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
          listener: keys.track,
        })}
        contentContainerStyle={{
          paddingBottom: TAB_BAR_CLEARANCE + insets.bottom + keys.padding,
        }}
      >
        {/* WHO. */}
        <View style={[styles.hero, { height: heroHeight }]}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ translateY: heroShift }, { scale: heroScale }] },
            ]}
          >
            {/* Today's sky (§154): one of ten, a new one each day. */}
            <LinearGradient
              colors={sky.colors}
              locations={[0, 0.55, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            {/* Two soft lights, so the dark is a surface and not a void. */}
            <View style={[styles.glow, styles.glowA, { backgroundColor: sky.glows[0] }]} />
            <View style={[styles.glow, styles.glowB, { backgroundColor: sky.glows[1] }]} />
          </Animated.View>

          <View style={[styles.heroBody, { paddingTop: insets.top + 18 }]}>
            <Text style={styles.heroLabel}>Account</Text>

            {me.isLoading && <Skeleton width={104} height={104} round={52} />}

            {me.data && (
              <FadeIn style={styles.heroPerson}>
                {/* Shown to them and to nobody else (§124.1). A shop needs a
                    name to call out and an arrival code, not a face. */}
                <PressableScale
                  disabled={picture.isPending}
                  onPress={() => picture.mutate()}
                  accessibilityRole="button"
                  accessibilityLabel={me.data.imageUrl ? 'Change picture' : 'Add a picture'}
                  scaleTo={0.95}
                  haptic
                >
                  <LinearGradient
                    colors={[theme.accent, theme.star]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.ring}
                  >
                    <View style={styles.ringGap}>
                      <Avatar
                        uri={me.data.imageUrl}
                        name={me.data.displayName ?? me.data.email}
                        size={92}
                      />
                    </View>
                  </LinearGradient>
                  <View style={styles.cameraBadge}>
                    <Icon name="camera" size={14} color="#FFFFFF" />
                  </View>
                </PressableScale>

                <Text style={styles.heroName} numberOfLines={1}>
                  {nameShown}
                </Text>
                <Text style={styles.heroEmail} numberOfLines={1}>
                  {me.data.email}
                </Text>

                <View style={styles.heroChips}>
                  <View style={styles.since}>
                    <Icon name="sparkles" size={12} color={theme.star} />
                    <Text style={styles.sinceText}>With us since {joined(me.data.createdAt)}</Text>
                  </View>
                  {/* The sky's name, small: a page that changes should say so. */}
                  <View style={styles.since}>
                    <Text style={styles.sinceText}>{sky.name}</Text>
                  </View>
                </View>
              </FadeIn>
            )}
          </View>
        </View>

        <View
          style={[
            styles.content,
            { width: layout.contentWidth, paddingHorizontal: layout.gutter },
          ]}
        >
          {/* WHAT IS YOURS. Lapping over the header's edge, the way a card sits
              on a counter. Each number is a door to the tab that holds it. */}
          <FadeIn delay={80} style={styles.stats}>
            <Stat
              value={everBooked.data?.total}
              label="Bookings"
              onPress={() => router.push('/bookings')}
            />
            <View style={styles.statRule} />
            <Stat value={upcoming} label="To come" onPress={() => router.push('/bookings')} />
            <View style={styles.statRule} />
            <Stat
              value={favourites.data?.total}
              label="Saved"
              onPress={() => router.push('/saved')}
            />
          </FadeIn>

          {/* ---- Profile ---- */}
          {me.data && (
            <FadeIn delay={120}>
              <Text style={styles.group}>Profile</Text>
              <View style={styles.card}>
                <Row
                  icon="camera-outline"
                  label={
                    picture.isPending
                      ? 'Sending it now…'
                      : me.data.imageUrl
                        ? 'Change picture'
                        : 'Add a picture'
                  }
                  // On Android the picker's own crop screen is the last step
                  // and its button says "Crop", not "Done" — which reads as
                  // though something else is still expected (§125.6).
                  note={
                    Platform.OS === 'android'
                      ? 'Only you see it. Tapping Crop is what sends it.'
                      : 'Only you see it.'
                  }
                  onPress={() => picture.mutate()}
                  off={picture.isPending}
                />
                {me.data.imageUrl && (
                  <>
                    <View style={styles.divider} />
                    <Row
                      icon="trash-outline"
                      label="Remove picture"
                      onPress={() => clearPicture.mutate()}
                      off={clearPicture.isPending}
                      plain
                    />
                  </>
                )}
                <View style={styles.divider} />
                <Row
                  icon="create-outline"
                  label="The name on your reviews"
                  value={nameShown}
                  // One name for the account, so it changes on every review
                  // they have left at once (§31.1) — said in the sheet, where
                  // the change is made.
                  note={
                    me.data.displayName
                      ? 'Tap to change it, or to be shown as Anonymous.'
                      : 'Tap to give a name.'
                  }
                  onPress={() => {
                    setNameDraft(me.data?.displayName ?? '');
                    setNaming(true);
                  }}
                />
              </View>
            </FadeIn>
          )}

          {/* ---- Payment ---- */}
          {/* A keyboard shortcut, not a stored payment method, and the screen
              says so — nothing kept here can be charged without the handset
              (§124.2). */}
          <FadeIn delay={160}>
            <Text style={styles.group}>Payment</Text>
            <View style={styles.card}>
              <View style={styles.payHead}>
                <MomoLogo size={44} />
                <View style={styles.flex}>
                  <Text style={styles.rowLabel}>MTN Mobile Money</Text>
                  <Text style={type.small}>Numbers you pay from</Text>
                </View>
                <View style={styles.safe}>
                  <Icon name="shield-checkmark" size={12} color={theme.ok} />
                  <Text style={styles.safeText}>Safe</Text>
                </View>
              </View>

              {numbers.data?.map((number) => (
                <View key={number.id}>
                  <View style={styles.divider} />
                  <View style={styles.numberRow}>
                    <View style={styles.rowIcon}>
                      <Icon name="phone-portrait-outline" size={18} color={theme.accent} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.number}>{spaced(number.phoneNumber)}</Text>
                      {number.lastUsedAt && (
                        <Text style={type.small}>
                          Last used {new Date(number.lastUsedAt).toLocaleDateString()}
                        </Text>
                      )}
                    </View>
                    <PressableScale
                      onPress={() => dropNumber.mutate(number.id)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${number.phoneNumber}`}
                      style={styles.remove}
                    >
                      <Icon name="close" size={15} color={theme.ink2} />
                    </PressableScale>
                  </View>
                </View>
              ))}

              <View style={styles.divider} />

              {adding ? (
                <View style={styles.numberAdd}>
                  <TextInput
                    onFocus={keys.reveal}
                    style={styles.numberInput}
                    value={newNumber}
                    onChangeText={setNewNumber}
                    placeholder="07xx xxx xxx"
                    placeholderTextColor={theme.muted}
                    keyboardType="phone-pad"
                    autoFocus
                  />
                  <Button
                    compact
                    label="Save"
                    busy={addNumber.isPending}
                    disabled={newNumber.replace(/\D/g, '').length < 9}
                    onPress={() => addNumber.mutate()}
                  />
                </View>
              ) : (
                <Row icon="add" label="Add a number" onPress={() => setAdding(true)} accent />
              )}

              <Text style={type.small}>
                Saved so you do not retype them. Nothing can be charged without the
                prompt on your phone.
              </Text>
            </View>
          </FadeIn>

          {/* ---- Emails about services nearby, for those who want them (§140). ---- */}
          <FadeIn delay={200}>
            <Text style={styles.group}>Offers</Text>
            <OffersCard />
          </FadeIn>

          {/* ---- About ---- */}
          <FadeIn delay={240}>
            <Text style={styles.group}>About</Text>
            <View style={styles.card}>
              <Row
                icon="document-text-outline"
                label="Terms and privacy"
                onPress={() => router.push('/legal')}
              />
              <View style={styles.divider} />
              <Row icon="share-social-outline" label="Tell a friend about this app" onPress={shareApp} />
            </View>
          </FadeIn>

          {/* ---- Your data ---- */}
          {/* Offered BEFORE the close, and said so in the closing dialogue: the
              moment someone is leaving is the only moment they want this. */}
          <FadeIn delay={280}>
            <Text style={styles.group}>Your data</Text>
            <View style={styles.card}>
              <Row
                icon="download-outline"
                label={exportData.isPending ? 'Preparing…' : 'Get a copy of my data'}
                note="A PDF you can read: your bookings, reviews, messages and support tickets."
                onPress={() => exportData.mutate()}
                off={exportData.isPending}
              />
              <View style={styles.divider} />
              <Row
                icon="code-slash-outline"
                label={exportJson.isPending ? 'Preparing…' : 'Technical copy'}
                note="The same data as a JSON file, for moving it to another service."
                onPress={() => exportJson.mutate()}
                off={exportJson.isPending}
                plain
              />
              <View style={styles.divider} />
              <Row icon="log-out-outline" label="Sign out" onPress={leave} danger />
            </View>
          </FadeIn>

          {/* Plainer than Sign out, deliberately. The irreversible thing should
              not be the loudest thing on the screen. */}
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

          {Constants.expoConfig?.version && (
            <Text style={styles.version}>Version {Constants.expoConfig.version}</Text>
          )}
        </View>
      </Animated.ScrollView>

      {/* The name on their reviews (§144). Two choices, said as two choices:
          a name, or Anonymous. Anonymous is not an empty box somebody has to
          think to clear — it is a button. */}
      <Sheet open={naming} title="The name on your reviews" onClose={() => setNaming(false)}>
        <View style={styles.nameSheet}>
          <Text style={type.small}>
            Shown beside every review you have written and will write. Shops you
            book with still see your email.
          </Text>
          <TextInput
            style={styles.nameInput}
            value={nameDraft}
            onChangeText={setNameDraft}
            placeholder="For example, Aline M."
            placeholderTextColor={theme.muted}
            maxLength={40}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
          />
          <Button
            label={rename.isPending ? 'Saving…' : 'Save this name'}
            busy={rename.isPending}
            disabled={
              nameDraft.trim().length < 2 || nameDraft.trim() === (me.data?.displayName ?? '')
            }
            onPress={() => rename.mutate(nameDraft.trim())}
          />
          {me.data?.displayName ? (
            <Button
              kind="outline"
              icon="eye-off-outline"
              label="Show me as Anonymous"
              disabled={rename.isPending}
              onPress={() => rename.mutate(null)}
            />
          ) : (
            <View style={styles.anonNow}>
              <Icon name="eye-off-outline" size={16} color={theme.ink2} />
              <Text style={[type.small, styles.flex]}>
                You are shown as Anonymous now.
              </Text>
            </View>
          )}
        </View>
      </Sheet>

      {/* The bar that appears once the header has scrolled away. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.bar, { paddingTop: insets.top + 8, opacity: barOpacity }]}
      >
        {me.data && (
          <>
            <Avatar uri={me.data.imageUrl} name={me.data.displayName ?? me.data.email} size={30} />
            <Text style={styles.barName} numberOfLines={1}>
              {nameShown}
            </Text>
          </>
        )}
      </Animated.View>
    </View>
  );
}

/** "0788123456" → "0788 123 456": how a phone number is read aloud. */
const spaced = (digits: string) =>
  digits.length === 10 ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : digits;

/**
 * One number that is yours, and the way to what it counts.
 *
 * It counts UP to its value the first time it arrives — half a second that
 * makes a figure feel like it was just worked out for you rather than printed.
 * A dash until it is known: a 0 that turns into a 7 reads as a mistake.
 */
function Stat({
  value,
  label,
  onPress,
}: {
  value: number | undefined;
  label: string;
  onPress: () => void;
}) {
  const [shown, setShown] = useState<number | null>(null);
  const counter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (value === undefined) return;
    const id = counter.addListener(({ value: v }) => setShown(Math.round(v)));
    Animated.timing(counter, {
      toValue: value,
      duration: 650,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => setShown(value));
    return () => counter.removeListener(id);
  }, [value, counter]);

  return (
    // The third of the row belongs to this View: the pressable inside is
    // wrapped for its animation, and a wrapper does not pass `flex` on.
    <View style={styles.flex}>
      <PressableScale
        onPress={onPress}
        haptic
        scaleTo={0.94}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? 'loading'}`}
        style={styles.stat}
      >
        <Text style={styles.statValue}>{shown === null ? '–' : shown}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </PressableScale>
    </View>
  );
}

/**
 * One row of a group: an icon, what it is, and — when it goes somewhere — a
 * chevron saying so. With a `value` and no `onPress` it is a fact, not a door.
 */
function Row({
  icon,
  label,
  value,
  note,
  onPress,
  off,
  danger,
  accent,
  plain,
}: {
  icon: IconName;
  label: string;
  value?: string;
  note?: string;
  onPress?: () => void;
  off?: boolean;
  /** The way out: red, and no chevron — it does not go anywhere. */
  danger?: boolean;
  /** An invitation to add something. */
  accent?: boolean;
  /** A quiet action: grey icon. */
  plain?: boolean;
}) {
  const tint = danger ? theme.danger : plain ? theme.ink2 : theme.accent;
  const inner = (
    <>
      <View
        style={[
          styles.rowIcon,
          danger && { backgroundColor: theme.dangerSoft },
          plain && { backgroundColor: theme.sunken },
        ]}
      >
        <Icon name={icon} size={18} color={tint} />
      </View>
      <View style={styles.flex}>
        <Text
          style={[
            value ? type.label : styles.rowLabel,
            danger && { color: theme.danger },
            accent && { color: theme.accent },
          ]}
        >
          {label}
        </Text>
        {value && <Text style={styles.rowLabel}>{value}</Text>}
        {note && <Text style={[type.small, styles.rowNote]}>{note}</Text>}
      </View>
      {onPress && !danger && !accent && (
        <Icon name="chevron-forward" size={17} color={theme.muted} />
      )}
    </>
  );

  if (!onPress) return <View style={styles.row}>{inner}</View>;
  return (
    <PressableScale
      style={[styles.row, off && styles.off]}
      onPress={onPress}
      disabled={off}
      haptic
      scaleTo={0.98}
      accessibilityRole="button"
    >
      {inner}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  centre: { textAlign: 'center' },
  off: { opacity: 0.5 },

  // ---- the header ----
  // Clipped, so the soft lights stop at its edge instead of spilling onto the page.
  hero: { overflow: 'hidden' },
  glow: { position: 'absolute', borderRadius: 999 },
  glowA: { width: 260, height: 260, top: -90, right: -70 },
  glowB: { width: 200, height: 200, bottom: -60, left: -60 },
  heroBody: { flex: 1, alignItems: 'center', paddingHorizontal: 24 },
  heroLabel: {
    alignSelf: 'flex-start',
    fontFamily: font.bold,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.55)',
    marginBottom: 14,
  },
  heroPerson: { alignItems: 'center', alignSelf: 'stretch' },
  ring: {
    width: 108,
    height: 108,
    borderRadius: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringGap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: theme.night,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.accent,
    borderWidth: 3,
    borderColor: theme.night,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: {
    fontFamily: font.extrabold,
    fontSize: 24,
    letterSpacing: -0.4,
    color: '#FFFFFF',
    marginTop: 14,
    maxWidth: '100%',
  },
  heroEmail: {
    fontFamily: font.medium,
    fontSize: 13.5,
    color: 'rgba(255,255,255,0.62)',
    marginTop: 2,
    maxWidth: '100%',
  },
  heroChips: { flexDirection: 'row', gap: 8, marginTop: 12 },
  since: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  sinceText: { fontFamily: font.semibold, fontSize: 12, color: 'rgba(255,255,255,0.86)' },

  // ---- the page ----
  content: { alignSelf: 'center', gap: 6 },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    paddingVertical: 16,
    marginTop: -38,
    ...shadow.raised,
  },
  stat: { alignItems: 'center', gap: 1, paddingVertical: 2 },
  statValue: {
    fontFamily: font.extrabold,
    fontSize: 24,
    letterSpacing: -0.5,
    color: theme.ink,
    fontVariant: ['tabular-nums'],
  },
  statLabel: { fontFamily: font.semibold, fontSize: 12, color: theme.muted },
  statRule: { width: 1, height: 30, backgroundColor: theme.line },
  group: {
    fontFamily: font.bold,
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: theme.muted,
    marginTop: 20,
    marginBottom: 9,
    marginLeft: 6,
  },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 4,
    ...shadow.card,
  },
  divider: { height: 1, backgroundColor: theme.line, marginLeft: 53 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 10 },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { fontFamily: font.bold, fontSize: 15, color: theme.ink },
  rowNote: { marginTop: 2 },
  payHead: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 10 },
  safe: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.okSoft,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  safeText: { fontFamily: font.bold, fontSize: 11.5, color: theme.ok },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 10 },
  number: {
    fontFamily: font.bold,
    fontSize: 15.5,
    letterSpacing: 0.4,
    color: theme.ink,
    fontVariant: ['tabular-nums'],
  },
  remove: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberAdd: { flexDirection: 'row', gap: 8, paddingVertical: 8 },
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
  nameSheet: { gap: 12, paddingBottom: 8 },
  nameInput: {
    fontFamily: font.semibold,
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    height: 52,
    paddingVertical: 0,
    fontSize: 16,
    color: theme.ink,
  },
  anonNow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    padding: 12,
  },
  closeAccount: { paddingVertical: 8, alignItems: 'center', marginTop: 18 },
  closeAccountText: { fontFamily: font.semibold, fontSize: 14, color: theme.muted },
  version: {
    textAlign: 'center',
    fontFamily: font.medium,
    fontSize: 11.5,
    color: theme.muted,
    marginTop: 16,
    opacity: 0.8,
  },

  // ---- the bar that follows ----
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingBottom: 12,
    paddingHorizontal: 60,
    backgroundColor: theme.night,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  barName: { fontFamily: font.bold, fontSize: 15.5, color: '#FFFFFF', flexShrink: 1 },
});
