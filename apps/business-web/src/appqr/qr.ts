import { toQR } from 'toqr';

/**
 * The app QR code's drawing (§309), worked out once and drawn three ways — on
 * the screen (SVG), on paper (the same SVG, printed) and as a picture to post
 * (canvas, cardImage.ts) — so all three are the same code.
 *
 * Error correction H: up to 30% of the code may be covered and it still reads,
 * which is what lets the platform's mark sit in the middle. Round dots and
 * rounded corner squares read like any square code; the dark stays the ink,
 * on white, because a colour on the dots costs contrast phones need.
 */
const CORRECTION_HIGH = 2;

/** White border around the code, in modules: the four a scanner expects. */
export const QUIET = 4;

export type QrDrawing = {
  /** Modules along one side, the white border included. */
  size: number;
  /** The centres of the dots, in modules. */
  dots: Array<[number, number]>;
  /** The top-left corner of each 7×7 corner square, in modules. */
  eyes: Array<[number, number]>;
  /** The square left empty in the middle for the mark, in modules. */
  hole: { x: number; y: number; side: number };
};

export function drawQr(text: string): QrDrawing {
  const modules = toQR(text, CORRECTION_HIGH as never);
  const n = Math.round(Math.sqrt(modules.length));
  const eyes: Array<[number, number]> = [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ];
  const inEye = (x: number, y: number) => eyes.some(([ex, ey]) => x >= ex && x < ex + 7 && y >= ey && y < ey + 7);
  // About a fifth of the side, odd so it sits on the middle module.
  let side = Math.round(n * 0.22);
  if (side % 2 === 0) side += 1;
  const start = (n - side) / 2;
  // QR sizes are odd (21, 25, 29 …), so the hole starts on a whole module.
  const inHole = (x: number, y: number) => x >= start && x < start + side && y >= start && y < start + side;

  const dots: Array<[number, number]> = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (modules[y * n + x] && !inEye(x, y) && !inHole(x, y)) dots.push([x + QUIET + 0.5, y + QUIET + 0.5]);
    }
  }
  return {
    size: n + QUIET * 2,
    dots,
    eyes: eyes.map(([x, y]) => [x + QUIET, y + QUIET]),
    hole: { x: start + QUIET, y: start + QUIET, side },
  };
}

/** The dot's radius and the corner squares' rounding, in modules. */
export const DOT_RADIUS = 0.43;
export const EYE_ROUND = { outer: 2.1, ring: 1.4, inner: 0.9 };

/** The platform's mark (ui/Logo), drawn on a 136-unit tile. */
export const MARK = {
  b: 'M30 18 C28 40 27 62 29 88 C31 100 40 106 50 104 C66 100 74 86 70 70 C66 58 50 54 36 64',
  check: 'M72 70 L82 82 L106 46',
  ink: '#1f2a1f',
  orange: '#fd7511',
};

export const INK = '#1f2a1f';
