/**
 * The empty-page drawings (§311), as data.
 *
 * Hand-drawn ink in one family: the logo's green-black line, white and two
 * warm greys for surfaces, a hard ink shadow, floating specks — and ONE
 * orange thing per drawing, the thing that will change when the page fills.
 * Every drawing sits on the same 240 × 180 sheet (the 404's is 360 × 200).
 *
 * Plain path data, no JSX, so any app can draw it. This file is copied,
 * unchanged, into business-web and admin-web (`src/ui/emptyArtData.ts`):
 * change one, change both (`cmp`).
 */

/** How a shape is painted (see `EmptyArt`). */
export type Look =
  | 'ink' // a line, full weight
  | 'line' // a finer line
  | 'dash' // a dashed line
  | 'paper' // white, outlined
  | 'shade' // light grey, outlined
  | 'deep' // darker grey, outlined
  | 'solid' // ink, no outline — shadows, holes
  | 'accent' // orange, outlined
  | 'accentLine' // an orange line
  | 'accentDash' // an orange dashed line
  | 'white' // a white line, on orange or ink
  | 'veil' // a soft hill behind, no outline
  | 'veil2'
  | 'speck' // a grey speck, no outline
  | 'dot' // an ink speck
  | 'cable' // a thick ink line, under `cableIn`
  | 'cableIn'; // the white inside of a cable

const INK = '#1F2A1F';
const ORANGE = '#F0532D';

/** The paint of each look: one table, so every app draws the same picture. */
export const PAINT: Record<Look, { fill?: string; stroke?: string; width?: number; dash?: string }> = {
  ink: { stroke: INK, width: 2.4 },
  line: { stroke: INK, width: 1.7 },
  dash: { stroke: INK, width: 1.8, dash: '5 5' },
  paper: { fill: '#FFFFFF', stroke: INK, width: 2.4 },
  shade: { fill: '#ECE8E1', stroke: INK, width: 2.4 },
  deep: { fill: '#D6CFC3', stroke: INK, width: 2.4 },
  solid: { fill: INK },
  accent: { fill: ORANGE, stroke: INK, width: 2.4 },
  accentLine: { stroke: ORANGE, width: 2.8 },
  accentDash: { stroke: ORANGE, width: 2.2, dash: '4 4' },
  white: { stroke: '#FFFFFF', width: 2.6 },
  veil: { fill: '#EFEBE4' },
  veil2: { fill: '#E6E1D8' },
  speck: { fill: '#D6D0C5' },
  dot: { fill: INK },
  cable: { stroke: INK, width: 11 },
  cableIn: { stroke: '#FFFFFF', width: 5.5 },
};

/** How a shape moves: specks drift (a, b, c), the orange thing bobs, steam rises, a needle hunts. */
export type Motion = 'a' | 'b' | 'c' | 'bob' | 'steam' | 'hunt' | 'swing';

export type Shape = { d: string; look: Look; transform?: string; motion?: Motion; origin?: string };
export type Scene = { width: number; height: number; shapes: Shape[] };

// ---- drawing helpers ----

const r1 = (n: number) => Math.round(n * 10) / 10;

const circle = (cx: number, cy: number, r: number) =>
  `M${r1(cx - r)} ${r1(cy)}a${r} ${r} 0 1 0 ${r1(2 * r)} 0a${r} ${r} 0 1 0 ${r1(-2 * r)} 0Z`;

