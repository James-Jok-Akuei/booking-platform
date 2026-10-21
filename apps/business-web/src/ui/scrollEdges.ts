import { useCallback, useRef } from 'react';

/**
 * Marks a row that scrolls sideways with what is hidden at either end
 * (`data-more="start end"`), so `.scroll-edges` fades that edge (§308.7). In
 * a longer language a row of tabs may not fit on the screen, and a word cut
 * at the edge has to read as "there is more", never as a mistake.
 *
 * A ref to put on the row: `<div className="scroll-edges" ref={useScrollEdges()}>`.
 */
export function useScrollEdges() {
  const stop = useRef<(() => void) | null>(null);
  return useCallback((row: HTMLElement | null) => {
    stop.current?.();
    stop.current = null;
    if (!row) return;
    const mark = () => {
      const more = [row.scrollLeft > 2 && 'start', row.scrollLeft + row.clientWidth < row.scrollWidth - 2 && 'end']
        .filter(Boolean)
        .join(' ');
      if (row.dataset.more !== more) row.dataset.more = more;
    };
    mark();
    row.addEventListener('scroll', mark, { passive: true });
    // Its own size, and each tab's — a count arriving makes a tab wider.
    const resize = new ResizeObserver(mark);
    resize.observe(row);
    for (const child of Array.from(row.children)) resize.observe(child);
    stop.current = () => {
      row.removeEventListener('scroll', mark);
      resize.disconnect();
    };
  }, []);
}
