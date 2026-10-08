import { Fragment, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../ui/Icon';
import { Effect } from './Effects';
import type { Slide } from './slides';

/** How long each advert is on screen — the customer app's pace (§188). */
const SLIDE_MS = 8000;
/** How long one slide takes to hand over to the next. */
const SWAP_MS = 900;

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = () =>
  typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * The "For you" banner (§204, §210). One advert at a time, eight seconds each,
 * always moving forward.
 *
 * Each card is built in layers (§210): a deep gradient with slow aurora light
 * drifting through it and a fine grain, the photo easing closer or — without
 * one — a floating glass tile with its own orbit, and a sheen sweeping
 * across — and each card its own moving effect, chosen for what it is about
 * (§212): confetti, coins, a ping, rising stars, bubbles, shooting stars and
 * more. Cards hand over cinematically (the new one sharpens out of a blur as
 * the old one recedes), the frame's edge shimmers, and on a computer the card
 * tilts towards the pointer with a light that follows it. The dots below show
 * the time left and jump to any card; on a phone, swipe. With "reduce motion"
 * on, none of it moves and nothing advances by itself.
 */
export function AdCarousel({
  slides,
  compact = false,
  slim = false,
  start = 0,
  onElsewhere,
}: {
  slides: Slide[];
  compact?: boolean;
  /** About half the height: label, title and a round button (§221). */
  slim?: boolean;
  /** Which advert to open on (wrapped), so different pages open on different ones. */
  start?: number;
  /** For a button pointing at part of the column when the column is not on
   *  screen (a phone): the place that shows that part instead. */
  onElsewhere?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const count = slides.length;
  const [index, setIndex] = useState(() => (slides.length ? start % slides.length : 0));
  const [leaving, setLeaving] = useState<number | null>(null);
  const [dir, setDir] = useState(1);
  const [held, setHeld] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const still = reduceMotion();
  const root = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const shown = count ? Math.min(index, count - 1) : 0;

  const go = (to: number, direction: number) => {
    if (count < 2) return;
    const next = ((to % count) + count) % count;
    if (next === shown) return;
    setLeaving(shown);
    setDir(direction);
    setIndex(next);
  };

  // The card that left is drawn until it has finished leaving.
  useEffect(() => {
    if (leaving === null) return;
    const timer = setTimeout(() => setLeaving(null), SWAP_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  // Only moves while it can be seen.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const seen = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting && !document.hidden), {
      threshold: 0.2,
    });
    seen.observe(el);
    const onVisibility = () => setOnScreen(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      seen.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (still || held || !onScreen || count < 2) return;
    const timer = setTimeout(() => go(shown + 1, 1), SLIDE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, held, onScreen, count, still]);

  if (count === 0) return null;

  const act = (slide: Slide) => {
    const cta = slide.cta;
    if (!cta || swipe.current?.moved) return;
    if (cta.href) window.open(cta.href, '_blank', 'noopener');
    else if (cta.to) navigate(cta.to);
    else if (cta.scrollTo) {
      const target = document.getElementById(cta.scrollTo);
      if (!target) return onElsewhere?.(cta.scrollTo);
      // A "How it works" topic opens as it comes into view.
      if (target instanceof HTMLDetailsElement) target.open = true;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Tilt towards the pointer, with a light that follows it.
  const lean = (event: PointerEvent<HTMLDivElement>) => {
    const el = frame.current;
    if (!el || still || event.pointerType !== 'mouse' || !finePointer()) return;
    const box = el.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width;
    const py = (event.clientY - box.top) / box.height;
    el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
    el.style.setProperty('--rx', `${((0.5 - py) * 5).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${((px - 0.5) * 7).toFixed(2)}deg`);
  };
  const settle = () => {
    const el = frame.current;
    el?.style.setProperty('--rx', '0deg');
    el?.style.setProperty('--ry', '0deg');
  };

  // A swipe sideways changes card; anything else is a tap.
  const down = (event: PointerEvent<HTMLDivElement>) => {
    swipe.current = { x: event.clientX, y: event.clientY, moved: false };
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      start.moved = true;
      go(shown + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    }
    // Cleared once the click that follows this release has been seen.
    setTimeout(() => {
      swipe.current = null;
    }, 0);
  };

  return (
    <div
      ref={root}
      className={`adc${compact ? ' is-compact' : ''}${slim ? ' is-slim' : ''}${still ? ' is-still' : ''}`}
      style={{ '--dir': dir } as CSSProperties}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node)) setHeld(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(shown + 1, 1);
        if (event.key === 'ArrowLeft') go(shown - 1, -1);
      }}
      role="region"
      aria-roledescription="carousel"
      aria-label="For you"
    >
      <div
        ref={frame}
        className="adc-frame"
        onPointerMove={lean}
        onPointerLeave={settle}
        onPointerDown={down}
        onPointerUp={up}
      >
        <div className="adc-window">
          <div className="adc-stage">
            {slides.map((slide, i) => (
              <Card
                key={slide.key}
                slide={slide}
                position={`${i + 1} of ${count}`}
                active={i === shown}
                leaving={i === leaving}
                compact={compact}
                lively={!still && onScreen}
                onAct={() => act(slide)}
              />
            ))}
          </div>
          <i className="adc-glare" aria-hidden="true" />

        </div>
      </div>

      {count > 1 && (
        <div className="adc-dots" role="tablist" aria-label="Choose an advert">
          {slides.map((slide, i) => (
            <button
              key={slide.key}
              type="button"
              role="tab"
              aria-selected={i === shown}
              aria-label={`${i + 1} of ${count}: ${slide.eyebrow}`}
              className={`adc-dot${i === shown ? ' is-on' : ''}`}
              onClick={() => go(i, i > shown ? 1 : -1)}
            >
              {i === shown && (
                <i
                  key={`${shown}-${held}`}
                  style={{
                    animationDuration: `${SLIDE_MS}ms`,
                    animationPlayState: held || still || !onScreen ? 'paused' : 'running',
                  }}
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({
  slide,
  position,
  active,
  leaving,
  compact,
  lively,
  onAct,
}: {
  slide: Slide;
  position: string;
  active: boolean;
  leaving: boolean;
  compact: boolean;
  lively: boolean;
  onAct: () => void;
}) {
  const words = slide.title.split(/\s+/);
  return (
    <article
      className={[
        'adc-slide',
        `look-${slide.look}`,
        slide.image ? 'has-image' : 'has-art',
        slide.stat && 'has-stat',
        active && 'is-active',
        leaving && 'is-leaving',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden={!active}
      aria-roledescription="slide"
      aria-label={`${position}: ${slide.eyebrow}`}
    >
      <div className="adc-bg" aria-hidden="true">
        <i className="m1" />
        <i className="m2" />
        <i className="m3" />
      </div>
      {slide.image ? (
        <>
          <div className="adc-photo" style={{ backgroundImage: `url(${slide.image})` }} />
          <div className="adc-tint" />
        </>
      ) : (
        <Art icon={slide.icon} compact={compact} />
      )}
      <div className="adc-shade" />
      <Effect kind={slide.effect ?? 'bokeh'} running={active && lively} />
      <i className="adc-shine" aria-hidden="true" />

      {slide.stat && (
        <div className="adc-stat">
          <strong>
            <CountUp value={slide.stat.value} run={active && lively} />
          </strong>
          <span>{slide.stat.label}</span>
        </div>
      )}

      <div className="adc-body">
        <span className="adc-eyebrow">
          <Icon name={slide.icon} size={13} stroke={2.2} />
          {slide.eyebrow}
        </span>
        <h3 aria-label={slide.title}>
          {words.map((word, i) => (
            <Fragment key={i}>
              <span aria-hidden="true" style={{ '--i': i } as CSSProperties}>
                {word}
              </span>
              {i < words.length - 1 ? ' ' : ''}
            </Fragment>
          ))}
        </h3>
        <p>{slide.text}</p>
        {slide.cta && (
          <button type="button" className="adc-cta" tabIndex={active ? 0 : -1} onClick={onAct}>
            <span>{slide.cta.label}</span>
            <Icon name={slide.cta.href ? 'external' : 'arrowRight'} size={15} stroke={2.2} />
          </button>
        )}
      </div>
    </article>
  );
}

/** Without a photo: a glass tile floating before a slow-morphing glow, an orbit, and the icon drawn large and faint behind. */
function Art({ icon, compact }: { icon: IconName; compact: boolean }) {
  return (
    <div className="adc-art" aria-hidden="true">
      <Icon className="adc-ghost" name={icon} size={compact ? 170 : 230} stroke={0.8} />
      <i className="adc-blob" />
      <i className="adc-orbit">
        <b />
      </i>
      <span className="adc-glass">
        <Icon name={icon} size={compact ? 28 : 36} stroke={1.8} />
      </span>
    </div>
  );
}

/** A number that counts up from nothing when its card arrives: "94%", "12". */
function CountUp({ value, run }: { value: string; run: boolean }) {
  const match = /^(\d[\d,]*)(.*)$/.exec(value);
  const target = match ? Number(match[1].replace(/,/g, '')) : 0;
  const [n, setN] = useState(target);

  useEffect(() => {
    if (!match || !run) {
      setN(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1100);
      setN(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    setN(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, target]);

  if (!match) return <>{value}</>;
  return (
    <>
      {n.toLocaleString()}
      {match[2]}
    </>
  );
}
