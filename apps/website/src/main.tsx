import { Fragment, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { App } from './App';
import { loadLocale, useSiteLocale } from './i18n';
import './styles.css';

/** The page in the chosen language; drawn again whole when it changes (§308). */
function Localised() {
  const locale = useSiteLocale();
  return (
    <I18nProvider i18n={i18n}>
      <Fragment key={locale}>
        <App />
      </Fragment>
    </I18nProvider>
  );
}

// Drawn once the language is settled, so the page opens in it rather than switching after.
void loadLocale().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Localised />
    </StrictMode>,
  ),
);
