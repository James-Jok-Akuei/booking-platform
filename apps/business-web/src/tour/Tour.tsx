import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMe, tourDone, type Me } from '../api/business';
import { useAccess } from '../access';
import { leaveIntro } from '../intro';
import { useMediaQuery } from '../shell/useMediaQuery';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { Portal } from '../ui/Portal';
import { SCENES, keptMark, marksFor, type Mark, type Placement, type Scene } from './steps';
import './tour.css';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { appLocale } from '../i18n';

/** A screen of the film, taken in the app's language (§308.7); English ones are at the folder's root. */
const tourPicture = (name: string) => {
  const locale = appLocale();
  return locale === 'rw' || locale === 'fr' ? `/tour/${locale}/${name}.jpg` : `/tour/${name}.jpg`;
};

/**
 * The welcome tour (§307): what somebody new to the seller app sees the first
 * time they reach it — a founder once they leave setting up their shop, a new
 * member of a team the first time they sign in.
 *
 * First a short FILM of how a booking reaches them, on the real screens; then,
 * if they want it, the MARKS: the real app dimmed, and a light moving from one
 * part of it to the next with a few words beside it. Put aside or finished, it
 * is not shown again on any device — the server keeps that — and it can be
 * taken again from Help or the search.
 */

type Phase = { kind: 'film' } | { kind: 'marks'; marks: Mark[] } | null;

const TourContext = createContext<{ start: () => void }>({ start: () => undefined });

/** Starts the tour again, from wherever it is asked for. */
export const useTour = () => useContext(TourContext);

