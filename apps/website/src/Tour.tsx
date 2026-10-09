import { useEffect, useRef, useState, type CSSProperties, type TouchEvent } from 'react';
import { Icon, type IconName } from './Icon';
import { businessStart } from './links';

/** Where on a screen the eye should go: a box, in percent of the picture. */
type Spot = { x: number; y: number; w: number; h: number };

type Step = {
  key: 'signup' | 'setup' | 'live';
  title: string;
  text: string;
  alt: string;
  chip: { icon: IconName; tone: 'orange' | 'cream' | 'green'; title: string; text: string };
  /** The part of the computer screenshot, and of the phone one, that the step is about. */
  desk: Spot;
  phone: Spot;
};

/**
 * The three steps from signing up to taking bookings (§260), each shown on
 * the real screen a seller meets at that moment — captured from the business
 * app itself, at a computer's size and a phone's, so a visitor sees the app
 * they will use on the device they are holding.
 */
const STEPS: Step[] = [
  {
    key: 'signup',
    title: 'Sign up with your email',
    text: 'We send a 6-digit code, and that is your account. No password, no card.',
    alt: 'The business app’s sign-up: a 6-digit code sent to your email, typed into six boxes.',
    chip: { icon: 'mail', tone: 'orange', title: 'Code sent', text: 'Six digits — no password, ever' },
    desk: { x: 64.6, y: 46.6, w: 30.4, h: 9.4 },
    phone: { x: 5, y: 66.2, w: 90, h: 9.2 },
  },
  {
    key: 'setup',
    title: 'Set up your shop',
    text: 'Your name, a branch and one service — about five minutes. Skip anything and add it later.',
    alt: 'Setting up a shop: its name, what kind of shop it is, and how customers will see it.',
    chip: { icon: 'check', tone: 'cream', title: 'About five minutes', text: 'Skip anything, add it later' },
    desk: { x: 41, y: 27.8, w: 40.2, h: 10.6 },
    phone: { x: 8, y: 30, w: 84, h: 12.6 },
  },
  {
    key: 'live',
    title: 'We check it, you go live',
    text: 'Usually within one working day. Then customers can find you and book.',
    alt: 'The business app’s home page the moment a shop is approved: You are live!',
    chip: { icon: 'shield', tone: 'green', title: 'Approved', text: 'Usually within one working day' },
    desk: { x: 21.2, y: 29.6, w: 53.8, h: 18.8 },
    phone: { x: 4, y: 37.6, w: 92, h: 27.6 },
  },
];

const spotVars = (s: Step) =>
  ({
    '--dx': `${s.desk.x}%`,
    '--dy': `${s.desk.y}%`,
    '--dw': `${s.desk.w}%`,
    '--dh': `${s.desk.h}%`,
    '--dox': `${s.desk.x + s.desk.w / 2}%`,
    '--doy': `${s.desk.y + s.desk.h / 2}%`,
    '--px': `${s.phone.x}%`,
    '--py': `${s.phone.y}%`,
    '--pw': `${s.phone.w}%`,
    '--ph': `${s.phone.h}%`,
    '--pox': `${s.phone.x + s.phone.w / 2}%`,
    '--poy': `${s.phone.y + s.phone.h / 2}%`,
  }) as CSSProperties;

const prefersLessMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * "Live in three steps" as a short film: the steps on the left light up in
 * turn, each with a line that fills while it is on; the screen beside them
 * cross-fades to that step's real screenshot, eases in on the part that
 * matters and dims the rest; a note floats in beside it. It plays only while
 * on screen and not under the mouse, and a press on any step jumps there. On
 * a phone the steps become story bars over a phone, which can be swiped.
 * With reduced motion it is a plain set of three tabs.
 */
