import type { CardWords } from './cardWords';
import { DOT_RADIUS, EYE_ROUND, INK, MARK, drawQr } from './qr';

/**
 * The counter card as a picture to post (§309): 1080×1350, the size WhatsApp
 * status and Instagram show whole. Drawn on a canvas from the same QR drawing
 * as the screen, in the card's language; long words shrink a step at a time
 * until they fit, so Kinyarwanda holds as well as English.
 */
const W = 1080;
const H = 1350;
const PAPER = '#fbf6ec';
const NIGHT = '#1f2a1f';
const MUTED = '#4a554a';
const ORANGE = '#fd7511';
const FONT = "'Plus Jakarta Sans', system-ui, sans-serif";

export async function cardImage(input: { words: CardWords; shop: string; logoUrl: string | null; link: string }): Promise<Blob> {
  await Promise.all(['800 72px', '700 40px', '600 30px'].map((f) => document.fonts.load(`${f} ${FONT}`).catch(() => [])));
  const logo = input.logoUrl ? await loadImage(input.logoUrl) : null;
  try {
    return await render(input, logo);
  } catch {
    // A logo from another address without permission taints the canvas: the initials instead.
    return render(input, null);
  }
}

function render(input: { words: CardWords; shop: string; link: string }, logo: HTMLImageElement | null): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // The shop, on the night band.
  ctx.fillStyle = NIGHT;
  ctx.fillRect(0, 0, W, 260);
  const tile = 120;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(90, 70, tile, tile, 30);
  ctx.clip();
  if (logo) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(90, 70, tile, tile);
    ctx.drawImage(logo, 90, 70, tile, tile);
  } else {
    ctx.fillStyle = '#d4401c';
    ctx.fillRect(90, 70, tile, tile);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 48px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials(input.shop), 90 + tile / 2, 70 + tile / 2 + 2);
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  const name = fit(ctx, input.shop, 740, 52, 32, 1, 800);
  ctx.font = name.font;
  ctx.fillText(name.lines[0], 240, 148);
  ctx.fillStyle = 'rgba(255,255,255,0.62)';
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText('BwanguReservations', 240, 190);

  // What it is for.
  ctx.fillStyle = NIGHT;
  const head = fit(ctx, input.words.headline, 900, 70, 44, 2, 800);
  ctx.font = head.font;
  head.lines.forEach((line, i) => ctx.fillText(line, 90, 350 + i * head.size * 1.1));
  ctx.fillStyle = MUTED;
  const lead = fit(ctx, input.words.lead, 900, 34, 24, 2, 500);
  ctx.font = lead.font;
  const leadTop = 350 + head.lines.length * head.size * 1.1 + 8;
  lead.lines.forEach((line, i) => ctx.fillText(line, 90, leadTop + i * lead.size * 1.35));

  // The code, on its white tile.
  const side = 520;
  const top = 640;
  const left = (W - side) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(31,42,31,0.16)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  ctx.beginPath();
  ctx.roundRect(left - 20, top - 20, side + 40, side + 40, 44);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  drawCode(ctx, input.link, left, top, side);

  // Three steps, all at the size the longest one needs, so they read as one row.
  const stepTop = 1216;
  const colW = (W - 180) / 3;
  const stepSize = Math.min(...input.words.steps.map((step) => fit(ctx, step, colW - 72, 28, 20, 2, 700).size));
  input.words.steps.forEach((step, i) => {
    const x = 90 + i * colW;
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(x + 22, stepTop, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 24px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x + 22, stepTop + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = NIGHT;
    const label = fit(ctx, step, colW - 72, stepSize, stepSize, 2, 700);
    ctx.font = label.font;
    const first = label.lines.length === 1 ? stepTop + 10 : stepTop - 4;
    label.lines.forEach((line, k) => ctx.fillText(line, x + 56, first + k * label.size * 1.2));
  });

  // The platform, at the foot.
  ctx.font = `800 26px ${FONT}`;
  const first = 'Bwangu';
  const total = ctx.measureText('BwanguReservations').width;
  const markSide = 34;
  const footLeft = (W - total - markSide - 12) / 2;
  drawMark(ctx, footLeft, 1290, markSide);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = NIGHT;
  ctx.fillText(first, footLeft + markSide + 12, 1308);
  ctx.fillStyle = ORANGE;
  ctx.fillText('Reservations', footLeft + markSide + 12 + ctx.measureText(first).width, 1308);
  ctx.textBaseline = 'alphabetic';

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no picture'))), 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}

/** The code at (x, y), `side` wide: dots, the corner squares and the mark, as AppQr draws them. */
function drawCode(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, side: number) {
  const qr = drawQr(text);
  const m = side / qr.size;
  ctx.fillStyle = INK;
  for (const [cx, cy] of qr.dots) {
    ctx.beginPath();
    ctx.arc(x + cx * m, y + cy * m, DOT_RADIUS * m, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [ex, ey] of qr.eyes) {
    const box = (dx: number, size: number, round: number, colour: string) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.roundRect(x + (ex + dx) * m, y + (ey + dx) * m, size * m, size * m, round * m);
      ctx.fill();
    };
    box(0, 7, EYE_ROUND.outer, INK);
    box(1, 5, EYE_ROUND.ring, '#ffffff');
    box(2, 3, EYE_ROUND.inner, INK);
  }
  const { hole } = qr;
  const at = (hole.x + 0.5) * m;
  drawMark(ctx, x + at, y + at, (hole.side - 1) * m);
}

/** The platform's mark on its white tile, `side` wide at (x, y). */
function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, side: number) {
  ctx.save();
  ctx.translate(x, y);
  const scale = side / 136;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e7e2d8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(0, 0, 136, 136, 34);
  ctx.fill();
  ctx.stroke();
  ctx.translate(20, 20);
  ctx.scale(0.8, 0.8);
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = MARK.ink;
  ctx.stroke(new Path2D(MARK.b));
  ctx.strokeStyle = MARK.orange;
  ctx.stroke(new Path2D(MARK.check));
  ctx.restore();
}

/** The words in at most `maxLines` lines of `width`, the size coming down from `size` to `min` until they fit. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number, size: number, min: number, maxLines: number, weight: number) {
  for (let s = size; ; s -= 2) {
    const font = `${weight} ${s}px ${FONT}`;
    ctx.font = font;
    const lines = wrap(ctx, text, width);
    const fits = lines.length <= maxLines && lines.every((line) => ctx.measureText(line).width <= width);
    if (fits || s <= min) return { font, size: s, lines: lines.slice(0, maxLines) };
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('') || 'B';

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
