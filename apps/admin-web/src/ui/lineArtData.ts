/**
 * The fine-line drawings of each kind of shop (§263, §264), as data.
 *
 * One drawing per category `icon` word: thin ink strokes over a soft brush
 * mark in the category's colour, all on the same 200 × 100 sheet standing on
 * the same ground line. Kept as plain path data — no JSX — so the web apps
 * (an <svg>) and the phone app (react-native-svg) draw exactly the same
 * lines. This file is copied, unchanged, into business-web, admin-web and
 * customer-app (`src/ui/lineArtData.ts`): change one, change all three.
 */

export type Stroke = { d: string; transform?: string };
export type Drawing = { swash: string; strokes: Stroke[] };

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
const lines = (...ds: string[]): Stroke[] => ds.map((d) => ({ d }));
const turned = (transform: string, ...ds: string[]): Stroke[] => ds.map((d) => ({ d, transform }));

/** The soft brush mark behind a drawing: a loose stroke, not a shape. */
export const SWASH =
  'M10 78c18-12 46-14 74-17 30-4 58-14 86-12 16 1 26 7 24 14-2 8-20 9-38 11-34 4-62 13-94 16-24 2-50 1-56-5-3-3-1-5 4-7Z';

/** A glass, standing at the origin, for the events drawing. */
const GLASS = ['M-9 0c0 22 3 34 9 38 6-4 9-16 9-38M-9 0h18M0 38v22M-10 62c6-3 14-3 20 0', 'M-8 13c5 2 11-2 16 0'];

