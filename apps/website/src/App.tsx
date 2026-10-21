import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { plural, t } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import { Icon, type IconName } from './Icon';
import { Logo, Wordmark } from './Logo';
import { API_URL, APP_IS_OUT, APP_STORE_URL, CUSTOMER_APP_URL, PLAY_STORE_URL, businessStart } from './links';
import { sheetPath, useSize } from './sheet';
import { Tour } from './Tour';
import { Features } from './Features';
import { Places } from './Places';
import { Footer } from './Footer';
import { Modal } from './Modal';
import { LanguageChoice } from './LanguageChoice';
import { useFitWords, useTightBar } from './fit';
import { askIn, shotsFor, useSiteLocale } from './i18n';
import { HEAD } from './i18n/head';
import { i18n } from '@lingui/core';

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
  // The tab's title and description in the page's language (§308). The build
  // writes the same into each language's own page (/rw/, /fr/), for search.
  useEffect(() => {
    document.title = i18n._(HEAD.title);
    document.querySelector('meta[name="description"]')?.setAttribute('content', i18n._(HEAD.description));
  }, []);
  return (
    <>
      <Hero onOpen={setSheet} />
      {/* The picture's order: four reasons, then the dark grid of what can be booked (§273). */}
      <Features />
      <Places onGetApp={() => setSheet('app')} />
      <ForBusinesses />
      <Tour />
      <Footer onGetApp={() => setSheet('app')} onHow={() => setSheet('how')} />
      <Rail onOpen={setSheet} />
      <BackToTop />
      {sheet === 'app' && <GetTheApp onClose={() => setSheet(null)} />}
      {sheet === 'how' && <HowItWorks onClose={() => setSheet(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// The hero

// The descriptions are read when drawn, in the language then in use (§308).
const SHOTS = [
  {
    src: 'overview.jpg',
    get alt() {
      return t`The business app: a shop’s day at a glance`;
    },
    kind: 'wide',
    cls: 's1',
  },
  {
    src: 'calendar.jpg',
    get alt() {
      return t`The business app: a week of bookings on a calendar`;
    },
    kind: 'wide',
    cls: 's2',
  },
  {
    src: 'home.jpg',
    get alt() {
      return t`The customer app: find a place`;
    },
    kind: 'phone',
    cls: 's3',
  },
  {
    src: 'shop.jpg',
    get alt() {
      return t`The customer app: a shop’s page`;
    },
    kind: 'phone',
    cls: 's4',
  },
] as const;

function Hero({ onOpen }: { onOpen: (sheet: Sheet) => void }) {
  const spoken = useSiteLocale();
  const ref = useRef<HTMLElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const { w, h } = useSize(ref);
  const { h: copyH } = useSize(copy);
  useFitWords(title);
  const top = useRef<HTMLElement>(null);
  useTightBar(top);
  const narrow = w > 0 && w < 900;
  // Where the paper's corner sits: in from the left edge, up from the foot,
  // leaving room for the big number on it.
  const edge = narrow ? 20 : Math.min(128, Math.max(20, w * 0.084));
  const cornerY = h - (narrow ? 150 : 190);
  // Longer words make the words above taller (§308): the hero grows with
  // them, so the play button always stays above the paper.
  const needed = !narrow && copy.current ? copy.current.offsetTop + copyH + 70 + 190 : 0;
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
    <section
      className="hero"
      ref={ref}
      style={{ '--edge': `${edge}px`, ...(needed ? { minHeight: `max(var(--hero-h), ${needed}px)` } : {}) } as CSSProperties}
    >
      <div className="hero-bg" aria-hidden="true" />

      <header className="top" ref={top}>
        <a className="brand" href="/" aria-label="BwanguReservations">
          <Logo size={46} />
          <Wordmark />
        </a>
        <nav className="top-nav" aria-label={t`Main`}>
          <a className="top-link" href="#businesses">
            <Trans>For businesses</Trans>
          </a>
          <LanguageChoice variant="menu" />
          <button type="button" className="btn top-app" onClick={openApp} title={t`Get the app`}>
            <span className="top-app-icon" aria-hidden="true">
              <Icon name="phone" size={20} />
            </span>
            <span className="top-app-label">
              <Trans>Get the app</Trans>
            </span>
          </button>
        </nav>
      </header>

      <div className="copy" ref={copy}>
        <p className="eyebrow">
          <Trans>Your appointments, without the phone calls.</Trans>
        </p>
        <h1 ref={title}>
          <Trans>
            Book your next
            <br />
            appointment, Easily!
          </Trans>
        </h1>
        <button type="button" className="play" onClick={() => onOpen('how')}>
          <span className="play-disc" aria-hidden="true">
            <Icon name="play" size={22} filled stroke={0} />
          </span>
          <span>
            <Trans>
              Watch how to book
              <br />
              in under a minute!
            </Trans>
          </span>
        </button>
      </div>

      <div className="stack" aria-label={t`Screens of the apps`}>
        {SHOTS.map((shot) => (
          <figure key={shot.src} className={`shot is-${shot.kind} ${shot.cls}`}>
            <img src={`${shotsFor(spoken)}/${shot.src}`} alt={shot.alt} loading="eager" decoding="async" draggable={false} />
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
    fetch(`${API_URL}/discover/locations?limit=1`, { signal: control.signal, headers: { 'Accept-Language': askIn() } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((page: { total: number }) => setTotal(page.total))
      .catch(() => setTotal(null));
    return () => control.abort();
  }, []);
  if (total === null) return null;
  return (
    <div className="count">
      <span className="count-num" aria-label={plural(total, { one: '# place', other: '# places' })}>
        {total}
      </span>
      <h2>
        <Plural
          value={total}
          one={
            <Trans>
              Place you can
              <br />
              book today.
            </Trans>
          }
          other={
            <Trans>
              Places you can
              <br />
              book today.
            </Trans>
          }
        />
      </h2>
    </div>
  );
}

// ---------------------------------------------------------------------------
// For businesses

const toBusinesses = () => document.getElementById('businesses')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/**
 * The way in for sellers (§258), under the hero: what the business app does
 * for a shop, and two doors into it — "Start selling" for a newcomer, "Sign
 * in" for a returning seller, each telling the sign-in page which it was. The
 * three steps from here to taking bookings follow it (`Tour`, §260), the
 * approval among them, so nobody signs up expecting to be live the same minute.
 */
function ForBusinesses() {
  const spoken = useSiteLocale();
  const signUp = businessStart('signup');
  const signIn = businessStart('signin');
  return (
    <section className="biz" id="businesses" aria-labelledby="biz-title">
      <div className="biz-grid">
        <div className="biz-copy">
          <p className="biz-eyebrow">
            <Icon name="store" size={16} /> <Trans>For businesses</Trans>
          </p>
          <h2 id="biz-title">
            <Trans>
              Get booked
              <br />
              while you work.
            </Trans>
          </h2>
          <p className="biz-lead">
            <Trans>
              Barbers, salons, spas, garages and more: customers find you, pick a free time and hold it with a small MoMo
              deposit. You see your whole day on one screen, and check people in with a code.
            </Trans>
          </p>
          {signUp && signIn ? (
            <div className="biz-actions">
              <a className="btn" href={signUp}>
                <Trans>Start selling — it is free</Trans> <Icon name="arrowRight" size={17} stroke={2.2} />
              </a>
              <a className="btn-line" href={signIn}>
                <Icon name="logIn" size={18} /> <Trans>Sign in</Trans>
              </a>
            </div>
          ) : (
            <p className="biz-soon">
              <Trans>Sign-ups for businesses open soon.</Trans>
            </p>
          )}
          <ul className="biz-ticks">
            <li>
              <Icon name="check" size={16} stroke={2.6} /> <Trans>Deposits paid straight to MTN MoMo</Trans>
            </li>
            <li>
              <Icon name="check" size={16} stroke={2.6} /> <Trans>Fewer people who book and do not come</Trans>
            </li>
            <li>
              <Icon name="check" size={16} stroke={2.6} /> <Trans>Your bookings, messages and money in one place</Trans>
            </li>
          </ul>
        </div>

        <div className="biz-visual" aria-hidden="true">
          <figure className="biz-shot">
            <img src={`${shotsFor(spoken)}/overview.jpg`} alt="" loading="lazy" decoding="async" draggable={false} />
          </figure>
          <span className="biz-chip c1">
            <span className="biz-chip-icon is-orange">
              <Icon name="calendarCheck" size={18} />
            </span>
            <span>
              <strong>
                <Trans>New booking</Trans>
              </strong>
              <em>
                <Trans>Haircut · Saturday 10:30</Trans>
              </em>
            </span>
          </span>
          <span className="biz-chip c2">
            <span className="biz-chip-icon is-green">
              <Icon name="shield" size={18} />
            </span>
            <span>
              <strong>
                <Trans>You are live!</Trans>
              </strong>
              <em>
                <Trans>Customers can book you now</Trans>
              </em>
            </span>
          </span>
        </div>
      </div>

    </section>
  );
}

// ---------------------------------------------------------------------------
// The rail and the way back up

function Rail({ onOpen }: { onOpen: (sheet: Sheet) => void }) {
  const items: Array<{ icon: IconName; label: string; go: () => void }> = [
    { icon: 'phone', label: t`Get the app`, go: () => onOpen('app') },
    { icon: 'play', label: t`How it works`, go: () => onOpen('how') },
    { icon: 'store', label: t`For businesses`, go: toBusinesses },
    { icon: 'message', label: t`Help`, go: () => onOpen('app') },
  ];
  return (
    <nav className="rail" aria-label={t`Quick links`}>
      {items.map((item) => (
        <button key={item.icon} type="button" onClick={item.go} aria-label={item.label} data-label={item.label}>
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
      aria-label={t`Back to top`}
      tabIndex={shown ? 0 : -1}
    >
      <Icon name="chevronUp" size={20} stroke={2.2} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// The two small sheets

/** Until the app is in the stores, "Get the app" says so rather than leading nowhere. */
function GetTheApp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t`Get the app`} onClose={onClose}>
      <div className="modal-logo">
        <Logo size={64} />
      </div>
      <h3>
        <Trans>The app is on its way.</Trans>
      </h3>
      <p>
        <Trans>
          BwanguReservations is coming to the App Store and Google Play. Businesses can already sign in on the web and
          set up their shop.
        </Trans>
      </p>
      <div className="modal-actions">
        {businessStart('signup') && (
          <a className="btn" href={businessStart('signup')!}>
            <Trans>Start selling</Trans> <Icon name="arrowRight" size={17} stroke={2.2} />
          </a>
        )}
        <button type="button" className="btn-quiet" onClick={onClose}>
          <Trans>Close</Trans>
        </button>
      </div>
    </Modal>
  );
}

/**
 * The walkthrough (§240): a minute of the real customer app, booking a steam
 * room — recorded from the app itself, with a voice over each step — in a
 * window over the page. The three steps are written under it for anyone
 * who would rather read.
 */
function HowItWorks({ onClose }: { onClose: () => void }) {
  const spoken = useSiteLocale();
  const steps: Array<{ icon: IconName; title: string; text: string }> = [
    {
      icon: 'search',
      title: t`Find a shop near you`,
      text: t`Barbers, salons, spas, garages — with real photos, prices and open hours.`,
    },
    {
      icon: 'banknote',
      title: t`Hold your time with a small deposit`,
      text: t`Paid with MTN MoMo on your own phone. The rest you pay at the shop.`,
    },
    {
      icon: 'ticket',
      title: t`Show your 6-digit code at the door`,
      text: t`The shop checks you in with it. No password, no printout.`,
    },
  ];
  return (
    <Modal title={t`How booking works`} onClose={onClose} wide>
      <video className="walkthrough" src="/video/how-booking-works.mp4" poster="/video/how-booking-works-poster.jpg" controls autoPlay playsInline preload="metadata">
        {/* Its voice is English; the words under it come in the page's language, on by default when that is not English (§308.7). */}
        <track kind="subtitles" srcLang="rw" label="Ikinyarwanda" src="/video/how-booking-works.rw.vtt" default={spoken === 'rw'} />
        <track kind="subtitles" srcLang="fr" label="Français" src="/video/how-booking-works.fr.vtt" default={spoken === 'fr'} />
        <track kind="captions" srcLang="en" label="English" src="/video/how-booking-works.en.vtt" />
      </video>
      <ol className="steps is-row">
        {steps.map((step, i) => (
          <li key={step.icon}>
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
    </Modal>
  );
}
