import { useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getGallery, listServices, type Location, type Service } from '../api/business';
import { getShopfront, getShopReviews, type Shopfront, type ShopfrontService } from '../api/discovery';
import { useMoney } from '../money';
import { LineArt } from '../onboarding/LineArt';
import { ION, type IonName } from './ionicons';
import './customer-phone.css';
import { RichText } from '../ui/RichText';
import { hasRichText, richToPlain } from '../lib/richText';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { dayName, formatDate } from '../i18n/format';
import { plural } from '@lingui/core/macro';

/**
 * "How customers see you" (§208): the customer app's shop page, drawn here at
 * its real size — a 390 × 844 phone — and scaled down to fit, so every size,
 * colour, corner and icon is the app's own (`app/shop/[id].tsx` and the
 * pieces it is built from). Change the page there, change it here.
 *
 * The branch is read from the same public address the app reads, as a
 * signed-out customer; the name, description and type being typed on the left
 * are laid over it, so the seller sees their words where they will be read
 * before saving. A shop customers cannot see right now (paused, or not yet
 * approved) is drawn from the shop's own records instead, and says so.
 */

const HERO = 300;
/** Day names in the app's language (§308), Sunday first. */
const DAYS = () => [0, 1, 2, 3, 4, 5, 6].map((day) => dayName(day));

/** Each category's picture and colours when a shop has no cover (customer app `lookFor`). */
const LOOKS: Record<string, { icon: IonName; from: string; to: string; tint: string; ink: string }> = {
  car: { icon: 'car-sport', from: '#DCE9FF', to: '#B9D2FF', tint: '#EAF1FF', ink: '#2456C7' },
  sparkles: { icon: 'sparkles', from: '#FFE1EC', to: '#FFC2D6', tint: '#FFECF2', ink: '#D03A6E' },
  'calendar-star': { icon: 'calendar', from: '#EADFFF', to: '#D2BEFF', tint: '#F2EBFF', ink: '#6B3FD4' },
  'heart-pulse': { icon: 'fitness', from: '#D8F5E6', to: '#B1E9CC', tint: '#E6F8EE', ink: '#0E8A4A' },
  'home-tools': { icon: 'hammer', from: '#FFE9CF', to: '#FFD3A0', tint: '#FFF1DF', ink: '#B5630A' },
  paw: { icon: 'paw', from: '#FFE4D6', to: '#FFC9AE', tint: '#FFEEE5', ink: '#C4501B' },
  camera: { icon: 'camera', from: '#D9F1F7', to: '#B2E1EE', tint: '#E6F6FA', ink: '#0F7C97' },
  briefcase: { icon: 'briefcase', from: '#E3E6EE', to: '#C8CEDC', tint: '#EEF0F5', ink: '#3E4A66' },
  // The kinds added in §266 have no glyph in this small icon set; their thumbnail uses the shopfront.
  utensils: { icon: 'storefront', from: '#FFECD2', to: '#FFD9A8', tint: '#FFF4E4', ink: '#B8620B' },
  ticket: { icon: 'storefront', from: '#FFF2C7', to: '#FFE08A', tint: '#FFF8DF', ink: '#9A6B00' },
  people: { icon: 'storefront', from: '#D7F5EC', to: '#B3EAD9', tint: '#E7F8F2', ink: '#0F7F63' },
  dumbbell: { icon: 'storefront', from: '#DCEFFF', to: '#B8DCFF', tint: '#EAF5FF', ink: '#1D6FB8' },
  stethoscope: { icon: 'storefront', from: '#FFE1DE', to: '#FFC4BE', tint: '#FFEDEB', ink: '#C2392B' },
  bed: { icon: 'storefront', from: '#EFE4FF', to: '#DCC8FF', tint: '#F5EEFF', ink: '#7445C9' },
  mountain: { icon: 'storefront', from: '#E0F2D6', to: '#C4E5B2', tint: '#ECF7E6', ink: '#3F7A28' },
  shirt: { icon: 'storefront', from: '#FCE1F3', to: '#F5C3E6', tint: '#FDEEF8', ink: '#B03A86' },
};
const FALLBACK_LOOK = { icon: 'storefront' as IonName, from: '#FFE6DC', to: '#FFCDB9', tint: '#FFEEE8', ink: '#F0532D' };
const lookFor = (icon: string | null | undefined) => (icon && LOOKS[icon]) || FALLBACK_LOOK;

