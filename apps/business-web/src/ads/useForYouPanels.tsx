import { useEffect, useState } from 'react';
import { Panel } from '../ui/Panel';
import { ForYouContent, GuideBody } from './AdRail';
import { guideTopics, type GuideTopic } from './guide';
import type { AdData } from './useAdData';
import { t } from '@lingui/core/macro';

/**
 * "For you" without its column (§205, §221): a "How it works" topic opens on
 * its own, and "See all" opens everything the wide screen's column holds —
 * for the banner's buttons that point at part of that column ("Read more",
 * "See what is trending"), from Overview's block or the slim banner on every
 * other page.
 */
export function useForYouPanels(data: AdData) {
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

  const topics = guideTopics(data.feePercent);

  const elsewhere = (id: string) => {
    const guide = topics.find((t) => `guide-${t.key}` === id);
    if (guide) return setTopic(guide);
    setJump(id);
    setAll(true);
  };

  const panels = (
    <>
      {topic && (
        <Panel eyebrow={t`How it works`} title={topic.title} onClose={() => setTopic(null)} width={560}>
          <p className="fy-short">{topic.short}</p>
          <GuideBody topic={topic} onLink={() => setTopic(null)} />
        </Panel>
      )}
      {all && (
        <Panel eyebrow={t`Ideas, news and how it all works`} title={t`For you`} onClose={() => setAll(false)} width={460}>
          <div className="fy-panel">
            <ForYouContent data={data} banner={false} />
          </div>
        </Panel>
      )}
    </>
  );

  return { topics, elsewhere, openAll: () => setAll(true), openTopic: setTopic, panels };
}
