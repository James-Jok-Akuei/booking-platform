import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { NAV_ITEMS } from '../nav';
import { Icon } from '../ui/Icon';
import { AdCarousel } from './AdCarousel';
import { buildSlides } from './slides';
import { hideStrip, isStripHidden, showStripAgain } from './stripHidden';
import { useAdData } from './useAdData';
import { useForYouPanels } from './useForYouPanels';
import './ads.css';

/**
 * Each page opens on its own advert: its place in the menu, so neighbouring
 * pages never open on the same one.
 */
const seedOf = (path: string) => Math.max(0, NAV_ITEMS.findIndex((item) => item.to === path));

/** How long "Hidden until you next sign in · Undo" stays after closing. */
const NOTE_MS = 5000;

/**
 * The "For you" banner, slim, at the top of every page but Overview when there
 * is no room for the column (§221) — about half the height of Overview's, with
 * just the label, the title and a round button, so the page's own work starts
 * close to the top. Each page opens on a different advert.
 *
 * Its ✕ closes it on every page until the seller next signs in (§223); a short
 * note says so, with Undo. Overview's own block has no ✕.
 */
export function AdStrip() {
  const data = useAdData();
  const { pathname } = useLocation();
  const { elsewhere, panels } = useForYouPanels(data);
  const [hidden, setHidden] = useState(isStripHidden);
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState(false);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(false), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  const close = () => {
    hideStrip();
    setClosing(true);
  };
  const undo = () => {
    showStripAgain();
    setNote(false);
    setClosing(false);
    setHidden(false);
  };

  if (hidden) {
    return note ? (
      <p className="ad-strip-note" role="status">
        <Icon name="clock" size={15} />
        <span>Adverts hidden until you next sign in.</span>
        <button type="button" onClick={undo}>
          Undo
        </button>
      </p>
    ) : null;
  }

  if (!data.ready) return <div className="skeleton ad-strip-skel" />;

  return (
    <aside
      className={`ad-strip${closing ? ' is-closing' : ''}`}
      aria-label="For you"
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) {
          setHidden(true);
          setNote(true);
        }
      }}
    >
      <AdCarousel slides={buildSlides(data)} slim start={seedOf(pathname)} onElsewhere={elsewhere} />
      <button
        type="button"
        className="ad-strip-close"
        onClick={close}
        aria-label="Hide adverts until you next sign in"
        title="Hide until you next sign in"
      >
        <Icon name="close" size={14} stroke={2.4} />
      </button>
      {panels}
    </aside>
  );
}
