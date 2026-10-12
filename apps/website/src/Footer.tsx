import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Logo, Wordmark } from './Logo';
import { Modal } from './Modal';
import { API_URL, CONTACT_EMAIL, CONTACT_PHONE, SOCIAL, businessStart } from './links';
import { SocialIcon } from './SocialIcon';

type Kind = 'TERMS_OF_USE' | 'PRIVACY_POLICY' | 'SELLER_AGREEMENT';
type Doc = { title: string; version: number; body: string; publishedAt: string };

const DOCS: Array<{ kind: Kind; label: string }> = [
  { kind: 'TERMS_OF_USE', label: 'Terms of Use' },
  { kind: 'PRIVACY_POLICY', label: 'Privacy Policy' },
  { kind: 'SELLER_AGREEMENT', label: 'Seller Agreement' },
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
          <p>Book real places near you, hold your time with a small MoMo deposit, and show your code at the door.</p>
          <span className="foot-made">
            <RwandaFlag /> Made for Rwanda
          </span>
          {/* Our pages (§276). One whose link is not set yet says so, rather than leading to a guess. */}
          <ul className="foot-social" aria-label="BwanguReservations on social media">
            {SOCIAL.map((s) => (
              <li key={s.key}>
                {s.url ? (
                  <a
                    className={`social is-${s.key}`}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`BwanguReservations on ${s.label}`}
                    title={s.label}
                  >
                    <SocialIcon network={s.key} />
                  </a>
                ) : (
                  <span
                    className={`social is-${s.key} is-soon`}
                    role="img"
                    aria-label={`${s.label} — coming soon`}
                    title={`${s.label} — coming soon`}
                  >
                    <SocialIcon network={s.key} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        <nav className="foot-cols" aria-label="More">
          <div>
            <h3>For customers</h3>
            <button type="button" onClick={onGetApp}>
              Get the app
            </button>
            <button type="button" onClick={onHow}>
              How booking works
            </button>
            <button type="button" onClick={() => go('places')}>
              Places to book
            </button>
          </div>
          <div>
            <h3>For businesses</h3>
            {signUp && <a href={signUp}>Start selling</a>}
            {signIn && <a href={signIn}>Sign in</a>}
            <button type="button" onClick={() => go('steps')}>
              Live in three steps
            </button>
          </div>
          <div>
            <h3>Legal</h3>
            {DOCS.map((d) => (
              <button key={d.kind} type="button" onClick={() => setReading(d.kind)}>
                {d.label}
              </button>
            ))}
          </div>
          {(CONTACT_EMAIL || CONTACT_PHONE) && (
            <div className="foot-contact">
              <h3>Talk to us</h3>
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
        <span>Prices in RWF · Deposits by MTN MoMo</span>
      </div>

      {reading && <LegalDoc kind={reading} onClose={() => setReading(null)} />}
    </footer>
  );
}

/** One published document, as the apps show it, in a window over the page. */
function LegalDoc({ kind, onClose }: { kind: Kind; onClose: () => void }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [failed, setFailed] = useState(false);
  const label = DOCS.find((d) => d.kind === kind)!.label;

  useEffect(() => {
    const control = new AbortController();
    fetch(`${API_URL}/legal/${kind}`, { signal: control.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Doc) => setDoc(d))
      .catch((e: Error) => e.name !== 'AbortError' && setFailed(true));
    return () => control.abort();
  }, [kind]);

  return (
    <Modal title={label} onClose={onClose} className="is-doc">
      <h3>{doc?.title ?? label}</h3>
      {doc && (
        <p className="doc-meta">
          Version {doc.version} · in force since{' '}
          {new Date(doc.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      )}
      <div className="doc-body">
        {failed ? (
          <p>This could not be loaded just now. Please try again in a moment.</p>
        ) : !doc ? (
          <p className="doc-wait">Loading…</p>
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
