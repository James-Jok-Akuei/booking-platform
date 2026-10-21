import { cloneElement, useRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useInView } from './inView';

/**
 * Four reasons to book here (§273), under the big number — the picture's
 * four columns: a fine orange line drawing, a bold two-line title, a few
 * plain words. Every word is true of the apps as they are: the shops are
 * checked before they are listed (§255), the deposit is part of the price
 * and comes back in full only when the SHOP cancels, the reminder comes the
 * day before.
 *
 * The drawings draw themselves in, one after another, the first time the
 * row is seen. The words are `<Trans>`, said in the language in use when drawn
 * (§308); where the title breaks is the translator's to choose.
 */
const FEATURES: Array<{ title: ReactNode; text: ReactNode; art: ReactElement[] }> = [
  {
    title: (
      <Trans>
        Real places,
        <br />
        checked by us
      </Trans>
    ),
    text: (
      <Trans>
        Barbers, salons, spas, garages, clinics and more — with their own photos, prices and opening hours. We check
        every shop before it is listed.
      </Trans>
    ),
    art: [
      <path d="M6 54h52" />,
      <path d="M10 24 14 14h36l4 10" />,
      <path d="M10 24a5.5 5.5 0 0 0 11 0 5.5 5.5 0 0 0 11 0 5.5 5.5 0 0 0 11 0 5.5 5.5 0 0 0 11 0" />,
      <path d="M13 29v25h38V29" />,
      <path d="M28 54V42a4 4 0 0 1 8 0v12" />,
      <path d="M17 36h7v8h-7z" />,
      <path d="M40 36h7v8h-7z" />,
      <circle cx="55" cy="8" r="6.5" />,
      <path d="m52 8.2 2.2 2.2 4-4.2" />,
    ],
  },
  {
    title: (
      <Trans>
        Book in
        <br />
        under a minute
      </Trans>
    ),
    text: (
      <Trans>
        See the free times for today and the days ahead, pick one, and it is yours. No phone calls, no waiting for a
        reply.
      </Trans>
    ),
    art: [
      <rect x="18" y="6" width="28" height="52" rx="6" />,
      <path d="M29 11h6" />,
      <rect x="23" y="18" width="18" height="16" rx="2" />,
      <path d="M23 23h18" />,
      <path d="M27.5 27.5h.01M32 27.5h.01M36.5 27.5h.01M27.5 31h.01M32 31h.01" />,
      <rect x="23" y="40" width="18" height="6" rx="3" />,
      <path d="m48 39 4-2.5M49 44h5M48 49l4 2.5" />,
    ],
  },
  {
    title: (
      <Trans>
        A small deposit
        <br />
        holds your time
      </Trans>
    ),
    text: (
      <Trans>
        Pay part of the price with MTN MoMo on your own phone, and the rest at the shop. If the shop has to cancel, you
        get it all back.
      </Trans>
    ),
    art: [
      <ellipse cx="22" cy="36" rx="11" ry="4" />,
      <path d="M11 36v12a11 4 0 0 0 22 0V36" />,
      <path d="M11 42a11 4 0 0 0 22 0" />,
      <rect x="37" y="10" width="20" height="36" rx="4" />,
      <path d="M44 14h6" />,
      <circle cx="47" cy="27" r="5" />,
      <path d="m44.8 27.2 1.6 1.6 3-3.2" />,
      <path d="M35 18c-9-4-15 2-14 10" />,
      <path d="m18.2 25.6 2.8 3 3-2.8" />,
    ],
  },
  {
    title: (
      <Trans>
        Your code,
        <br />
        not a queue
      </Trans>
    ),
    text: (
      <Trans>
        Show your 6-digit code when you arrive and you are checked in. We remind you the day before, so it is never a
        surprise.
      </Trans>
    ),
    art: [
      <path d="M8 18h48v8a5 5 0 0 0 0 10v8H8v-8a5 5 0 0 0 0-10z" />,
      <path d="M40 20v4M40 28v4M40 36v4" />,
      <path d="M14 27h4M20 27h4M26 27h4" />,
      <path d="M14 33h4M20 33h4M26 33h4" />,
      <circle cx="48" cy="31" r="4.5" />,
      <path d="m46 31.2 1.5 1.5 3-3" />,
      <path d="M30 50c4 4 10 4 14 0" />,
    ],
  },
];

export function Features() {
  const ref = useRef<HTMLElement>(null);
  const seen = useInView(ref);
  return (
    <section className={`features${seen ? ' is-in' : ''}`} ref={ref} aria-label={t`Why book here`}>
      <ul className="features-grid">
        {FEATURES.map((f, i) => (
          <li key={i} style={{ '--i': i } as CSSProperties}>
            <svg
              className="feature-art"
              viewBox="0 0 64 64"
              width="84"
              height="84"
              aria-hidden="true"
              focusable="false"
            >
              {/* Every stroke one unit long, so each draws from nothing at the same pace. */}
              <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                {f.art.map((stroke, n) => cloneElement(stroke, { key: n, pathLength: 1 }))}
              </g>
            </svg>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
