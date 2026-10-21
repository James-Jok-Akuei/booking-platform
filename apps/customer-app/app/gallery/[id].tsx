import { useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getShop } from '../../src/api/discovery';
import { font, radius, shadow, theme, type } from '../../src/theme';
import { Avatar } from '../../src/ui/Avatar';
import { Chip } from '../../src/ui/Chip';
import { EmptyState } from '../../src/ui/EmptyState';
import { FadeIn } from '../../src/ui/FadeIn';
import { Icon } from '../../src/ui/Icon';
import { useLayout } from '../../src/ui/layout';
import { PopIn } from '../../src/ui/Motion';
import { PhotoViewer, type ViewerPhoto } from '../../src/ui/PhotoViewer';
import { PressableScale } from '../../src/ui/PressableScale';
import { Skeleton } from '../../src/ui/Skeleton';
import { TopBar } from '../../src/ui/TopBar';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

const GAP = 8;

/** A photo with where it came from, so the wall can be filtered and captioned. */
type Shot = ViewerPhoto & {
  /** 'place' for the branch's own photos; a service id for a service's. */
  group: string;
  /** Width ÷ height once known; 4:3 until then. */
  ratio: number;
};

/**
 * Every photo of a shop, in one place (§152).
 *
 * "See all" used to open the first photo in the viewer — which is a way to
 * see the photos one at a time, not to see them all. This is the wall: the
 * branch's own photos and every service's photos, laid as a masonry — two
 * columns of tiles at the photos' own shapes, each dropped into whichever
 * column is shorter, so nothing is cropped to a square and nothing leaves a
 * hole. One photo opens larger as the lead.
 *
 * Chips along the top narrow the wall to the place or to one service, which is
 * how someone decides between "their braids" and "their nails" without
 * guessing from thumbnails. Every tile opens the viewer at that photo, with the
 * service's name beside the counter.
 *
 * Shapes are learnt as the images load (`Image.getSize`), so the wall starts
 * at 4:3 and settles into itself over the first second — a tile growing a
 * little is better than a wall that waits.
 */
