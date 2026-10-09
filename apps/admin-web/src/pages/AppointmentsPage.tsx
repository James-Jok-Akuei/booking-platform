import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useMoney } from '../money';
import {
  getAdminAppointment,
  listAdminAppointments,
  reclassifyAsBusinessCancellation,
  type AdminAppointment,
  type AdminAppointmentDetail,
  type AppointmentStatus,
} from '../api/admin';
import { BOOKING_STATUS, reservationNo } from '../lib/bookingLook';
import { ENTRY_LABEL, ENTRY_MEANING } from '../lib/ledgerWords';
import { ago, clock, minutesBetween, relativeDay, shortDay } from '../lib/time';
import { Avatar } from '../ui/Avatar';
import { Icon, type IconName } from '../ui/Icon';
import { NETWORK_NAME, NetworkMark } from '../ui/NetworkMark';
import { Panel } from '../ui/Panel';
import { ShopMark } from '../ui/ShopMark';
import { Stars } from '../ui/Stars';
import './appointments.css';

type TabKey = 'all' | 'expected' | 'in-progress' | 'unpaid' | 'done' | 'no-show' | 'cancelled';

const TABS: Array<{ key: TabKey; status?: AppointmentStatus; label: string; icon: IconName }> = [
  { key: 'all', label: 'All', icon: 'layers' },
  { key: 'expected', status: 'BOOKED', label: 'Expected', icon: 'calendarCheck' },
  { key: 'in-progress', status: 'IN_PROGRESS', label: 'In progress', icon: 'timer' },
  { key: 'unpaid', status: 'PENDING_PAYMENT', label: 'Unpaid', icon: 'hourglass' },
  { key: 'done', status: 'COMPLETED', label: 'Done', icon: 'checkCircle' },
  { key: 'no-show', status: 'NO_SHOW', label: 'No-show', icon: 'userX' },
  { key: 'cancelled', status: 'CANCELLED', label: 'Cancelled', icon: 'calendarX' },
];

/** The tabs where what happens next is still ahead: read soonest first. */
const AHEAD: TabKey[] = ['expected', 'in-progress', 'unpaid'];

const PAGE = 25;

/** Who called it off, in a few words: a booking released unpaid was not cancelled by anyone. */
const CANCELLED: Record<string, string> = {
  CUSTOMER: 'Cancelled by the customer',
  BUSINESS: 'Cancelled by the shop',
  SYSTEM_EXPIRY: 'Not paid in time',
};

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const stamp = (iso: string) => `${shortDay(iso)}, ${clock(iso)}`;

/** What the deposit came to: paid, never paid, or given back. */
function depositState(a: AdminAppointment): { note: string; tone: 'ok' | 'warn' | 'muted'; icon: IconName } {
  if (!a.depositPaid) return a.status === 'PENDING_PAYMENT' ? { note: 'Waiting to be paid', tone: 'warn', icon: 'hourglass' } : { note: 'Never paid', tone: 'muted', icon: 'minus' };
  if (a.status === 'CANCELLED' && a.cancelledBy === 'BUSINESS') return { note: 'Refunded in full', tone: 'muted', icon: 'refresh' };
  return { note: 'Deposit paid', tone: 'ok', icon: 'check' };
}

/** A line under the status: what is worth knowing at a glance. */
function standing(a: AdminAppointment, now: Date): string {
  switch (a.status) {
    case 'BOOKED': {
      const minutes = (new Date(a.startTime).getTime() - now.getTime()) / 60_000;
      if (minutes < -15) return 'Not checked in';
      if (minutes < 60) return minutes <= 0 ? 'Due now' : `In ${Math.round(minutes)} min`;
      return relativeDay(a.startTime, now) === 'Today' ? `Today ${clock(a.startTime)}` : `Booked ${ago(a.createdAt)}`;
    }
    case 'IN_PROGRESS':
      return a.verifiedAt ? `Checked in ${clock(a.verifiedAt)}${a.verificationMethod === 'MANUAL' ? ' · no code' : ''}` : 'Checked in';
    case 'COMPLETED':
      return a.reviewRating ? `Reviewed ${a.reviewRating} ★` : a.completedAt ? `Done ${ago(a.completedAt)}` : 'Done';
    case 'CANCELLED':
      return a.cancelledBy ? CANCELLED[a.cancelledBy] : 'Cancelled';
    case 'NO_SHOW':
      return 'Did not come';
    case 'PENDING_PAYMENT':
      return 'Approving on their phone';
  }
}

