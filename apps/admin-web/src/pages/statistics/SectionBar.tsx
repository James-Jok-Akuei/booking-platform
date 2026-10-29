import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../../ui/Icon';
import type { SectionId } from './insights';

export const SECTIONS: Array<{ id: SectionId; label: string; icon: IconName }> = [
  { id: 'st-all', label: 'All time', icon: 'coins' },
  { id: 'st-stretch', label: 'This stretch', icon: 'chart' },
  { id: 'st-people', label: 'Customers & shops', icon: 'users' },
  { id: 'st-wants', label: 'What people want', icon: 'search' },
  { id: 'st-months', label: 'Month by month', icon: 'calendar' },
];

/**
 * How far below the window's top a section should land: under the top bar
 * and the part of the page's head that stays pinned (§242's `.page-top`,
 * folded by `--pt-fold`), with a little air.
 */
function pinnedBottom() {
  const top = document.querySelector<HTMLElement>('.st .page-top');
  if (!top) return 140;
  const style = getComputedStyle(top);
  const bar = parseFloat(style.getPropertyValue('--tb-h')) || 74;
  const fold = parseFloat(style.getPropertyValue('--pt-fold')) || 0;
  return bar - 1 - fold + top.offsetHeight + 14;
}

export function goToSection(id: SectionId) {
  const el = document.getElementById(id);
  if (!el) return;
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - pinnedBottom(), behavior: still ? 'auto' : 'smooth' });
}

/**
 * The statistics page's sections (§316), one tap each — the page runs to
 * several screens, thirteen on a phone. The one row of the head that stays
 * pinned (the stretch and the narrowing are a scroll away, and changed far
 * less often); the section in view is the lit one.
 */
export function SectionBar() {
  const [active, setActive] = useState<SectionId>('st-all');
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const spy = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const line = pinnedBottom() + 8;
        let current: SectionId = SECTIONS[0].id;
        for (const section of SECTIONS) {
          const el = document.getElementById(section.id);
          if (el && el.getBoundingClientRect().top <= line) current = section.id;
        }
        // At the foot of the page the last section is the one being read, however short.
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = SECTIONS[SECTIONS.length - 1].id;
        setActive(current);
      });
    };
    spy();
    window.addEventListener('scroll', spy, { passive: true });
    window.addEventListener('resize', spy);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', spy);
      window.removeEventListener('resize', spy);
    };
  }, []);

  // On a phone the row scrolls sideways: keep the lit one in view.
  useEffect(() => {
    const row = track.current;
    const chip = row?.querySelector<HTMLElement>('.is-on');
    if (!row || !chip || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({ left: chip.offsetLeft - row.clientWidth / 2 + chip.offsetWidth / 2, behavior: 'smooth' });
  }, [active]);

  return (
    <nav className="st-jump pin-from pin-phone" aria-label="Sections of this page">
      <div className="st-jump-track" ref={track}>
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={active === section.id ? 'is-on' : ''}
            aria-current={active === section.id ? 'location' : undefined}
            onClick={() => goToSection(section.id)}
          >
            <Icon name={section.icon} size={14} />
            {section.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