const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${r1(cx - rx)} ${r1(cy)}a${rx} ${ry} 0 1 0 ${r1(2 * rx)} 0a${rx} ${ry} 0 1 0 ${r1(-2 * rx)} 0Z`;

const rrect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;

/**
 * A closed shape through the points, each edge bowed a little one way or the
 * other — a hand's line, not a ruler's. The bow is fixed, so it never jitters.
 */
function hand(points: Array<[number, number]>, bow = 1.4): string {
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const side = i % 2 === 0 ? 1 : -1;
    const amount = Math.min(bow, len / 18) * side;
    const cx = (x1 + x2) / 2 + ((y2 - y1) / len) * amount;
    const cy = (y1 + y2) / 2 - ((x2 - x1) / len) * amount;
    d += `Q${r1(cx)} ${r1(cy)} ${x2} ${y2}`;
  }
  return `${d}Z`;
}

/** A five-pointed star. */
function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.48;
    pts.push(`${r1(cx + rr * Math.cos(a))} ${r1(cy + rr * Math.sin(a))}`);
  }
  return `M${pts.join('L')}Z`;
}

/** A heart, its point at the bottom. */
const heart = (cx: number, cy: number, s: number) =>
  `M${cx} ${r1(cy + s * 0.9)}C${r1(cx - s * 1.4)} ${r1(cy + s * 0.05)} ${r1(cx - s * 0.9)} ${r1(cy - s * 0.95)} ${cx} ${r1(cy - s * 0.35)}C${r1(cx + s * 0.9)} ${r1(cy - s * 0.95)} ${r1(cx + s * 1.4)} ${r1(cy + s * 0.05)} ${cx} ${r1(cy + s * 0.9)}Z`;

/** Specks: [x, y, r, look, motion]. */
const specks = (...list: Array<[number, number, number, 'speck' | 'dot', Motion?]>): Shape[] =>
  list.map(([x, y, r, look, motion]) => ({ d: circle(x, y, r), look, motion }));

/** The curl of loose thread that floats above a drawing. */
const curl = (x: number, y: number): Shape => ({
  d: `M${x} ${y}c-3-9 5-16 11-11s-3 13-8 6c-4-6 1-15 10-19 6-3 11-2 14 1`,
  look: 'line',
  motion: 'b',
});

/** A tuft of grass at a point on the ground. */
const tuft = (x: number, y: number) => `M${x} ${y}l-4-7M${x} ${y}l1-9M${x} ${y}l5-6`;

/** A hand-drawn ground line with two tufts. */
const ground = (from: number, to: number, y: number): Shape => ({
  d: `M${from} ${y + 2}C${from + (to - from) * 0.3} ${y - 3} ${from + (to - from) * 0.7} ${y - 3} ${to} ${y + 1}${tuft(from + 26, y)}${tuft(to - 30, y)}`,
  look: 'line',
});

/** A check mark, for white on orange. */
const check = (cx: number, cy: number, s: number) =>
  `M${r1(cx - s * 0.55)} ${r1(cy + s * 0.02)}l${r1(s * 0.38)} ${r1(s * 0.38)} ${r1(s * 0.72)}-${r1(s * 0.78)}`;

const plus = (cx: number, cy: number, s: number) => `M${cx} ${cy - s}v${2 * s}M${cx - s} ${cy}h${2 * s}`;

/** A feather pen, its nib at (x, y), leaning right. */
const feather = (x: number, y: number) => [
  `M${x} ${y}c5-28 19-55 41-74 5 22-6 50-30 66Z`,
  `M${x + 2} ${y - 4}c9-21 21-42 35-61`,
];

// ---- the drawings ----

const W = 240;
const H = 180;

/** Bookings: the calendar, one day ringed in orange where the first will land. */
const calendar: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([40, 62, 3, 'speck', 'a'], [204, 50, 2.6, 'speck', 'b'], [210, 104, 3.2, 'speck', 'c'], [30, 116, 2.2, 'speck', 'b'], [52, 40, 1.6, 'dot', 'c'], [196, 132, 1.8, 'dot', 'a']),
    curl(188, 40),
    { d: rrect(70, 54, 114, 96, 10), look: 'solid' },
    { d: rrect(62, 46, 114, 96, 10), look: 'paper' },
    { d: 'M72 46h94a10 10 0 0 1 10 10v16H62V56a10 10 0 0 1 10-10Z', look: 'shade' },
    ...[84, 106, 128, 150].map((x) => ({ d: rrect(x - 3.5, 36, 7, 22, 3.5), look: 'paper' as const })),
    ...[80, 100, 120, 140, 160].flatMap((x) =>
      [88, 106, 124].filter((y) => !(x === 140 && y === 106)).map((y) => ({ d: circle(x, y, 2.8), look: 'dot' as const })),
    ),
    { d: circle(140, 106, 9.5), look: 'accentDash' },
    { d: circle(140, 106, 4), look: 'accent', motion: 'bob' },
    { d: 'M70 146l-5 7M80 146l-4 8M90 146l-3 7', look: 'line' },
  ],
};

/** Empty, in general — and services: the open box, a "+" floating out of it. */
const box: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([44, 56, 3, 'speck', 'a'], [206, 60, 2.4, 'speck', 'c'], [214, 112, 3, 'speck', 'b'], [34, 120, 2.2, 'speck', 'c'], [66, 36, 1.6, 'dot', 'b'], [192, 30, 1.8, 'dot', 'a']),
    { d: hand([[58, 150], [146, 150], [182, 132], [204, 136], [162, 157], [62, 157]], 1), look: 'solid' },
    { d: hand([[100, 82], [182, 82], [190, 58], [110, 60]]), look: 'shade' },
    { d: hand([[64, 98], [146, 98], [182, 82], [100, 82]], 0.8), look: 'deep' },
    { d: hand([[64, 98], [146, 98], [146, 148], [64, 148]]), look: 'paper' },
    { d: hand([[146, 98], [182, 82], [182, 130], [146, 148]]), look: 'shade' },
    { d: hand([[64, 98], [100, 82], [82, 68], [44, 86]]), look: 'paper' },
    { d: hand([[146, 98], [182, 82], [202, 96], [166, 112]]), look: 'paper' },
    { d: 'M158 124l9-5M160 132l9-5M78 136h22', look: 'line' },
    { d: 'M118 86c-3-10 5-17 11-12s-2 13-7 6c-4-6 0-15 8-20', look: 'line', motion: 'b' },
    { d: circle(150, 38, 11), look: 'accent', motion: 'bob' },
    { d: plus(150, 38, 5), look: 'white', motion: 'bob' },
  ],
};

/** Messages: a question, and the answer that will come. */
const chat: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([40, 50, 2.6, 'speck', 'b'], [200, 54, 3, 'speck', 'a'], [208, 92, 2.2, 'speck', 'c'], [44, 140, 3, 'speck', 'a'], [186, 150, 1.8, 'dot', 'b'], [64, 30, 1.6, 'dot', 'c']),
    curl(120, 40),
    { d: 'M81.6 114.8A34 34 0 1 0 66.6 101L50 128Z', look: 'paper' },
    { d: 'M84 74c0-9 6-14 13-14s13 5 13 12c0 8-11 9-11 17', look: 'ink' },
    { d: circle(99, 98.5, 2.6), look: 'dot' },
    { d: 'M154.9 131.6A28 28 0 1 1 168 125.4L178 142Z', look: 'shade' },
    { d: circle(150, 104, 15), look: 'accent', motion: 'bob' },
    { d: check(150, 104, 11), look: 'white', motion: 'bob' },
  ],
};

/** Notifications: the bell, quiet. */
const bell: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([46, 60, 3, 'speck', 'a'], [196, 48, 2.4, 'speck', 'b'], [204, 120, 3, 'speck', 'c'], [40, 128, 2.2, 'speck', 'b'], [70, 36, 1.6, 'dot', 'a'], [184, 146, 1.8, 'dot', 'c']),
    { d: ellipse(122, 156, 40, 4), look: 'solid' },
    { d: 'M72 76l-10-6M68 94H56M170 70l10-7M176 88h12', look: 'line', motion: 'a' },
    { d: circle(120, 136, 8), look: 'accent', motion: 'swing', origin: '120px 60px', transform: 'rotate(-12 120 96)' },
    { d: 'M92 118c0-28 6-60 28-60s28 32 28 60c0 4 6 7 10 8H82c4-1 10-4 10-8Z', look: 'paper', motion: 'swing', origin: '120px 60px', transform: 'rotate(-12 120 96)' },
    { d: 'M92 116c-1 5-5 8-10 10h76c-5-2-9-5-10-10Z', look: 'shade', motion: 'swing', origin: '120px 60px', transform: 'rotate(-12 120 96)' },
    { d: 'M104 78c4-6 9-9 14-9', look: 'line', motion: 'swing', origin: '120px 60px', transform: 'rotate(-12 120 96)' },
    { d: circle(120, 54, 6), look: 'shade', motion: 'swing', origin: '120px 60px', transform: 'rotate(-12 120 96)' },
  ],
};

/** Reviews: a card waiting for its words, one star already orange. */
const reviews: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([40, 52, 2.6, 'speck', 'c'], [206, 46, 3, 'speck', 'a'], [214, 118, 2.4, 'speck', 'b'], [36, 124, 3, 'speck', 'a'], [58, 30, 1.6, 'dot', 'b'], [120, 166, 1.8, 'dot', 'c']),
    curl(66, 40),
    { d: rrect(68, 64, 116, 80, 10), look: 'solid', transform: 'rotate(-5 120 100)' },
    { d: rrect(60, 56, 116, 80, 10), look: 'paper', transform: 'rotate(-5 120 100)' },
    { d: star(82, 77, 7), look: 'accent', transform: 'rotate(-5 120 100)', motion: 'bob' },
    ...[101, 120, 139, 158].map((x) => ({ d: star(x, 77, 7), look: 'paper' as const, transform: 'rotate(-5 120 100)' })),
    { d: rrect(74, 96, 84, 8, 4), look: 'shade', transform: 'rotate(-5 120 100)' },
    { d: rrect(74, 110, 56, 8, 4), look: 'shade', transform: 'rotate(-5 120 100)' },
    { d: feather(164, 146)[0], look: 'solid' },
    { d: feather(164, 146)[1], look: 'white' },
    { d: 'M164 146l-3 8', look: 'ink' },
  ],
};

/** Getting paid, the ledger: the bank, a coin with a "+" on its way. */
const bank: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([196, 52, 3, 'speck', 'a'], [210, 100, 2.4, 'speck', 'c'], [34, 108, 3, 'speck', 'b'], [190, 30, 1.6, 'dot', 'b'], [44, 140, 1.8, 'dot', 'a']),
    { d: hand([[54, 148], [190, 148], [206, 156], [62, 157]], 1), look: 'solid' },
    { d: hand([[56, 138], [184, 138], [184, 149], [56, 149]], 0.8), look: 'paper' },
    { d: hand([[64, 130], [176, 130], [176, 138], [64, 138]], 0.8), look: 'shade' },
    ...[84, 108, 132, 156].map((x) => ({ d: hand([[x - 7, 86], [x + 7, 86], [x + 7, 130], [x - 7, 130]], 0.6), look: 'paper' as const })),
    { d: hand([[64, 76], [176, 76], [176, 87], [64, 87]], 0.8), look: 'paper' },
    { d: hand([[58, 76], [120, 40], [182, 76]], 1.2), look: 'shade' },
    { d: circle(120, 62, 6.5), look: 'paper' },
    { d: circle(120, 62, 1.6), look: 'dot' },
    { d: 'M79 94v28M103 94v28M127 94v28M151 94v28', look: 'line' },
    { d: circle(62, 40, 11), look: 'accent', motion: 'bob' },
    { d: plus(62, 40, 5), look: 'white', motion: 'bob' },
  ],
};

/** Announcements, an inbox: the mailbox open, its orange flag up. */
const mailbox: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([46, 56, 3, 'speck', 'a'], [200, 112, 2.6, 'speck', 'b'], [40, 116, 2.2, 'speck', 'c'], [62, 34, 1.6, 'dot', 'b'], [206, 140, 1.8, 'dot', 'a']),
    ground(30, 210, 150),
    { d: hand([[114, 118], [126, 118], [126, 151], [114, 151]], 0.6), look: 'paper' },
    { d: 'M84 118V80c0-20 16-36 36-36s36 16 36 36v38Z', look: 'paper' },
    { d: 'M98 104V84c0-12 10-22 22-22s22 10 22 22v20Z', look: 'solid' },
    { d: hand([[98, 104], [142, 104], [150, 130], [90, 130]], 1), look: 'shade' },
    { d: 'M156 96h10V54', look: 'ink' },
    { d: 'M166 54h20l-7 8 7 8h-20Z', look: 'accent', motion: 'bob' },
    { d: 'M120 92c-5-11 3-18 9-13s-4 13-8 5c-3-7 5-15 13-17', look: 'line', motion: 'b' },
  ],
};

/** Nothing matches: a magnifier coming up out of a hole, papers in the air. */
const search: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([200, 40, 3, 'speck', 'a'], [36, 92, 2.6, 'speck', 'b'], [208, 132, 2.2, 'speck', 'c'], [54, 36, 1.6, 'dot', 'c'], [176, 160, 1.8, 'dot', 'a']),
    { d: rrect(54, 52, 22, 28, 3), look: 'paper', transform: 'rotate(-18 65 66)', motion: 'a' },
    { d: 'M59 61h12M59 67h9', look: 'line', transform: 'rotate(-18 65 66)', motion: 'a' },
    { d: rrect(172, 62, 22, 28, 3), look: 'paper', transform: 'rotate(16 183 76)', motion: 'c' },
    { d: 'M177 71h12M177 77h8', look: 'line', transform: 'rotate(16 183 76)', motion: 'c' },
    { d: rrect(184, 104, 18, 22, 3), look: 'paper', transform: 'rotate(-8 193 115)', motion: 'b' },
    { d: hand([[111.1, 146.9], [120.9, 149.1], [130.9, 103.1], [121.1, 100.9]], 0.5), look: 'solid' },
    { d: circle(134, 78, 24), look: 'paper' },
    { d: circle(134, 78, 17), look: 'line' },
    { d: 'M126 72c0-6 4-9 8.5-9s8.5 3 8.5 8c0 5-7 6-7 11', look: 'ink' },
    { d: circle(136, 88, 2.2), look: 'dot' },
    { d: ellipse(122, 148, 38, 8), look: 'solid' },
    { d: 'M150 62c3 2 5 5 6 9', look: 'accentLine' },
  ],
};

/** People: two of them, and a place for one more. */
const peopleBase: Shape[] = [
  ...specks([44, 58, 3, 'speck', 'a'], [204, 60, 2.6, 'speck', 'b'], [36, 112, 2.2, 'speck', 'c'], [62, 36, 1.6, 'dot', 'c'], [210, 138, 1.8, 'dot', 'a']),
  ground(30, 210, 150),
  { d: 'M118 148c0-24 12-38 30-38s30 14 30 38Z', look: 'shade' },
  { d: circle(148, 82, 17), look: 'shade' },
  { d: 'M66 148c0-28 16-44 36-44s36 16 36 44Z', look: 'paper' },
  { d: circle(102, 80, 20), look: 'paper' },
  { d: 'M95 79v3M109 79v3M96 90c4 3 8 3 12 0', look: 'line' },
];
const people: Scene = {
  width: W,
  height: H,
  shapes: [
    ...peopleBase,
    { d: circle(184, 98, 12), look: 'accent', motion: 'bob' },
    { d: plus(184, 98, 5.5), look: 'white', motion: 'bob' },
  ],
};

/** Followers: the same two, and the heart that brought them. */
const followers: Scene = {
  width: W,
  height: H,
  shapes: [...peopleBase, { d: heart(184, 96, 12), look: 'accent', motion: 'bob' }],
};

/** Branches: a folded map, the orange pin about to land on it. */
const pin: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([44, 62, 3, 'speck', 'a'], [206, 70, 2.4, 'speck', 'c'], [210, 126, 3, 'speck', 'b'], [32, 128, 2.2, 'speck', 'c'], [70, 40, 1.6, 'dot', 'b']),
    { d: hand([[62, 156], [176, 156], [188, 150], [70, 151]], 0.6), look: 'solid' },
    { d: hand([[60, 96], [96, 84], [96, 144], [60, 154]]), look: 'paper' },
    { d: hand([[96, 84], [132, 96], [132, 156], [96, 144]]), look: 'shade' },
    { d: hand([[132, 96], [170, 84], [170, 144], [132, 156]]), look: 'paper' },
    { d: 'M68 136c12-10 18-24 30-20s16 20 30 12 14-22 26-28', look: 'dash' },
    { d: ellipse(152, 104, 8, 2.6), look: 'solid', motion: 'a' },
    { d: 'M152 96c-12-14-18-24-18-32a18 18 0 0 1 36 0c0 8-6 18-18 32Z', look: 'accent', motion: 'bob' },
    { d: circle(152, 63, 6.5), look: 'paper', motion: 'bob' },
  ],
};

/** Stories: two instant photos, the orange sun in the empty one. */
const photo: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([42, 56, 3, 'speck', 'b'], [204, 54, 2.6, 'speck', 'a'], [212, 120, 2.2, 'speck', 'c'], [34, 122, 3, 'speck', 'a'], [186, 150, 1.8, 'dot', 'b']),
    curl(180, 34),
    { d: rrect(104, 44, 74, 90, 6), look: 'shade', transform: 'rotate(9 141 89)' },
    { d: rrect(70, 60, 78, 94, 6), look: 'solid', transform: 'rotate(-6 114 104)' },
    { d: rrect(64, 54, 78, 94, 6), look: 'paper', transform: 'rotate(-6 114 104)' },
    { d: rrect(72, 62, 62, 60, 3), look: 'shade', transform: 'rotate(-6 114 104)' },
    { d: 'M74 112c8-10 14-14 22-8s12 8 20-5 12-8 16-3', look: 'line', transform: 'rotate(-6 114 104)' },
    { d: circle(118, 80, 7), look: 'accent', transform: 'rotate(-6 114 104)', motion: 'bob' },
    { d: rrect(82, 132, 34, 5, 2.5), look: 'shade', transform: 'rotate(-6 114 104)' },
  ],
};

/** Something broke, the connection dropped: two plugs, apart. */
const plug: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([60, 40, 3, 'speck', 'a'], [196, 52, 2.4, 'speck', 'b'], [70, 146, 2.6, 'speck', 'c'], [182, 156, 1.8, 'dot', 'a'], [120, 30, 1.6, 'dot', 'c']),
    { d: ellipse(30, 82, 8, 20), look: 'solid' },
    { d: 'M34 84c20 2 32-12 54-12', look: 'cable' },
    { d: 'M34 84c20 2 32-12 54-12', look: 'cableIn' },
    { d: 'M118 64l14-3M120 78l14-3', look: 'cable' },
    { d: rrect(84, 56, 36, 30, 9), look: 'paper', transform: 'rotate(-8 102 71)' },
    { d: 'M96 62v18', look: 'line', transform: 'rotate(-8 102 71)' },
    { d: ellipse(212, 112, 8, 20), look: 'solid' },
    { d: 'M206 114c-20 0-28 8-48 6', look: 'cable' },
    { d: 'M206 114c-20 0-28 8-48 6', look: 'cableIn' },
    { d: rrect(124, 102, 36, 32, 9), look: 'shade', transform: 'rotate(6 142 118)' },
    { d: `${circle(136, 112, 2.6)}${circle(135, 124, 2.6)}`, look: 'solid', transform: 'rotate(6 142 118)' },
    { d: 'M136 82l7-8M144 90l10-3M126 92l2 9', look: 'accentLine', motion: 'bob' },
  ],
};

/** Lost: a signpost whose arrows only ask. */
const signpost: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([44, 56, 3, 'speck', 'a'], [204, 48, 2.6, 'speck', 'c'], [210, 110, 2.2, 'speck', 'b'], [34, 106, 2.4, 'speck', 'b'], [66, 34, 1.6, 'dot', 'c']),
    ground(26, 214, 150),
    { d: hand([[114, 52], [124, 52], [124, 151], [114, 151]], 0.6), look: 'paper' },
    { d: 'M84 58h62l12 12-12 12H84Z', look: 'accent', motion: 'bob' },
    { d: 'M110 66c0-3 2.5-5 5.5-5s5.5 2 5.5 5c0 3.5-5 4-5 7.5M115.8 77.5v.4', look: 'white', motion: 'bob' },
    { d: 'M156 92H94l-12 12 12 12h62Z', look: 'paper' },
    { d: 'M117 100c0-3 2.5-5 5.5-5s5.5 2 5.5 5c0 3.5-5 4-5 7.5M122.8 111.5v.4', look: 'ink' },
    { d: 'M150 150l7-8', look: 'line' },
  ],
};

/** Writing — documents, drafts: the sheet and the orange pen. */
const paper: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([44, 50, 3, 'speck', 'b'], [200, 44, 2.4, 'speck', 'a'], [214, 104, 3, 'speck', 'c'], [36, 118, 2.2, 'speck', 'a'], [72, 30, 1.6, 'dot', 'c']),
    { d: hand([[86, 144], [176, 136], [190, 146], [92, 156]], 0.8), look: 'solid' },
    { d: hand([[70, 62], [156, 52], [168, 138], [80, 148]]), look: 'paper' },
    { d: hand([[140, 54], [156, 52], [158, 68]], 0.6), look: 'shade' },
    { d: 'M84 80l50-6M86 94l58-7M88 108l40-5', look: 'line' },
    { d: feather(156, 140)[0], look: 'accent', motion: 'bob' },
    { d: feather(156, 140)[1], look: 'ink', motion: 'bob' },
    { d: 'M156 140l-3 8', look: 'ink' },
  ],
};

/** All caught up: a cup of tea, nothing waiting. */
const clear: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([44, 60, 3, 'speck', 'a'], [210, 112, 2.4, 'speck', 'b'], [34, 120, 2.2, 'speck', 'c'], [66, 38, 1.6, 'dot', 'b'], [196, 148, 1.8, 'dot', 'a']),
    { d: ellipse(120, 142, 50, 10), look: 'shade' },
    { d: 'M150 94c16 0 22 8 22 15s-6 15-22 15M150 101c8 0 12 3 12 8s-4 8-12 8', look: 'ink' },
    { d: 'M86 86h64v36c0 14-10 22-22 22h-20c-12 0-22-8-22-22Z', look: 'paper' },
    { d: ellipse(118, 86, 32, 6), look: 'paper' },
    { d: ellipse(118, 87, 26, 3.6), look: 'deep' },
    { d: 'M96 128c6 4 14 5 22 5', look: 'line' },
    { d: 'M106 72c-6-6 6-10 0-18', look: 'line', motion: 'steam' },
    { d: 'M120 70c-6-7 6-12 0-20', look: 'line', motion: 'steam' },
    { d: 'M134 72c-6-6 6-10 0-18', look: 'line', motion: 'steam' },
    { d: circle(176, 54, 13), look: 'accent', motion: 'bob' },
    { d: check(176, 54, 10), look: 'white', motion: 'bob' },
  ],
};

/** Numbers to come: a board on an easel, the line still dotted. */
const chart: Scene = {
  width: W,
  height: H,
  shapes: [
    ...specks([42, 52, 3, 'speck', 'a'], [206, 46, 2.4, 'speck', 'b'], [212, 110, 3, 'speck', 'c'], [34, 116, 2.2, 'speck', 'b'], [64, 30, 1.6, 'dot', 'a']),
    { d: 'M98 130l-14 24M142 130l14 24M120 130v22', look: 'ink' },
    { d: rrect(66, 50, 120, 86, 10), look: 'solid' },
    { d: rrect(58, 42, 120, 86, 10), look: 'paper' },
    { d: 'M70 66h96M70 86h96M70 106h96', look: 'line' },
    { d: rrect(74, 104, 12, 16, 2), look: 'shade' },
    { d: rrect(92, 96, 12, 24, 2), look: 'shade' },
    { d: rrect(110, 100, 12, 20, 2), look: 'shade' },
    { d: 'M76 98c14-6 20-18 34-16s16 4 28-10 14-14 22-18', look: 'dash' },
    { d: circle(160, 54, 6), look: 'accent', motion: 'bob' },
  ],
};

/**
 * The 404: "4 [compass] 4" — the zero a compass whose orange needle cannot
 * settle — standing on the three hills of the opening picture (§302).
 */
const four = (dx: number): string =>
  hand([[44 + dx, 54], [62 + dx, 54], [62 + dx, 112], [76 + dx, 112], [76 + dx, 128], [62 + dx, 128], [62 + dx, 152], [44 + dx, 152], [44 + dx, 128], [4 + dx, 128], [4 + dx, 112]], 1) +
  // The hole inside the 4 (drawn even-odd).
  `M${44 + dx} 80L${44 + dx} 112L${22 + dx} 112Z`;
const lost: Scene = {
  width: 360,
  height: 200,
  shapes: [
    { d: 'M0 200C34 178 96 154 172 150s152 20 188 50Z', look: 'veil' },
    { d: 'M24 200c52-15 122-23 192-19s104 10 132 19Z', look: 'veil2' },
    { d: 'M34 190c58-12 128-18 196-12s82 8 100 7', look: 'line' },
    ...specks([36, 40, 3, 'speck', 'a'], [320, 44, 2.6, 'speck', 'c'], [336, 110, 2.2, 'speck', 'b'], [24, 112, 2.4, 'speck', 'b'], [150, 24, 1.6, 'dot', 'c'], [268, 30, 1.8, 'dot', 'a']),
    { d: rrect(222, 18, 20, 26, 3), look: 'paper', transform: 'rotate(14 232 31)', motion: 'c' },
    { d: 'M227 27h10M227 33h7', look: 'line', transform: 'rotate(14 232 31)', motion: 'c' },
    curl(108, 30),
    { d: four(34), look: 'solid', transform: 'translate(7 7)' },
    { d: four(34), look: 'shade' },
    { d: four(244), look: 'solid', transform: 'translate(7 7)' },
    { d: four(244), look: 'shade' },
    { d: circle(187, 109, 47), look: 'solid' },
    { d: circle(180, 102, 47), look: 'paper' },
    { d: circle(180, 102, 37), look: 'line' },
    { d: 'M180 58v8M180 138v8M136 102h8M216 102h8', look: 'ink' },
    { d: 'M180 102l8-6 -8-38 -8 38Z', look: 'accent', motion: 'hunt', origin: '180px 102px' },
    { d: 'M180 102l8 6 -8 38 -8-38Z', look: 'paper', motion: 'hunt', origin: '180px 102px' },
    { d: circle(180, 102, 4.5), look: 'solid' },
  ],
};

export const EMPTY_ART = {
  calendar,
  box,
  chat,
  bell,
  reviews,
  bank,
  mailbox,
  search,
  people,
  followers,
  pin,
  photo,
  plug,
  signpost,
  paper,
  clear,
  chart,
  lost,
} satisfies Record<string, Scene>;

export type EmptyArtName = keyof typeof EMPTY_ART;
