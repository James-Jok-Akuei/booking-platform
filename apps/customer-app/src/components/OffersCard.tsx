import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import {
  ActivityIndicator,
  Keyboard,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getOffersPreference,
  searchAddresses,
  setOffersPreference,
  type FoundAddress,
  type OffersPreference,
} from '../api/auth';
import { ApiError } from '../api/client';
import { listProvinces } from '../api/discovery';
import { font, radius, shadow, theme, type } from '../theme';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { FadeIn } from '../ui/FadeIn';
import { Icon } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';
import { Sheet } from '../ui/Sheet';
import { Skeleton } from '../ui/Skeleton';
import { showProblem } from '../ui/Dialog';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

/**
 * "Weekly offers by email" (§140, §172): one email a week about popular
 * services near an address the customer chose.
 *
 * Called "Offers near me" until Home began narrowing to where the phone is
 * right now (§171) — after which "near me" sounded like the same thing, and
 * people might think they needed it to see nearby shops. It is not: it is an
 * email, sent while the app is closed, about the address saved here.
 *
 * OFF until they turn it on, and the card says what turning it on gets them.
 * That sentence is the consent; nothing is hidden behind it.
 *
 * The address is said right under the name (§172), so a wrong one is seen —
 * and it can be set three ways: typed and picked from the places found, where
 * the phone is now, or a whole district.
 */
