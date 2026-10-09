import type { CSSProperties } from 'react';
import { SWASH, drawingFor } from '../ui/lineArtData';

/**
 * A kind of shop as a fine-line drawing (§263): one thin ink line over a
 * soft brush mark in the category's colour, drawing itself in when it
 * appears. The drawings themselves are data (`ui/lineArtData.ts`), shared
 * with the admin console and the phone app.
 */
export function LineArt({
  icon,
  delay = 0,
  className = '',
  swash = true,
}: {
  icon: string | null | undefined;
  delay?: number;
  className?: string;
  /** The brush mark behind; off where the drawing sits on its own colour. */
  swash?: boolean;
}) {
  const art = drawingFor(icon);
  return (
    <svg
      className={`line-art ${className}`}
      viewBox="0 0 200 100"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ '--delay': `${delay}ms` } as CSSProperties}
    >
      {swash && <path className="line-art-swash" d={SWASH} fill={art.swash} />}
      <g className="line-art-ink" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
        {art.strokes.map((s, i) => (
          <path key={i} d={s.d} transform={s.transform} />
        ))}
      </g>
    </svg>
  );
}