/** The customer app's avatar tints, chosen by the letters of the name. */
const TINTS = [
  { bg: '#FFEEE8', fg: '#D7421E' },
  { bg: '#EAF1FF', fg: '#2456C7' },
  { bg: '#E6F8EE', fg: '#0E8A4A' },
  { bg: '#F2EBFF', fg: '#6B3FD4' },
  { bg: '#FFF1DF', fg: '#B5630A' },
  { bg: '#E6F6FA', fg: '#0F7C97' },
  { bg: '#FFECF2', fg: '#D03A6E' },
];
const tintFor = (name: string) => TINTS[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % TINTS.length];

/** "45 minutes", "1 hour 30 minutes" — the app's `duration(minutes, true)`. */
const duration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = plural(h, { one: '# hour', other: '# hours' });
  const mins = plural(m, { one: '# minute', other: '# minutes' });
  if (h === 0) return mins;
  if (m === 0) return hours;
  return `${hours} ${mins}`;
};

const niceDate = (ymd: string) =>
  formatDate(new Date(`${ymd}T12:00:00Z`), { weekday: 'short', day: 'numeric', month: 'short' });

function Ion({ name, size, color }: { name: IonName; size: number; color: string }) {
  return (
    <svg className="csp-ion" width={size} height={size} viewBox="0 6.5 512 512" fill={color} aria-hidden="true">
      <path d={ION[name]} />
    </svg>
  );
}

export type LiveDetails = {
  name: string;
  description: string;
  subcategory: string | null;
  categoryIcon: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
};

