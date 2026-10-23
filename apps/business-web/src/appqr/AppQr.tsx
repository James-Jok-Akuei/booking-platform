import { useMemo } from 'react';
import { DOT_RADIUS, EYE_ROUND, INK, MARK, drawQr } from './qr';

/**
 * The app QR code on the screen and on paper (§309): round dots, rounded corner
 * squares and the platform's mark in the middle. One SVG, sharp at any size.
 */
export function AppQr({ text, size, label }: { text: string; size?: number | string; label: string }) {
  const qr = useMemo(() => drawQr(text), [text]);
  const { hole } = qr;
  // The mark's white tile fills the hole with a module's breathing room.
  const tile = hole.side - 1;
  const at = hole.x + 0.5;
  return (
    <svg
      className="aq-code"
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
    >
      <rect width={qr.size} height={qr.size} fill="#ffffff" />
      <g fill={INK}>
        {qr.dots.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={DOT_RADIUS} />
        ))}
      </g>
      {qr.eyes.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width={7} height={7} rx={EYE_ROUND.outer} fill={INK} />
          <rect x={x + 1} y={y + 1} width={5} height={5} rx={EYE_ROUND.ring} fill="#ffffff" />
          <rect x={x + 2} y={y + 2} width={3} height={3} rx={EYE_ROUND.inner} fill={INK} />
        </g>
      ))}
      <g transform={`translate(${at} ${at}) scale(${tile / 136})`}>
        <rect width="136" height="136" rx="34" fill="#ffffff" stroke="#e7e2d8" strokeWidth="3" />
        <g transform="translate(20 20) scale(0.8)" fill="none" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">
          <path d={MARK.b} stroke={MARK.ink} />
          <path d={MARK.check} stroke={MARK.orange} />
        </g>
      </g>
    </svg>
  );
}
