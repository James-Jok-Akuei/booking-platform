import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listCategories } from '../src/api/discovery';
import { font, radius, shadow, theme, type } from '../src/theme';
import { EmptyState } from '../src/ui/EmptyState';
import { FadeIn } from '../src/ui/FadeIn';
import { Icon, lookFor } from '../src/ui/Icon';
import { useLayout } from '../src/ui/layout';
import { PressableScale } from '../src/ui/PressableScale';
import { RowSkeleton } from '../src/ui/Skeleton';
import { TopBar } from '../src/ui/TopBar';

/**
 * Everything the platform is open for, in one list (§121).
 *
 * Discovery already filters by category, through tiles that scroll sideways and
 * show about four of eight. That works for someone who knows what they want.
 * This is for someone who does not: the whole list, what each one covers, and
 * the subcategories under it — which were reachable from nowhere at all.
 *
 * Each category keeps the colour and icon it has on the home screen (§133), so
 * the rose sparkle there and the rose sparkle here are recognisably one thing.
 */
export default function Categories() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const [open, setOpen] = useState<string | null>(null);
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories });

  return (
    <View style={styles.screen}>
      <TopBar title="Categories" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 28, width: layout.contentWidth },
        ]}
      >
        {categories.isLoading && (
          <>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        )}

        {categories.data?.length === 0 && (
          <EmptyState icon="grid-outline" title="Nothing is listed yet." />
        )}

        {categories.data?.map((category, index) => {
          const expanded = open === category.id;
          const look = lookFor(category.icon);
          return (
            <FadeIn key={category.id} index={index} style={styles.card}>
              <PressableScale
                style={styles.row}
                scaleTo={0.98}
                // Back DOWN to the Home that is already there, not a second one
                // pushed on top of it (§133.6). Home is a tab now and stays
                // mounted; it follows the params it is handed.
                onPress={() => router.dismissTo(`/?categoryId=${category.id}`)}
              >
                <View style={[styles.disc, { backgroundColor: look.tint }]}>
                  <Icon name={look.icon} size={26} color={look.ink} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.name}>{category.name}</Text>
                  {category.description && (
                    <Text style={type.small}>{category.description}</Text>
                  )}
                </View>
                <Icon name="chevron-forward" size={18} color={theme.muted} />
              </PressableScale>

              {/* Behind a tap rather than always open: eight categories with
                  every subcategory shown is a wall of words, and the names are
                  only useful once somebody has picked the area. */}
              {category.subcategories.length > 0 && (
                <>
                  <PressableScale
                    onPress={() => setOpen(expanded ? null : category.id)}
                    hitSlop={8}
                    haptic
                    style={styles.moreRow}
                  >
                    <Text style={styles.more}>
                      {expanded
                        ? 'Hide'
                        : `${category.subcategories.length} kinds of ${category.name.toLowerCase()}`}
                    </Text>
                    <Icon
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={15}
                      color={theme.accent}
                    />
                  </PressableScale>

                  {expanded && (
                    <FadeIn distance={8} style={styles.subs}>
                      {category.subcategories.map((sub) => (
                        <PressableScale
                          key={sub.id}
                          haptic
                          scaleTo={0.94}
                          style={[styles.sub, { backgroundColor: look.tint }]}
                          onPress={() =>
                            router.dismissTo(
                              `/?categoryId=${category.id}&subcategoryId=${sub.id}`,
                            )
                          }
                        >
                          <Text style={[styles.subText, { color: look.ink }]}>{sub.name}</Text>
                        </PressableScale>
                      ))}
                    </FadeIn>
                  )}
                </>
              )}
            </FadeIn>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { paddingHorizontal: 20, paddingTop: 6, gap: 12, alignSelf: 'center' },
  card: {
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 14,
    gap: 12,
    ...shadow.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  disc: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontFamily: font.bold, fontSize: 16, color: theme.ink },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  more: { fontFamily: font.bold, fontSize: 13, color: theme.accent },
  subs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sub: { borderRadius: radius.pill, paddingHorizontal: 13, paddingVertical: 8 },
  subText: { fontFamily: font.semibold, fontSize: 13 },
});
