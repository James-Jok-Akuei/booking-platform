import { initialsOf } from './Avatar';

/**
 * A shop, as a rounded tile (§244): its logo when it has one, otherwise its
 * initials on a colour made from its name — so a shop is the same colour on
 * every page of the console. Squarer than a person's avatar on purpose: a
 * shop and a person should not be mistaken for each other in a list.
 */
const TINTS: Array<[string, string]> = [
  ['#ffe8dd', '#c2410c'],
  ['#e5f6ec', '#0b7d42'],
  ['#eaf1ff', '#2456c7'],
  ['#f3e8ff', '#7e22ce'],
  ['#fff3dc', '#a16207'],
  ['#e0f2f1', '#0f766e'],
  ['#fce7f3', '#be185d'],
];

const hash = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function ShopMark({
  name,
  logoUrl,
  size = 44,
  className = '',
}: {
  name: string | null;
  logoUrl: string | null;
  size?: number;
  className?: string;
}) {
  const label = name?.trim() || 'Unnamed shop';
  const [bg, fg] = TINTS[hash(label.toLowerCase()) % TINTS.length];
  return (
    <span
      className={`shop-mark ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: logoUrl ? '#fff' : bg,
        color: fg,
        fontSize: Math.max(11, Math.round(size * 0.34)),
      }}
      aria-hidden="true"
    >
      {logoUrl ? <img src={logoUrl} alt="" loading="lazy" /> : initialsOf(label)}
    </span>
  );
}
