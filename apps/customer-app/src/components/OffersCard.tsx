import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getOffersPreference,
  setOffersPreference,
  type OffersPreference,
} from '../api/auth';
import { ApiError } from '../api/client';
import { listProvinces } from '../api/discovery';
import { radius, shadow, theme, type } from '../theme';
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

  if (!preference.data) return null;
  const { optedIn, district } = preference.data;

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
            if (on && !district) setChoosing(true);
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
        <Icon name="location-outline" size={17} color={theme.ink2} />
        <Text style={[type.subheading, styles.flex]} numberOfLines={1}>
          {district ? `${district.name}, ${district.provinceName}` : 'Choose your district'}
        </Text>
        <Icon name="chevron-forward" size={16} color={theme.muted} />
      </PressableScale>

      <Sheet open={choosing} title="Where are you?" onClose={() => setChoosing(false)}>
        <ScrollView contentContainerStyle={styles.sheet} showsVerticalScrollIndicator={false}>
          <Text style={type.small}>
            Used only to pick services near you for the weekly email.
          </Text>
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
                      save.mutate({ optedIn: optedIn || !district, districtId: option.id });
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
  group: { gap: 9 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
