import { StyleSheet, Text, View } from 'react-native';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { canShareOnWeb, mapsApps, openDirections, sendPlace, type MapsApp, type Place } from '../directions';
import { font, radius, shadow, theme, type } from '../theme';
import { Button } from '../ui/Button';
import { showDialog } from '../ui/Dialog';
import { FadeIn } from '../ui/FadeIn';
import { Icon, type IconName } from '../ui/Icon';
import { PressableScale } from '../ui/PressableScale';
import { Sheet } from '../ui/Sheet';
import { StaticMap } from '../ui/StaticMap';

/**
 * Where a branch is (§318): its pin on a map, its address, how to find the
 * door in the shop's own words, and the way there. On the shop page under
 * whichever tab is open, and on a reservation while the visit is ahead —
 * the same card in both, so it is recognised.
 */
export function WhereCard({
  place,
  area,
  way,
  onDirections,
  delay = 0,
  mapHeight = 172,
}: {
  place: Place;
  /** "Gasabo, Kigali". */
  area?: string | null;
  /** "14 min by car", once the phone's position is known. */
  way?: string | null;
  onDirections: () => void;
  delay?: number;
  mapHeight?: number;
}) {
  const pinned = place.latitude !== null && place.longitude !== null;
  return (
    <FadeIn delay={delay} style={styles.section}>
      <Text style={type.heading}><Trans>Where it is</Trans></Text>
      <View style={styles.card}>
        {pinned && (
          <PressableScale
            onPress={onDirections}
            scaleTo={0.99}
            accessibilityRole="button"
            accessibilityLabel={t`Map of where ${place.shopName} is. Tap for directions`}
          >
            <StaticMap latitude={place.latitude!} longitude={place.longitude!} height={mapHeight}>
              {way && (
                <View style={styles.wayChip}>
                  <Icon name="car-outline" size={14} color={theme.ink} />
                  <Text style={styles.wayText}>{way}</Text>
                </View>
              )}
            </StaticMap>
          </PressableScale>
        )}

        <View style={styles.body}>
          <View style={styles.addressRow}>
            {!pinned && (
              <View style={styles.addressIcon}>
                <Icon name="location" size={18} color={theme.accent} />
              </View>
            )}
            <View style={styles.flex}>
              <Text style={type.subheading}>{place.branchName}</Text>
              <Text style={type.body} selectable>{place.address}</Text>
              {area && <Text style={type.small}>{area}</Text>}
            </View>
          </View>

          {/* The pin finds the building; this finds the door — in the shop's words. */}
          {place.findUs && (
            <View style={styles.note}>
              <View style={styles.noteIcon}>
                <Icon name="footsteps-outline" size={16} color={theme.accentDeep} />
              </View>
              <View style={styles.flex}>
                <Text style={type.label}><Trans>How to find it</Trans></Text>
                <Text style={styles.noteText} selectable>{place.findUs}</Text>
              </View>
            </View>
          )}

          <Button label={t`Get directions`} icon="navigate" onPress={onDirections} />
        </View>
      </View>
    </FadeIn>
  );
}

type Look = { label: string; icon: IconName; tile: string; ink: string };

const APPS: Record<MapsApp, Look> = {
  get apple(): Look {
    return { label: t`Apple Maps`, icon: 'logo-apple', tile: theme.night, ink: '#FFFFFF' };
  },
  get google(): Look {
    return { label: t`Google Maps`, icon: 'logo-google', tile: '#E8F0FE', ink: '#1A73E8' };
  },
  get waze(): Look {
    return { label: t`Waze`, icon: 'car-sport', tile: '#DDF5FD', ink: '#0B8FC4' };
  },
};

/**
 * The way there (§318): the maps apps this phone may have, each opening the
 * route to the exact pin from wherever the person is — the phone's maps app
 * has their roads, traffic and way of getting about, so it does the finding
 * and nothing about where they are comes to us. Then sending the place to
 * somebody, which is how people here say "meet me there".
 */
export function DirectionsSheet({ place, open, onClose }: { place: Place; open: boolean; onClose: () => void }) {
  const go = async (app: MapsApp) => {
    onClose();
    if (!(await openDirections(app, place))) {
      showDialog({ tone: 'warn', icon: 'map', title: t`Could not open maps`, message: `${place.shopName}\n${place.address}` });
    }
  };
  const send = async () => {
    onClose();
    const result = await sendPlace(place);
    if (result === 'copied') {
      showDialog({ tone: 'ok', icon: 'copy', title: t`Copied`, message: t`The address and a map link are copied — paste them where you like.` });
    } else if (result === 'failed') {
      showDialog({ tone: 'warn', icon: 'share-social', title: t`Could not send that`, message: `${place.shopName}\n${place.address}` });
    }
  };

  return (
    <Sheet open={open} title={t`Get directions`} onClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetPlace}>
          <Icon name="location" size={18} color={theme.accent} />
          <View style={styles.flex}>
            <Text style={type.subheading} numberOfLines={1}>{place.shopName}</Text>
            <Text style={type.small} numberOfLines={2}>
              {place.branchName !== place.shopName ? `${place.branchName} · ${place.address}` : place.address}
            </Text>
          </View>
        </View>

        <View style={styles.options}>
          {mapsApps().map((app, i) => (
            <Option key={app} first={i === 0} look={APPS[app]} onPress={() => go(app)} trailing="open-outline" />
          ))}
        </View>

        <View style={styles.options}>
          <Option
            first
            look={{ label: t`Send this place`, icon: 'share-social', tile: theme.accentSoft, ink: theme.accentDeep }}
            sub={canShareOnWeb() ? t`WhatsApp, a message, or copy it` : t`Copies the address and a map link`}
            onPress={send}
          />
        </View>

        <Text style={[type.small, styles.foot]}>
          <Trans>Your maps app works out the way from where you are.</Trans>
        </Text>
      </View>
    </Sheet>
  );
}

function Option({
  look,
  sub,
  first,
  trailing = 'chevron-forward',
  onPress,
}: {
  look: Look;
  sub?: string;
  first?: boolean;
  trailing?: IconName;
  onPress: () => void;
}) {
  return (
    <PressableScale onPress={onPress} haptic scaleTo={0.98} accessibilityRole="button" style={[styles.option, !first && styles.optionLine]}>
      <View style={[styles.optionTile, { backgroundColor: look.tile }]}>
        <Icon name={look.icon} size={20} color={look.ink} />
      </View>
      <View style={styles.flex}>
        <Text style={type.subheading}>{look.label}</Text>
        {sub && <Text style={type.small}>{sub}</Text>}
      </View>
      <Icon name={trailing} size={17} color={theme.muted} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { gap: 12 },
  card: { backgroundColor: theme.panel, borderRadius: radius.lg, overflow: 'hidden', ...shadow.card },
  wayChip: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.94)',
    ...shadow.card,
  },
  wayText: { fontFamily: font.bold, fontSize: 12.5, color: theme.ink },
  body: { padding: 16, gap: 14 },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  addressIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: theme.sunken,
  },
  noteIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteText: { fontFamily: font.medium, fontSize: 14.5, lineHeight: 21, color: theme.ink, marginTop: 3 },
  sheet: { gap: 14 },
  sheetPlace: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2 },
  options: { backgroundColor: theme.panel, borderRadius: radius.lg, paddingHorizontal: 14, ...shadow.card },
  option: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12 },
  optionLine: { borderTopWidth: 1, borderTopColor: theme.line },
  optionTile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  foot: { textAlign: 'center', paddingHorizontal: 12 },
});
