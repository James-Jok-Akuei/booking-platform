import { useEffect, useRef } from 'react';

/**
 * The moving part of each "For you" card (§210, §212) — one per card, chosen
 * for what the card is about, so the banner never repeats itself: confetti
 * for a best seller, coins for getting paid, a ping for something just in,
 * rising stars for reviews, and so on. Most are drawn on a canvas, which only
 * runs on the card being shown, while it can be seen; four are pure CSS.
 */
export type SlideEffect =
  | 'glitter'
  | 'confetti'
  | 'bokeh'
  | 'bubbles'
  | 'stars'
  | 'coins'
  | 'meteors'
  | 'constellation'
  | 'streaks'
  | 'ripples'
  | 'rays'
  | 'aurora'
  | 'waves';

const CSS_EFFECTS: SlideEffect[] = ['ripples', 'rays', 'aurora', 'waves'];

export function Effect({ kind, running }: { kind: SlideEffect; running: boolean }) {
  if (kind === 'ripples')
    return (
      <div className="fx-ripples" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    );
  if (kind === 'rays') return <div className="fx-rays" aria-hidden="true" />;
  if (kind === 'aurora')
    return (
      <div className="fx-aurora" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    );
  if (kind === 'waves') return <Waves />;
  return running && !CSS_EFFECTS.includes(kind) ? <CanvasEffect kind={kind} /> : null;
}

