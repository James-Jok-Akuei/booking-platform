import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { listCategories, type Category } from '../src/api/discovery';
import { theme } from '../src/theme';

/**
 * A rough picture for each category, since the admin names them and nothing
 * ships an image per category.
 *
 * Keyed on the `icon` the admin set, falling back on the name. A missing one
 * renders a neutral mark rather than nothing, so the list never has a hole in it
 * where a picture should be.
 */
const GLYPH: Record<string, string> = {
  car: '🚗',
  scissors: '✂️',
  spa: '💆',
  dumbbell: '🏋️',
  camera: '📷',
  shirt: '👕',
  wrench: '🔧',
  sparkles: '✨',
  calendar: '📅',
  heart: '♥',
};

const glyphFor = (category: Category) =>
  (category.icon && GLYPH[category.icon]) ??
  GLYPH[category.name.toLowerCase().split(/[^a-z]/)[0] ?? ''] ??
  '◆';

/**
 * Everything the platform is open for, in one list (§121).
 *
 * Discovery already filters by category, through chips that scroll sideways and
 * show about three of eight. That works for someone who knows what they want.
 * This is for someone who does not: the whole list, what each one covers, and
 * the subcategories under it — which were reachable from nowhere at all.
 */
export default function Categories() {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories });

  return (
    <>
      <Stack.Screen options={{ title: 'Categories' }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {categories.isLoading && <ActivityIndicator color={theme.accent} />}

        {categories.data?.length === 0 && (
          <Text style={styles.empty}>Nothing is listed yet.</Text>
        )}

        {categories.data?.map((category) => {
          const expanded = open === category.id;
          return (
            <View key={category.id} style={styles.card}>
              <Pressable
                style={styles.row}
                onPress={() => router.push(`/?categoryId=${category.id}`)}
              >
                <Text style={styles.glyph}>{glyphFor(category)}</Text>
                <View style={styles.rowText}>
                  <Text style={styles.name}>{category.name}</Text>
                  {category.description && (
                    <Text style={styles.description}>{category.description}</Text>
                  )}
                </View>
              </Pressable>

              {/* Behind a tap rather than always open: eight categories with
                  every subcategory shown is a wall of words, and the names are
                  only useful once somebody has picked the area. */}
              {category.subcategories.length > 0 && (
                <>
                  <Pressable
                    onPress={() => setOpen(expanded ? null : category.id)}
                    hitSlop={8}
                  >
                    <Text style={styles.more}>
                      {expanded
                        ? 'Hide'
                        : `${category.subcategories.length} kinds of ${category.name.toLowerCase()}`}
                    </Text>
                  </Pressable>

                  {expanded && (
                    <View style={styles.subs}>
                      {category.subcategories.map((sub) => (
                        <Pressable
                          key={sub.id}
                          style={styles.sub}
                          onPress={() =>
                            router.push(
                              `/?categoryId=${category.id}&subcategoryId=${sub.id}`,
                            )
                          }
                        >
                          <Text style={styles.subText}>{sub.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </>
              )}
            </View>
          );
        })}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 16, gap: 10, paddingBottom: 28 },
  card: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    padding: 14,
    gap: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  glyph: { fontSize: 28 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: '700', color: theme.ink },
  description: { color: theme.muted, fontSize: 13, lineHeight: 18 },
  more: { color: theme.accent, fontWeight: '600', fontSize: 13 },
  subs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  sub: {
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: theme.bg,
  },
  subText: { color: theme.ink, fontSize: 13, fontWeight: '500' },
  empty: { color: theme.muted, textAlign: 'center', padding: 28 },
});
