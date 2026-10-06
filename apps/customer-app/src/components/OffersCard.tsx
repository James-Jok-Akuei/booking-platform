import { useState } from 'react';
import * as Location from 'expo-location';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getOffersPreference,
  setOffersPreference,
  type OffersPreference,
} from '../api/auth';
import { ApiError } from '../api/client';
import { listProvinces } from '../api/discovery';
import { font, radius, shadow, theme, type } from '../theme';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Icon } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';
import { Sheet } from '../ui/Sheet';

/**
 * "Offers near me" (§140): one email a week about popular services in the
 * customer's own district.
 *
 * OFF until they turn it on, and the switch says exactly what turning it on
 * gets them — how often, about what, and that it can be undone. That sentence
 * is the consent; nothing is hidden behind it.
 *
 * "Near" is a district they pick from a list. Not their phone's position: a
 * district is enough to choose the right shops, and it is not a record of
 * where somebody was. Turning the switch on with no district chosen opens the
 * list, and choosing one is what finishes turning it on.
 */
export function OffersCard() {
  const queryClient = useQueryClient();
  const [choosing, setChoosing] = useState(false);

  const preference = useQuery({ queryKey: ['offers-preference'], queryFn: getOffersPreference });
  const provinces = useQuery({
    queryKey: ['provinces'],
    queryFn: listProvinces,
    staleTime: Infinity,
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

  /**
   * The exact spot (§169): the phone's best fix, named by the phone's own
   * address lookup so the customer sees a street rather than numbers. Asked
   * for only here, when they press the button — never on its own (§107.3).
   */
  const [locating, setLocating] = useState(false);
  const takeExactSpot = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location is off',
          'Allow location for this app to use your exact spot, or choose a district instead.',
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
      save.mutate({ optedIn: true, spot: { latitude, longitude, ...(label ? { label } : {}) } });
      setChoosing(false);
    } catch {
      Alert.alert('Could not find you', 'Try again outdoors, or choose a district instead.');
    } finally {
      setLocating(false);
    }
  };

  if (!preference.data) return null;
  const { optedIn, district, spot } = preference.data;
  const hasPlace = Boolean(district || spot);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Icon name="mail-outline" size={19} color={theme.accent} />
        </View>
        <View style={styles.flex}>
          <Text style={type.heading}>Offers near me</Text>
        </View>
        <Switch
          value={optedIn}
          accessibilityLabel="Offers near me"
          trackColor={{ true: theme.accent, false: theme.line }}
          thumbColor="#FFFFFF"
          onValueChange={(on) => {
            if (on && !hasPlace) setChoosing(true);
            else save.mutate({ optedIn: on });
          }}
        />
      </View>

      <Text style={type.small}>
        One email a week about popular services close to you. You can turn it off here, or
        from any of the emails.
      </Text>

      <PressableScale
        onPress={() => setChoosing(true)}
        haptic
        accessibilityRole="button"
        style={styles.district}
      >
        <Icon
          name={spot ? 'navigate' : 'location-outline'}
          size={17}
          color={spot ? theme.accent : theme.ink2}
        />
        <View style={styles.flex}>
          <Text style={type.subheading} numberOfLines={1}>
            {spot
              ? (spot.label ?? 'Your exact location')
              : district
                ? `${district.name}, ${district.provinceName}`
                : 'Choose where you are'}
          </Text>
          {/* Said, because the two give different answers: an exact spot is
              measured by road; a district is the whole district. */}
          {(spot || district) && (
            <Text style={type.tiny}>
              {spot ? 'Exact spot · distances by road' : 'Whole district'}
            </Text>
          )}
        </View>
        <Icon name="chevron-forward" size={16} color={theme.muted} />
      </PressableScale>

      <Sheet open={choosing} title="Where are you?" onClose={() => setChoosing(false)}>
        <ScrollView contentContainerStyle={styles.sheet} showsVerticalScrollIndicator={false}>
          {/* Most exact first (§169): a district can be ten kilometres across. */}
          <View style={styles.exact}>
            <View style={styles.exactHead}>
              <View style={styles.exactIcon}>
                <Icon name="navigate" size={18} color={theme.accent} />
              </View>
              <View style={styles.flex}>
                <Text style={type.subheading}>Use my exact location</Text>
                <Text style={type.small}>
                  Services are picked by real road distance from where you are now — your
                  home, say.
                </Text>
              </View>
            </View>
            {spot && (
              <Text style={styles.saved} numberOfLines={2}>
                Saved: {spot.label ?? `${spot.latitude.toFixed(4)}, ${spot.longitude.toFixed(4)}`}
              </Text>
            )}
            <View style={styles.exactActions}>
              <Button
                compact
                icon="locate"
                label={locating ? 'Finding you…' : spot ? 'Update to here' : 'Use where I am now'}
                busy={locating}
                onPress={takeExactSpot}
                style={styles.flex}
              />
              {spot && (
                <Button
                  compact
                  kind="ghost"
                  label="Forget it"
                  onPress={() => {
                    // Forgetting the spot with no district left would leave
                    // nothing to measure from, so the emails stop too.
                    save.mutate({ optedIn: optedIn && Boolean(district), spot: null });
                  }}
                />
              )}
            </View>
            <Text style={type.tiny}>
              Kept only for these emails and never shown to shops. Forget it any time.
            </Text>
          </View>

          <Text style={type.label}>Or choose a district</Text>
          {provinces.data?.map((province) => (
            <View key={province.id} style={styles.group}>
              <Text style={type.label}>{province.name}</Text>
              <View style={styles.chips}>
                {province.districts.map((option) => (
                  <Chip
                    key={option.id}
                    tone="accent"
                    label={option.name}
                    active={district?.id === option.id}
                    onPress={() => {
                      // Choosing a district from the switch is what turns it
                      // on; choosing one otherwise leaves the switch alone.
                      save.mutate({ optedIn: optedIn || !hasPlace, districtId: option.id });
                      setChoosing(false);
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
  district: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.sunken,
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  sheet: { gap: 16, paddingBottom: 8 },
  exact: {
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 14,
    gap: 10,
    borderWidth: 1.5,
    borderColor: theme.accentSoft,
  },
  exactHead: { flexDirection: 'row', gap: 12 },
  exactIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saved: { fontFamily: font.bold, fontSize: 13, color: theme.ink },
  exactActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  group: { gap: 9 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