/** Three waves along the foot. Each path is two whole waves wide, so sliding it by half loops seamlessly. */
const WAVES = [
  'M0,70 Q180,38 360,70 T720,70 T1080,70 T1440,70 V160 H0 Z',
  'M0,82 Q180,50 360,82 T720,82 T1080,82 T1440,82 V160 H0 Z',
  'M0,96 Q180,72 360,96 T720,96 T1080,96 T1440,96 V160 H0 Z',
];
function Waves() {
  return (
    <div className="fx-waves" aria-hidden="true">
      {WAVES.map((d, i) => (
        <svg key={i} className={`w${i}`} viewBox="0 0 1440 160" preserveAspectRatio="none">
          <path d={d} />
        </svg>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The canvas effects

type Stage = { ctx: CanvasRenderingContext2D; w: number; h: number; glow: HTMLCanvasElement };
type System = (dt: number, s: Stage) => void;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
/** Quieter where the words are: the lower half, and the left of a short card. */
const calm = (x: number, y: number, s: Stage) => (y > s.h * 0.5 || (x < s.w * 0.66 && y > s.h * 0.22) ? 0.4 : 1);
const area = (s: Stage, per: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, (s.w * s.h) / per)));

function softGlow() {
  const glow = document.createElement('canvas');
  glow.width = glow.height = 64;
  const g = glow.getContext('2d')!;
  const fall = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  fall.addColorStop(0, 'rgba(255, 250, 235, 1)');
  fall.addColorStop(0.25, 'rgba(255, 236, 200, 0.55)');
  fall.addColorStop(1, 'rgba(255, 220, 180, 0)');
  g.fillStyle = fall;
  g.fillRect(0, 0, 64, 64);
  return glow;
}

function fourStar(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, thin = 0.18) {
  const k = s * thin;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x + k, y - k, x + s, y);
  ctx.quadraticCurveTo(x + k, y + k, x, y + s);
  ctx.quadraticCurveTo(x - k, y + k, x - s, y);
  ctx.quadraticCurveTo(x - k, y - k, x, y - s);
  ctx.fill();
}

function fiveStar(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? s : s * 0.46;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

/** Twinkling stars and specks rising, and now and then a glint by the art. */
function glitter(s0: Stage): System {
  type P = { x: number; y: number; r: number; vy: number; sway: number; tw: number; ph: number; star: boolean };
  const make = (s: Stage, below: boolean): P => ({
    x: Math.random() * s.w,
    y: below ? s.h + rand(0, 24) : Math.random() * s.h,
    r: rand(0.7, 2.9),
    vy: rand(5, 18),
    sway: rand(0, 6.3),
    tw: rand(1.2, 4),
    ph: rand(0, 6.3),
    star: Math.random() < 0.5,
  });
  const ps = Array.from({ length: area(s0, 4200, 14, 38) }, () => make(s0, false));
  let glint = { x: 0, y: 0, t: 1, size: 14 };
  let wait = 0.7;
  return (dt, s) => {
    const { ctx, glow } = s;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of ps) {
      p.y -= p.vy * dt;
      p.sway += dt * 0.7;
      p.ph += dt * p.tw;
      if (p.y < -12) Object.assign(p, make(s, true));
      const x = p.x + Math.sin(p.sway) * 7;
      const a = (0.15 + 0.85 * Math.pow((Math.sin(p.ph) + 1) / 2, 3)) * calm(x, p.y, s);
      const halo = p.r * (p.star ? 7 : 5);
      ctx.globalAlpha = a * 0.55;
      ctx.drawImage(glow, x - halo, p.y - halo, halo * 2, halo * 2);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fffaf0';
      if (p.star) fourStar(ctx, x, p.y, p.r * 3);
      else {
        ctx.beginPath();
        ctx.arc(x, p.y, p.r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    wait -= dt;
    if (wait <= 0 && glint.t >= 1) {
      glint = { x: s.w * rand(0.6, 0.94), y: s.h * rand(0.1, 0.4), t: 0, size: rand(12, 22) };
      wait = rand(1.6, 3.4);
    }
    if (glint.t < 1) {
      glint.t = Math.min(1, glint.t + dt / 0.9);
      const k = Math.sin(glint.t * Math.PI);
      const z = glint.size * k;
      ctx.globalAlpha = k * 0.9;
      ctx.drawImage(glow, glint.x - z * 2.2, glint.y - z * 2.2, z * 4.4, z * 4.4);
      ctx.globalAlpha = k;
      ctx.fillStyle = '#fff';
      fourStar(ctx, glint.x, glint.y, z, 0.08);
    }
  };
}

/** Paper confetti fluttering down, turning over as it falls. */
function confetti(s0: Stage): System {
  const COLORS = ['#ffffff', '#ffd166', '#ff6b9a', '#7cf0c8', '#9cc8ff', '#ffb36b', '#c9a7ff'];
  type P = { x: number; y: number; w: number; h: number; vy: number; sway: number; swing: number; rot: number; vr: number; flip: number; vf: number; color: string; shape: number };
  const make = (s: Stage, top: boolean): P => {
    const shape = Math.floor(Math.random() * 3);
    return {
      x: Math.random() * s.w,
      y: top ? rand(-40, -8) : Math.random() * s.h,
      w: shape === 2 ? rand(2.5, 3.5) : rand(5, 9),
      h: shape === 2 ? rand(12, 18) : rand(7, 12),
      vy: rand(26, 58),
      sway: rand(0, 6.3),
      swing: rand(8, 22),
      rot: rand(0, 6.3),
      vr: rand(-3, 3),
      flip: rand(0, 6.3),
      vf: rand(3, 7),
      color: pick(COLORS),
      shape,
    };
  };
  const ps = Array.from({ length: area(s0, 3600, 18, 46) }, () => make(s0, false));
  return (dt, s) => {
    const { ctx } = s;
    for (const p of ps) {
      p.y += p.vy * dt;
      p.sway += dt * 1.6;
      p.rot += p.vr * dt;
      p.flip += p.vf * dt;
      if (p.y > s.h + 20) Object.assign(p, make(s, true));
      const x = p.x + Math.sin(p.sway) * p.swing;
      ctx.save();
      ctx.translate(x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.flip));
      ctx.globalAlpha = 0.95 * calm(x, p.y, s);
      ctx.fillStyle = p.color;
      if (p.shape === 1) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
  };
}

/** Soft out-of-focus lights drifting, as a camera sees them. */
function bokeh(s0: Stage): System {
  const TINTS = ['255,255,255', '255,238,210', '255,214,232', '210,236,255'];
  type P = { x: number; y: number; r: number; vx: number; vy: number; a: number; ph: number; tint: string; rim: boolean };
  const ps: P[] = Array.from({ length: area(s0, 9000, 10, 16) }, () => ({
    x: Math.random() * s0.w,
    y: Math.random() * s0.h,
    r: rand(10, 46),
    vx: rand(-7, 7),
    vy: rand(-9, -2),
    a: rand(0.07, 0.22),
    ph: rand(0, 6.3),
    tint: pick(TINTS),
    rim: Math.random() < 0.6,
  }));
  return (dt, s) => {
    const { ctx } = s;
    ctx.globalCompositeOperation = 'screen';
    for (const p of ps) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.ph += dt * 0.8;
      if (p.y < -p.r) p.y = s.h + p.r;
      if (p.x < -p.r) p.x = s.w + p.r;
      if (p.x > s.w + p.r) p.x = -p.r;
      const a = p.a * (0.75 + 0.25 * Math.sin(p.ph)) * calm(p.x, p.y, s);
      const g = ctx.createRadialGradient(p.x, p.y, p.r * 0.15, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(${p.tint},${a})`);
      g.addColorStop(0.78, `rgba(${p.tint},${a * 0.85})`);
      g.addColorStop(1, `rgba(${p.tint},0)`);
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      if (p.rim) {
        ctx.strokeStyle = `rgba(${p.tint},${a * 1.6})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.86, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  };
}

/** Bubbles rising and wobbling, each with a glint of light on it. */
function bubbles(s0: Stage): System {
  type P = { x: number; y: number; r: number; vy: number; wob: number; amp: number };
  const make = (s: Stage, below: boolean): P => ({
    x: Math.random() * s.w,
    y: below ? s.h + rand(10, 40) : Math.random() * s.h,
    r: rand(3, 13),
    vy: rand(14, 36),
    wob: rand(0, 6.3),
    amp: rand(3, 10),
  });
  const ps = Array.from({ length: area(s0, 5200, 14, 28) }, () => make(s0, false));
  return (dt, s) => {
    const { ctx } = s;
    for (const p of ps) {
      p.y -= p.vy * dt;
      p.wob += dt * 2;
      if (p.y < -p.r * 2) Object.assign(p, make(s, true));
      const x = p.x + Math.sin(p.wob) * p.amp;
      const k = calm(x, p.y, s);
      ctx.globalAlpha = k;
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.ellipse(x - p.r * 0.38, p.y - p.r * 0.4, p.r * 0.26, p.r * 0.16, -0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}

/** Five-pointed stars floating up, turning and twinkling — gold and white. */
function stars(s0: Stage): System {
  type P = { x: number; y: number; size: number; vy: number; rot: number; vr: number; ph: number; gold: boolean };
  const make = (s: Stage, below: boolean): P => ({
    x: Math.random() * s.w,
    y: below ? s.h + rand(10, 30) : Math.random() * s.h,
    size: rand(3, 8.5),
    vy: rand(10, 26),
    rot: rand(0, 6.3),
    vr: rand(-1.2, 1.2),
    ph: rand(0, 6.3),
    gold: Math.random() < 0.55,
  });
  const ps = Array.from({ length: area(s0, 5600, 12, 24) }, () => make(s0, false));
  return (dt, s) => {
    const { ctx, glow } = s;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of ps) {
      p.y -= p.vy * dt;
      p.rot += p.vr * dt;
      p.ph += dt * 2.4;
      if (p.y < -16) Object.assign(p, make(s, true));
      const a = (0.45 + 0.55 * (Math.sin(p.ph) + 1) / 2) * calm(p.x, p.y, s);
      ctx.globalAlpha = a * 0.5;
      ctx.drawImage(glow, p.x - p.size * 3, p.y - p.size * 3, p.size * 6, p.size * 6);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.gold ? '#ffd76a' : '#fffaf0';
      fiveStar(ctx, p.size);
      ctx.restore();
    }
  };
}

/** Gold coins tumbling down slowly, catching the light as they turn. */
function coins(s0: Stage): System {
  type P = { x: number; y: number; r: number; vy: number; spin: number; vs: number; sway: number; tilt: number };
  const make = (s: Stage, top: boolean): P => ({
    x: rand(0.05, 0.95) * s.w,
    y: top ? rand(-60, -14) : Math.random() * s.h,
    r: rand(7, 13),
    vy: rand(22, 44),
    spin: rand(0, 6.3),
    vs: rand(2, 4.5),
    sway: rand(0, 6.3),
    tilt: rand(-0.4, 0.4),
  });
  const ps = Array.from({ length: area(s0, 9500, 8, 15) }, () => make(s0, false));
  return (dt, s) => {
    const { ctx, glow } = s;
    for (const p of ps) {
      p.y += p.vy * dt;
      p.spin += p.vs * dt;
      p.sway += dt;
      if (p.y > s.h + 20) Object.assign(p, make(s, true));
      const x = p.x + Math.sin(p.sway) * 6;
      const face = Math.cos(p.spin);
      const sx = Math.max(0.12, Math.abs(face));
      const k = calm(x, p.y, s);
      ctx.save();
      ctx.translate(x, p.y);
      ctx.rotate(p.tilt);
      ctx.scale(sx, 1);
      ctx.globalAlpha = k;
      const g = ctx.createLinearGradient(-p.r, -p.r, p.r, p.r);
      g.addColorStop(0, '#fff3c4');
      g.addColorStop(0.45, '#ffc93d');
      g.addColorStop(1, '#c9780a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(150, 82, 0, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, p.r * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      // A flash as a face turns to the light.
      if (face > 0.94) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (face - 0.94) * 14 * k;
        ctx.drawImage(glow, x - p.r * 2, p.y - p.r * 2, p.r * 4, p.r * 4);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  };
}

/** A still field of faint stars, with shooting stars streaking across. */
function meteors(s0: Stage): System {
  const field = Array.from({ length: area(s0, 3000, 20, 44) }, () => ({ x: Math.random() * s0.w, y: Math.random() * s0.h * 0.75, r: rand(0.4, 1.2), ph: rand(0, 6.3) }));
  type M = { x: number; y: number; vx: number; vy: number; len: number; life: number };
  const live: M[] = [];
  let wait = 0.4;
  return (dt, s) => {
    const { ctx, glow } = s;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ffffff';
    for (const f of field) {
      f.ph += dt * 1.5;
      ctx.globalAlpha = (0.25 + 0.5 * (Math.sin(f.ph) + 1) / 2) * calm(f.x, f.y, s);
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    wait -= dt;
    if (wait <= 0) {
      const speed = rand(380, 560);
      const angle = rand(2.55, 2.8); // down and to the left
      live.push({ x: s.w * rand(0.45, 1.15), y: s.h * rand(-0.1, 0.25), vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, len: rand(70, 140), life: 1 });
      wait = rand(0.9, 2.2);
    }
    for (let i = live.length - 1; i >= 0; i--) {
      const m = live[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const speed = Math.hypot(m.vx, m.vy);
      const tx = m.x - (m.vx / speed) * m.len;
      const ty = m.y - (m.vy / speed) * m.len;
      const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.3, 'rgba(255,226,200,0.45)');
      g.addColorStop(1, 'rgba(255,200,170,0)');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.drawImage(glow, m.x - 9, m.y - 9, 18, 18);
      if (m.x < -m.len || m.y > s.h + m.len) live.splice(i, 1);
    }
  };
}

/** Points of light drifting, joined to their neighbours: a network growing. */
function constellation(s0: Stage): System {
  type P = { x: number; y: number; vx: number; vy: number; r: number; ph: number };
  const ps: P[] = Array.from({ length: area(s0, 5600, 14, 26) }, () => ({
    x: Math.random() * s0.w,
    y: Math.random() * s0.h,
    vx: rand(-11, 11),
    vy: rand(-11, 11),
    r: rand(1.3, 2.6),
    ph: rand(0, 6.3),
  }));
  const reach = 92;
  return (dt, s) => {
    const { ctx, glow } = s;
    for (const p of ps) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.ph += dt * 2;
      if (p.x < 0 || p.x > s.w) p.vx *= -1;
      if (p.y < 0 || p.y > s.h) p.vy *= -1;
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i];
        const b = ps[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > reach) continue;
        ctx.globalAlpha = (1 - d / reach) * 0.5 * Math.min(calm(a.x, a.y, s), calm(b.x, b.y, s));
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of ps) {
      const a = (0.6 + 0.4 * Math.sin(p.ph)) * calm(p.x, p.y, s);
      ctx.globalAlpha = a * 0.6;
      ctx.drawImage(glow, p.x - p.r * 5, p.y - p.r * 5, p.r * 10, p.r * 10);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}

/** Light streaking upwards — something on the way up. */
function streaks(s0: Stage): System {
  type P = { x: number; y: number; len: number; vy: number; w: number; a: number };
  const make = (s: Stage, below: boolean): P => ({
    x: Math.random() * s.w,
    y: below ? s.h + rand(0, 60) : Math.random() * s.h,
    len: rand(28, 90),
    vy: rand(90, 200),
    w: rand(1, 2.2),
    a: rand(0.3, 0.75),
  });
  const ps = Array.from({ length: area(s0, 7000, 10, 18) }, () => make(s0, false));
  return (dt, s) => {
    const { ctx, glow } = s;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of ps) {
      p.y -= p.vy * dt;
      if (p.y + p.len < 0) Object.assign(p, make(s, true));
      const k = calm(p.x, p.y, s);
      const g = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.len);
      g.addColorStop(0, `rgba(255,255,255,${p.a * k})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 1;
      ctx.strokeStyle = g;
      ctx.lineWidth = p.w;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y + p.len);
      ctx.stroke();
      ctx.globalAlpha = p.a * k * 0.8;
      ctx.drawImage(glow, p.x - 6, p.y - 6, 12, 12);
    }
  };
}

const SYSTEMS: Partial<Record<SlideEffect, (s: Stage) => System>> = {
  glitter,
  confetti,
  bokeh,
  bubbles,
  stars,
  coins,
  meteors,
  constellation,
  streaks,
};

function CanvasEffect({ kind }: { kind: SlideEffect }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    const build = SYSTEMS[kind];
    if (!canvas || !ctx || !build) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const stage: Stage = { ctx, w: 0, h: 0, glow: softGlow() };
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      stage.w = box.width;
      stage.h = box.height;
      canvas.width = Math.max(1, Math.round(box.width * dpr));
      canvas.height = Math.max(1, Math.round(box.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const watch = new ResizeObserver(resize);
    watch.observe(canvas);

    const step = build(stage);
    let last = performance.now();
    let raf = 0;
    let awake = true;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, stage.w, stage.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      step(dt, stage);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (awake) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Asleep in a hidden tab.
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      awake = !document.hidden;
      if (awake) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      awake = false;
      cancelAnimationFrame(raf);
      watch.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [kind]);

  return <canvas ref={ref} className="fx-canvas" aria-hidden="true" />;
}
