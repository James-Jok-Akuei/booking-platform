import { useEffect, useRef } from 'react';

/**
 * Glitter for the "For you" banner (§210): soft four-pointed stars and specks
 * rising slowly, each twinkling at its own pace, and every couple of seconds
 * one bright glint that flares and fades. Drawn on a canvas with additive
 * light, so it glows over any colour — and only on the slide being shown, and
 * only while it can be seen, so it costs nothing anywhere else.
 */
export function Sparkles({ density = 1 }: { density?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      w = box.width;
      h = box.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const watch = new ResizeObserver(resize);
    watch.observe(canvas);

    // One soft glow, drawn once and stamped wherever light is needed.
    const glow = document.createElement('canvas');
    glow.width = glow.height = 64;
    const g = glow.getContext('2d')!;
    const fall = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    fall.addColorStop(0, 'rgba(255, 250, 235, 1)');
    fall.addColorStop(0.25, 'rgba(255, 236, 200, 0.55)');
    fall.addColorStop(1, 'rgba(255, 220, 180, 0)');
    g.fillStyle = fall;
    g.fillRect(0, 0, 64, 64);

    type Speck = { x: number; y: number; r: number; vy: number; sway: number; tw: number; ph: number; star: boolean };
    const make = (fromBelow: boolean): Speck => ({
      x: Math.random() * w,
      y: fromBelow ? h + Math.random() * 24 : Math.random() * h,
      r: 0.7 + Math.random() * 2.2,
      vy: 5 + Math.random() * 13,
      sway: Math.random() * Math.PI * 2,
      tw: 1.2 + Math.random() * 2.8,
      ph: Math.random() * Math.PI * 2,
      star: Math.random() < 0.5,
    });
    const count = Math.round(Math.min(38, Math.max(14, (w * h) / 4200)) * density);
    const specks = Array.from({ length: count }, () => make(false));

    const star = (x: number, y: number, s: number, thin = 0.18) => {
      const k = s * thin;
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.quadraticCurveTo(x + k, y - k, x + s, y);
      ctx.quadraticCurveTo(x + k, y + k, x, y + s);
      ctx.quadraticCurveTo(x - k, y + k, x - s, y);
      ctx.quadraticCurveTo(x - k, y - k, x, y - s);
      ctx.fill();
    };

    let glint = { x: 0, y: 0, t: 1, size: 14 };
    let untilGlint = 0.7;
    let last = performance.now();
    let raf = 0;
    let running = true;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      for (const p of specks) {
        p.y -= p.vy * dt;
        p.sway += dt * 0.7;
        p.ph += dt * p.tw;
        if (p.y < -12) Object.assign(p, make(true));
        const x = p.x + Math.sin(p.sway) * 7;
        // Quieter where the words are: the lower half, and the left of a
        // short card, whose words start higher.
        const calm = p.y > h * 0.5 || (x < w * 0.66 && p.y > h * 0.22) ? 0.35 : 1;
        const a = (0.15 + 0.85 * Math.pow((Math.sin(p.ph) + 1) / 2, 3)) * calm;
        ctx.globalAlpha = a * 0.55;
        const halo = p.r * (p.star ? 7 : 5);
        ctx.drawImage(glow, x - halo, p.y - halo, halo * 2, halo * 2);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#fffaf0';
        if (p.star) star(x, p.y, p.r * 3);
        else {
          ctx.beginPath();
          ctx.arc(x, p.y, p.r * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // The glint: a long-rayed star that flares and fades.
      untilGlint -= dt;
      if (untilGlint <= 0 && glint.t >= 1) {
        // Around the art, top right, never on the words.
        glint = { x: w * (0.6 + Math.random() * 0.34), y: h * (0.1 + Math.random() * 0.3), t: 0, size: 12 + Math.random() * 10 };
        untilGlint = 1.6 + Math.random() * 1.8;
      }
      if (glint.t < 1) {
        glint.t = Math.min(1, glint.t + dt / 0.9);
        const k = Math.sin(glint.t * Math.PI);
        const s = glint.size * k;
        ctx.globalAlpha = k * 0.9;
        ctx.drawImage(glow, glint.x - s * 2.2, glint.y - s * 2.2, s * 4.4, s * 4.4);
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = k;
        star(glint.x, glint.y, s, 0.08);
        ctx.save();
        ctx.translate(glint.x, glint.y);
        ctx.rotate(Math.PI / 4);
        ctx.globalAlpha = k * 0.6;
        star(0, 0, s * 0.55, 0.1);
        ctx.restore();
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (running) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Asleep in a hidden tab.
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      running = !document.hidden;
      if (running) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      watch.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [density]);

  return <canvas ref={ref} className="adc-sparkles" aria-hidden="true" />;
}
