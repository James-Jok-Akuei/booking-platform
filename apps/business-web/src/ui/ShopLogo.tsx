import { initialsOf } from './Avatar';

/**
 * The shop's own logo (§217), wherever the app says "this is your business":
 * the top bar, its menu and the foot of the sidebar — filling its tile as it
 * does at the top of the sidebar, so the two look the same; a shop without
 * one gets its initials on the brand colour. A dot
 * on the corner says whether customers can see the shop.
 */
export function ShopLogo({
  logoUrl,
  name,
  size = 36,
  state,
  className = '',
}: {
  logoUrl: string | null;
  name: string;
  size?: number;
  /** Live (green), off (grey) — or no dot. */
  state?: 'live' | 'off';
  className?: string;
}) {
  return (
    <span
      className={`shop-logo${logoUrl ? '' : ' is-initials'} ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {logoUrl ? <img src={logoUrl} alt="" /> : initialsOf(name)}
      {state && <i className={`shop-logo-dot is-${state}`} />}
    </span>
  );
}
