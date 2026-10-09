import type { CSSProperties, ReactNode } from 'react';

/**
 * Fine-line drawings of each kind of shop (§263), drawn for this app: one
 * thin ink line, loose and hand-made in feel, over a soft brush mark in the
 * category's colour. They draw themselves in when they appear.
 *
 * Every drawing sits on the same 200 × 100 sheet, standing on the same
 * ground line, so a grid of them reads as one set.
 */

type Art = { swash: string; lines: ReactNode };

/** The soft brush mark behind a drawing: a loose stroke, not a shape. */
const SWASH =
  'M10 78c18-12 46-14 74-17 30-4 58-14 86-12 16 1 26 7 24 14-2 8-20 9-38 11-34 4-62 13-94 16-24 2-50 1-56-5-3-3-1-5 4-7Z';

const ARTS: Record<string, Art> = {
  // A car, with the air still moving behind it.
  car: {
    swash: '#c9dcff',
    lines: (
      <>
        <path d="M6 58h16M2 66h22M10 74h12" />
        <path d="M36 82v-12c0-6 4-9 10-10l14-3c8-11 18-17 34-17h22c13 0 23 7 31 17l18 4c8 2 12 8 11 21" />
        <path d="M181 82h-21a12 12 0 0 0-24 0H76a12 12 0 0 0-24 0H36" />
        <circle cx="148" cy="83" r="8.5" />
        <circle cx="64" cy="83" r="8.5" />
        <path d="M68 57c7-8 16-12 28-12h20c10 0 18 4 24 12Z" />
        <path d="M104 45v12M112 66h7" />
        <path d="M24 93h40M80 93h66M160 93h28" />
      </>
    ),
  },
  // Scissors and a comb, and a little shine.
  sparkles: {
    swash: '#ffd0df',
    lines: (
      <>
        <ellipse cx="60" cy="70" rx="10" ry="8" transform="rotate(-20 60 70)" />
        <ellipse cx="78" cy="85" rx="10" ry="8" transform="rotate(-20 78 85)" />
        <path d="M68 64 101 56M86 80l15-24" />
        <path d="M100 58c20-14 40-26 62-36-13 13-32 30-55 42" />
        <path d="M101 55c24-5 46-9 70-10-19 7-41 14-64 18" />
        <circle cx="103" cy="57" r="2" />
        <path d="M118 90h66v-7h-66Z" />
        <path d="M124 83v-9M131 83v-9M138 83v-9M145 83v-9M152 83v-9M159 83v-9M166 83v-9M173 83v-9M180 83v-9" />
        <path d="M38 22c1 6 3 8 9 9-6 1-8 3-9 9-1-6-3-8-9-9 6-1 8-3 9-9Z" />
        <path d="M184 52c.6 3.4 1.8 4.6 5 5-3.2.4-4.4 1.6-5 5-.6-3.4-1.8-4.6-5-5 3.2-.4 4.4-1.6 5-5Z" />
      </>
    ),
  },
  // Two glasses meeting, and the confetti that follows.
  'calendar-star': {
    swash: '#ddd0ff',
    lines: (
      <>
        <g transform="translate(84 26) rotate(14)">
          <path d="M-9 0c0 22 3 34 9 38 6-4 9-16 9-38M-9 0h18M0 38v22M-10 62c6-3 14-3 20 0" />
          <path d="M-8 13c5 2 11-2 16 0" />
        </g>
        <g transform="translate(118 26) rotate(-14)">
          <path d="M-9 0c0 22 3 34 9 38 6-4 9-16 9-38M-9 0h18M0 38v22M-10 62c6-3 14-3 20 0" />
          <path d="M-8 13c5 2 11-2 16 0" />
        </g>
        <path d="M96 14l-4-8M101 12V3M106 14l4-8" />
        <path d="M40 34q4-6 8 0t8 0M150 30q4-6 8 0t8 0M44 64q3-5 6 0t6 0M152 62q3-5 6 0t6 0" />
        <circle cx="34" cy="48" r="1.6" />
        <circle cx="168" cy="46" r="1.6" />
        <circle cx="62" cy="20" r="1.6" />
        <circle cx="142" cy="16" r="1.6" />
        <path d="M58 92h86" />
      </>
    ),
  },
  // A heartbeat that grows into a sprout.
  'heart-pulse': {
    swash: '#c6efd9',
    lines: (
      <>
        <path d="M8 72h40l7-14 9 30 10-46 9 36 5-6h30c10 0 18-6 18-18V32" />
        <path d="M136 54c-12-2-20-10-22-22 12 0 20 8 22 22" />
        <path d="M136 42c10 0 20-8 22-20-12 0-20 8-22 20" />
        <path d="M124 79c8 6 22 6 30 0M120 88h40" />
        <path d="M178 40c.6 3.4 1.8 4.6 5 5-3.2.4-4.4 1.6-5 5-.6-3.4-1.8-4.6-5-5 3.2-.4 4.4-1.6 5-5Z" />
      </>
    ),
  },
  // A house, and the wrench that keeps it running.
  'home-tools': {
    swash: '#ffe0bd',
    lines: (
      <>
        <path d="M22 88h108M40 88V54l36-26 36 26v34" />
        <path d="M94 41V27h8v20" />
        <path d="M68 88V68h16v20M92 60h13v11H92ZM98.5 60v11" />
        <path d="M30 62 76 28l46 34" />
        <g transform="translate(160 58) rotate(34)">
          <path d="M-3-14V24a3 3 0 0 0 6 0V-14" />
          <path d="M-3-14c-9-2-11-14-5-20l2 8h12l2-8c6 6 4 18-5 20" />
        </g>
        <path d="M144 90h34" />
      </>
    ),
  },
  // A cat, sitting, tail curled round.
  paw: {
    swash: '#ffd6c2',
    lines: (
      <>
        <path d="M77 31l-5-15 11 10c4-1 9-1 13 0l11-10-4 15c5 6 5 15 0 21" />
        <path d="M77 31c-5 6-5 15 0 21" />
        <path d="M103 52c14 8 22 22 19 38H74c-2-12 0-26 9-36" />
        <path d="M88 90c0-10 1-18-1-26" />
        <path d="M120 89c20 2 32-6 30-18-2-9-11-9-10-2" />
        <path d="M83 40h4M96 40h4M89.5 46l1.5 1.5 1.5-1.5" />
        <path d="M77 46H66M77 49l-10 3M104 46h11M104 49l10 3" />
        <path d="M48 92h112" />
      </>
    ),
  },
  // A camera, with a flash going off.
  camera: {
    swash: '#c9ecf5',
    lines: (
      <>
        <path d="M52 42h22l8-10h30l8 10h28a8 8 0 0 1 8 8v32a8 8 0 0 1-8 8H52a8 8 0 0 1-8-8V50a8 8 0 0 1 8-8Z" />
        <circle cx="98" cy="66" r="18" />
        <circle cx="98" cy="66" r="10" />
        <path d="M92 60c2-2 5-3 8-2" />
        <path d="M136 52h10M56 42v-5h10v5" />
        <path d="M168 24l-3 8M176 30l-7 4M160 20v8" />
        <path d="M30 92h140" />
      </>
    ),
  },
  // A laptop with a rising line, and a coffee beside it.
  briefcase: {
    swash: '#d8dcea',
    lines: (
      <>
        <path d="M52 74V32a5 5 0 0 1 5-5h74a5 5 0 0 1 5 5v42" />
        <path d="M38 74h112l6 12H32Z" />
        <path d="M62 64l14-12 12 6 16-16 18 6" />
        <path d="M116 46l6 2-3 5" />
        <path d="M164 62h20v18a6 6 0 0 1-6 6h-8a6 6 0 0 1-6-6Z" />
        <path d="M184 66c8 0 8 12 0 12" />
        <path d="M170 56c-3-4 3-6 0-10M178 56c-3-4 3-6 0-10" />
        <path d="M24 92h168" />
      </>
    ),
  },
  // A shopfront, for a kind of place not drawn yet.
  store: {
    swash: '#ffd9cb',
    lines: (
      <>
        <path d="M52 88V50M148 88V50" />
        <path d="M46 50l8-20h92l8 20" />
        <path d="M46 50c0 7 6 12 13 12s13-5 13-12c0 7 6 12 14 12s14-5 14-12c0 7 6 12 14 12s14-5 14-12c0 7 6 12 13 12s13-5 13-12" />
        <path d="M86 88V70h28v18M62 70h14v10H62ZM124 70h14v10h-14Z" />
        <path d="M30 88h140" />
      </>
    ),
  },
};

export function LineArt({ icon, delay = 0, className = '' }: { icon: string | null | undefined; delay?: number; className?: string }) {
  const art = (icon && ARTS[icon]) || ARTS.store;
  return (
    <svg
      className={`line-art ${className}`}
      viewBox="0 0 200 100"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ '--delay': `${delay}ms` } as CSSProperties}
    >
      <path className="line-art-swash" d={SWASH} fill={art.swash} />
      <g className="line-art-ink" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
        {art.lines}
      </g>
    </svg>
  );
}
