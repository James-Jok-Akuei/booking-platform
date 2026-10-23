import type { CSSProperties } from 'react';
import { EMPTY_ART, PAINT, type EmptyArtName } from './emptyArtData';
import './empty.css';

/**
 * One of the empty-page drawings (§311), from `emptyArtData.ts`. The specks
 * drift, the orange thing bobs, the 404's needle hunts for north — and with
 * "reduce motion" all of it stands still.
 */
export function EmptyArt({ name, className = '' }: { name: EmptyArtName; className?: string }) {
  const scene = EMPTY_ART[name];
  return (
    <svg
      className={`ea ea-is-${name} ${className}`}
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      aria-hidden="true"
      focusable="false"
    >
      {scene.shapes.map((shape, i) => {
        const paint = PAINT[shape.look];
        const path = (
          <path
            d={shape.d}
            fill={paint.fill ?? 'none'}
            fillRule="evenodd"
            stroke={paint.stroke}
            strokeWidth={paint.width}
            strokeDasharray={paint.dash}
            strokeLinecap="round"
            strokeLinejoin="round"
            transform={shape.transform}
          />
        );
        if (!shape.motion) return <g key={i}>{path}</g>;
        // The motion goes on a group around the path, so it never replaces the path's own turn.
        return (
          <g
            key={i}
            className={`ea-m ea-${shape.motion}`}
            style={{ '--i': i, transformOrigin: shape.origin } as CSSProperties}
          >
            {path}
          </g>
        );
      })}
    </svg>
  );
}
