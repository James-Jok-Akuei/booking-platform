import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './auth/auth-context';
import { DialogHost } from './ui/Dialog';
import { ConfirmHost } from './session/ConfirmItsYou';
import { leaveIntro } from './intro';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // An admin acts on what they see, so a stale queue is worse than an extra
      // request. Refetching on focus means switching back to this tab shows the
      // current state rather than whatever was true when you left.
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // 401 is handled by the client: it refreshes once, then ends the session.
      // Retrying past that would hammer the server while the person is already
      // being redirected to the login screen.
      retry: (failureCount, error) =>
        (error as { status?: number }).status === 401 ? false : failureCount < 2,
    },
  },
});

/** The opening picture goes once the app has drawn underneath it (§302). */
function IntroLeaves() {
  useEffect(() => void leaveIntro(), []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <DialogHost />
          <ConfirmHost />
          <IntroLeaves />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
