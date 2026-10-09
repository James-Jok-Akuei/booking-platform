import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Logo, Wordmark } from './Logo';
import { API_URL, APP_IS_OUT, APP_STORE_URL, BUSINESS_APP_URL, CUSTOMER_APP_URL, PLAY_STORE_URL } from './links';
import { sheetPath, useSize } from './sheet';

type Sheet = 'app' | 'how' | null;

/**
 * The landing page (§239): the first thing anyone sees of the platform.
 *
 * Built to the one picture the user gave — a dark hero with the headline
 * and a play button on the left, a tilted stack of screenshots on the right,
 * a sheet of paper slanting up across the foot of it with a big number cut
 * out of photos — in the platform's own colours, with real screens of the
 * two apps in the stack and real numbers from the server.
 */
export function App() {
  const [sheet, setSheet] = useState<Sheet>(null);
  return (
    <>
      <Hero onOpen={setSheet} />
      <Rail onOpen={setSheet} />
      <BackToTop />
      {sheet === 'app' && <GetTheApp onClose={() => setSheet(null)} />}
      {sheet === 'how' && <HowItWorks onClose={() => setSheet(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// The hero

const SHOTS = [
  { src: '/shots/overview.jpg', alt: 'The business app: a shop’s day at a glance', kind: 'wide', cls: 's1' },
  { src: '/shots/calendar.jpg', alt: 'The business app: a week of bookings on a calendar', kind: 'wide', cls: 's2' },
  { src: '/shots/home.jpg', alt: 'The customer app: find a place', kind: 'phone', cls: 's3' },
  { src: '/shots/shop.jpg', alt: 'The customer app: a shop’s page', kind: 'phone', cls: 's4' },
] as const;

function Hero({ onOpen }: { onOpen: (sheet: Sheet) => void }) {
  const ref = useRef<HTMLElement>(null);
  const { w, h } = useSize(ref);
  const narrow = w > 0 && w < 900;
  // Where the paper's corner sits: in from the left edge, up from the foot,
  // leaving room for the big number on it.
  const edge = narrow ? 20 : Math.min(128, Math.max(20, w * 0.084));
  const cornerY = h - (narrow ? 150 : 190);
  const layers =
    w > 0 && h > 0
      ? [
          { cls: 'b2', path: sheetPath(w, h, { x: edge - 120, y: cornerY - 122 }, 11.5, 26, 70) },
          { cls: 'b1', path: sheetPath(w, h, { x: edge - 56, y: cornerY - 58 }, 8, 23, 80) },
          { cls: 'paper', path: sheetPath(w, h, { x: edge, y: cornerY }, 5, 20, 90) },
        ]
      : [];

  const openApp = () => {
    if (!APP_IS_OUT) return onOpen('app');
    window.location.href = CUSTOMER_APP_URL ?? APP_STORE_URL ?? PLAY_STORE_URL ?? '/';
  };

  return (
    <section className="hero" ref={ref} style={{ '--edge': `${edge}px` } as CSSProperties}>
      <div className="hero-bg" aria-hidden="true" />

      <header className="top">
        <a className="brand" href="/" aria-label="BwanguReservations">
          <Logo size={46} />
          <Wordmark />
        </a>
        <nav className="top-nav" aria-label="Main">
          {BUSINESS_APP_URL && (
            <a className="top-link" href={BUSINESS_APP_URL}>
              For businesses
            </a>
          )}
          <button type="button" className="btn" onClick={openApp}>
            Get the app
          </button>
        </nav>
      </header>

      <div className="copy">
        <p className="eyebrow">Bwangu means quick.</p>
        <h1>
          Book your next
          <br />
          appointment, Easily!
        </h1>
        <button type="button" className="play" onClick={() => onOpen('how')}>
          <span className="play-disc" aria-hidden="true">
            <Icon name="play" size={22} filled stroke={0} />
          </span>
          <span>
            Watch how to book
            <br />
            in under a minute!
          </span>
        </button>
      </div>

      <div className="stack" aria-label="Screens of the apps">
        {SHOTS.map((shot) => (
          <figure key={shot.src} className={`shot is-${shot.kind} ${shot.cls}`}>
            <img src={shot.src} alt={shot.alt} loading="eager" decoding="async" draggable={false} />
          </figure>
        ))}
      </div>

      {/* The sheet of paper, three layers deep: two bands fanning up behind
          the paper itself, drawn as clip paths so the angles stay true. */}
      <div className="sheet" aria-hidden="true">
        {layers.map((layer) => (
          <div key={layer.cls} className={`sheet-layer ${layer.cls}`} style={{ clipPath: `path('${layer.path}')` }} />
        ))}
      </div>

      <Count />
    </section>
  );
}

/** The big number on the paper: places taking bookings, counted by the server. */
function Count() {
  const [total, setTotal] = useState<number | null>(null);
  useEffect(() => {
    const control = new AbortController();
    fetch(`${API_URL}/discover/locations?limit=1`, { signal: control.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((page: { total: number }) => setTotal(page.total))
      .catch(() => setTotal(null));
    return () => control.abort();
  }, []);
  if (total === null) return null;
  return (
    <div className="count">
      <span className="count-num" aria-label={`${total} places`}>
        {total}
      </span>
      <h2>
        Places you can
        <br />
        book today.
      </h2>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The rail and the way back up

function Rail({ onOpen }: { onOpen: (sheet: Sheet) => void }) {
  const items: Array<{ icon: IconName; label: string; go: () => void }> = [
    { icon: 'phone', label: 'Get the app', go: () => onOpen('app') },
    { icon: 'play', label: 'How it works', go: () => onOpen('how') },
    ...(BUSINESS_APP_URL ? [{ icon: 'store' as const, label: 'For businesses', go: () => window.location.assign(BUSINESS_APP_URL ?? '/') }] : []),
    { icon: 'message', label: 'Help', go: () => onOpen('app') },
  ];
  return (
    <nav className="rail" aria-label="Quick links">
      {items.map((item) => (
        <button key={item.label} type="button" onClick={item.go} aria-label={item.label} data-label={item.label}>
          <Icon name={item.icon} size={20} />
        </button>
      ))}
    </nav>
  );
}

function BackToTop() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > 480);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <button
      type="button"
      className={`to-top${shown ? ' is-shown' : ''}`}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      tabIndex={shown ? 0 : -1}
    >
      <Icon name="chevronUp" size={20} stroke={2.2} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// The two small sheets

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={18} stroke={2.2} />
        </button>
        {children}
      </div>
    </div>
  );
}

/** Until the app is in the stores, "Get the app" says so rather than leading nowhere. */
function GetTheApp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Get the app" onClose={onClose}>
      <div className="modal-logo">
        <Logo size={64} />
      </div>
      <h3>The app is on its way.</h3>
      <p>
        BwanguReservations is coming to the App Store and Google Play. Businesses can already sign in on the web and
        set up their shop.
      </p>
      <div className="modal-actions">
        {BUSINESS_APP_URL && (
          <a className="btn" href={BUSINESS_APP_URL}>
            For businesses <Icon name="arrowRight" size={17} stroke={2.2} />
          </a>
        )}
        <button type="button" className="btn-quiet" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function HowItWorks({ onClose }: { onClose: () => void }) {
  const steps: Array<{ icon: IconName; title: string; text: string }> = [
    { icon: 'search', title: 'Find a shop near you', text: 'Barbers, salons, spas, garages — with real photos, prices and open hours.' },
    { icon: 'banknote', title: 'Hold your time with a small deposit', text: 'Paid with MTN MoMo on your own phone. The rest you pay at the shop.' },
    { icon: 'ticket', title: 'Show your 6-digit code at the door', text: 'The shop checks you in with it. No password, no printout.' },
  ];
  return (
    <Modal title="How booking works" onClose={onClose}>
      <h3>How booking works</h3>
      <ol className="steps">
        {steps.map((step, i) => (
          <li key={step.title}>
            <span className="step-n">{i + 1}</span>
            <span className="step-icon">
              <Icon name={step.icon} size={20} />
            </span>
            <span>
              <strong>{step.title}</strong>
              <span>{step.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="modal-note">A short video of all three is on its way.</p>
    </Modal>
  );
}
