import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
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
        <Stack.Screen name="index" options={{ title: 'Find a place' }} />
        <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
      </Stack>
    </QueryClientProvider>
  );
}
