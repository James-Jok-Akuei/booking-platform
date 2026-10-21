import type { ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSignedIn } from '../api/client';
import { theme } from '../theme';
import { EmptyState } from '../ui/EmptyState';
import type { IconName } from '../ui/Icon';
import { TopBar } from '../ui/TopBar';
import { t } from '@lingui/core/macro';

type Wall = { title: string; text: string; icon: IconName };

/**
 * A screen that only means something to the person it belongs to (§170).
 *
 * Nothing signed-out points at these any more — the tabs, the bell and the
 * message button are hidden — but a link from an email or a notification still
 * can, and so can a session that ends while the screen is open. Every request
 * behind it would fail, so instead of a screen of errors it shows what is here
 * and the one thing that unlocks it. Signing in comes straight back to the same
 * address, which is now the real screen.
 *
 * The check sits OUTSIDE the screen rather than inside it, so the screen's own
 * hooks never run without an account and never have to be ordered around an
 * early return.
 */
export function requireSignIn<P extends object>(Screen: ComponentType<P>, wall: Wall) {
  function Guarded(props: P) {
    const signedIn = useSignedIn();
    const router = useRouter();
    const here = usePathname();

    if (signedIn) return <Screen {...props} />;

    return (
      <View style={styles.screen}>
        <TopBar />
        <EmptyState
          icon={wall.icon}
          title={wall.title}
          text={wall.text}
          action={t`Sign in`}
          onAction={() => router.push(`/sign-in?next=${encodeURIComponent(here)}`)}
        />
      </View>
    );
  }
  Guarded.displayName = `requireSignIn(${Screen.displayName ?? Screen.name})`;
  return Guarded;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
});
