import { useLayoutEffect, type RefObject } from 'react';

/**
 * Shrinks a heading's letters, a step at a time, until its longest word fits
 * its width (§308). English fits as designed and is left alone; a long
 * Kinyarwanda word makes the heading a little smaller rather than spill out
 * of its column or break in the middle.
 */
export function useFitWords(ref: RefObject<HTMLElement>, least = 0.6) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = '';
      let size = parseFloat(getComputedStyle(el).fontSize);
      // Never below `least` of the designed size: a heading, still.
      const min = size * least;
      while (el.scrollWidth > el.clientWidth + 1 && size > min) {
        size -= 2;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    // Again once the brand's font has arrived, and whenever the column changes width.
    void document.fonts?.ready.then(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(el.parentElement ?? el);
    return () => observer.disconnect();
  }, [ref, least]);
}

/**
 * The top bar, when its words no longer fit beside the name (§308): first the
 * "For businesses" link steps aside (the rail and the footer still have it)
 * and the language button keeps only its globe; if that is not enough, "Get
 * the app" becomes its phone icon. Decided by measuring, so it happens
 * exactly when a language's words need it, at any width.
 */
export function useTightBar(ref: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const over = () => el.scrollWidth > el.clientWidth + 1;
    const check = () => {
      el.classList.remove('is-tight', 'is-tighter');
      if (!over()) return;
      el.classList.add('is-tight');
      if (over()) el.classList.add('is-tighter');
    };
    check();
    void document.fonts?.ready.then(check);
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}
