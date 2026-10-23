import { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { CounterCard } from '../appqr/CounterCard';
import { ShowQr } from '../appqr/ShowQr';
import { cardImage } from '../appqr/cardImage';
import { useCardWords } from '../appqr/useCardWords';
import { offeredLanguages, useAppLocale, type AppLocale } from '../i18n';
import { customerAppLink } from '../lib/customerApp';
import { useShellData } from '../shell/useShellData';
import { alertDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { Portal } from '../ui/Portal';
import '../appqr/appqr.css';

/**
 * The app QR code (§309): a code customers scan at the shop to get the
 * customer app — the main way a shop brings its customers onto the platform,
 * straight to the store instead of searching for it. Shown to a customer on
 * the screen, printed as a counter card, or posted as a picture; the card in
 * the language its readers speak, whatever the app is in.
 */
export function AppQrPage() {
  const data = useShellData();
  const shop = data.business?.name ?? t`Your business`;
  const appLocale = useAppLocale();
  const [locale, setLocale] = useState<AppLocale>(appLocale === 'en-XA' ? 'en' : appLocale);
  const words = useCardWords(locale, shop);
  const link = customerAppLink();
  const [showing, setShowing] = useState(false);
  const [saving, setSaving] = useState(false);
  const languages = offeredLanguages().filter((language) => language.code !== 'en-XA');

  const download = async () => {
    if (!link) return;
    setSaving(true);
    try {
      const blob = await cardImage({ words, shop, logoUrl: data.logoUrl, link: link.url });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${shop.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shop'}-app-qr.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      await alertDialog({ title: t`The picture could not be made`, body: t`Try again, or print the card instead.` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="aq">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1><Trans>App QR code</Trans></h1>
            <p className="muted">
              <Trans>
                Show it to customers you have just served. They scan it with their phone’s camera, get the app, and can
                book you again whenever they like.
              </Trans>
            </p>
          </div>
        </header>
      </div>

      <div className="aq-main">
        <div className="aq-stage">
          <CounterCard words={words} shop={shop} logoUrl={data.logoUrl} link={link?.url ?? null} lang={locale} live />
        </div>

        <div className="aq-side">
          <article className="aq-panel">
            <h2><Trans>Every visit can bring the next booking</Trans></h2>
            <div className="aq-actions">
              <button type="button" className="primary aq-show-btn" onClick={() => setShowing(true)} disabled={!link}>
                <Icon name="expand" size={18} />
                <Trans>Show to a customer</Trans>
              </button>
              <button type="button" onClick={() => window.print()} disabled={!link}>
                <Icon name="printer" size={17} />
                <Trans>Print the card</Trans>
              </button>
              <button type="button" onClick={() => void download()} disabled={!link || saving}>
                <Icon name="download" size={17} />
                {saving ? t`Making the picture…` : t`Download the picture`}
              </button>
            </div>
            {languages.length > 1 && (
              <div className="aq-lang">
                <span><Trans>Language on the card</Trans></span>
                <div role="radiogroup" aria-label={t`Language on the card`}>
                  {languages.map((language) => (
                    <button
                      key={language.code}
                      type="button"
                      role="radio"
                      aria-checked={language.code === locale}
                      className={language.code === locale ? 'is-on' : ''}
                      onClick={() => setLocale(language.code)}
                    >
                      {language.native}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </article>

          {link?.testing && (
            <aside className="aq-note is-testing">
              <Icon name="info" size={18} />
              <div>
                <strong><Trans>For testing</Trans></strong>
                <p>
                  <Trans>
                    For now the code opens the customer app in Expo Go on this Wi-Fi, like the code in the terminal. Once
                    the app is in the App Store and Google Play, it will open the store instead — print cards then.
                  </Trans>
                </p>
                <code>{link.url}</code>
              </div>
            </aside>
          )}
          {!link && (
            <aside className="aq-note">
              <Icon name="info" size={18} />
              <p>
                <Trans>The code appears here once the customer app is in the App Store and Google Play.</Trans>
              </p>
            </aside>
          )}

          <article className="aq-where">
            <h3><Trans>Where it works best</Trans></h3>
            <ul>
              <Tip icon="ticket" title={t`Right after check-in`} text={t`The Check in window has a button for it, while they are still with you.`} />
              <Tip icon="printer" title={t`By the till or the mirror`} text={t`Print the card and stand it where people wait or pay.`} />
              <Tip icon="image" title={t`On WhatsApp status or Instagram`} text={t`Post the picture so regulars can get the app from home.`} />
            </ul>
          </article>
        </div>
      </div>

      {/* What the printer gets: the card alone, on its own page (appqr.css). */}
      {link && (
        <Portal>
          <div className="aq-print-root" aria-hidden="true">
            <CounterCard words={words} shop={shop} logoUrl={data.logoUrl} link={link.url} lang={locale} />
          </div>
        </Portal>
      )}

      {showing && link && (
        <ShowQr link={link.url} shop={shop} logoUrl={data.logoUrl} words={words} lang={locale} onClose={() => setShowing(false)} />
      )}
    </section>
  );
}

function Tip({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <li>
      <span className="aq-tip-icon">
        <Icon name={icon} size={17} />
      </span>
      <div>
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
    </li>
  );
}