export function OffersCard() {
  const queryClient = useQueryClient();
  const [choosing, setChoosing] = useState(false);
  /** Opened from the switch: choosing an address is what finishes turning it on. */
  const [turningOn, setTurningOn] = useState(false);
  const [typed, setTyped] = useState('');
  /** What is asked for: the typed words once typing pauses (§174). */
  const [asked, setAsked] = useState('');
  /** Typing an address: the sheet shows only the field and what it finds. */
  const [focused, setFocused] = useState(false);
  const field = useRef<TextInput>(null);

  const preference = useQuery({ queryKey: ['offers-preference'], queryFn: getOffersPreference });
  const provinces = useQuery({
    queryKey: ['provinces'],
    queryFn: listProvinces,
    staleTime: Infinity,
  });
  /**
   * Suggestions as the address is typed (§174), asked for when typing pauses
   * rather than on every letter: "kimironko" is one question, not nine. A
   * question overtaken by more letters is dropped (the `signal`).
   */
  useEffect(() => {
    const words = typed.trim().replace(/\s+/g, ' ');
    const timer = setTimeout(() => setAsked(words), 350);
    return () => clearTimeout(timer);
  }, [typed]);

  const found = useQuery({
    queryKey: ['addresses', asked],
    queryFn: ({ signal }) => searchAddresses(asked, signal),
    enabled: asked.length >= 3,
    // A place does not move; the same letters need not be asked twice.
    staleTime: Infinity,
    retry: false,
    // The last suggestions stay while the next ones come, instead of the
    // list blinking out at every letter.
    placeholderData: keepPreviousData,
  });
  const searching = focused || typed.length > 0;

  const save = useMutation({
    mutationFn: setOffersPreference,
    // The switch moves at once; the server's answer replaces the guess.
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ['offers-preference'] });
      const before = queryClient.getQueryData<OffersPreference>(['offers-preference']);
      if (before) {
        queryClient.setQueryData<OffersPreference>(['offers-preference'], {
          ...before,
          optedIn: next.optedIn,
        });
      }
      return { before };
    },
    onSuccess: (saved) => queryClient.setQueryData(['offers-preference'], saved),
    onError: (error, _next, context) => {
      if (context?.before) queryClient.setQueryData(['offers-preference'], context.before);
      showProblem(t`Not saved`, error);
    },
  });

  const open = (fromSwitch: boolean) => {
    setTurningOn(fromSwitch);
    setChoosing(true);
  };

  const close = () => {
    Keyboard.dismiss();
    setChoosing(false);
    setTurningOn(false);
    setTyped('');
    setAsked('');
    setFocused(false);
  };

  /** Out of typing, back to all three ways. */
  const stopSearching = () => {
    field.current?.blur();
    Keyboard.dismiss();
    setTyped('');
    setAsked('');
    setFocused(false);
  };

  const pick = (place: FoundAddress) => {
    if (!preference.data) return;
    save.mutate({
      optedIn: preference.data.optedIn || turningOn,
      spot: { latitude: place.latitude, longitude: place.longitude, label: place.label },
    });
    close();
  };

  /**
   * Where the phone is now (§169): its best fix, named by the phone's own
   * address lookup so the customer sees a street rather than numbers. Asked
   * for only here, when they press the button — never on its own (§107.3).
   */
  const [locating, setLocating] = useState(false);
  /**
   * What went wrong finding the phone, said in the sheet beside the button
   * (§184) — not in a pop-up over a sheet that is already open. `settings`
   * when only the phone's Settings can turn location back on.
   */
  const [spotProblem, setSpotProblem] = useState<{ text: string; settings?: boolean } | null>(null);
  const takeExactSpot = async () => {
    setSpotProblem(null);
    if (!preference.data) return;
    const optedIn = preference.data.optedIn || turningOn;
    setLocating(true);
    try {
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setSpotProblem(
          canAskAgain
            ? { text: t`Location is off. Allow it to use where you are, or type the address above.` }
            : {
                text: t`Location is off for this app. Turn it on in Settings, or type the address above.`,
                settings: true,
              },
        );
        return;
      }
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const { latitude, longitude } = fix.coords;
      let label: string | undefined;
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
        const parts = [place?.street ?? place?.name, place?.district ?? place?.subregion ?? place?.city]
          .filter((part): part is string => Boolean(part))
          // "KG 11 Ave, KG 11 Ave" when the phone names a place twice.
          .filter((part, i, all) => all.indexOf(part) === i);
        if (parts.length > 0) label = parts.join(', ').slice(0, 120);
      } catch {
        // A spot with no name is still a spot; the email says "near you".
      }
      save.mutate({ optedIn, spot: { latitude, longitude, ...(label ? { label } : {}) } });
      close();
    } catch {
      setSpotProblem({ text: t`Your phone could not find where you are. Try again outdoors, or type the address above.` });
    } finally {
      setLocating(false);
    }
  };

  if (!preference.data) return null;
  const { optedIn, district, spot } = preference.data;
  const hasPlace = Boolean(district || spot);

  const where = spot
    ? (spot.label ?? t`Your saved address`)
    : district
      ? `${district.name}, ${district.provinceName}`
      : null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Icon name="mail-outline" size={19} color={theme.accent} />
        </View>
        <View style={styles.flex}>
          <Text style={type.heading}><Trans>Weekly offers by email</Trans></Text>
          <Text style={type.small}><Trans>Popular near you, every Friday</Trans></Text>
        </View>
        <Switch
          value={optedIn}
          accessibilityLabel={t`Weekly offers by email`}
          trackColor={{ true: theme.accent, false: theme.line }}
          thumbColor="#FFFFFF"
          onValueChange={(on) => {
            if (on && !hasPlace) open(true);
            else save.mutate({ optedIn: on });
          }}
        />
      </View>

      {/* WHICH address, said right under the name (§172): the one thing a
          customer has to get right, and the one most easily set wrong. */}
      <PressableScale
        onPress={() => open(false)}
        haptic
        accessibilityRole="button"
        accessibilityLabel={where ? t`Sent for ${where}. Change the address` : t`Add an address`}
        style={[styles.address, !where && styles.addressEmpty]}
      >
        <View style={[styles.addressIcon, !where && styles.addressIconEmpty]}>
          <Icon
            name={spot ? 'home' : district ? 'map-outline' : 'add'}
            size={17}
            color={where ? theme.accent : '#FFFFFF'}
          />
        </View>
        <View style={styles.flex}>
          {/* "Change" sits up here, beside the label, so the address itself
              has the whole width — it is the part that has to be read. */}
          <View style={styles.kickerRow}>
            <Text style={styles.addressKicker}>{where ? t`Sent for` : t`No address yet`}</Text>
            <Text style={styles.change}>{where ? t`Change` : t`Add`}</Text>
          </View>
          <Text style={type.subheading} numberOfLines={3}>
            {where ?? t`Add the address to send offers for`}
          </Text>
          {/* Said, because the two give different answers: an address is
              measured by road; a district is the whole district. */}
          <Text style={type.tiny}>
            {spot
              ? t`Saved address · measured by road`
              : district
                ? t`Whole district · add an address for real distances`
                : t`Home, work, or anywhere you like`}
          </Text>
        </View>
      </PressableScale>

      <Text style={type.small}>
        <Trans>
          Picked near this address, not where your phone is. Turn it off here or from any of the
          emails.
        </Trans>
      </Text>

      <Sheet open={choosing} title={t`Send offers for which address?`} onClose={close}>
        <ScrollView
          contentContainerStyle={styles.sheet}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {spot && !searching && (
            <View style={styles.current}>
              <Icon name="home" size={16} color={theme.accent} />
              <View style={styles.flex}>
                <Text style={styles.addressKicker}><Trans>Saved now</Trans></Text>
                <Text style={styles.currentText} numberOfLines={2}>
                  {spot.label ?? `${spot.latitude.toFixed(4)}, ${spot.longitude.toFixed(4)}`}
                </Text>
              </View>
              <Button
                compact
                kind="ghost"
                label={t`Forget it`}
                onPress={() => {
                  // Forgetting the address with no district left would leave
                  // nothing to measure from, so the emails stop too.
                  save.mutate({ optedIn: optedIn && Boolean(district), spot: null });
                  close();
                }}
              />
            </View>
          )}

          {/* 1. Typed, with places suggested as it is typed (§172, §174). */}
          <View style={styles.block}>
            {!searching && <Text style={type.subheading}><Trans>Type the address</Trans></Text>}
            <View style={styles.searchRow}>
              <View style={[styles.search, focused && styles.searchOn]}>
                <Icon name="search" size={17} color={focused ? theme.accent : theme.muted} />
                <TextInput
                  ref={field}
                  style={styles.searchInput}
                  value={typed}
                  onChangeText={setTyped}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder={t`Start typing a street or place`}
                  placeholderTextColor={theme.muted}
                  returnKeyType="search"
                  // Return asks at once rather than waiting for the pause.
                  onSubmitEditing={() => setAsked(typed.trim().replace(/\s+/g, ' '))}
                  autoCorrect={false}
                  accessibilityLabel={t`Address to search for`}
                />
                {found.isFetching ? (
                  <ActivityIndicator size="small" color={theme.accent} />
                ) : typed.length > 0 ? (
                  <PressableScale
                    onPress={() => {
                      setTyped('');
                      setAsked('');
                      field.current?.focus();
                    }}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t`Clear the address`}
                    style={styles.clear}
                  >
                    <Icon name="close" size={13} color={theme.ink2} />
                  </PressableScale>
                ) : null}
              </View>
              {searching && (
                <PressableScale onPress={stopSearching} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.cancel}><Trans>Cancel</Trans></Text>
                </PressableScale>
              )}
            </View>

            {typed.trim().length < 3 ? (
              <Text style={type.tiny}>
                {typed.trim().length === 0
                  ? t`Places appear as you type — "KG 11", "Kimironko", "Kigali Heights".`
                  : t`Keep typing…`}
              </Text>
            ) : found.isPending && found.isFetching ? (
              <View style={styles.results}>
                {[0, 1, 2].map((n) => (
                  <View key={n} style={styles.resultGhost}>
                    <Skeleton width={30} height={30} round={15} />
                    <View style={styles.flex}>
                      <Skeleton width="75%" height={12} />
                      <Skeleton width="45%" height={10} style={styles.ghostGap} />
                    </View>
                  </View>
                ))}
              </View>
            ) : found.isError ? (
              <Text style={styles.notice}>
                {found.error instanceof ApiError ? found.error.message : t`Could not search. Try again.`}
              </Text>
            ) : found.data && !found.data.available ? (
              <Text style={styles.notice}>
                <Trans>
                  Address search is not working just now. Use where you are, or choose a district.
                </Trans>
              </Text>
            ) : found.data && found.data.results.length === 0 && !found.isPlaceholderData ? (
              <Text style={styles.notice}>
                <Trans>
                  Nothing found for "{asked}". Try a street name, a building or a neighbourhood.
                </Trans>
              </Text>
            ) : found.data ? (
              <View style={[styles.results, found.isPlaceholderData && styles.resultsStale]}>
                {found.data.results.map((place) => (
                  <PressableScale
                    key={`${place.latitude},${place.longitude}`}
                    onPress={() => pick(place)}
                    haptic
                    accessibilityRole="button"
                    accessibilityLabel={t`Use ${place.label}${place.detail ? `, ${place.detail}` : ''}`}
                    style={styles.result}
                  >
                    <View style={styles.resultIcon}>
                      <Icon name="location" size={15} color={theme.accent} />
                    </View>
                    <View style={styles.flex}>
                      <Highlighted text={place.label} typed={asked} />
                      {place.detail ? <Text style={type.tiny}>{place.detail}</Text> : null}
                    </View>
                    <Icon name="arrow-forward" size={15} color={theme.muted} />
                  </PressableScale>
                ))}
              </View>
            ) : null}
          </View>

          {!searching && (
            <>
              {/* 2. Where the phone is now (§169). */}
              <View style={styles.block}>
                <View style={styles.exactHead}>
                  <View style={styles.exactIcon}>
                    <Icon name="navigate" size={18} color={theme.accent} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={type.subheading}><Trans>At the address right now?</Trans></Text>
                    <Text style={type.small}>
                      <Trans>
                        Save the exact spot your phone is at — your home, say.
                      </Trans>
                    </Text>
                  </View>
                </View>
                <Button
                  compact
                  kind="soft"
                  icon="locate"
                  label={locating ? t`Finding you…` : t`Use where I am now`}
                  busy={locating}
                  onPress={takeExactSpot}
                />
                {spotProblem && (
                  <FadeIn style={styles.spotProblem}>
                    <Icon name="location" size={16} color={theme.warn} />
                    <View style={styles.flex}>
                      <Text style={styles.spotProblemText}>{spotProblem.text}</Text>
                      {spotProblem.settings && (
                        <PressableScale
                          onPress={() => void Linking.openSettings()}
                          hitSlop={8}
                          accessibilityRole="button"
                        >
                          <Text style={styles.spotProblemLink}><Trans>Open Settings</Trans></Text>
                        </PressableScale>
                      )}
                    </View>
                  </FadeIn>
                )}
                <Text style={type.tiny}>
                  <Trans>
                    Kept only for these emails and never shown to shops. Forget it any time.
                  </Trans>
                </Text>
              </View>

              {/* 3. A whole district, for someone who would rather not say more. */}
              <Text style={type.label}><Trans>Or a whole district</Trans></Text>
              {provinces.data?.map((province) => (
                <View key={province.id} style={styles.group}>
                  <Text style={type.label}>{province.name}</Text>
                  <View style={styles.chips}>
                    {province.districts.map((option) => (
                      <Chip
                        key={option.id}
                        tone="accent"
                        label={option.name}
                        active={!spot && district?.id === option.id}
                        onPress={() => {
                          // A district instead of an address: the address is
                          // forgotten, or the email would go on using it.
                          save.mutate({
                            optedIn: optedIn || turningOn,
                            districtId: option.id,
                            ...(spot ? { spot: null } : {}),
                          });
                          close();
                        }}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </Sheet>
    </View>
  );
}

/**
 * A suggestion with the letters already typed picked out, so the eye goes
 * straight to why it matched: **Kimir**onko Market, KG 153 Street.
 */
function Highlighted({ text, typed }: { text: string; typed: string }) {
  const words = typed
    .toLowerCase()
    .split(' ')
    .filter((word) => word.length >= 2)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) {
    return (
      <Text style={styles.resultLabel} numberOfLines={2}>
        {text}
      </Text>
    );
  }
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'gi'));
  return (
    <Text style={styles.resultLabel} numberOfLines={2}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={styles.match}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.xl,
    padding: 20,
    gap: 12,
    ...shadow.card,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  address: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  addressEmpty: {
    backgroundColor: theme.panel,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#F6C3B4',
  },
  addressIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressIconEmpty: { backgroundColor: theme.accent },
  addressKicker: {
    fontFamily: font.bold,
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: theme.muted,
  },
  kickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  change: { fontFamily: font.bold, fontSize: 13.5, color: theme.accent },
  sheet: { gap: 16, paddingBottom: 8 },
  current: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.accentSoft,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 4,
  },
  currentText: { fontFamily: font.bold, fontSize: 14, color: theme.ink },
  block: {
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 14,
    gap: 10,
    borderWidth: 1.5,
    borderColor: theme.accentSoft,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: theme.sunken,
  },
  searchOn: { borderColor: theme.accent, backgroundColor: theme.panel },
  searchInput: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 14.5,
    color: theme.ink,
    paddingVertical: 0,
  },
  results: { gap: 6 },
  resultsStale: { opacity: 0.55 },
  clear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: { fontFamily: font.semibold, fontSize: 14.5, color: theme.ink2, paddingHorizontal: 2 },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    backgroundColor: theme.sunken,
  },
  resultGhost: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 },
  ghostGap: { marginTop: 6 },
  resultIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultLabel: { fontFamily: font.semibold, fontSize: 14, lineHeight: 19, color: theme.ink2 },
  match: { fontFamily: font.extrabold, color: theme.ink },
  notice: { fontFamily: font.medium, fontSize: 13, lineHeight: 18.5, color: theme.ink2 },
  exactHead: { flexDirection: 'row', gap: 12 },
  exactIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  group: { gap: 9 },
  spotProblem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: theme.warnSoft,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  spotProblemText: { fontFamily: font.semibold, fontSize: 13, lineHeight: 18.5, color: theme.ink2 },
  spotProblemLink: { fontFamily: font.bold, fontSize: 13.5, color: theme.accent, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
