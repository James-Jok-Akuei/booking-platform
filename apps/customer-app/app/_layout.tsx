import { useEffect, useState } from 'react';
import { Link, Stack } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '../src/api/client';
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

  // SecureStore is async, so the token cache is filled once before anything
  // that depends on being signed in renders.
  useEffect(() => {
    tokens.hydrate().finally(() => setReady(true));
  }, []);

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.panel },
          headerTintColor: theme.ink,
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'Find a place',
            // The only way back to a booking once this screen has been left.
            // Shown to everyone, signed in or not: the screen itself explains
            // that signing in is what fills it, which is a better invitation
            // than a button that is not there.
            headerRight: () => (
              <Link href="/bookings" asChild>
                <Pressable hitSlop={10}>
                  <Text style={{ color: theme.accent, fontWeight: '600' }}>
                    My bookings
                  </Text>
                </Pressable>
              </Link>
            ),
          }}
        />
        <Stack.Screen name="bookings" options={{ title: 'My bookings' }} />
        <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
      </Stack>
    </QueryClientProvider>
  );
}
