import { Icon } from '../ui/Icon';
import { AdCarousel } from './AdCarousel';
import { buildSlides } from './slides';
import { useAdData } from './useAdData';
import { useForYouPanels } from './useForYouPanels';
import './ads.css';
import { Trans } from '@lingui/react/macro';

/**
 * "For you" on a phone or tablet (§205, §206): at the top of the home page,
 * the way the customer app puts its spotlights at the top of Home (§176) —
 * the banner (which leads with whatever just came in), then "How it works" as
 * chips. "See all" opens everything the wide screen's column holds.
 */
export function ForYouTop() {
  const data = useAdData();
  const { topics, elsewhere, openAll, openTopic, panels } = useForYouPanels(data);

  if (!data.ready) return <div className="skeleton fy-skel" />;

  return (
    <section className="fy">
      <header className="fy-head">
        <p className="ads-label">
          <Icon name="sparkles" size={14} />{' '}
          <Trans>For you</Trans>
        </p>
        <button type="button" className="fy-all" onClick={openAll}><Trans>See all </Trans><Icon name="chevronRight" size={15} stroke={2.2} />
        </button>
      </header>

      <AdCarousel slides={buildSlides(data)} compact onElsewhere={elsewhere} />

      <div className="fy-learn">
        <p className="ads-label"><Trans>How it works</Trans></p>
        <div className="fy-chips">
          {topics.map((t) => (
            <button key={t.key} type="button" className={`fy-chip tone-${t.tone}`} onClick={() => openTopic(t)}>
              <Icon name={t.icon} size={15} />
              {t.title}
            </button>
          ))}
        </div>
      </div>

      {panels}
    </section>
  );
}
