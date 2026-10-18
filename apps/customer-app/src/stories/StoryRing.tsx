import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../theme';

/** The ring's colours: amber into the app's coral (§285). */
export const RING = ['#FFB547', '#F0532D', '#D7421E'] as const;

/**
 * The ring round a shop with a story (§285): coral while there is something
 * new, a thin grey line once it has all been seen. `size` is what sits inside.
 */
export function StoryRing({
  size,
  seen,
  gap = theme.bg,
  children,
}: {
  size: number;
  seen: boolean;
  /** The colour between the ring and the picture: whatever the ring sits on. */
  gap?: string;
  children: ReactNode;
}) {
  const outer = size + 10;
  const round = { width: outer, height: outer, borderRadius: outer / 2 };
  const inner = { width: size + 5, height: size + 5, borderRadius: (size + 5) / 2, backgroundColor: gap };

  if (seen) {
    return (
      <View style={[styles.center, round, styles.seen]}>
        <View style={[styles.center, inner]}>{children}</View>
      </View>
    );
  }
  return (
    <LinearGradient colors={RING} start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }} style={[styles.center, round]}>
      <View style={[styles.center, inner]}>{children}</View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  seen: { borderWidth: 1.5, borderColor: '#D9D5CD' },
});
