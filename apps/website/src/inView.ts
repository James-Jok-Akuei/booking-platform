import { useEffect, useState, type RefObject } from 'react';

/**
 * Whether an element has come into view — once; it stays true, so what
 * draws itself in does it the first time it is seen and then stays drawn.
 */
export function useInView(ref: RefObject<HTMLElement>, ready = true, margin = '0px 0px -12% 0px') {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    // `ready`: an element that appears later (after its data) is watched from then.
    if (!el || seen || !ready) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, margin, seen, ready]);
  return seen;
}
