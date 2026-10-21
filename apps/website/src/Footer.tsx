import { useEffect, useState } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Icon } from './Icon';
import { Logo, Wordmark } from './Logo';
import { Modal } from './Modal';
import { API_URL, CONTACT_EMAIL, CONTACT_PHONE, SOCIAL, businessStart } from './links';
import { SocialIcon } from './SocialIcon';
import { LanguageChoice } from './LanguageChoice';
import { formatDate, askIn } from './i18n';

type Kind = 'TERMS_OF_USE' | 'PRIVACY_POLICY' | 'SELLER_AGREEMENT';
type Doc = { title: string; version: number; body: string; publishedAt: string; language?: string };

// Read when drawn, in the language then in use (§308).
const DOCS: Array<{ kind: Kind; readonly label: string }> = [
  {
    kind: 'TERMS_OF_USE',
    get label() {
      return t`Terms of Use`;
    },
  },
  {
    kind: 'PRIVACY_POLICY',
    get label() {
      return t`Privacy Policy`;
    },
  },
  {
    kind: 'SELLER_AGREEMENT',
    get label() {
      return t`Seller Agreement`;
    },
  },
];

const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/**
 * The foot of the page (§273): who this is, the ways in for customers and for
 * shops, the three published documents — read right here, in the words the
 * apps ask people to accept (`GET /legal`, open to anyone, §122) — and how to
 * reach us, when the build says how.
 */
