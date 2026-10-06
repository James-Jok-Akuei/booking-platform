import { useState } from 'react';
import * as Location from 'expo-location';
import {
  Alert,
  Keyboard,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  const [asked, setAsked] = useState('');

  const preference = useQuery({ queryKey: ['offers-preference'], queryFn: getOffersPreference });
  const provinces = useQuery({
    queryKey: ['provinces'],
    queryFn: listProvinces,
    staleTime: Infinity,
  });
  const found = useQuery({
    queryKey: ['addresses', asked],
    queryFn: () => searchAddresses(asked),
    enabled: asked.length >= 3,
    // A place does not move; the same words need not be asked twice.
    staleTime: Infinity,
    retry: false,
  });

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
      Alert.alert(
        'Not saved',
        error instanceof ApiError ? error.message : 'Please try again.',
      );
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
  };

  const find = () => {
    const words = typed.trim().replace(/\s+/g, ' ');
    if (words.length < 3) return;
    Keyboard.dismiss();
    setAsked(words);
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
  const takeExactSpot = async () => {
    if (!preference.data) return;
    const optedIn = preference.data.optedIn || turningOn;
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location is off',
          'Allow location for this app to use where you are, or type the address instead.',
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
      Alert.alert('Could not find you', 'Try again outdoors, or type the address instead.');
    } finally {
      setLocating(false);
    }
  };

  if (!preference.data) return null;
  const { optedIn, district, spot } = preference.data;
  const hasPlace = Boolean(district || spot);

  const where = spot
    ? (spot.label ?? 'Your saved address')
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
          <Text style={type.heading}>Weekly offers by email</Text>
          <Text style={type.small}>Popular near you, every Friday</Text>
        </View>
        <Switch
          value={optedIn}
          accessibilityLabel="Weekly offers by email"
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
        accessibilityLabel={where ? `Sent for ${where}. Change the address` : 'Add an address'}
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
            <Text style={styles.addressKicker}>{where ? 'Sent for' : 'No address yet'}</Text>
            <Text style={styles.change}>{where ? 'Change' : 'Add'}</Text>
          </View>
          <Text style={type.subheading} numberOfLines={3}>
            {where ?? 'Add the address to send offers for'}
          </Text>
          {/* Said, because the two give different answers: an address is
              measured by road; a district is the whole district. */}
          <Text style={type.tiny}>
            {spot
              ? 'Saved address · measured by road'
              : district
                ? 'Whole district · add an address for real distances'
                : 'Home, work, or anywhere you like'}
          </Text>
        </View>
      </PressableScale>

      <Text style={type.small}>
        Picked near this address, not where your phone is. Turn it off here or from any of the
        emails.
      </Text>

      <Sheet open={choosing} title="Send offers for which address?" onClose={close}>
        <ScrollView
          contentContainerStyle={styles.sheet}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {spot && (
            <View style={styles.current}>
              <Icon name="home" size={16} color={theme.accent} />
              <View style={styles.flex}>
                <Text style={styles.addressKicker}>Saved now</Text>
                <Text style={styles.currentText} numberOfLines={2}>
                  {spot.label ?? `${spot.latitude.toFixed(4)}, ${spot.longitude.toFixed(4)}`}
                </Text>
              </View>
              <Button
                compact
                kind="ghost"
                label="Forget it"
                onPress={() => {
                  // Forgetting the address with no district left would leave
                  // nothing to measure from, so the emails stop too.
                  save.mutate({ optedIn: optedIn && Boolean(district), spot: null });
                  close();
                }}
              />
            </View>
          )}

          {/* 1. Typed, and picked from what the map finds (§172). */}
          <View style={styles.block}>
            <Text style={type.subheading}>Type the address</Text>
            <View style={styles.searchRow}>
              <View style={styles.search}>
                <Icon name="search" size={17} color={theme.muted} />
                <TextInput
                  style={styles.searchInput}
                  value={typed}
                  onChangeText={setTyped}
                  placeholder="A street, building or place"
                  placeholderTextColor={theme.muted}
                  returnKeyType="search"
                  onSubmitEditing={find}
                  autoCorrect={false}
                  accessibilityLabel="Address to search for"
                />
              </View>
              <Button
                compact
                label="Find"
                disabled={typed.trim().length < 3}
                busy={found.isFetching}
                onPress={find}
              />
            </View>
            <Text style={type.tiny}>For example "KG 11 Ave", "Kimironko Market" or "Kigali Heights".</Text>

            {asked.length >= 3 && found.isFetching && (
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
            )}

            {asked.length >= 3 && !found.isFetching && found.data && (
              <FadeIn key={asked}>
                {!found.data.available ? (
                  <Text style={styles.notice}>
                    Address search is not working just now. Use where you are, or choose a
                    district below.
                  </Text>
                ) : found.data.results.length === 0 ? (
                  <Text style={styles.notice}>
                    Nothing found for "{asked}". Try a street name, a building or a
                    neighbourhood.
                  </Text>
                ) : (
                  <View style={styles.results}>
                    {found.data.results.map((place) => (
                      <PressableScale
                        key={`${place.latitude},${place.longitude}`}
                        onPress={() => pick(place)}
                        haptic
                        accessibilityRole="button"
                        accessibilityLabel={`Use ${place.label}${place.detail ? `, ${place.detail}` : ''}`}
                        style={styles.result}
                      >
                        <View style={styles.resultIcon}>
                          <Icon name="location" size={15} color={theme.accent} />
                        </View>
                        <View style={styles.flex}>
                          <Text style={styles.resultLabel} numberOfLines={2}>
                            {place.label}
                          </Text>
                          {place.detail ? <Text style={type.tiny}>{place.detail}</Text> : null}
                        </View>
                        <Icon name="chevron-forward" size={15} color={theme.muted} />
                      </PressableScale>
                    ))}
                  </View>
                )}
              </FadeIn>
            )}

            {found.isError && !found.isFetching && (
              <Text style={styles.notice}>
                {found.error instanceof ApiError ? found.error.message : 'Could not search. Try again.'}
              </Text>
            )}
          </View>

          {/* 2. Where the phone is now (§169). */}
          <View style={styles.block}>
            <View style={styles.exactHead}>
              <View style={styles.exactIcon}>
                <Icon name="navigate" size={18} color={theme.accent} />
              </View>
              <View style={styles.flex}>
                <Text style={type.subheading}>At the address right now?</Text>
                <Text style={type.small}>
                  Save the exact spot your phone is at — your home, say.
                </Text>
              </View>
            </View>
            <Button
              compact
              kind="soft"
              icon="locate"
              label={locating ? 'Finding you…' : 'Use where I am now'}
              busy={locating}
              onPress={takeExactSpot}
            />
            <Text style={type.tiny}>
              Kept only for these emails and never shown to shops. Forget it any time.
            </Text>
          </View>

          {/* 3. A whole district, for someone who would rather not say more. */}
          <Text style={type.label}>Or a whole district</Text>
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
        </ScrollView>
      </Sheet>
    </View>
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
    backgroundColor: theme.sunken,
  },
  searchInput: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 14.5,
    color: theme.ink,
    paddingVertical: 0,
  },
  results: { gap: 6 },
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
  resultLabel: { fontFamily: font.bold, fontSize: 14, lineHeight: 19, color: theme.ink },
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
