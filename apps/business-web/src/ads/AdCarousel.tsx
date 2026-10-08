import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../ui/Icon';
import type { Slide } from './slides';

/** How long each advert is on screen — the customer app's pace (§188). */
const SLIDE_MS = 8000;
const MOVE_MS = 620;

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The "For you" banner (§204): the seller app's version of the customer app's
 * spotlights (§176, §188). One advert at a time, eight seconds each, round and
 * round — from the last straight on to the first, never rewinding. Hovering or
 * focusing it holds it still; the dots jump to any one; with "reduce motion"
 * on, it waits for the dots.
 */
export function AdCarousel({ slides, compact = false }: { slides: Slide[]; compact?: boolean }) {
  const navigate = useNavigate();
  const count = slides.length;
  // `index === count` is a copy of the first, drawn after the last, so the
  // last slides on to it like any other; then the strip jumps back unseen.
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [held, setHeld] = useState(false);
  const still = reduceMotion();
  const shown = count ? index % count : 0;
  const root = useRef<HTMLDivElement>(null);

  // A set that changes (a check is done, a review answered) must not leave the
  // strip pointing past its end.
  useEffect(() => {
    if (index > count) setIndex(0);
  }, [count, index]);

  useEffect(() => {
    if (still || held || count < 2 || index === count) return;
    const timer = setTimeout(() => {
      setAnimate(true);
      setIndex((i) => i + 1);
    }, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [index, held, count, still]);

  // Arrived on the copy: back to the real first without a slide.
  useEffect(() => {
    if (count < 2 || index !== count) return;
    const timer = setTimeout(() => {
      setAnimate(false);
      setIndex(0);
    }, MOVE_MS + 40);
    return () => clearTimeout(timer);
  }, [index, count]);

  if (count === 0) return null;
  const strip = count > 1 ? [...slides, slides[0]] : slides;

  const act = (slide: Slide) => {
    const cta = slide.cta;
    if (!cta) return;
    if (cta.href) window.open(cta.href, '_blank', 'noopener');
    else if (cta.to) navigate(cta.to);
    else if (cta.scrollTo) document.getElementById(cta.scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      ref={root}
      className={`adc${compact ? ' is-compact' : ''}`}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node)) setHeld(false);
      }}
      role="region"
      aria-roledescription="carousel"
      aria-label="For you"
    >
      <div className="adc-window">
        <div
          className="adc-strip"
          style={{
            transform: `translateX(-${index * 100}%)`,
            transition: animate ? `transform ${MOVE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` : 'none',
          }}
        >
          {strip.map((slide, i) => {
            const active = i === index || (index === count && i === 0);
            return (
              <article
                key={i === count ? `${slide.key}#again` : slide.key}
                className={`adc-slide look-${slide.look}${slide.image ? ' has-image' : ''}${active ? ' is-active' : ''}`}
                aria-hidden={!active}
                aria-roledescription="slide"
                aria-label={`${(i % count) + 1} of ${count}: ${slide.eyebrow}`}
              >
                {slide.image ? (
                  <div className="adc-photo" style={{ backgroundImage: `url(${slide.image})` }} />
                ) : (
                  <div className="adc-art" aria-hidden="true">
                    <Icon name={slide.icon} size={compact ? 150 : 190} stroke={1} />
                    <i className="r1" />
                    <i className="r2" />
                  </div>
                )}
                <div className="adc-shade" />
                {slide.stat && (
                  <div className="adc-stat">
                    <strong>{slide.stat.value}</strong>
                    <span>{slide.stat.label}</span>
                  </div>
                )}
                <div className="adc-body">
                  <span className="adc-eyebrow">
                    <Icon name={slide.icon} size={13} stroke={2.2} />
                    {slide.eyebrow}
                  </span>
                  <h3>{slide.title}</h3>
                  <p>{slide.text}</p>
                  {slide.cta && (
                    <button type="button" className="adc-cta" tabIndex={active ? 0 : -1} onClick={() => act(slide)}>
                      {slide.cta.label}
                      <Icon name={slide.cta.href ? 'external' : 'arrowRight'} size={15} stroke={2.2} />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
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
              onClick={() => {
                setAnimate(true);
                setIndex(i);
              }}
            >
              {i === shown && (
                <i
                  key={`${index}-${held}`}
                  style={{
                    animationDuration: `${SLIDE_MS}ms`,
                    animationPlayState: held || still || index === count ? 'paused' : 'running',
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
