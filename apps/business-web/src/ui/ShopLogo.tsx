import { initialsOf } from './Avatar';
import { Icon, type IconName } from './Icon';

/**
 * The shop's own logo (§217), wherever the app says "this is your business":
 * the top bar, its menu and the foot of the sidebar — filling its tile as it
 * does at the top of the sidebar, so the two look the same; a shop without
 * one gets its initials on the brand colour. A dot
 * on the corner says whether customers can see the shop.
 *
 * Also wherever a card or a notice is ABOUT the shop (§231) — "Your shop is
 * open", "Your shop is paused", "Your business was approved" — in place of a
 * plain icon, with that icon shrunk to a badge on the corner when the news
 * needs one (a pause, a tick, a cross).
 */
export function ShopLogo({
  logoUrl,
  name,
  size = 36,
  state,
  badge,
  className = '',
}: {
  logoUrl: string | null;
  name: string;
  size?: number;
  /** Live (green), off (grey), paused (amber) — or no dot. */
  state?: 'live' | 'off' | 'paused';
  /** A small icon on the corner instead of the dot: what the news is. */
  badge?: { icon: IconName; tone: string };
  className?: string;
}) {
  return (
    <span
      className={`shop-logo${logoUrl ? '' : ' is-initials'} ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), fontSize: Math.round(size * 0.36) }}
      aria-hidden="true"
    >
      {logoUrl ? <img src={logoUrl} alt="" /> : initialsOf(name)}
      {badge ? (
        <i className={`shop-logo-badge tone-${badge.tone}`} style={{ width: Math.max(18, Math.round(size * 0.42)), height: Math.max(18, Math.round(size * 0.42)) }}>
          <Icon name={badge.icon} size={Math.max(10, Math.round(size * 0.24))} stroke={2.6} />
        </i>
      ) : (
        state && <i className={`shop-logo-dot is-${state}`} />
      )}
    </span>
  );
}