/**
 * Every booking on the platform (§249, §95) — the business app's work list
 * (§213), for the people who look bookings up rather than run a day.
 *
 * Search takes what people quote: the reservation number from the customer's
 * app ("0440-A141"), an email, a name, a shop, a branch or a service. Each
 * row says when, who, what and where, what the deposit came to, and where the
 * booking stands. Opening one tells its whole story — the price, how it was
 * paid and through which operator, who checked the customer in and how, who
 * cancelled and why, every line the ledger wrote for it, its review, and the
 * tickets about it — and is where a cancellation is put on the shop, the one
 * thing an administrator may change about a booking.
 */
export function AppointmentsPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.key === params.get('tab')) ?? TABS[0];
  const paidOnly = tab.key === 'cancelled' && params.get('paid') === '1';
  const openId = params.get('open');
  const q = params.get('q') ?? '';
  const [typed, setTyped] = useState(q);
  const money = useMoney();
  const now = new Date();

  const patch = (next: Record<string, string | null>) =>
    setParams(
      (was) => {
        const out = new URLSearchParams(was);
        for (const [k, v] of Object.entries(next)) {
          if (v === null || v === '') out.delete(k);
          else out.set(k, v);
        }
        return out;
      },
      { replace: true },
    );

  useEffect(() => {
    const t = setTimeout(() => {
      if (typed.trim() !== q) patch({ q: typed.trim() || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const filters = (t: (typeof TABS)[number], paid = false) => ({
    ...(t.status ? { status: t.status } : {}),
    ...(paid ? { reclassifiable: 'true' } : {}),
    ...(q ? { q } : {}),
  });

  const list = useInfiniteQuery({
    queryKey: ['admin-appointments', tab.key, paidOnly, q],
    queryFn: ({ pageParam }) =>
      listAdminAppointments({
        ...filters(tab, paidOnly),
        sort: AHEAD.includes(tab.key) ? 'soonest' : 'latest',
        limit: PAGE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, p) => sum + p.appointments.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: (previous) => previous,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.appointments) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;

  const counts = useQueries({
    queries: [
      ...TABS.map((t) => ({
        queryKey: ['admin-appointments', 'count', t.key, q],
        queryFn: () => listAdminAppointments({ ...filters(t), limit: 1 }),
        select: (page: { total: number }) => page.total,
      })),
      {
        queryKey: ['admin-appointments', 'count', 'paid-cancelled', q],
        queryFn: () => listAdminAppointments({ ...filters(TABS[6], true), limit: 1 }),
        select: (page: { total: number }) => page.total,
      },
    ],
  });
  const paidCancelled = counts[TABS.length]?.data;

  // Grouped by day, as the business app reads them.
  const groups = useMemo(() => {
    const out: Array<{ key: string; title: string; rows: AdminAppointment[] }> = [];
    for (const a of rows) {
      const key = new Date(a.startTime).toDateString();
      const last = out[out.length - 1];
      if (last?.key === key) last.rows.push(a);
      else out.push({ key, title: relativeDay(a.startTime), rows: [a] });
    }
    return out;
  }, [rows]);

  // The next page loads as the end of the list comes into view.
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
      },
      { rootMargin: '600px 0px' },
    );
    seen.observe(el);
    return () => seen.disconnect();
  }, [list]);

  return (
    <section className="ap">
      <div className="page-top ap-top">
        <header className="page-head">
          <div>
            <h1>Appointments</h1>
            <p className="muted">Every booking on the platform: find one, read what happened, and put a cancellation on the shop when it was theirs.</p>
          </div>
        </header>

        <div className="ap-card-top pin-from">
          <div className="ap-toolbar">
            <label className="ap-search">
              <Icon name="search" size={18} />
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="No. like 0440-A141, an email, a shop, a branch or a service"
                aria-label="Find a booking"
              />
              {typed && (
                <button type="button" className="ap-search-clear" onClick={() => setTyped('')} aria-label="Clear">
                  <Icon name="close" size={14} stroke={2.2} />
                </button>
              )}
            </label>
          </div>
          <div className="ap-tabs-row pin-phone">
            <div className="ap-tabs" role="tablist">
              {TABS.map((t, i) => {
                const count = counts[i]?.data;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={t.key === tab.key}
                    className={`ap-tab${t.key === tab.key ? ' is-active' : ''}`}
                    onClick={() => patch({ tab: t.key === 'all' ? null : t.key, paid: null })}
                  >
                    <Icon name={t.icon} size={16} />
                    {t.label}
                    {count !== undefined && <span className="ap-tab-count">{count.toLocaleString()}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          {tab.key === 'cancelled' && (
            <div className="ap-subfilter">
              <button
                type="button"
                className={`ap-chip${paidOnly ? ' is-on' : ''}`}
                aria-pressed={paidOnly}
                onClick={() => patch({ paid: paidOnly ? null : '1' })}
              >
                <Icon name={paidOnly ? 'check' : 'banknote'} size={14} />
                Paid, then cancelled by the customer
                {paidCancelled !== undefined && <span>{paidCancelled}</span>}
              </button>
              <span className="ap-subfilter-note">The only ones that can still be put on the shop.</span>
            </div>
          )}
          <div className="ap-cols" aria-hidden="true">
            <span>When</span>
            <span className="col-customer">Customer</span>
            <span className="col-service">Service &amp; shop</span>
            <span className="col-booking">Booking</span>
            <span>Deposit</span>
            <span>Status</span>
            <span className="col-action" />
          </div>
        </div>
      </div>

      <div className={`ap-board${list.isPlaceholderData ? ' is-refreshing' : ''}`}>
        {list.isLoading && (
          <div className="ap-skeletons" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="ap-skel-row">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            ))}
          </div>
        )}

        {list.data && rows.length === 0 && (
          <div className="ap-empty">
            <span>
              <Icon name={q ? 'search' : tab.icon} size={28} />
            </span>
            <strong>{q ? 'Nothing matches' : 'No bookings here'}</strong>
            <p>
              {q
                ? 'Try the reservation number as the customer’s app shows it (like 3F2A-1C9B), part of an email, or a shop’s name.'
                : tab.key === 'cancelled' && paidOnly
                  ? 'No customer has cancelled after paying.'
                  : 'Bookings in this state will be listed here.'}
            </p>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.key} className="ap-group">
            <h2 className="ap-group-title">
              <Icon name="calendar" size={15} />
              {group.title}
              <span>{group.rows.length}</span>
            </h2>
            {group.rows.map((a) => (
              <Row key={a.id} a={a} now={now} picked={a.id === openId} format={money.format} onOpen={() => patch({ open: a.id })} />
            ))}
          </section>
        ))}

        <div ref={end} />
        {rows.length > 0 && (
          <footer className="ap-foot">
            <span>
              Showing <strong>{rows.length.toLocaleString()}</strong> of <strong>{total.toLocaleString()}</strong>
              {q ? ' that match' : ''}
            </span>
            {list.hasNextPage && (
              <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </button>
            )}
          </footer>
        )}
      </div>

      {openId && <Detail key={openId} id={openId} onClose={() => patch({ open: null })} />}
    </section>
  );
}

function Thumb({ url, size }: { url: string | null; size: number }) {
  return (
    <span className="ap-thumb" style={{ width: size, height: size }} aria-hidden="true">
      {url ? <img src={url} alt="" loading="lazy" /> : <Icon name="scissors" size={Math.round(size * 0.42)} />}
    </span>
  );
}

function Row({
  a,
  now,
  picked,
  format,
  onOpen,
}: {
  a: AdminAppointment;
  now: Date;
  picked: boolean;
  format: (minor: number | null | undefined, code?: string | null) => string;
  onOpen: () => void;
}) {
  const look = BOOKING_STATUS[a.status];
  const deposit = depositState(a);
  const who = a.customerDisplayName || a.customerEmail;
  return (
    <article
      className={`ap-row is-${look.cls}${picked ? ' is-picked' : ''}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) onOpen();
      }}
      tabIndex={0}
      aria-label={`${who}, ${a.serviceName} at ${a.businessName ?? 'a shop'}, ${shortDay(a.startTime)} ${clock(a.startTime)}, ${look.label}. Open.`}
    >
      <div className="ap-time">
        <strong>{clock(a.startTime)}</strong>
        <span>{minutesBetween(a.startTime, a.endTime)} min</span>
      </div>

      <div className="ap-customer">
        <Avatar label={who} size={36} />
        <div className="ap-two">
          <strong title={a.customerEmail}>{who}</strong>
          <span className="ap-no" title="Booking number — the customer sees the same one in their app">
            No. {reservationNo(a.id)}
          </span>
        </div>
      </div>

      <div className="ap-service">
        <Thumb url={a.serviceImageUrl} size={44} />
        <div className="ap-two">
          <strong title={a.serviceName}>
            {a.serviceName}
            {a.quantity > 1 && <em className="ap-qty">×{a.quantity}</em>}
          </strong>
          <span className="ap-shop">
            <ShopMark name={a.businessName} logoUrl={a.businessLogoUrl} size={16} />
            <b>{a.businessName ?? 'Unnamed shop'}</b>
            <i>· {a.locationName}</i>
          </span>
          <span className="sub-customer" title={a.customerEmail}>
            {who} · No. {reservationNo(a.id)}
          </span>
        </div>
      </div>

      <div className="ap-pay">
        <strong>{format(a.depositAmountMinor, a.currency)}</strong>
        <span className={`tone-${deposit.tone}`}>
          <Icon name={deposit.icon} size={13} stroke={2.2} /> {deposit.note}
        </span>
      </div>

      <div className="ap-state" title={a.cancellationReason ?? undefined}>
        <span className={`pill ${look.cls}`}>{look.label}</span>
        <span className="ap-when">{standing(a, now)}</span>
      </div>

      <div className="ap-act">
        {a.ticketCount > 0 && (
          <span className="ap-flag" title={`${a.ticketCount} support ${a.ticketCount === 1 ? 'ticket' : 'tickets'} about it`}>
            <Icon name="help" size={14} /> {a.ticketCount}
          </span>
        )}
        <span className="ap-open">
          View <Icon name="chevronRight" size={15} />
        </span>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// One booking

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ad-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
      aria-label={`Copy ${label}`}
      title={text}
    >
      <Icon name={done ? 'check' : 'copy'} size={13} /> <span>{done ? 'Copied' : text}</span>
    </button>
  );
}

function Section({ icon, title, children, aside }: { icon: IconName; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="ad-section">
      <h4>
        <Icon name={icon} size={15} />
        {title}
        {aside && <span className="ad-section-aside">{aside}</span>}
      </h4>
      {children}
    </section>
  );
}

type Step = { label: string; when: string | null; note?: ReactNode; tone?: 'ok' | 'bad' | 'wait' };

/** The booking's story, step by step — what happened and, greyed, what has not yet. */
function stepsOf(a: AdminAppointmentDetail): Step[] {
  const steps: Step[] = [{ label: 'Booked', when: a.createdAt }];
  if (a.depositPaidAt) steps.push({ label: 'Deposit paid', when: a.depositPaidAt });
  else if (a.status === 'PENDING_PAYMENT') steps.push({ label: 'Deposit not paid yet', when: null, tone: 'wait' });
  if (a.verifiedAt)
    steps.push({
      label: a.verificationMethod === 'MANUAL' ? 'Checked in without a code' : 'Checked in with their code',
      when: a.verifiedAt,
      note: a.verifiedByEmail ? (
        <>
          by {a.verifiedByEmail}
          {a.manualVerificationNote && <em> — “{a.manualVerificationNote}”</em>}
        </>
      ) : undefined,
    });
  if (a.completedAt) steps.push({ label: 'Done', when: a.completedAt });
  if (a.noShowAt) steps.push({ label: 'Did not come', when: a.noShowAt, tone: 'bad' });
  if (a.cancelledAt)
    steps.push({
      label: a.cancelledBy === 'SYSTEM_EXPIRY' ? 'Released: the deposit was not paid in time' : a.cancelledBy ? CANCELLED[a.cancelledBy] : 'Cancelled',
      when: a.cancelledAt,
      tone: 'bad',
      note: (
        <>
          {a.cancelledByEmail && <>by {a.cancelledByEmail}</>}
          {a.cancellationReason && <em> — “{a.cancellationReason}”</em>}
        </>
      ),
    });
  if (a.status === 'BOOKED') steps.push({ label: `Expected ${shortDay(a.startTime)}, ${clock(a.startTime)}`, when: null, tone: 'wait' });
  if (a.status === 'IN_PROGRESS') steps.push({ label: 'With the shop now', when: null, tone: 'wait' });
  return steps;
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const money = useMoney();
  const one = useQuery({ queryKey: ['admin-appointment', id], queryFn: () => getAdminAppointment(id) });
  const [reclassifying, setReclassifying] = useState(false);
  const a = one.data;

  if (!a) {
    return (
      <Panel eyebrow="Booking" title={one.isError ? 'Not found' : 'Loading…'} onClose={onClose}>
        {one.isError ? (
          <p className="muted">{one.error instanceof ApiError ? one.error.message : 'This booking could not be read.'}</p>
        ) : (
          <div className="ad-skel">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        )}
      </Panel>
    );
  }

  if (reclassifying) return <Reclassify a={a} onBack={() => setReclassifying(false)} onDone={() => setReclassifying(false)} onClose={onClose} />;

  const look = BOOKING_STATUS[a.status];
  const who = a.customerDisplayName || a.customerEmail;
  const open = a.status === 'BOOKED' || a.status === 'IN_PROGRESS';
  const due = a.servicePriceMinor === null ? null : Math.max(0, a.servicePriceMinor - a.depositAmountMinor);
  const shopsCancellation = a.status === 'CANCELLED' && a.cancelledBy === 'BUSINESS';

  return (
    <Panel
      eyebrow={`A booking at ${a.businessName ?? 'a shop'}`}
      title={a.serviceName}
      onClose={onClose}
      width={760}
      footer={
        a.canReclassify ? (
          <>
            <span className="ad-foot-note">The customer cancelled after paying. If it was really the shop’s doing, they get everything back.</span>
            <button type="button" className="danger" onClick={() => setReclassifying(true)}>
              <Icon name="refresh" size={16} /> It was the shop…
            </button>
          </>
        ) : undefined
      }
    >
      <div className="ad-hero">
        <Thumb url={a.serviceImageUrl} size={64} />
        <div>
          <div className="ad-tags">
            <span className={`pill ${look.cls}`}>{look.label}</span>
            <Copy text={reservationNo(a.id)} label="the booking number" />
            {a.quantity > 1 && <span className="ad-qty">{a.quantity} people</span>}
          </div>
          <strong>
            {longDate(a.startTime)} · {clock(a.startTime)}–{clock(a.endTime)}
          </strong>
          <span>Booked {ago(a.createdAt)}</span>
        </div>
      </div>

      <div className="ad-parties">
        <div className="ad-party">
          <span className="ad-party-label">Customer</span>
          <div className="ad-party-who">
            <Avatar label={who} size={40} />
            <div>
              <strong>{a.customerDisplayName ?? 'No name given'}</strong>
              <a href={`mailto:${a.customerEmail}`}>{a.customerEmail}</a>
            </div>
          </div>
          <Link className="ad-party-link" to={`/appointments?tab=all&q=${encodeURIComponent(a.customerEmail)}`} onClick={onClose}>
            Their bookings <Icon name="arrowRight" size={13} stroke={2.2} />
          </Link>
        </div>
        <div className="ad-party">
          <span className="ad-party-label">Shop</span>
          <div className="ad-party-who">
            <ShopMark name={a.businessName} logoUrl={a.businessLogoUrl} size={40} />
            <div>
              <strong>{a.businessName ?? 'Unnamed shop'}</strong>
              <span>
                {a.locationName} · {a.locationAddress}
              </span>
              {a.shopPhone && <a href={`tel:${a.shopPhone}`}>{a.shopPhone}</a>}
            </div>
          </div>
          <Link className="ad-party-link" to={`/businesses?status=ALL&open=${a.businessId}`} onClick={onClose}>
            The shop <Icon name="arrowRight" size={13} stroke={2.2} />
          </Link>
        </div>
      </div>

      {shopsCancellation && (
        <div className="ad-banner is-ok">
          <Icon name="checkCircle" size={18} />
          <span>
            <strong>Put on the shop.</strong> The customer was refunded the whole deposit, the platform fee included.
            {a.cancellationTicketReference && (
              <>
                {' '}
                Decided on{' '}
                <Link to={`/tickets?ref=${a.cancellationTicketReference}`} onClick={onClose}>
                  {a.cancellationTicketReference}
                </Link>
                .
              </>
            )}
          </span>
        </div>
      )}

      <Section icon="banknote" title="Money">
        <dl className="ad-money">
          {a.servicePriceMinor !== null && (
            <div>
              <dt>Full price{a.discountPercent ? ` (−${a.discountPercent}%)` : ''}</dt>
              <dd>
                {a.discountPercent && a.listPriceMinor !== null && <s>{money.format(a.listPriceMinor, a.currency)}</s>}{' '}
                {money.format(a.servicePriceMinor, a.currency)}
              </dd>
            </div>
          )}
          <div className="is-strong">
            <dt>Deposit</dt>
            <dd>
              {money.format(a.depositAmountMinor, a.currency)}
              <small>{a.depositPaidAt ? `paid ${stamp(a.depositPaidAt)}` : depositState(a).note.toLowerCase()}</small>
            </dd>
          </div>
          <div>
            <dt>Platform fee</dt>
            <dd>{money.format(a.platformFeeAmountMinor, a.currency)}</dd>
          </div>
          <div>
            <dt>The shop’s share</dt>
            <dd>{money.format(a.businessAmountMinor, a.currency)}</dd>
          </div>
          {open && due !== null && (
            <div className="is-due">
              <dt>Still to pay at the shop</dt>
              <dd>{money.format(due, a.currency)}</dd>
            </div>
          )}
        </dl>

        {a.ledger.length > 0 && (
          <>
            <p className="ad-sub">
              Ledger entries for it <em>— from the business’s side: positive is owed to them, negative is owed back</em>
            </p>
            <ul className="ad-ledger">
              {a.ledger.map((line) => (
                <li key={line.id}>
                  <span title={ENTRY_MEANING[line.type]}>
                    {ENTRY_LABEL[line.type] ?? line.type}
                    <em>{stamp(line.createdAt)}</em>
                  </span>
                  {line.payoutId && <i className="ad-paid-out">paid out</i>}
                  <b className={line.amountMinor < 0 ? 'is-neg' : 'is-pos'}>{money.signed(line.amountMinor, line.currency)}</b>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {(a.paymentProvider || a.paymentProviderReferenceId) && (
        <Section icon="phone" title="Payment">
          <div className="ad-pay">
            {a.paymentProvider && <NetworkMark network={a.paymentProvider} size={40} />}
            <dl>
              {a.paymentProvider && (
                <div>
                  <dt>Paid with</dt>
                  <dd>{NETWORK_NAME[a.paymentProvider]}</dd>
                </div>
              )}
              {a.paymentProviderReferenceId && (
                <div>
                  <dt>Operator’s reference</dt>
                  <dd>
                    <Copy text={a.paymentProviderReferenceId} label="the operator's reference" />
                  </dd>
                </div>
              )}
              {a.paymentInitiatedAt && (
                <div>
                  <dt>Asked to pay</dt>
                  <dd>{stamp(a.paymentInitiatedAt)}</dd>
                </div>
              )}
              {a.providerAmountMinor !== null && a.providerCurrency && (
                <div>
                  <dt>Charged by the operator</dt>
                  <dd>
                    {money.format(a.providerAmountMinor, a.providerCurrency)}
                    {a.exchangeRateUsed !== null && a.providerCurrency !== a.currency && (
                      <small>
                        at {a.exchangeRateUsed} {a.providerCurrency} to 1 {a.currency}
                      </small>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </Section>
      )}

      <Section icon="clock" title="What happened">
        <ol className="ad-steps">
          {stepsOf(a).map((s, i) => (
            <li key={i} className={s.tone ? `is-${s.tone}` : ''}>
              <i />
              <div>
                <strong>{s.label}</strong>
                {s.when && <span>{stamp(s.when)}</span>}
                {s.note && <span className="ad-step-note">{s.note}</span>}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {a.review && (
        <Section
          icon="star"
          title="Their review"
          aside={
            <Link to={`/reviews?show=all&q=${encodeURIComponent(a.customerEmail)}`} onClick={onClose}>
              In Reviews <Icon name="arrowRight" size={13} stroke={2.2} />
            </Link>
          }
        >
          <div className={`ad-review${a.review.hiddenAt ? ' is-hidden' : ''}`}>
            <span className="ad-review-top">
              <Stars value={a.review.rating} size={15} />
              <b>{a.review.rating}.0</b>
              <em>{ago(a.review.createdAt)}</em>
              {a.review.hiddenAt && <span className="pill closed">Hidden</span>}
            </span>
            <p>{a.review.comment ?? <i>A rating, no words.</i>}</p>
          </div>
        </Section>
      )}

      {a.tickets.length > 0 && (
        <Section icon="help" title="Support tickets about it">
          <ul className="ad-tickets">
            {a.tickets.map((t) => (
              <li key={t.id}>
                <Link to={`/tickets?status=ALL&open=${t.id}`} onClick={onClose}>
                  <span className="ad-ref">{t.reference}</span>
                  <strong>{t.subject}</strong>
                  <span className={`pill tkt-${t.status === 'OPEN' ? 'open' : t.status === 'IN_PROGRESS' ? 'active' : t.status === 'RESOLVED' ? 'resolved' : 'closed'}`}>
                    {t.status === 'OPEN' ? 'New' : t.status === 'IN_PROGRESS' ? 'Being handled' : t.status === 'RESOLVED' ? 'Resolved' : 'Closed'}
                  </span>
                  <Icon name="chevronRight" size={15} />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Panel>
  );
}

/**
 * Putting a cancellation on the shop (§25, §95): the one change an
 * administrator may make to a booking, and the only action in the console that
 * pays a customer. It cannot be undone, so the consequences are spelled out in
 * money before anything else, and the decision is recorded with its reason and
 * the ticket it came from.
 */
function Reclassify({
  a,
  onBack,
  onDone,
  onClose,
}: {
  a: AdminAppointmentDetail;
  onBack: () => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const money = useMoney();
  const [reason, setReason] = useState('');
  const [ticketId, setTicketId] = useState<string>(a.tickets[0]?.id ?? '');
  const [charge, setCharge] = useState('0');
  const factor = 10 ** money.exponent;
  const chargeMinor = Math.round(Number(charge) * factor);
  const chargeValid = charge.trim() !== '' && Number.isFinite(Number(charge)) && Number(charge) >= 0 && Number.isInteger(chargeMinor);

  const run = useMutation({
    mutationFn: () =>
      reclassifyAsBusinessCancellation(a.id, {
        reason: reason.trim(),
        gatewayChargeMinor: chargeMinor,
        ...(ticketId ? { ticketId } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-appointments'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-appointment', a.id] });
      void queryClient.invalidateQueries({ queryKey: ['ledger'] });
      void queryClient.invalidateQueries({ queryKey: ['held'] });
      onDone();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim().length >= 3 && chargeValid) run.mutate();
  };

  return (
    <Panel
      eyebrow={`Booking No. ${reservationNo(a.id)}`}
      title="Put this cancellation on the shop"
      onClose={onClose}
      width={640}
      footer={
        <>
          <button type="button" onClick={onBack} disabled={run.isPending}>
            Back
          </button>
          <button type="submit" form="ad-reclassify" className="danger" disabled={run.isPending || reason.trim().length < 3 || !chargeValid}>
            {run.isPending ? 'Refunding…' : `Refund ${money.format(a.depositAmountMinor, a.currency)}`}
          </button>
        </>
      }
    >
      <div className="ad-banner is-danger">
        <Icon name="alert" size={18} />
        <span>
          <strong>This moves money, and cannot be undone.</strong> There is no way to put it back on the customer afterwards.
        </span>
      </div>

      <ul className="ad-consequences">
        <li>
          <Avatar label={a.customerDisplayName || a.customerEmail} size={30} />
          <span>
            <strong>{a.customerEmail}</strong> gets back <b>{money.format(a.depositAmountMinor, a.currency)}</b> — the whole deposit, the platform fee
            of {money.format(a.platformFeeAmountMinor, a.currency)} included.
          </span>
        </li>
        <li>
          <ShopMark name={a.businessName} logoUrl={a.businessLogoUrl} size={30} />
          <span>
            <strong>{a.businessName ?? 'The shop'}</strong> loses the {money.format(a.businessAmountMinor, a.currency)} it was owed, and carries the
            gateway fee — what the operator charges to send the refund.
          </span>
        </li>
        <li>
          <span className="ad-consequence-icon">
            <Icon name="mail" size={15} />
          </span>
          <span>Both are told, with the reason you write below.</span>
        </li>
      </ul>

      <form id="ad-reclassify" className="ad-form" onSubmit={submit}>
        <label>
          <span>What actually happened</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={500}
            autoFocus
            placeholder="The shop was closed when the customer arrived, and asked them to cancel."
          />
        </label>

        <fieldset>
          <legend>The ticket this was decided on</legend>
          <div className="ad-ticket-picks">
            {a.tickets.map((t) => (
              <label key={t.id} className={ticketId === t.id ? 'is-on' : ''}>
                <input type="radio" name="ticket" checked={ticketId === t.id} onChange={() => setTicketId(t.id)} />
                <span className="ad-ref">{t.reference}</span>
                <span>{t.subject}</span>
              </label>
            ))}
            <label className={ticketId === '' ? 'is-on' : ''}>
              <input type="radio" name="ticket" checked={ticketId === ''} onChange={() => setTicketId('')} />
              <span>{a.tickets.length === 0 ? 'No ticket was raised about it' : 'None of these'}</span>
            </label>
          </div>
          {a.tickets.length === 0 && <small>The ticket is the evidence. If someone wrote in about it, find it under Support first.</small>}
        </fieldset>

        <label>
          <span>The gateway fee: what the operator charged to send the refund</span>
          <div className="ad-amount">
            <b>{money.code || a.currency}</b>
            <input value={charge} onChange={(event) => setCharge(event.target.value)} inputMode="decimal" aria-label="The operator's charge" />
          </div>
          <small>From the operator’s statement. Write 0 if there was none — a guess here is carried by the shop.</small>
        </label>

        {run.error && (
          <p className="error small" role="alert">
            {run.error instanceof ApiError ? run.error.message : 'That did not work.'}
          </p>
        )}
      </form>
    </Panel>
  );
}
