import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from './Icon';
import { useInView } from './inView';
import { API_URL, CUSTOMER_APP_URL } from './links';
import { useSize } from './sheet';

/** One service as the public search returns it — only what a card shows. */
type Found = {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  depositPercentage: string;
  durationMinutes: number;
  imageUrl: string | null;
  discount: { percent: number } | null;
  location: { id: string; district: { name: string } | null; ratingAvg: number | null; ratingCount: number };
  business: {
    name: string;
    coverImageUrl: string | null;
    subcategory: { name: string } | null;
    kinds: Array<{ subcategory: { name: string }; otherLabel: string | null }>;
  };
};

const SHOWN = 6;

/** Money as the apps show it: "RWF 7,000" — whole francs, a currency's own decimals elsewhere. */
function money(minor: number, currency: string) {
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 0;
  const major = minor / 10 ** digits;
  return `${currency} ${major.toLocaleString('en', { maximumFractionDigits: digits })}`;
}

/**
 * The picture's dark "132 Ready to Import" section (§273), as this platform
 * has it: the services anyone can book right now, counted by the server, and
 * six of them — real ones, with their own photos and prices — on cards.
 *
 * The cream paper above ends in the picture's slant: down to the right, a
 * rounded corner, then steeply back up to the edge — drawn in pixels like
 * the hero's paper, so its angles stay true at any width. Left out entirely
 * when the server cannot be reached, rather than shown empty.
 */
