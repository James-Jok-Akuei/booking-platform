import { useEffect, useState } from 'react';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { AdCarousel } from './AdCarousel';
import { ForYouContent, GuideBody } from './AdRail';
import { guideTopics, type GuideTopic } from './guide';
import { buildSlides } from './slides';
import { useAdData } from './useAdData';
import './ads.css';

/**
 * "For you" on a phone or tablet (§205, §206): at the top of the home page,
 * the way the customer app puts its spotlights at the top of Home (§176) —
 * the banner (which leads with whatever just came in), then "How it works" as
 * chips. "See all" opens everything the wide screen's column holds.
 */
export function ForYouTop() {
  const data = useAdData();
  const [all, setAll] = useState(false);
  const [topic, setTopic] = useState<GuideTopic | null>(null);
  // A part of "See all" to bring into view once its panel has opened.
  const [jump, setJump] = useState<string | null>(null);

  useEffect(() => {
    if (!all || !jump) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setJump(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [all, jump]);

  if (!data.ready) return <div className="skeleton fy-skel" />;

  const topics = guideTopics(data.feePercent);

  // The banner's "Read more" and "See what is trending" point at the wide
  // screen's column; here a topic opens on its own, anything else in "See all".
  const elsewhere = (id: string) => {
    const guide = topics.find((t) => `guide-${t.key}` === id);
    if (guide) return setTopic(guide);
    setJump(id);
    setAll(true);
  };

  return (
    <section className="fy">
      <header className="fy-head">
        <p className="ads-label">
          <Icon name="sparkles" size={14} /> For you
        </p>
        <button type="button" className="fy-all" onClick={() => setAll(true)}>
          See all <Icon name="chevronRight" size={15} stroke={2.2} />
        </button>
      </header>

      <AdCarousel slides={buildSlides(data)} compact onElsewhere={elsewhere} />

      <div className="fy-learn">
        <p className="ads-label">How it works</p>
        <div className="fy-chips">
          {topics.map((t) => (
            <button key={t.key} type="button" className={`fy-chip tone-${t.tone}`} onClick={() => setTopic(t)}>
              <Icon name={t.icon} size={15} />
              {t.title}
            </button>
          ))}
        </div>
      </div>

      {topic && (
        <Panel eyebrow="How it works" title={topic.title} onClose={() => setTopic(null)} width={560}>
          <p className="fy-short">{topic.short}</p>
          <GuideBody topic={topic} onLink={() => setTopic(null)} />
        </Panel>
      )}
      {all && (
        <Panel eyebrow="Ideas, news and how it all works" title="For you" onClose={() => setAll(false)} width={460}>
          <div className="fy-panel">
            <ForYouContent data={data} banner={false} />
          </div>
        </Panel>
      )}
    </section>
  );
}
