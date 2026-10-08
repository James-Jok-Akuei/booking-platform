import { useEffect, type RefObject } from 'react';

/**
 * Closes something open — a menu, a dropdown — when the person presses
 * anywhere outside it, or Esc (§220).
 *
 * Listens on the whole document rather than drawing an invisible layer to
 * catch the click: a fixed layer inside the frosted top bar is held inside the
 * bar (its blur makes it the layer's frame), so only clicks on the bar itself
 * reached it. `pointerdown` covers mouse, pen and touch alike.
 */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && close();
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open, ref, close]);
}