export default function Gallery() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const [group, setGroup] = useState<string>('all');
  const [open, setOpen] = useState<number | null>(null);
  const [ratios, setRatios] = useState<Record<string, number>>({});

  const shop = useQuery({ queryKey: ['shop', id], queryFn: () => getShop(id) });
  const s = shop.data;

  // Every photo of the shop, place first, then each service in catalogue order.
  const all = useMemo<Shot[]>(() => {
    if (!s) return [];
    const place: Shot[] = s.gallery.map((p) => ({
      id: p.id,
      url: p.url,
      group: 'place',
      label: s.name,
      ratio: ratios[p.id] ?? 4 / 3,
    }));
    const services: Shot[] = s.services.flatMap((service) =>
      service.images.map((p) => ({
        id: p.id,
        url: p.url,
        group: service.id,
        label: service.name,
        ratio: ratios[p.id] ?? 4 / 3,
      })),
    );
    return [...place, ...services];
  }, [s, ratios]);

  // Learn each photo's shape once. Failures stay at 4:3, which is fine.
  useEffect(() => {
    for (const shot of all) {
      if (ratios[shot.id] !== undefined) continue;
      Image.getSize(
        shot.url,
        (w, h) => {
          if (w > 0 && h > 0) {
            setRatios((was) => (was[shot.id] ? was : { ...was, [shot.id]: w / h }));
          }
        },
        () => setRatios((was) => (was[shot.id] ? was : { ...was, [shot.id]: 4 / 3 })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all.length]);

  const groups = useMemo(() => {
    if (!s) return [];
    const list: Array<{ id: string; label: string; count: number }> = [];
    if (s.gallery.length > 0) list.push({ id: 'place', label: t`The place`, count: s.gallery.length });
    for (const service of s.services) {
      if (service.images.length > 0) {
        list.push({ id: service.id, label: service.name, count: service.images.length });
      }
    }
    return list;
  }, [s]);

  const shown = group === 'all' ? all : all.filter((shot) => shot.group === group);
  const [lead, ...rest] = shown;

  // The masonry: each tile goes to the shorter column, so the two ends land
  // close together. Three columns on anything wider than a phone.
  const inner = layout.contentWidth - layout.gutter * 2;
  const columnCount = inner >= 560 ? 3 : 2;
  const tileWidth = (inner - GAP * (columnCount - 1)) / columnCount;
  const columns = useMemo(() => {
    const cols: Array<{ height: number; tiles: Array<{ shot: Shot; index: number; height: number }> }> =
      Array.from({ length: columnCount }, () => ({ height: 0, tiles: [] }));
    rest.forEach((shot, i) => {
      // Tall portraits are tamed a little so one does not swallow a column.
      const height = Math.round(tileWidth / Math.max(0.6, Math.min(1.9, shot.ratio)));
      const target = cols.reduce((best, c) => (c.height < best.height ? c : best), cols[0]);
      target.tiles.push({ shot, index: i + 1, height });
      target.height += height + GAP;
    });
    return cols;
  }, [rest, columnCount, tileWidth]);

  if (shop.isLoading) {
    return (
      <View style={styles.screen}>
        <TopBar title={t`Photos`} />
        <View style={[styles.content, { paddingHorizontal: layout.gutter }]}>
          <Skeleton height={260} round={radius.xl} />
          <View style={styles.wall}>
            <View style={styles.column}>
              <Skeleton height={180} round={radius.lg} />
              <Skeleton height={120} round={radius.lg} />
            </View>
            <View style={styles.column}>
              <Skeleton height={120} round={radius.lg} />
              <Skeleton height={180} round={radius.lg} />
            </View>
          </View>
        </View>
      </View>
    );
  }
  if (!s) {
    return (
      <View style={styles.screen}>
        <TopBar title={t`Photos`} />
        <EmptyState icon="images-outline" title={t`This place is not available right now.`} />
      </View>
    );
  }

  const shopName = s.business.name ?? s.name;

  return (
    <View style={styles.screen}>
      <TopBar
        title={t`Photos`}
        subtitle={`${shopName} · ${all.length} ${all.length === 1 ? 'photo' : 'photos'}`}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28, width: layout.contentWidth, paddingHorizontal: layout.gutter },
        ]}
      >
        {all.length === 0 && (
          <EmptyState
            icon="images-outline"
            title={t`No photos yet.`}
            text={t`This place has not added any pictures. Its services may still be worth a look.`}
          />
        )}

        {/* What to look at: the place, or one service. */}
        {groups.length > 1 && (
          <FadeIn>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -layout.gutter }}
              contentContainerStyle={[styles.chips, { paddingHorizontal: layout.gutter }]}
            >
              <Chip label={t`All · ${all.length}`} tone="accent" active={group === 'all'} onPress={() => setGroup('all')} />
              {groups.map((g) => (
                <Chip
                  key={g.id}
                  label={`${g.label} · ${g.count}`}
                  tone="accent"
                  active={group === g.id}
                  onPress={() => setGroup(group === g.id ? 'all' : g.id)}
                />
              ))}
            </ScrollView>
          </FadeIn>
        )}

        {/* The lead: one photo, large, with the shop on it. */}
        {lead && (
          <FadeIn key={`lead-${lead.id}`} delay={40}>
            <PressableScale
              scaleTo={0.985}
              accessibilityRole="imagebutton"
              accessibilityLabel={t`${lead.label ?? 'Photo'}, 1 of ${shown.length}`}
              onPress={() => setOpen(0)}
            >
              <Image
                source={{ uri: lead.url }}
                style={[
                  styles.lead,
                  // Its own shape within reason, and never more than half the
                  // screen tall — a portrait on a tablet should not be a wall.
                  {
                    height: Math.min(
                      Math.round(layout.height * 0.52),
                      Math.round(inner / Math.max(0.9, Math.min(1.6, lead.ratio))),
                    ),
                  },
                ]}
              />
              <LinearGradient
                colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
                style={styles.leadShade}
                pointerEvents="none"
              />
              <View style={styles.leadText} pointerEvents="none">
                <Avatar uri={s.business.logoUrl} name={shopName} size={34} />
                <View style={styles.flex}>
                  <Text style={styles.leadName} numberOfLines={1}>
                    {shopName}
                  </Text>
                  <Text style={styles.leadSub} numberOfLines={1}>
                    {lead.label}
                  </Text>
                </View>
                <View style={styles.leadOpen}>
                  <Icon name="expand-outline" size={16} color="#FFFFFF" />
                </View>
              </View>
            </PressableScale>
          </FadeIn>
        )}

        {/* The wall. */}
        {rest.length > 0 && (
          <View style={styles.wall}>
            {columns.map((column, c) => (
              <View key={c} style={[styles.column, { width: tileWidth }]}>
                {column.tiles.map(({ shot, index, height }, i) => (
                  <PopIn key={shot.id} delay={Math.min(c + i * columnCount, 10) * 45}>
                    <PressableScale
                      scaleTo={0.96}
                      haptic
                      accessibilityRole="imagebutton"
                      accessibilityLabel={t`${shot.label ?? 'Photo'}, ${index + 1} of ${shown.length}`}
                      onPress={() => setOpen(index)}
                    >
                      <Image source={{ uri: shot.url }} style={[styles.tile, { height }]} />
                      {group === 'all' && shot.label && (
                        <View style={styles.tag}>
                          <Text style={styles.tagText} numberOfLines={1}>
                            {shot.label}
                          </Text>
                        </View>
                      )}
                    </PressableScale>
                  </PopIn>
                ))}
              </View>
            ))}
          </View>
        )}

        {/* Where this leads: looking is for choosing. */}
        {all.length > 0 && (
          <FadeIn delay={200} style={styles.foot}>
            <PressableScale
              haptic
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.footButton}
            >
              <Icon name="calendar-outline" size={17} color="#FFFFFF" />
              <Text style={styles.footText}><Trans>Back to {shopName} to book</Trans></Text>
            </PressableScale>
          </FadeIn>
        )}
      </ScrollView>

      <PhotoViewer photos={shown} openAt={open} onClose={() => setOpen(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  content: { paddingTop: 6, gap: 14, alignSelf: 'center' },
  chips: { gap: 8 },
  lead: { width: '100%', borderRadius: radius.xl, backgroundColor: theme.line },
  leadShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 120,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  leadText: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  leadName: { fontFamily: font.extrabold, fontSize: 16, color: '#FFFFFF' },
  leadSub: { fontFamily: font.semibold, fontSize: 12.5, color: 'rgba(255,255,255,0.8)' },
  leadOpen: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wall: { flexDirection: 'row', gap: GAP },
  column: { flex: 1, gap: GAP },
  tile: { width: '100%', borderRadius: radius.lg, backgroundColor: theme.line },
  tag: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: '80%',
    backgroundColor: 'rgba(31,42,31,0.62)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tagText: { fontFamily: font.bold, fontSize: 11, color: '#FFFFFF' },
  foot: { alignItems: 'center', marginTop: 8 },
  footButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: theme.night,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 22,
    ...shadow.raised,
  },
  footText: { fontFamily: font.bold, fontSize: 14.5, color: '#FFFFFF' },
});
