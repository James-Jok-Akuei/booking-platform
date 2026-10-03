import { Share } from 'react-native';

/**
 * Where a shared link points.
 *
 * There is no public website yet, so there is nothing honest to link to by
 * default. Rather than invent a URL that 404s, a share carries the information
 * itself — the name, where it is, what it costs — and gains a link the day
 * `EXPO_PUBLIC_SHARE_BASE_URL` names a real one (§121.2).
 *
 * A message that is useful with no link beats a link that goes nowhere: somebody
 * forwarding a shop to a friend over WhatsApp is passing on an address, and an
 * address works whether or not the recipient has the app.
 */
const BASE_URL = process.env.EXPO_PUBLIC_SHARE_BASE_URL?.replace(/\/+$/, '');

const linkFor = (path: string) => (BASE_URL ? `\n\n${BASE_URL}${path}` : '');

/** Passes a shop to somebody, with enough to find it even without a link. */
export async function shareShop(shop: {
  id: string;
  name: string;
  address: string;
  businessName?: string | null;
  districtName?: string | null;
  fromPrice?: string | null;
}) {
  const where = shop.districtName ? `${shop.districtName} — ${shop.address}` : shop.address;
  const price = shop.fromPrice ? `\nFrom ${shop.fromPrice}.` : '';
  await Share.share({
    message:
      `${shop.businessName ?? shop.name}\n${where}${price}` +
      linkFor(`/shop/${shop.id}`),
  });
}

/** Passes the app itself on. */
export async function shareApp() {
  await Share.share({
    message:
      'Book appointments with shops near you — see prices and free times before ' +
      'you go, and pay the deposit from your phone.' + linkFor('/'),
  });
}