export function CustomerPhone({ live, locations }: { live: LiveDetails; locations: Location[] }) {
  const branches = locations.filter((l) => l.isActive);
  const [picked, setPicked] = useState<string | null>(null);
  const branch = branches.find((b) => b.id === picked) ?? branches[0] ?? null;
  const id = branch?.id ?? null;

  const shop = useQuery({
    queryKey: ['shopfront', id],
    queryFn: () => getShopfront(id!),
    enabled: Boolean(id),
    retry: false,
    staleTime: 60_000,
  });
  const reviews = useQuery({
    queryKey: ['shop-reviews', id],
    queryFn: () => getShopReviews(id!),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
  // Customers cannot see it right now — draw it from the shop's own records.
  const hidden = shop.isError;
  const services = useQuery({ queryKey: ['services'], queryFn: listServices, enabled: hidden });
  const gallery = useQuery({ queryKey: ['gallery', id], queryFn: () => getGallery(id!), enabled: hidden && Boolean(id) });

  const s: Shopfront | null = shop.data
    ? shop.data
    : hidden && branch
      ? fromOwnRecords(branch, services.data ?? [], gallery.data?.photos ?? [])
      : null;

  return (
    <div className="csp">
      {branches.length > 1 && (
        <div className="csp-branches" role="tablist" aria-label={t`Which branch`}>
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={b.id === branch?.id}
              className={b.id === branch?.id ? 'is-on' : ''}
              onClick={() => setPicked(b.id)}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}

      <div className="csp-device">
        <div className="csp-screen">
          {s ? (
            <ShopScreen key={s.id} s={s} live={live} reviewTotal={reviews.data?.total ?? 0} reviews={reviews.data?.reviews ?? []} />
          ) : (
            <div className="csp-loading">
              <span className="skeleton" style={{ height: HERO, borderRadius: 0 }} />
              <div>
                <span className="skeleton" style={{ width: '30%', height: 22 }} />
                <span className="skeleton" style={{ width: '70%', height: 26 }} />
                <span className="skeleton" style={{ width: '90%', height: 14 }} />
                <span className="skeleton" style={{ height: 54, borderRadius: 27 }} />
              </div>
            </div>
          )}
          <StatusBar />
          <i className="csp-island" />
          <i className="csp-home" />
        </div>
      </div>

      <p className="csp-note">
        {hidden ? (
          <>
            <Trans>
              <b>Customers cannot see this right now</b> — your shop is not posted yet, paused, or not yet approved. This is
              how it will look.
            </Trans>
          </>
        ) : (
          t`The real page from the app, with what you have typed. Scroll it, and try the tabs.`
        )}
      </p>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="csp-status" aria-hidden="true">
      <span>9:41</span>
      <span className="csp-status-icons">
        <Ion name="cellular" size={17} color="#15171C" />
        <Ion name="wifi" size={17} color="#15171C" />
        <Ion name="battery-full" size={25} color="#15171C" />
      </span>
    </div>
  );
}

function ShopScreen({
  s,
  live,
  reviewTotal,
  reviews,
}: {
  s: Shopfront;
  live: LiveDetails;
  reviewTotal: number;
  reviews: NonNullable<Awaited<ReturnType<typeof getShopReviews>>['reviews']>;
}) {
  const money = useMoney();
  const [tab, setTab] = useState<'services' | 'hours' | 'reviews'>('services');
  const hero = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const today = new Date().getDay();

  const displayName = live.name.trim() || s.business.name || s.name;
  const description = live.description.trim();
  const look = lookFor(live.categoryIcon);
  const cover = live.coverImageUrl;

  // The picture moves at half the speed of the page; the bar with the name
  // fades in as the title scrolls under it — as in the app.
  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const y = Math.max(0, event.currentTarget.scrollTop);
    if (hero.current) hero.current.style.transform = `translateY(${-Math.min(y, HERO) / 2}px)`;
    if (bar.current) bar.current.style.opacity = String(Math.min(1, Math.max(0, (y - (HERO - 150)) / 60)));
  };

  const tabs = [
    { value: 'services' as const, label: t`What they do` },
    { value: 'hours' as const, label: t`Open hours` },
    { value: 'reviews' as const, label: reviewTotal ? t`Reviews (${reviewTotal})` : t`Reviews` },
  ];
  const index = tabs.findIndex((t) => t.value === tab);

  return (
    <>
      <div className="csp-hero" ref={hero}>
        {/* No photo: the category's drawing on a tint of its colour, as the app draws it (§264). */}
        <div className="csp-cover" style={{ background: look.tint, color: look.ink }}>
          {!cover && <LineArt icon={live.categoryIcon} swash={false} className="csp-cover-art" />}
          {cover && <img src={cover} alt="" />}
        </div>
      </div>

      <div className="csp-scroll" onScroll={onScroll}>
        <div className="csp-sheet">
          <div className="csp-fade">
            <div className="csp-pills">
              {s.openNow ? (
                <span className="csp-pill tone-ok">
                  <Trans><i />Open now</Trans>
                </span>
              ) : (
                <span className="csp-pill tone-neutral"><Trans>Closed</Trans></span>
              )}
              {live.subcategory && <span className="csp-pill tone-accent">{live.subcategory}</span>}
              {/* The one heart for a shop (§288): customers follow it here. */}
              <span className="csp-pill tone-accent csp-follow">
                <Ion name="heart-outline" size={12} color="currentColor" />
                <Trans>Follow</Trans>
              </span>
            </div>

            <div className="csp-title-row">
              <h3 className="csp-title">{displayName}</h3>
              {live.logoUrl && <img className="csp-logo" src={live.logoUrl} alt="" />}
            </div>

            <div className="csp-line">
              <Ion name="location-outline" size={16} color="#8B909B" />
              <span className="csp-body">
                {s.name} · {s.address}
              </span>
            </div>
            {s.district && (
              <p className="csp-small csp-indent">
                {s.district.name}, {s.district.provinceName}
              </p>
            )}

            {s.rating.count > 0 && (
              <div className="csp-line csp-rating">
                <Ion name="star" size={16} color="#FFB020" />
                <b>{s.rating.average?.toFixed(1)}</b>
                <span className="csp-small"><Trans>from {s.rating.count} reviews</Trans></span>
              </div>
            )}

            {hasRichText(description) ? (
              <RichText text={description} className="csp-body csp-desc" />
            ) : (
              <p className="csp-desc csp-hint"><Trans>Your description shows here. Say what you offer and why you are worth the trip.</Trans></p>
            )}
          </div>

          <div className="csp-button csp-fade" style={{ animationDelay: '80ms' }}>
            <Ion name="chatbubble-ellipses-outline" size={18} color="#F0532D" />
            <Trans>Message the shop</Trans>
          </div>

          {s.gallery.length > 0 && (
            <div className="csp-section csp-fade" style={{ animationDelay: '120ms' }}>
              <div className="csp-gallery-head">
                <h4><Trans>Photos <span>{s.gallery.length}</span></Trans>
                </h4>
                <b><Trans>See all →</Trans></b>
              </div>
              <div className="csp-gallery">
                {s.gallery.slice(0, 6).map((photo, i) => (
                  <span key={photo.id} className="csp-photo" style={{ backgroundImage: `url(${photo.url})` }}>
                    {i === 5 && s.gallery.length > 6 && <em>+{s.gallery.length - 6}</em>}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div
            className="csp-segmented csp-fade"
            role="tablist"
            style={{ animationDelay: '160ms', '--i': index } as CSSProperties}
          >
            <i className="csp-thumb" />
            {tabs.map((t) => (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={t.value === tab}
                className={t.value === tab ? 'is-on' : ''}
                onClick={() => setTab(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'services' && (
            <div className="csp-section csp-fade" key="services">
              {s.services.length === 0 && <p className="csp-small"><Trans>Nothing is bookable here yet.</Trans></p>}
              {s.services.map((service) => (
                <ServiceRow key={service.id} service={service} categoryIcon={live.categoryIcon} format={money.format} />
              ))}
            </div>
          )}

          {tab === 'hours' && (
            <div className="csp-section csp-fade" key="hours">
              <div className="csp-card">
                {s.hours.map((h) => {
                  const isToday = h.dayOfWeek === today;
                  return (
                    <div key={h.dayOfWeek} className={`csp-hour${isToday ? ' is-today' : ''}`}>
                      <span className="csp-day">{DAYS()[h.dayOfWeek]}</span>
                      <span className={h.isClosed ? 'csp-hour-closed' : 'csp-hour-text'}>
                        {h.isClosed ? t`Closed` : `${h.openTime} – ${h.closeTime}`}
                      </span>
                    </div>
                  );
                })}
                {s.upcomingExceptions.length > 0 && (
                  <div className="csp-exceptions">
                    <p className="csp-label"><Trans>Coming up</Trans></p>
                    {s.upcomingExceptions.map((x) => (
                      <div key={x.date} className="csp-hour">
                        <span className="csp-day">{niceDate(x.date)}</span>
                        <span className={x.isClosed ? 'csp-closed-day' : 'csp-hour-text'}>
                          {x.isClosed ? t`Closed` : `${x.customOpenTime} – ${x.customCloseTime}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'reviews' && (
            <div className="csp-section csp-fade" key="reviews">
              {s.rating.count > 0 && (
                <div className="csp-card csp-summary">
                  <strong>{s.rating.average?.toFixed(1)}</strong>
                  <div>
                    <Stars rating={s.rating.average ?? 0} size={18} />
                    <span className="csp-small"><Trans>from {s.rating.count} reviews</Trans></span>
                  </div>
                </div>
              )}
              {reviews.length === 0 && <p className="csp-small"><Trans>Nobody has reviewed this place yet.</Trans></p>}
              {reviews.map((review) => {
                const tint = tintFor(review.displayName.trim() || '?');
                return (
                  <div key={review.id} className="csp-card csp-review">
                    <div className="csp-review-head">
                      <span className="csp-avatar" style={{ background: tint.bg, color: tint.fg }}>
                        {review.displayName.trim()[0]?.toUpperCase() ?? '?'}
                      </span>
                      <div>
                        <b>{review.displayName}</b>
                        <Stars rating={review.rating} size={13} />
                      </div>
                    </div>
                    {review.comment && <p className="csp-body">{review.comment}</p>}
                    {review.responseText && (
                      <div className="csp-reply">
                        <p className="csp-label"><Trans>They replied</Trans></p>
                        <p className="csp-body">{review.responseText}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="csp-bar" ref={bar}>
        <span>{displayName}</span>
      </div>

      <div className="csp-floating">
        <span className="csp-round">
          <Ion name="chevron-back" size={20} color="#15171C" />
        </span>
        <span className="csp-floating-right">
          <span className="csp-round">
            <Ion name="share-outline" size={20} color="#15171C" />
          </span>
        </span>
      </div>
    </>
  );
}

function ServiceRow({
  service,
  categoryIcon,
  format,
}: {
  service: ShopfrontService;
  categoryIcon: string | null;
  format: (minor: number | null | undefined, code?: string | null) => string;
}) {
  // Rounded the way the server does it: the deposit is a share of the price.
  const deposit = Math.round((service.priceMinor * Number(service.depositPercentage)) / 100);
  const look = lookFor(categoryIcon);
  const photo = service.images[0]?.url;
  return (
    <div className="csp-card csp-service">
      <span className="csp-thumb-box" style={{ background: `linear-gradient(135deg, ${look.from}, ${look.to})` }}>
        <Ion name={look.icon} size={24} color={look.ink} />
        {photo && <img src={photo} alt="" />}
        {service.discount && (
          <span className="csp-sale">
            <Ion name="pricetag" size={10} color="#FFFFFF" />−{service.discount.percent}%
          </span>
        )}
      </span>
      <div className="csp-service-main">
        <b className="csp-service-name">{service.name}</b>
        {hasRichText(service.description) && <p className="csp-small csp-clamp">{richToPlain(service.description)}</p>}
        <div className="csp-line">
          <Ion name="time-outline" size={13} color="#8B909B" />
          <span className="csp-small">{duration(service.durationMinutes)}</span>
        </div>
        <div className="csp-price-row">
          <span className={`csp-price${service.discount ? ' is-sale' : ''}`}>{format(service.priceMinor, service.currency)}</span>
          {service.discount && <span className="csp-was">{format(service.discount.listPriceMinor, service.currency)}</span>}
          <span className="csp-deposit"><Trans>pay {format(deposit, service.currency)} now</Trans></span>
        </div>
      </div>
      <div className="csp-service-side">
        <span className="csp-heart-small">
          <Ion name="heart-outline" size={16} color="#15171C" />
        </span>
        <span className="csp-go">
          <Ion name="arrow-forward" size={17} color="#FFFFFF" />
        </span>
      </div>
    </div>
  );
}

function Stars({ rating, size }: { rating: number; size: number }) {
  return (
    <span className="csp-stars" aria-label={t`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((v) => (
        <Ion key={v} name="star" size={size} color={v <= Math.round(rating) ? '#FFB020' : '#ECE9E3'} />
      ))}
    </span>
  );
}

/**
 * "From" this price on a card (§300.3), by the server's rule: a question that
 * must be answered and always shows, with answers at different prices — or a
 * price agreed at the shop. Null when the price is the price.
 */
function startingPrice(sv: Service, priceMinor: number): number | null {
  let lowest = 0;
  let varies = false;
  for (const g of sv.choiceGroups) {
    if (!g.required || g.showIfOptionId) continue;
    const prices = g.options.filter((o) => o.available).map((o) => o.priceMinor);
    if (prices.length === 0) continue;
    lowest += Math.min(...prices);
    if (Math.max(...prices) !== Math.min(...prices)) varies = true;
  }
  if (!varies && !sv.priceConfirmedAtShop && lowest === 0) return null;
  return Math.max(0, priceMinor + lowest);
}

const listPrice = (sv: Service, locationId: string) =>
  sv.locations.find((o) => o.locationId === locationId)?.priceMinor ?? 0;

/**
 * The page as it will be, from the shop's own records, for when the public one
 * is not there to read. Prices as the server works them out (§186): a sale's
 * price is the list price less the percentage, rounded half up.
 */
function fromOwnRecords(
  branch: Location,
  services: Service[],
  photos: Array<{ id: string; url: string; status: string; displayOrder: number }>,
): Shopfront {
  const ymd = new Date().toISOString().slice(0, 10);
  // Cheapest first by the branch's list price, as the server orders them.
  const offered: ShopfrontService[] = services
    .filter((sv) => sv.isActive)
    .sort((a, b) => listPrice(a, branch.id) - listPrice(b, branch.id))
    .flatMap((sv) => {
      const offer = sv.locations.find((o) => o.locationId === branch.id && o.isOffered);
      if (!offer) return [];
      const live = sv.discountPercent && (!sv.discountEndsOn || sv.discountEndsOn.slice(0, 10) >= ymd);
      const price = live ? Math.round((offer.priceMinor * (100 - sv.discountPercent!)) / 100) : offer.priceMinor;
      return [
        {
          id: sv.id,
          name: sv.name,
          title: sv.title,
          description: sv.description,
          instructions: sv.instructions,
          durationMinutes: sv.durationMinutes,
          currency: sv.currency,
          depositPercentage: sv.depositPercentage,
          priceMinor: price,
          discount: live
            ? {
                percent: sv.discountPercent!,
                endsOn: sv.discountEndsOn?.slice(0, 10) ?? null,
                // The preview shows no countdown; the server says when it ends (§283).
                endsAt: null,
                listPriceMinor: offer.priceMinor,
              }
            : null,
          images: sv.images,
          // What the customer answers while booking (§300), as the server sends it.
          startingPriceMinor: startingPrice(sv, price),
          choiceGroups: sv.choiceGroups,
          noteEnabled: sv.noteEnabled,
          notePrompt: sv.notePrompt ?? t`Anything the shop should know?`,
          priceConfirmedAtShop: sv.priceConfirmedAtShop,
        },
      ];
    });

  const now = new Date();
  const hours = branch.hours.find((h) => h.dayOfWeek === now.getDay());
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return {
    id: branch.id,
    name: branch.name,
    address: branch.address,
    latitude: branch.latitude,
    longitude: branch.longitude,
    phone: branch.phone,
    capacity: branch.capacity,
    business: { id: branch.businessId, name: null, description: null, phone: null, logoUrl: null, coverImageUrl: null, category: null, subcategory: null, kinds: [], followers: 0, registeredBusiness: false },
    rating: { average: branch.ratingAvg ? Number(branch.ratingAvg) : null, count: branch.ratingCount },
    services: offered,
    district: branch.district
      ? { id: branch.district.id, name: branch.district.name, provinceId: branch.district.provinceId, provinceName: branch.district.province.name }
      : null,
    hours: [...branch.hours].sort((a, b) => a.dayOfWeek - b.dayOfWeek),
    upcomingExceptions: [],
    gallery: photos
      .filter((p) => p.status === 'APPROVED')
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((p) => ({ id: p.id, url: p.url, type: 'PHOTO' as const, displayOrder: p.displayOrder })),
    openNow: Boolean(hours && !hours.isClosed && hhmm >= hours.openTime && hhmm < hours.closeTime),
    timeZone: 'Africa/Kigali',
  };
}

