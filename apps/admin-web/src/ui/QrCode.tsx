import { useMemo } from 'react';
import { toQR } from 'toqr';

/**
 * A QR code, drawn as one SVG path (§298) — for an authenticator app to scan.
 * Made in the browser: the secret it holds never travels inside an image
 * from anywhere else.
 */
export function QrCode({ text, size = 196, label }: { text: string; size?: number; label: string }) {
  const { n, d } = useMemo(() => {
    const modules = toQR(text);
    const side = Math.round(Math.sqrt(modules.length));
    let path = '';
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        if (modules[y * side + x]) path += `M${x + 4} ${y + 4}h1v1h-1z`;
      }
    }
    return { n: side, d: path };
  }, [text]);

  return (
    <svg viewBox={`0 0 ${n + 8} ${n + 8}`} width={size} height={size} shapeRendering="crispEdges" role="img" aria-label={label}>
      <rect width={n + 8} height={n + 8} fill="#ffffff" />
      <path d={d} fill="#1f2a1f" />
    </svg>
  );
}
