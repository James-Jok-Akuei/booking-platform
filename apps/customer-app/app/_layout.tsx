import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  PlusJakartaSans_400Regular_Italic,
  PlusJakartaSans_500Medium_Italic,
  PlusJakartaSans_700Bold_Italic,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onSessionEnded, tokens } from '../src/api/client';
import { LegalPrompt } from '../src/components/LegalPrompt';
import { DialogHost } from '../src/ui/Dialog';
import { theme } from '../src/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A phone loses signal in a way a desktop does not, so a failed request
      // is more often worth one more try than it is on the web.
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  // The app's typeface (§133). Text drawn before it loads would be drawn in the
  // system font and then jump, so nothing renders until it is in — the splash
  // screen covers the wait, which is a few hundred milliseconds from the bundle.
  // An ERROR counts as done: a phone that cannot load a font still gets an app,
  // in the system face, rather than a splash screen forever.
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    PlusJakartaSans_400Regular_Italic,
    PlusJakartaSans_500Medium_Italic,
    PlusJakartaSans_700Bold_Italic,
  });

  // SecureStore is async, so the token cache is filled once before anything
  // that depends on being signed in renders.
  useEffect(() => {
    tokens.hydrate().finally(() => setReady(true));
  }, []);

  /**
   * When a refresh has definitively failed, send the person to sign in (§117.4).
   *
   * Both web apps have done this since they were written — through a window
   * event, which a phone does not have — and the hook this app shipped for it
   * was wired to nothing. So an expired session left every screen rendering with
   * every query failing, and no way to tell that signing in again would fix it.
   *
   * The cache is cleared on the way, for the same reason the account screen
   * clears it: everything in it was fetched as that person.
   */
  useEffect(
    () =>
      onSessionEnded(() => {
        queryClient.clear();
        router.replace('/sign-in?next=/');
      }),
    [],
  );

  if (!ready || (!fontsLoaded && !fontError)) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        {/* Above the navigator, so a replaced document is seen wherever somebody
            happens to be (§126.3). It renders nothing when there is nothing to
            say, which is almost always. */}
        <LegalPrompt />
        {/* No native headers anywhere (§133): every screen draws its own top
            bar, so the back button, the title and the type are the app's and
            are the same on every screen. */}
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.bg },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="categories" />
          <Stack.Screen name="legal" />
          <Stack.Screen name="notifications" />
          {/* Rises from the bottom: signing in is an interruption to whatever
              was being done, and it should look like one that can be put away. */}
          <Stack.Screen
            name="sign-in"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
        </Stack>
        {/* Every question and message the app asks (§184), in its own design
            rather than the phone's grey alert. One host, so they queue. */}
        <DialogHost />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
