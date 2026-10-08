import { useLocation } from 'react-router-dom';
import { NAV_ITEMS } from '../nav';
import { AdCarousel } from './AdCarousel';
import { buildSlides } from './slides';
import { useAdData } from './useAdData';
import { useForYouPanels } from './useForYouPanels';
import './ads.css';

/**
 * Each page opens on its own advert: its place in the menu, so neighbouring
 * pages never open on the same one.
 */
const seedOf = (path: string) => Math.max(0, NAV_ITEMS.findIndex((item) => item.to === path));

/**
 * The "For you" banner, slim, at the top of every page but Overview when there
 * is no room for the column (§221) — about half the height of Overview's, with
 * just the label, the title and a round button, so the page's own work starts
 * close to the top. Each page opens on a different advert.
 */
export function AdStrip() {
  const data = useAdData();
  const { pathname } = useLocation();
  const { elsewhere, panels } = useForYouPanels(data);

  if (!data.ready) return <div className="skeleton ad-strip-skel" />;
  const slides = buildSlides(data);

  return (
    <aside className="ad-strip" aria-label="For you">
      <AdCarousel slides={slides} slim start={seedOf(pathname)} onElsewhere={elsewhere} />
      {panels}
    </aside>
  );
}