export function Tour() {
  const [active, setActive] = useState(0);
  // Bumped on a press, so the step's line starts filling again from empty.
  const [round, setRound] = useState(0);
  const [inView, setInView] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [still] = useState(prefersLessMotion);
  const ref = useRef<HTMLElement>(null);
  const touch = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const playing = inView && !hovered && !still;
  const go = (i: number) => {
    setActive((i + STEPS.length) % STEPS.length);
    setRound((r) => r + 1);
  };
  const signUp = businessStart('signup');

  const onTouchStart = (e: TouchEvent) => {
    touch.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: TouchEvent) => {
    if (touch.current === null) return;
    const dx = e.changedTouches[0].clientX - touch.current;
    touch.current = null;
    if (Math.abs(dx) > 40) go(active + (dx < 0 ? 1 : -1));
  };

  return (
    <section
      ref={ref}
      className={`tour${playing ? ' is-playing' : ''}${still ? ' is-still' : ''}`}
      aria-labelledby="tour-title"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="tour-bg" aria-hidden="true" />
      <div className="tour-inner">
        <header className="tour-head">
          <p className="tour-eyebrow">From sign-up to your first booking</p>
          <h2 id="tour-title">
            Live in <span>three steps.</span>
          </h2>
          <p className="tour-lead">Real screens from the app — exactly what you will see.</p>
        </header>

        <div className="tour-grid">
          <div className="tour-side">
            <ol className="tour-steps" role="tablist" aria-label="The three steps">
              {STEPS.map((step, i) => {
                const on = i === active;
                return (
                  <li key={step.key} className={`${on ? 'is-on' : ''}${i < active ? ' is-done' : ''}`}>
                    <button
                      type="button"
                      role="tab"
                      id={`tour-tab-${step.key}`}
                      aria-selected={on}
                      aria-controls="tour-screen"
                      onClick={() => go(i)}
                    >
                      <span className="tour-n">{i + 1}</span>
                      <span className="tour-step-text">
                        <strong>{step.title}</strong>
                        <span className="tour-step-desc">
                          <span>{step.text}</span>
                        </span>
                      </span>
                      <span className="tour-bar" aria-hidden="true">
                        {on && !still ? (
                          <i key={`${active}-${round}`} onAnimationEnd={() => go(active + 1)} />
                        ) : (
                          <i className={on || i < active ? 'is-full' : ''} />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            {signUp && (
              <div className="tour-cta">
                <a className="btn" href={signUp}>
                  Start selling <Icon name="arrowRight" size={17} stroke={2.2} />
                </a>
                <span>Free to join · No card needed</span>
              </div>
            )}
          </div>

          <div className="tour-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <div className="tour-device">
              <div className="tour-chrome" aria-hidden="true">
                <span className="tour-dots">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="tour-url">
                  <Icon name="lock" size={13} stroke={2} /> BwanguReservations · For businesses
                </span>
              </div>
              <div className="tour-screen" id="tour-screen" role="tabpanel" aria-labelledby={`tour-tab-${STEPS[active].key}`}>
                {STEPS.map((step, i) => (
                  <figure key={step.key} className={`tour-shot${i === active ? ' is-on' : ''}`} style={spotVars(step)} aria-hidden={i !== active}>
                    <div className="tour-zoom">
                      {/* The phone's screens on a phone, the computer's on a computer — each at 1× and 2×. */}
                      <picture>
                        <source
                          media="(max-width: 899px)"
                          srcSet={`/shots/steps/${step.key}-phone.jpg 640w, /shots/steps/${step.key}-phone@2x.jpg 780w`}
                          sizes="300px"
                        />
                        <img
                          src={`/shots/steps/${step.key}-desktop.jpg`}
                          srcSet={`/shots/steps/${step.key}-desktop.jpg 1600w, /shots/steps/${step.key}-desktop@2x.jpg 2400w`}
                          sizes="(min-width: 1440px) 1000px, 64vw"
                          alt={step.alt}
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                        />
                      </picture>
                      <span className="tour-spot" aria-hidden="true" />
                    </div>
                  </figure>
                ))}
              </div>
            </div>

            {STEPS.map((step, i) => (
              <span key={step.key} className={`tour-chip c${i}${i === active ? ' is-on' : ''}`} aria-hidden="true">
                <span className={`tour-chip-icon is-${step.chip.tone}`}>
                  <Icon name={step.chip.icon} size={18} stroke={2.2} />
                </span>
                <span>
                  <strong>{step.chip.title}</strong>
                  <em>{step.chip.text}</em>
                </span>
              </span>
            ))}
          </div>

          {/* On a phone the steps are bars; what the step says sits under the phone. */}
          <p className="tour-caption" aria-hidden="true" key={active}>
            <strong>{STEPS[active].title}</strong>
            {STEPS[active].text}
          </p>
        </div>
      </div>
    </section>
  );
}