export function Footer({ onGetApp, onHow }: { onGetApp: () => void; onHow: () => void }) {
  const [reading, setReading] = useState<Kind | null>(null);
  const signUp = businessStart('signup');
  const signIn = businessStart('signin');
  const year = new Date().getFullYear();

  return (
    <footer className="foot">
      <div className="foot-inner">
        <div className="foot-brand">
          <a className="foot-logo" href="/" aria-label="BwanguReservations">
            <Logo size={44} />
            <Wordmark />
          </a>
          <p>
            <Trans>
              Book real places near you, hold your time with a small MoMo deposit, and show your code at the door.
            </Trans>
          </p>
          <span className="foot-made">
            <RwandaFlag /> <Trans>Made for Rwanda</Trans>
          </span>
          {/* Our pages (§276). One whose link is not set yet says so, rather than leading to a guess. */}
          <ul className="foot-social" aria-label={t`BwanguReservations on social media`}>
            {SOCIAL.map((s) => (
              <li key={s.key}>
                {s.url ? (
                  <a
                    className={`social is-${s.key}`}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t`BwanguReservations on ${s.label}`}
                    title={s.label}
                  >
                    <SocialIcon network={s.key} />
                  </a>
                ) : (
                  <span
                    className={`social is-${s.key} is-soon`}
                    role="img"
                    aria-label={t`${s.label} — coming soon`}
                    title={t`${s.label} — coming soon`}
                  >
                    <SocialIcon network={s.key} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <nav className="foot-cols" aria-label={t`More`}>
          <div>
            <h3>
              <Trans>For customers</Trans>
            </h3>
            <button type="button" onClick={onGetApp}>
              <Trans>Get the app</Trans>
            </button>
            <button type="button" onClick={onHow}>
              <Trans>How booking works</Trans>
            </button>
            <button type="button" onClick={() => go('places')}>
              <Trans>Places to book</Trans>
            </button>
          </div>
          <div>
            <h3>
              <Trans>For businesses</Trans>
            </h3>
            {signUp && (
              <a href={signUp}>
                <Trans>Start selling</Trans>
              </a>
            )}
            {signIn && (
              <a href={signIn}>
                <Trans>Sign in</Trans>
              </a>
            )}
            <button type="button" onClick={() => go('steps')}>
              <Trans>Live in three steps</Trans>
            </button>
          </div>
          <div>
            <h3>
              <Trans>Legal</Trans>
            </h3>
            {DOCS.map((d) => (
              <button key={d.kind} type="button" onClick={() => setReading(d.kind)}>
                {d.label}
              </button>
            ))}
          </div>
          {(CONTACT_EMAIL || CONTACT_PHONE) && (
            <div className="foot-contact">
              <h3>
                <Trans>Talk to us</Trans>
              </h3>
              {CONTACT_EMAIL && (
                <a href={`mailto:${CONTACT_EMAIL}`}>
                  <Icon name="mail" size={16} /> <span>{CONTACT_EMAIL}</span>
                </a>
              )}
              {CONTACT_PHONE && (
                <a href={`tel:${CONTACT_PHONE.replace(/\s/g, '')}`}>
                  <Icon name="phone" size={16} /> {CONTACT_PHONE}
                </a>
              )}
            </div>
          )}
        </nav>
      </div>

      <div className="foot-base">
        <span>© {year} BwanguReservations</span>
        <LanguageChoice variant="row" />
        <span>
          <Trans>Prices in RWF · Deposits by MTN MoMo</Trans>
        </span>
      </div>

      {reading && <LegalDoc kind={reading} onClose={() => setReading(null)} />}
    </footer>
  );
}

/** One published document, as the apps show it, in a window over the page. */
function LegalDoc({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [failed, setFailed] = useState(false);
  // "Read the English" (§308.5): the English applies wherever a translation differs.
  const [english, setEnglish] = useState(false);
  const label = DOCS.find((d) => d.kind === kind)!.label;
  const since = doc
    ? formatDate(new Date(doc.publishedAt), { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  useEffect(() => {
    const control = new AbortController();
    fetch(`${API_URL}/legal/${kind}${english ? '?lang=en' : ''}`, { signal: control.signal, headers: { 'Accept-Language': askIn() } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Doc) => setDoc(d))
      .catch((e: Error) => e.name !== 'AbortError' && setFailed(true));
    return () => control.abort();
  }, [kind, english]);

  return (
    <Modal title={label} onClose={onClose} className="is-doc">
      <h3>{doc?.title ?? label}</h3>
      {doc && (
        <p className="doc-meta">
          <Trans>
            Version {doc.version} · in force since {since}
          </Trans>
        </p>
      )}
      {doc && (english || (doc.language ?? 'en') !== 'en') && (
        <p className="doc-translated">
          {english ? (
            <Trans>This is the English, which applies wherever a translation differs.</Trans>
          ) : (
            <Trans>This is a translation. If it ever differs from the English, the English applies.</Trans>
          )}{' '}
          <button type="button" onClick={() => setEnglish((was) => !was)}>
            {english ? <Trans>Read it in my language</Trans> : <Trans>Read the English</Trans>}
          </button>
        </p>
      )}
      <div className="doc-body">
        {failed ? (
          <p>
            <Trans>This could not be loaded just now. Please try again in a moment.</Trans>
          </p>
        ) : !doc ? (
          <p className="doc-wait">
            <Trans>Loading…</Trans>
          </p>
        ) : (
          paragraphs(doc.body).map((block, i) =>
            block.heading ? <h4 key={i}>{block.text}</h4> : <p key={i}>{block.text}</p>,
          )
        )}
      </div>
    </Modal>
  );
}

/**
 * The documents are plain text: paragraphs between blank lines, and headings
 * written in capitals ("1. WHO WE ARE"). Read as such — never as HTML.
 */
function paragraphs(body: string) {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ text, heading: text.length < 90 && !/[a-z]/.test(text) && /[A-Z]/.test(text) }));
}

/** Rwanda's flag, small: sky blue over yellow over green, the sun top right. */
function RwandaFlag() {
  return (
    <svg viewBox="0 0 30 20" width="21" height="14" aria-hidden="true" className="foot-flag">
      <rect width="30" height="20" fill="#20603D" />
      <rect width="30" height="15" fill="#FAD201" />
      <rect width="30" height="10" fill="#00A1DE" />
      <circle cx="25" cy="4.6" r="2.4" fill="#E5BE01" />
    </svg>
  );
}
