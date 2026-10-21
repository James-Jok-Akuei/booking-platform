import { t } from '@lingui/core/macro';
/** The sun's 24 rays as one star: points alternating out and in, round its centre. */
const rays = (cx: number, cy: number, outer: number, inner: number) =>
  Array.from({ length: 48 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / 24 - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

const SUN = rays(23.6, 5, 3.3, 2.3);

/**
 * The flag of Rwanda, drawn (§233) — the customer app's (§147), here as a
 * picture the browser draws: never an emoji, which is a different picture on
 * every device and on some only the letters "RW". Official proportions, 3 by
 * 2: blue for the upper half, then yellow and green a quarter each, and the
 * golden sun in the blue towards the fly, its 24 rays as a star round a disc.
 */
export function RwandaFlag({ width = 18, className = '' }: { width?: number; className?: string }) {
  const height = Math.round((width * 2) / 3);
  return (
    <svg
      className={`rw-flag ${className}`}
      width={width}
      height={height}
      viewBox="0 0 30 20"
      role="img"
      aria-label={t`Rwanda`}
      style={{ borderRadius: Math.max(2, width / 9) }}
    >
      <rect width="30" height="10" fill="#00A1DE" />
      <rect y="10" width="30" height="5" fill="#FAD201" />
      <rect y="15" width="30" height="5" fill="#20603D" />
      <polygon points={SUN} fill="#E5BE01" />
      <circle cx="23.6" cy="5" r="1.95" fill="#00A1DE" />
      <circle cx="23.6" cy="5" r="1.6" fill="#E5BE01" />
    </svg>
  );
}