export function Places({ onGetApp }: { onGetApp: () => void }) {
  const [page, setPage] = useState<{ total: number; services: Found[] } | null>(null);
  const ref = useRef<HTMLElement>(null);
  const seen = useInView(ref, Boolean(page));
  const { w } = useSize(ref, Boolean(page));

  useEffect(() => {
    const control = new AbortController();
    fetch(`${API_URL}/discover/services?limit=24`, { signal: control.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { total: number; services: Found[] }) => setPage(data))
      .catch(() => setPage(null));
    return () => control.abort();
  }, []);

  if (!page || page.total === 0) return null;

  const picture = (s: Found) => s.imageUrl ?? s.business.coverImageUrl;
  const cards = pick(page.services, picture);

  const open = (s: Found) => {
    if (CUSTOMER_APP_URL)
      window.location.href = `${CUSTOMER_APP_URL.replace(/\/$/, '')}/book/${s.location.id}?serviceId=${s.id}`;
    else onGetApp();
  };

  const edge = slant(w);

  return (
    <section className={`places${seen ? ' is-in' : ''}`} id="places" ref={ref} aria-labelledby="places-title">
      {edge && (
        <div className="places-paper" aria-hidden="true" style={{ height: edge.h + 30 }}>
          <i className="places-band" style={{ clipPath: `path('${edge.band}')` }} />
          <i className="places-sheet" style={{ clipPath: `path('${edge.paper}')` }} />
        </div>
      )}

      <div className="places-inner">
        <span className="places-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="40" height="40">
            <path d="M12 2.6 2.8 7.5 12 12.4l9.2-4.9z" fill="currentColor" />
            <path
              d="m3.4 11.8 8.6 4.6 8.6-4.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="m3.4 16 8.6 4.6 8.6-4.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h2 id="places-title">
          <b>{page.total}</b> services ready to <b>book</b> today.
        </h2>
        <p className="places-flow">
          Find a place <i aria-hidden="true">-&gt;</i> Pick a free time <i aria-hidden="true">-&gt;</i> Show your code
          at the door.
        </p>

        <ul className="places-grid">
          {cards.map((s, i) => {
            const photo = picture(s);
            const kind = s.business.kinds[0];
            const kindName = kind ? kind.otherLabel || kind.subcategory.name : s.business.subcategory?.name;
            const deposit = Math.round((s.priceMinor * Number(s.depositPercentage)) / 100);
            return (
              <li key={s.id} style={{ '--i': i } as CSSProperties}>
                <button
                  type="button"
                  className="place"
                  onClick={() => open(s)}
                  aria-label={`${s.name} at ${s.business.name}`}
                >
                  <span className={`place-photo${photo ? '' : ' is-empty'}`}>
                    {photo ? (
                      <img src={photo} alt="" loading="lazy" decoding="async" draggable={false} />
                    ) : (
                      <Icon name="store" size={40} stroke={1.4} />
                    )}
                  </span>
                  <span className="place-top">
                    {kindName && <span className="place-kind">{kindName}</span>}
                    {s.location.ratingCount > 0 && s.location.ratingAvg !== null && (
                      <span className="place-rating">
                        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                          <path
                            fill="currentColor"
                            d="m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2-4.6-4.4 6.3-.9z"
                          />
                        </svg>
                        {s.location.ratingAvg.toFixed(1)}
                      </span>
                    )}
                    {s.discount && <span className="place-sale">−{s.discount.percent}%</span>}
                  </span>
                  <span className="place-info">
                    <strong>{s.name}</strong>
                    <span className="place-where">
                      {s.business.name}
                      {s.location.district ? ` · ${s.location.district.name}` : ''}
                    </span>
                    <span className="place-price">
                      <b>{money(s.priceMinor, s.currency)}</b>
                      <em>{money(deposit, s.currency)} to book</em>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="places-more">
          <button type="button" className="btn" onClick={onGetApp}>
            See every place in the app <Icon name="arrowRight" size={17} stroke={2.2} />
          </button>
          <span>Prices are set by each shop. The deposit is part of the price, not extra.</span>
        </div>
      </div>
    </section>
  );
}

/**
 * The paper's foot over the dark, in pixels: its edge falls gently to the
 * right, turns on a rounded corner near the right edge, and rises steeply to
 * it — the picture's shape. A paler band fans out behind, as on the hero.
 */
function slant(w: number) {
  if (w <= 0) return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  const narrow = w < 700;
  const h = narrow ? 120 : Math.min(240, Math.max(150, w * 0.12));
  const cx = w - (narrow ? 46 : Math.min(190, w * 0.095));
  const cy = h - 6;
  const gentle = rad(narrow ? 5 : 6.5);
  const steep = rad(narrow ? 58 : 50);
  const r = narrow ? 34 : 70;
  const p = (n: number) => n.toFixed(1);

  // From the left edge along the gentle slope, round the corner, up the
  // steep side to the top (or to the right edge, if it gets there first),
  // then back along the top.
  const path = (dx: number, dy: number) => {
    const x = cx + dx;
    const y = cy + dy;
    const yLeft = y - (x + 2) * Math.tan(gentle);
    const a = { x: x - r * Math.cos(gentle), y: y - r * Math.sin(gentle) };
    const b = { x: x + r * Math.cos(steep), y: y - r * Math.sin(steep) };
    const xTop = x + y / Math.tan(steep);
    const up =
      xTop <= w + 2
        ? `L ${p(xTop)} -2 L ${p(w + 2)} -2`
        : `L ${p(w + 2)} ${p(y - (w + 2 - x) * Math.tan(steep))} L ${p(w + 2)} -2`;
    return `M -2 ${p(yLeft)} L ${p(a.x)} ${p(a.y)} Q ${p(x)} ${p(y)} ${p(b.x)} ${p(b.y)} ${up} L -2 -2 Z`;
  };

  return { h, paper: path(0, 0), band: path(narrow ? 18 : 36, narrow ? 10 : 18) };
}

/**
 * Six cards worth looking at: ones with a photo first (a card is mostly its
 * picture), one of each service — a shop's "Haircut" at two branches is one
 * card — and shops taking turns, so the grid shows the range, not one shop.
 */
function pick(services: Found[], picture: (s: Found) => string | null) {
  const seen = new Set<string>();
  const byShop = new Map<string, Found[]>();
  for (const s of [...services].sort((a, b) => Number(Boolean(picture(b))) - Number(Boolean(picture(a))))) {
    const key = `${s.business.name}|${s.name.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byShop.set(s.business.name, [...(byShop.get(s.business.name) ?? []), s]);
  }
  const turns = [...byShop.values()];
  const out: Found[] = [];
  for (let round = 0; out.length < SHOWN && turns.some((t) => t.length > round); round++) {
    for (const shop of turns) if (shop[round] && out.length < SHOWN) out.push(shop[round]);
  }
  // Photos still lead after the turns.
  return out.sort((a, b) => Number(Boolean(picture(b))) - Number(Boolean(picture(a))));
}
