import { useEffect, useState, type RefObject } from 'react';

/**
 * A sheet of paper laid over the dark (§239): its top edge rising to the
 * right, its left edge dropping away to the left, one rounded corner where
 * the two meet. Drawn as a path for `clip-path`, in pixels, so the angles
 * stay true at every size instead of stretching with the box.
 */
export function sheetPath(
  w: number,
  h: number,
  corner: { x: number; y: number },
  /** Degrees the top edge rises by, going right. */
  up: number,
  /** Degrees the left edge drops by, going left. */
  down: number,
  radius: number,
): string {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const yRight = corner.y - (w - corner.x) * Math.tan(rad(up));
  const yLeft = corner.y + corner.x * Math.tan(rad(down));
  // The two points the rounded corner runs between, one on each edge.
  const a = { x: corner.x - radius * Math.cos(rad(down)), y: corner.y + radius * Math.sin(rad(down)) };
  const b = { x: corner.x + radius * Math.cos(rad(up)), y: corner.y - radius * Math.sin(rad(up)) };
  const p = (n: number) => n.toFixed(1);
  return `M 0 ${p(h + 50)} L 0 ${p(yLeft)} L ${p(a.x)} ${p(a.y)} Q ${p(corner.x)} ${p(corner.y)} ${p(b.x)} ${p(b.y)} L ${p(w)} ${p(yRight)} L ${p(w)} ${p(h + 50)} Z`;
}

/**
 * An element's size, kept current as it changes. `ready` for one that
 * appears later, after its data: it is measured from then.
 */
export function useSize(ref: RefObject<HTMLElement>, ready = true) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || !ready) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, ready]);
  return size;
}