export const DRAWINGS: Record<string, Drawing> = {
  // A car, with the air still moving behind it.
  car: {
    swash: '#c9dcff',
    strokes: [
      ...lines(
        'M6 58h16M2 66h22M10 74h12',
        'M36 82v-12c0-6 4-9 10-10l14-3c8-11 18-17 34-17h22c13 0 23 7 31 17l18 4c8 2 12 8 11 21',
        'M181 82h-21a12 12 0 0 0-24 0H76a12 12 0 0 0-24 0H36',
        circle(148, 83, 8.5),
        circle(64, 83, 8.5),
        'M68 57c7-8 16-12 28-12h20c10 0 18 4 24 12Z',
        'M104 45v12M112 66h7',
        'M24 93h40M80 93h66M160 93h28',
      ),
    ],
  },
  // Scissors and a comb, and a little shine.
  sparkles: {
    swash: '#ffd0df',
    strokes: [
      ...turned('rotate(-20 60 70)', ellipse(60, 70, 10, 8)),
      ...turned('rotate(-20 78 85)', ellipse(78, 85, 10, 8)),
      ...lines(
        'M68 64 101 56M86 80l15-24',
        'M100 58c20-14 40-26 62-36-13 13-32 30-55 42',
        'M101 55c24-5 46-9 70-10-19 7-41 14-64 18',
        circle(103, 57, 2),
        'M118 90h66v-7h-66Z',
        'M124 83v-9M131 83v-9M138 83v-9M145 83v-9M152 83v-9M159 83v-9M166 83v-9M173 83v-9M180 83v-9',
        'M38 22c1 6 3 8 9 9-6 1-8 3-9 9-1-6-3-8-9-9 6-1 8-3 9-9Z',
        'M184 52c.6 3.4 1.8 4.6 5 5-3.2.4-4.4 1.6-5 5-.6-3.4-1.8-4.6-5-5 3.2-.4 4.4-1.6 5-5Z',
      ),
    ],
  },
  // Two glasses meeting, and the confetti that follows.
  'calendar-star': {
    swash: '#ddd0ff',
    strokes: [
      ...turned('translate(84 26) rotate(14)', ...GLASS),
      ...turned('translate(118 26) rotate(-14)', ...GLASS),
      ...lines(
        'M96 14l-4-8M101 12V3M106 14l4-8',
        'M40 34q4-6 8 0t8 0M150 30q4-6 8 0t8 0M44 64q3-5 6 0t6 0M152 62q3-5 6 0t6 0',
        circle(34, 48, 1.6),
        circle(168, 46, 1.6),
        circle(62, 20, 1.6),
        circle(142, 16, 1.6),
        'M58 92h86',
      ),
    ],
  },
  // A heartbeat that grows into a sprout.
  'heart-pulse': {
    swash: '#c6efd9',
    strokes: lines(
      'M8 72h40l7-14 9 30 10-46 9 36 5-6h30c10 0 18-6 18-18V32',
      'M136 54c-12-2-20-10-22-22 12 0 20 8 22 22',
      'M136 42c10 0 20-8 22-20-12 0-20 8-22 20',
      'M124 79c8 6 22 6 30 0M120 88h40',
      'M178 40c.6 3.4 1.8 4.6 5 5-3.2.4-4.4 1.6-5 5-.6-3.4-1.8-4.6-5-5 3.2-.4 4.4-1.6 5-5Z',
    ),
  },
  // A house, and the wrench that keeps it running.
  'home-tools': {
    swash: '#ffe0bd',
    strokes: [
      ...lines(
        'M22 88h108M40 88V54l36-26 36 26v34',
        'M94 41V27h8v20',
        'M68 88V68h16v20M92 60h13v11H92ZM98.5 60v11',
        'M30 62 76 28l46 34',
        'M144 90h34',
      ),
      ...turned(
        'translate(160 58) rotate(34)',
        'M-3-14V24a3 3 0 0 0 6 0V-14',
        'M-3-14c-9-2-11-14-5-20l2 8h12l2-8c6 6 4 18-5 20',
      ),
    ],
  },
  // A cat, sitting, tail curled round.
  paw: {
    swash: '#ffd6c2',
    strokes: lines(
      'M77 31l-5-15 11 10c4-1 9-1 13 0l11-10-4 15c5 6 5 15 0 21',
      'M77 31c-5 6-5 15 0 21',
      'M103 52c14 8 22 22 19 38H74c-2-12 0-26 9-36',
      'M88 90c0-10 1-18-1-26',
      'M120 89c20 2 32-6 30-18-2-9-11-9-10-2',
      'M83 40h4M96 40h4M89.5 46l1.5 1.5 1.5-1.5',
      'M77 46H66M77 49l-10 3M104 46h11M104 49l10 3',
      'M48 92h112',
    ),
  },
  // A camera, with a flash going off.
  camera: {
    swash: '#c9ecf5',
    strokes: lines(
      'M52 42h22l8-10h30l8 10h28a8 8 0 0 1 8 8v32a8 8 0 0 1-8 8H52a8 8 0 0 1-8-8V50a8 8 0 0 1 8-8Z',
      circle(98, 66, 18),
      circle(98, 66, 10),
      'M92 60c2-2 5-3 8-2',
      'M136 52h10M56 42v-5h10v5',
      'M168 24l-3 8M176 30l-7 4M160 20v8',
      'M30 92h140',
    ),
  },
  // A laptop with a rising line, and a coffee beside it.
  briefcase: {
    swash: '#d8dcea',
    strokes: lines(
      'M52 74V32a5 5 0 0 1 5-5h74a5 5 0 0 1 5 5v42',
      'M38 74h112l6 12H32Z',
      'M62 64l14-12 12 6 16-16 18 6',
      'M116 46l6 2-3 5',
      'M164 62h20v18a6 6 0 0 1-6 6h-8a6 6 0 0 1-6-6Z',
      'M184 66c8 0 8 12 0 12',
      'M170 56c-3-4 3-6 0-10M178 56c-3-4 3-6 0-10',
      'M24 92h168',
    ),
  },
  // A shopfront, for a kind of place not drawn yet.
  store: {
    swash: '#ffd9cb',
    strokes: lines(
      'M52 88V50M148 88V50',
      'M46 50l8-20h92l8 20',
      'M46 50c0 7 6 12 13 12s13-5 13-12c0 7 6 12 14 12s14-5 14-12c0 7 6 12 14 12s14-5 14-12c0 7 6 12 13 12s13-5 13-12',
      'M86 88V70h28v18M62 70h14v10H62ZM124 70h14v10h-14Z',
      'M30 88h140',
    ),
  },
};

/** The `icon` words an administrator can give a category, each with its drawing. */
export const DRAWING_KEYS = ['car', 'sparkles', 'calendar-star', 'heart-pulse', 'home-tools', 'paw', 'camera', 'briefcase'] as const;

export const drawingFor = (icon: string | null | undefined): Drawing => (icon && DRAWINGS[icon]) || DRAWINGS.store;
