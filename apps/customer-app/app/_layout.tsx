import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
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
import { onSessionEnded, tokens, useSignedIn } from '../src/api/client';
import { configurePush, onAlertOpened, refreshPush } from '../src/push';
import { useLiveNotifications } from '../src/useLive';
import { LegalPrompt } from '../src/components/LegalPrompt';
import { DialogHost } from '../src/ui/Dialog';
import { Intro } from '../src/ui/Intro';
import { guardWebDrops } from '../src/ui/webDrop';
import { theme } from '../src/theme';

configurePush();
// On the web, a photo let go outside a drop place must not replace the app (§305).
guardWebDrops();

// The launch screen stays up until the intro's first frame, which is the same
// picture to the dot (§302); the intro hides it then. A short fade covers any
// pixel of difference. (Expo Go shows its own launch screen and refuses options.)
SplashScreen.preventAutoHideAsync().catch(() => undefined);
if (!isRunningInExpoGo()) SplashScreen.setOptions({ duration: 200, fade: true });

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

  // The opening picture (§302) says when to build the app underneath it — once
  // its lines are drawn, so putting the first screen together never makes them
  // stutter — and when it has gone. The web's page draws its own picture,
  // apart from the app, so there the app goes in at once.
  const [begun, setBegun] = useState(Platform.OS === 'web');
  const [introGone, setIntroGone] = useState(false);
  const begin = useCallback(() => setBegun(true), []);
  const gone = useCallback(() => setIntroGone(true), []);

  // The app's typeface (§133). Text drawn before it loads would be drawn in the
  // system font and then jump, so nothing renders until it is in — the intro
  // covers the wait, which is a few hundred milliseconds from the bundle.
  // An ERROR counts as done: a phone that cannot load a font still gets an app,
  // in the system face, rather than an intro forever.
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

  // Whatever becomes of the picture, nobody is kept behind it: the app goes in
  // after three seconds at the latest, and the picture is gone five after that.
  useEffect(() => {
    const timer = setTimeout(() => {
      begin();
      SplashScreen.hideAsync().catch(() => undefined);
    }, 3000);
    return () => clearTimeout(timer);
  }, [begin]);

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

  const fontsReady = fontsLoaded || !!fontError;
  const appIn = ready && fontsReady && begun;

  useEffect(() => {
    if (!appIn || introGone) return;
    const timer = setTimeout(gone, 5000);
    return () => clearTimeout(timer);
  }, [appIn, introGone, gone]);

  return (
    <SafeAreaProvider>
      {/* Light on the intro's night, dark on the app's paper. */}
      <StatusBar style={introGone ? 'dark' : 'light'} />
      {appIn && (
        <QueryClientProvider client={queryClient}>
          {/* Above the navigator, so a replaced document is seen wherever somebody
              happens to be (§126.3). It renders nothing when there is nothing to
              say, which is almost always — and nothing over the intro. */}
          {introGone && <LegalPrompt />}
          <Alerts />
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
      )}
      {!introGone && <Intro fontsReady={fontsReady} appReady={appIn} onBegin={begin} onGone={gone} />}
    </SafeAreaProvider>
  );
}

/**
 * Alerts (§287): the bell kept live while signed in; this phone's note on the
 * server refreshed; a tapped alert opening what it is about — including the
 * one that started the app.
 */
function Alerts() {
  const signedIn = useSignedIn();
  useLiveNotifications();
  useEffect(() => {
    if (signedIn) void refreshPush();
  }, [signedIn]);
  useEffect(() => onAlertOpened((link) => router.push(link as never)), []);
  return null;
}
