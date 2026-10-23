// The language first: English is ready before any other file is read (§308).
import { loadLocale, useAppLocale } from './i18n';
import { Fragment, StrictMode, useEffect, useRef, type ReactNode } from 'react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './auth/auth-context';
import { DialogHost } from './ui/Dialog';
import { ConfirmHost } from './session/ConfirmItsYou';
import { leaveIntro } from './intro';
import { guardFileDrops } from './ui/DropZone';
import { PageCrash } from './ui/PageCrash';
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

// A file let go outside a drop zone must not replace the app (§305).
guardFileDrops();


/** A new language is drawn afresh, every sentence in it; the address, and so the page, stays. */
function Localised({ children }: { children: ReactNode }) {
  const locale = useAppLocale();
  // What the server sent — category names among it (§308.3) — asked for again in the new language.
  const drawnIn = useRef(locale);
  useEffect(() => {
    if (drawnIn.current === locale) return;
    drawnIn.current = locale;
    void queryClient.invalidateQueries();
  }, [locale]);
  return (
    <I18nProvider i18n={i18n}>
      <Fragment key={locale}>{children}</Fragment>
    </I18nProvider>
  );
}

// Drawn once the language is settled (§308): its file is small, and the
// opening picture covers the wait.
void loadLocale().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Localised>
            <AuthProvider>
              {/* Anything that breaks the frame itself (§311). */}
              <PageCrash whole>
                <App />
              </PageCrash>
              <DialogHost />
              <ConfirmHost />
              <IntroLeaves />
            </AuthProvider>
          </Localised>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  ),
);