const PHONE = '(max-width: 859px)';
const lessMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function TourProvider({ children }: { children: ReactNode }) {
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const access = useAccess();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>(null);
  const offered = useRef(false);

  const due = me.data?.toursDue?.includes('seller') ?? false;
  const shopName = me.data?.businessMembership?.businessProfile.name?.trim() || null;

  // Owed: offered once, on the Overview, after the opening picture has gone —
  // never over somebody who went straight to a page of their own.
  useEffect(() => {
    if (!due || offered.current || location.pathname !== '/') return;
    let timer = 0;
    let left = false;
    void leaveIntro().then(() => {
      if (left) return;
      timer = window.setTimeout(() => {
        offered.current = true;
        setPhase({ kind: 'film' });
      }, 450);
    });
    // Gone before it showed: offered on the next visit to the Overview.
    return () => {
      left = true;
      window.clearTimeout(timer);
    };
  }, [due, location.pathname]);

  const markDone = useCallback(() => {
    if (!due) return;
    tourDone('seller')
      .then(({ toursDue }) => queryClient.setQueryData<Me>(['me'], (old) => (old ? { ...old, toursDue } : old)))
      .catch(() => undefined);
  }, [due, queryClient]);

  const start = useCallback(() => {
    if (location.pathname !== '/') navigate('/');
    setPhase({ kind: 'film' });
  }, [location.pathname, navigate]);

  const phone = () => window.matchMedia(PHONE).matches;
  const value = useMemo(() => ({ start }), [start]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {phase?.kind === 'film' && (
        <Film
          shopName={shopName}
          onTour={() => setPhase({ kind: 'marks', marks: marksFor(phone(), access) })}
          onSkip={() => {
            // The first time, where to find it again is shown before it goes.
            if (due) {
              markDone();
              setPhase({ kind: 'marks', marks: [keptMark(phone())] });
            } else setPhase(null);
          }}
        />
      )}
      {phase?.kind === 'marks' && (
        <Marks
          marks={phase.marks}
          onEnd={() => {
            markDone();
            setPhase(null);
          }}
        />
      )}
    </TourContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* The film                                                            */
/* ------------------------------------------------------------------ */

const spotVars = (scene: Scene) => {
  const vars: Record<string, string> = {};
  const set = (prefix: string, spot: { x: number; y: number; w: number; h: number }) => {
    vars[`--${prefix}x`] = `${spot.x}%`;
    vars[`--${prefix}y`] = `${spot.y}%`;
    vars[`--${prefix}w`] = `${spot.w}%`;
    vars[`--${prefix}h`] = `${spot.h}%`;
    vars[`--${prefix}ox`] = `${spot.x + spot.w / 2}%`;
    vars[`--${prefix}oy`] = `${spot.y + spot.h / 2}%`;
  };
  set('p', scene.phone);
  if (scene.desk) set('d', scene.desk);
  return vars as CSSProperties;
};

/**
 * "How a booking reaches you", in five moments (§307), told like the landing
 * page's steps (§260): each moment's real screen eases in on the part that
 * matters, with the rest dimmed and a note floating beside it. The customer's
 * moments are on a phone; the seller's are on this app — a computer's screen
 * on a computer, the phone's on a phone. It plays by itself, pauses under the
 * mouse or a held finger, and stops at the end on "Show me around".
 */
function Film({ shopName, onTour, onSkip }: { shopName: string | null; onTour: () => void; onSkip: () => void }) {
  const phone = useMediaQuery(PHONE);
  const [active, setActive] = useState(0);
  // Bumped on a jump, so the moment's line fills again from empty.
  const [round, setRound] = useState(0);
  const [held, setHeld] = useState(false);
  const [ended, setEnded] = useState(false);
  const [still] = useState(lessMotion);
  const go = useRef<HTMLButtonElement>(null);
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);
  const scene = SCENES[active];
  const last = SCENES.length - 1;

  const jump = (i: number) => {
    setActive(Math.max(0, Math.min(last, i)));
    setRound((r) => r + 1);
    setEnded(false);
  };
  const advance = () => (active === last ? setEnded(true) : jump(active + 1));

  useEffect(() => {
    go.current?.focus({ preventScroll: true });
    // Every screen fetched at once, so none of them fades in empty.
    for (const s of SCENES) {
      const image = new Image();
      image.src = tourPicture(`${s.key}-${s.side === 'seller' && !window.matchMedia(PHONE).matches ? 'desktop' : 'phone'}`);
    }
    // The page under the film stays where it is.
    document.documentElement.classList.add('tf-open');
    return () => document.documentElement.classList.remove('tf-open');
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip();
      else if (event.key === 'ArrowRight') jump(active + 1);
      else if (event.key === 'ArrowLeft') jump(active - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // A phone's screen is stories: a tap on the left goes back, on the right
  // goes on, a swipe either way, and a finger held down pauses.
  const onPointerDown = (event: React.PointerEvent) => {
    touch.current = { x: event.clientX, y: event.clientY, at: Date.now() };
    if (event.pointerType !== 'mouse') setHeld(true);
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const start = touch.current;
    touch.current = null;
    if (event.pointerType !== 'mouse') setHeld(false);
    if (!start || !phone) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) > 40) return jump(active + (dx < 0 ? 1 : -1));
    // A long press was a pause, not a tap.
    if (Date.now() - start.at > 350 || Math.abs(event.clientY - start.y) > 20) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    jump(active + (event.clientX - box.left < box.width * 0.35 ? -1 : 1));
  };

  const playing = !held && !ended && !still;
  const deviceFor = (s: Scene) => (s.side === 'seller' && !phone ? 'browser' : 'phone');
  const showing = deviceFor(scene);
  const shotsIn = (device: 'browser' | 'phone') => SCENES.map((s, i) => ({ s, i })).filter(({ s }) => deviceFor(s) === device);

  const bar = (i: number) => (
    <span className="tf-bar" aria-hidden="true">
      {i === active && !still && !ended ? (
        <i key={`${active}-${round}`} className="is-live" onAnimationEnd={advance} />
      ) : (
        <i className={i < active || (i === active && (ended || still)) ? 'is-full' : ''} />
      )}
    </span>
  );

  return (
    <Portal>
      <div className="tf-backdrop" />
      <div className={`tf${playing ? ' is-playing' : ''}${ended ? ' is-ended' : ''}${still ? ' is-still' : ''}`}>
        <div className="tf-panel" role="dialog" aria-modal="true" aria-labelledby="tf-title" aria-describedby="tf-lead">
          <button type="button" className="tf-close" onClick={onSkip} aria-label={t`Close the welcome`}>
            <Icon name="close" size={18} stroke={2.2} />
          </button>

          {phone && (
            <div className="tf-stories" aria-hidden="true">
              {SCENES.map((s, i) => (
                <span key={s.key} className="tf-story">
                  {bar(i)}
                </span>
              ))}
            </div>
          )}

          <div className="tf-side">
            <header className="tf-head">
              <p className="tf-eyebrow">
                <Logo size={22} />
                <span>{shopName ? t`Welcome, ${shopName}` : t`Welcome aboard`}</span>
              </p>
              <h2 id="tf-title"><Trans>How a booking <span>reaches you.</span></Trans>
              </h2>
              <p className="tf-lead" id="tf-lead">
                <Trans>Five moments, on the real screens. Then we can show you around — it takes a minute.</Trans>
              </p>
            </header>

            {!phone && (
              <ol className="tf-steps" role="tablist" aria-label={t`How a booking reaches you`}>
                {SCENES.map((s, i) => {
                  const on = i === active;
                  return (
                    <li key={s.key} className={`${on ? 'is-on' : ''}${i < active ? ' is-done' : ''}`}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={on}
                        aria-controls="tf-stage"
                        onClick={() => jump(i)}
                      >
                        <span className="tf-n">{i < active ? <Icon name="check" size={14} stroke={2.6} /> : i + 1}</span>
                        <span className="tf-step-text">
                          <strong>{s.title}</strong>
                          <span className="tf-step-desc">
                            <span>{s.text}</span>
                          </span>
                        </span>
                        {bar(i)}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div
            className="tf-stage"
            id="tf-stage"
            role="tabpanel"
            onMouseEnter={() => setHeld(true)}
            onMouseLeave={() => setHeld(false)}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              touch.current = null;
              setHeld(false);
            }}
          >
            <span className="tf-glow" aria-hidden="true" />
            <p className={`tf-whose is-${scene.side}`} key={`${scene.side}-${phone}`}>
              <Icon name={scene.side === 'customer' ? 'phone' : 'store'} size={14} stroke={2.2} />
              {scene.side === 'customer' ? t`On the customer’s phone` : t`In your app`}
            </p>

            {(['browser', 'phone'] as const).map((device) => {
              const shots = shotsIn(device);
              if (!shots.length) return null;
              return (
                <div key={device} className={`tf-device is-${device}${showing === device ? ' is-on' : ''}`} aria-hidden={showing !== device}>
                  {device === 'browser' ? (
                    <div className="tf-chrome" aria-hidden="true">
                      <span className="tf-dots">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="tf-url">
                        <Icon name="lock" size={12} stroke={2} />{' '}
                        <Trans>BwanguReservations · For businesses</Trans>
                      </span>
                    </div>
                  ) : (
                    <span className="tf-notch" aria-hidden="true" />
                  )}
                  <div className="tf-screen">
                    {shots.map(({ s, i }) => (
                      <figure key={s.key} className={`tf-shot${i === active ? ' is-on' : ''}`} style={spotVars(s)}>
                        <div className="tf-zoom">
                          <img
                            src={tourPicture(`${s.key}-${device === 'browser' ? 'desktop' : 'phone'}`)}
                            alt={i === active ? s.alt : ''}
                            draggable={false}
                            decoding="async"
                          />
                          <span className="tf-spot" aria-hidden="true" />
                        </div>
                      </figure>
                    ))}
                  </div>
                </div>
              );
            })}

            {!phone &&
              SCENES.map((s, i) => (
                <span key={s.key} className={`tf-chip is-${s.side} c${i}${i === active ? ' is-on' : ''}`} aria-hidden="true">
                  <span className={`tf-chip-icon is-${s.chip.tone}`}>
                    <Icon name={s.chip.icon} size={18} stroke={2.2} />
                  </span>
                  <span>
                    <strong>{s.chip.title}</strong>
                    <em>{s.chip.text}</em>
                  </span>
                </span>
              ))}
          </div>

          {phone && (
            <p className="tf-caption" key={active} aria-live="polite">
              <strong>{scene.title}</strong>
              {scene.text}
            </p>
          )}

          <footer className="tf-foot">
            <button type="button" ref={go} className="primary tf-go" onClick={onTour}>
              <Trans>Show me around</Trans>
            <Icon name="arrowRight" size={17} stroke={2.3} />
            </button>
            <button type="button" className="tf-later" onClick={onSkip}>
              <Trans>I’ll look around myself</Trans>
            </button>
          </footer>
        </div>
      </div>
    </Portal>
  );
}

/* ------------------------------------------------------------------ */
/* The marks                                                           */
/* ------------------------------------------------------------------ */

type Box = { x: number; y: number; w: number; h: number };

/** What carries this name and can be seen: the sidebar is drawn twice, once hidden on a phone. */
const findTarget = (name: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)).find((el) => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }) ?? null;

const GAP = 16;
const EDGE = 12;

/** Where the card goes beside the light, trying the side asked for first. */
function placeCard(hole: Box, card: { w: number; h: number }, want: Placement, vw: number, vh: number) {
  const opposite: Record<Placement, Placement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const order: Placement[] = [want, opposite[want], ...(['bottom', 'top', 'right', 'left'] as Placement[]).filter((p) => p !== want && p !== opposite[want])];
  const clampX = (x: number) => Math.max(EDGE, Math.min(vw - card.w - EDGE, x));
  const clampY = (y: number) => Math.max(EDGE, Math.min(vh - card.h - EDGE, y));
  for (const side of order) {
    if (side === 'right' && hole.x + hole.w + GAP + card.w <= vw - EDGE)
      return { side, x: hole.x + hole.w + GAP, y: clampY(hole.y + hole.h / 2 - card.h / 2) };
    if (side === 'left' && hole.x - GAP - card.w >= EDGE)
      return { side, x: hole.x - GAP - card.w, y: clampY(hole.y + hole.h / 2 - card.h / 2) };
    if (side === 'bottom' && hole.y + hole.h + GAP + card.h <= vh - EDGE)
      return { side, x: clampX(hole.x + hole.w / 2 - card.w / 2), y: hole.y + hole.h + GAP };
    if (side === 'top' && hole.y - GAP - card.h >= EDGE)
      return { side, x: clampX(hole.x + hole.w / 2 - card.w / 2), y: hole.y - GAP - card.h };
  }
  // Nowhere beside it (a tall card on a small screen): over its foot.
  return { side: 'over' as const, x: clampX(hole.x + hole.w / 2 - card.w / 2), y: vh - card.h - EDGE };
}

/**
 * The app dimmed, with a light on one part of it and a card beside it (§307).
 *
 * The light is a rounded hole in the dim; it glides from one part to the next
 * and follows the page as it scrolls, so a step never points at where
 * something used to be. The page underneath does not take clicks while it is
 * on — a click there nudges the card instead — so nothing is opened by
 * accident halfway through. ← and → move, Esc ends it.
 */
function Marks({ marks: asked, onEnd }: { marks: Mark[]; onEnd: () => void }) {
  // Only what is on the screen now: a shop that is live has no setup card, a
  // member who does not see the money has no money.
  const [marks, setMarks] = useState<Mark[] | null>(null);
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [nudged, setNudged] = useState(0);
  const hole = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLSpanElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const target = useRef<HTMLElement | null>(null);
  // Where the light and the card are, kept between steps so they glide on from there.
  const lit = useRef<Box | null>(null);
  const placed = useRef<{ x: number; y: number } | null>(null);
  const [still] = useState(lessMotion);
  const goTo = (i: number) => {
    setNudged(0);
    setIndex(i);
  };
  // Where the page and the menu were before the light moved them, so the end
  // of the tour leaves everything as it found it.
  const scrolled = useRef(new Map<Element | Window, number>());
  const remember = (el: HTMLElement) => {
    if (!scrolled.current.has(window)) scrolled.current.set(window, window.scrollY);
    for (let box = el.parentElement; box; box = box.parentElement) {
      const style = getComputedStyle(box);
      if (box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(style.overflowY) && !scrolled.current.has(box)) {
        scrolled.current.set(box, box.scrollTop);
      }
    }
  };

  useEffect(() => {
    // A moment for the page under the film to have drawn.
    const timer = window.setTimeout(() => setMarks(asked.filter((m) => findTarget(m.target))), 260);
    return () => window.clearTimeout(timer);
  }, [asked]);

  const mark = marks?.[index] ?? null;
  const count = marks?.length ?? 0;
  const lastOne = index === count - 1;

  const end = useCallback(() => {
    setLeaving(true);
    for (const [box, top] of scrolled.current) box.scrollTo({ top, behavior: still ? 'auto' : 'smooth' });
    window.setTimeout(onEnd, still ? 0 : 260);
  }, [onEnd, still]);

  useEffect(() => {
    if (marks && marks.length === 0) onEnd();
  }, [marks, onEnd]);

  // Each step: its part found, brought into view, and the card's button ready for a key.
  useLayoutEffect(() => {
    if (!mark) return;
    const el = findTarget(mark.target);
    target.current = el;
    if (el) {
      remember(el);
      const behavior = still ? 'auto' : 'smooth';
      const inPage = Boolean(el.closest('.content'));
      if (inPage && mark.place === 'bottom' && window.matchMedia(PHONE).matches) {
        // A phone has no room either side of a tall card: it goes up under
        // the top bar, and the words go below it.
        const bar = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - bar - 12, behavior });
      } else {
        el.scrollIntoView({ block: inPage ? 'center' : 'nearest', inline: 'nearest', behavior });
      }
    }
    next.current?.focus({ preventScroll: true });
  }, [mark, still]);

  useEffect(() => {
    if (!marks) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') end();
      else if (event.key === 'ArrowRight') (lastOne ? end() : goTo(index + 1));
      else if (event.key === 'ArrowLeft') goTo(Math.max(0, index - 1));
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The light and the card, every frame: eased towards where the part is
  // now, so they glide between steps and keep up with a scroll.
  useEffect(() => {
    if (!mark) return;
    let frame = 0;
    let then = performance.now();
    const tick = (time: number) => {
      const dt = Math.min(64, time - then);
      then = time;
      const el = target.current?.isConnected ? target.current : (target.current = findTarget(mark.target));
      const h = hole.current;
      const c = card.current;
      if (el && h && c) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const box = el.getBoundingClientRect();
        const pad = mark.pad ?? 8;
        // Kept on the screen: a part taller than the window is lit where it shows.
        const top = Math.max(6, box.top - pad);
        const bottom = Math.min(vh - 6, box.bottom + pad);
        const goal: Box = { x: box.left - pad, y: top, w: box.width + pad * 2, h: Math.max(24, bottom - top) };
        const was = lit.current;
        const k = still || !was ? 1 : 1 - Math.exp(-dt / 80);
        const now = was
          ? { x: was.x + (goal.x - was.x) * k, y: was.y + (goal.y - was.y) * k, w: was.w + (goal.w - was.w) * k, h: was.h + (goal.h - was.h) * k }
          : goal;
        lit.current = now;
        h.style.transform = `translate3d(${now.x}px, ${now.y}px, 0)`;
        h.style.width = `${now.w}px`;
        h.style.height = `${now.h}px`;
        h.style.borderRadius = `${Math.min(mark.radius ?? 14, now.w / 2, now.h / 2)}px`;

        const size = { w: c.offsetWidth, h: c.offsetHeight };
        const spot = placeCard(now, size, mark.place, vw, vh);
        const before = placed.current;
        const at = before && !still ? { x: before.x + (spot.x - before.x) * k, y: before.y + (spot.y - before.y) * k } : { x: spot.x, y: spot.y };
        placed.current = at;
        c.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`;

        // The card's point, at the middle of what is lit.
        const a = arrow.current;
        if (a) {
          a.dataset.side = spot.side;
          if (spot.side === 'left' || spot.side === 'right') {
            a.style.top = `${Math.max(22, Math.min(size.h - 22, now.y + now.h / 2 - at.y))}px`;
            a.style.left = '';
          } else {
            a.style.left = `${Math.max(26, Math.min(size.w - 26, now.x + now.w / 2 - at.x))}px`;
            a.style.top = '';
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // The light carries on from where it is when the step changes.
  }, [mark, still]);

  if (!marks || !mark) return null;
  const single = count === 1;

  return (
    <Portal>
      <div className={`tm${leaving ? ' is-leaving' : ''}${still ? ' is-still' : ''}`}>
        <div className="tm-catch" onClick={() => setNudged((n) => n + 1)} aria-hidden="true" />
        <div className="tm-hole" ref={hole} aria-hidden="true">
          <span className="tm-ring" key={index} />
        </div>
        <div
          className="tm-card"
          ref={card}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tm-title"
          aria-describedby="tm-text"
        >
          <span className="tm-arrow" ref={arrow} aria-hidden="true" />
          <div className={`tm-inner${nudged ? ' is-nudged' : ''}`} key={`${index}-${nudged}`}>
            <div className="tm-top">
              <span className="tm-icon" aria-hidden="true">
                <Icon name={mark.icon} size={18} stroke={2.1} />
              </span>
              {!single && (
                <span className="tm-count">
                  {index + 1}<Trans>of {count}</Trans>
                </span>
              )}
              <button type="button" className="tm-x" onClick={end} aria-label={t`End the tour`}>
                <Icon name="close" size={16} stroke={2.2} />
              </button>
            </div>
            <h3 id="tm-title">{mark.title}</h3>
            <p id="tm-text">{mark.text}</p>
            <div className="tm-foot">
              {!single && (
                <span className="tm-dots" aria-hidden="true">
                  {marks.map((m, i) => (
                    <i key={m.target} className={i === index ? 'is-on' : i < index ? 'is-done' : ''} />
                  ))}
                </span>
              )}
              <span className="tm-buttons">
                {index > 0 && (
                  <button type="button" className="tm-back" onClick={() => goTo(index - 1)}>
                    <Trans>Back</Trans>
                  </button>
                )}
                <button
                  type="button"
                  ref={next}
                  className="primary tm-next"
                  onClick={() => (lastOne ? end() : goTo(index + 1))}
                >
                  {single ? t`Got it` : lastOne ? t`Finish` : t`Next`}
                  {!single && <Icon name={lastOne ? 'check' : 'arrowRight'} size={16} stroke={2.4} />}
                </button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
