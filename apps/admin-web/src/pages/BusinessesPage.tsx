import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useMoney } from '../money';
import {
  approveBusiness,
  getBusiness,
  listBusinesses,
  reinstateBusiness,
  rejectBusiness,
  suspendBusiness,
  type AdminBusiness,
  type AdminBusinessDetail,
  type BusinessStatus,
} from '../api/admin';
import { Avatar } from '../ui/Avatar';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { NetworkMark } from '../ui/NetworkMark';
import { Panel } from '../ui/Panel';
import { ShopMark } from '../ui/ShopMark';
import { StaticMap } from '../ui/StaticMap';
import './businesses.css';

type Tab = BusinessStatus | 'ALL';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'PENDING', label: 'Awaiting review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'ALL', label: 'All' },
];

const STATUS: Record<BusinessStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Awaiting review', cls: 'pending' },
  APPROVED: { label: 'Approved', cls: 'approved' },
  SUSPENDED: { label: 'Suspended', cls: 'suspended' },
  REJECTED: { label: 'Rejected', cls: 'rejected' },
};

const PAGE = 25;

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** "today", "yesterday", "5 days ago" — how long an application has waited. */
const sinceDay = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

const nameOf = (b: { name: string | null }) => (b.name?.trim() ? b.name : null);

/**
 * The approval desk (§244, §42, §117.2).
 *
 * The queue, oldest first, with counts on the tabs and a search that asks the
 * server; each application opens in a review panel with everything the
 * decision rests on — the shop as customers will see it, where it is on a
 * map, what it sells and for how much, who acts for it, the number it is to
 * be paid to — and a "ready to go live?" check. The decision sits at the foot
 * of that panel, beside the evidence; the row keeps quick buttons for the
 * obvious cases.
 *
 * Approving asks first: it puts the shop in front of every customer at once.
 */
export function BusinessesPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('status') as Tab | null) ?? 'PENDING';
  const openId = params.get('open');
  const [typed, setTyped] = useState(params.get('q') ?? '');
  const q = params.get('q') ?? '';
  const queryClient = useQueryClient();

  const patch = (next: Record<string, string | null>) =>
    setParams(
      (now) => {
        const out = new URLSearchParams(now);
        for (const [k, v] of Object.entries(next)) {
          if (v === null || v === '') out.delete(k);
          else out.set(k, v);
        }
        return out;
      },
      { replace: true },
    );

  // The search asks once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => {
      if (typed.trim() !== q) patch({ q: typed.trim() || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const list = useInfiniteQuery({
    queryKey: ['businesses', tab, q],
    queryFn: ({ pageParam }) =>
      listBusinesses({ ...(tab === 'ALL' ? {} : { status: tab }), ...(q ? { q } : {}), limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.businesses.length < last.total ? last.offset + PAGE : undefined),
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.businesses) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;

  // A count on every tab: one row each, read for its total.
  const counts = useQuery({
    queryKey: ['businesses', 'counts', q],
    queryFn: async () => {
      const entries = await Promise.all(
        TABS.map(async (t) => [t.value, (await listBusinesses({ ...(t.value === 'ALL' ? {} : { status: t.value }), ...(q ? { q } : {}), limit: 1 })).total] as const),
      );
      return Object.fromEntries(entries) as Record<Tab, number>;
    },
  });

  const act = useMutation({
    mutationFn: (input: { id: string; action: 'approve' | 'reinstate' | 'reject' | 'suspend'; reason?: string }) => {
      switch (input.action) {
        case 'approve':
          return approveBusiness(input.id);
        case 'reinstate':
          return reinstateBusiness(input.id);
        case 'reject':
          return rejectBusiness(input.id, input.reason!);
        case 'suspend':
          return suspendBusiness(input.id, input.reason!);
      }
    },
    // Refetch rather than patch the cache: a transition can change more than
    // the status, and the server is the only thing that knows what it wrote.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['businesses'] });
      void queryClient.invalidateQueries({ queryKey: ['business'] });
    },
  });

  const decide = useDecisions(act.mutate);

  return (
    <section className="bz">
      <div className="page-top">
        <header className="page-head bz-head">
          <div>
            <h1>Businesses</h1>
            <p className="muted">Shops waiting for approval, and every shop on the platform.</p>
          </div>
          <label className="bz-search">
            <Icon name="search" size={18} />
            <input
              type="search"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Search a name, phone or email"
              aria-label="Search businesses"
            />
          </label>
        </header>
        <div className="qtabs pin-from" role="tablist" aria-label="Show">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              className={`qtab${tab === t.value ? ' is-on' : ''}`}
              onClick={() => patch({ status: t.value === 'PENDING' ? null : t.value, open: null })}
            >
              {t.label}
              {counts.data && <span className={t.value === 'PENDING' && counts.data.PENDING > 0 ? 'is-hot' : ''}>{counts.data[t.value]}</span>}
            </button>
          ))}
        </div>
      </div>

      {act.error && (
        <p className="error q-error" role="alert">
          <Icon name="alert" size={16} />
          {act.error instanceof ApiError ? act.error.message : 'That did not work.'}
        </p>
      )}
      {list.error && (
        <p className="error q-error" role="alert">
          <Icon name="alert" size={16} />
          {list.error instanceof ApiError ? list.error.message : 'Could not load businesses.'}
        </p>
      )}

      {list.isLoading && (
        <div className="bz-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton bz-skel" />
          ))}
        </div>
      )}

      {list.data && rows.length === 0 && (
        <div className="q-empty">
          <span>
            <Icon name={q ? 'search' : tab === 'PENDING' ? 'checkCircle' : 'store'} size={26} />
          </span>
          <strong>{q ? `Nothing found for “${q}”` : tab === 'PENDING' ? 'Nobody is waiting' : 'No businesses here'}</strong>
          <p className="muted">
            {q ? 'Try part of the name, a phone number or an email.' : tab === 'PENDING' ? 'Every application has an answer. New ones appear here, oldest first.' : 'None are in this state just now.'}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="bz-list">
          {rows.map((business) => (
            <Row
              key={business.id}
              business={business}
              busy={act.isPending && act.variables?.id === business.id}
              onOpen={() => patch({ open: business.id })}
              onApprove={() => decide.approve(business)}
              onReject={() => decide.reject(business)}
            />
          ))}
        </ul>
      )}

      {list.data && rows.length > 0 && (
        <div className="q-more">
          <span className="muted small">
            {rows.length} of {total}
          </span>
          {list.hasNextPage && (
            <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </button>
          )}
        </div>
      )}

      {openId && <ReviewPanel id={openId} onClose={() => patch({ open: null })} decide={decide} busy={act.isPending} />}
    </section>
  );
}

/** The four decisions, each asked first in plain words (§242.4). */
function useDecisions(run: (input: { id: string; action: 'approve' | 'reinstate' | 'reject' | 'suspend'; reason?: string }) => void) {
  const label = (b: { name: string | null }) => nameOf(b) ?? 'this business';
  return {
    approve: async (b: { id: string; name: string | null; status: BusinessStatus }) => {
      const sure = await confirmDialog({
        title: `Approve ${label(b)}?`,
        body: (
          <p>
            Customers can find {nameOf(b) ? <strong>{nameOf(b)}</strong> : 'it'} in search and book straight away. The
            owner is told by email.
          </p>
        ),
        tone: 'ok',
        icon: 'checkCircle',
        confirmLabel: 'Approve',
        cancelLabel: 'Not yet',
      });
      if (sure) run({ id: b.id, action: 'approve' });
    },
    reinstate: async (b: { id: string; name: string | null }) => {
      const sure = await confirmDialog({
        title: `Reinstate ${label(b)}?`,
        body: <p>It comes back into search and can take bookings again; its payouts resume on the next run.</p>,
        tone: 'ok',
        icon: 'refresh',
        confirmLabel: 'Reinstate',
        cancelLabel: 'Not yet',
      });
      if (sure) run({ id: b.id, action: 'reinstate' });
    },
    reject: async (b: { id: string; name: string | null }) => {
      const reason = await promptDialog({
        title: `Reject ${label(b)}?`,
        body: <p>They are told the reason, and can fix what is wrong and apply again.</p>,
        label: 'Reason — sent to them, so write it for them to read',
        placeholder: 'For example: the photos are not of your shop.',
        minLength: 3,
        minMessage: 'A reason of at least 3 characters.',
        multiline: true,
        tone: 'danger',
        icon: 'xCircle',
        confirmLabel: 'Reject',
        cancelLabel: 'Not now',
      });
      if (reason !== null) run({ id: b.id, action: 'reject', reason: reason.trim() });
    },
    suspend: async (b: { id: string; name: string | null }) => {
      const reason = await promptDialog({
        title: `Suspend ${label(b)}?`,
        body: (
          <p>
            It disappears from search and cannot take new bookings until reinstated. Bookings already made still happen.
            They are told the reason.
          </p>
        ),
        label: 'Reason — sent to them, so write it for them to read',
        placeholder: 'For example: customers report the shop is closed.',
        minLength: 3,
        minMessage: 'A reason of at least 3 characters.',
        multiline: true,
        tone: 'danger',
        icon: 'pause',
        confirmLabel: 'Suspend',
        cancelLabel: 'Not now',
      });
      if (reason !== null) run({ id: b.id, action: 'suspend', reason: reason.trim() });
    },
  };
}

function Row({
  business,
  busy,
  onOpen,
  onApprove,
  onReject,
}: {
  business: AdminBusiness;
  busy: boolean;
  onOpen: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const name = nameOf(business);
  const look = STATUS[business.status];
  const pending = business.status === 'PENDING';
  return (
    <li className={`bz-row${pending ? ' is-pending' : ''}`}>
      <button type="button" className="bz-row-main" onClick={onOpen} aria-label={`Review ${name ?? 'this business'}`}>
        <ShopMark name={name} logoUrl={business.logoUrl} size={48} />
        <span className="bz-row-text">
          <strong>{name ?? <em className="muted">No name yet</em>}</strong>
          <span>
            {business.category?.name ?? 'No category'}
            {business.subcategory ? ` · ${business.subcategory.name}` : ''}
          </span>
          {business.statusReason && business.status !== 'APPROVED' && <span className="bz-row-reason">“{business.statusReason}”</span>}
          <span className={`pill ${look.cls}`}>{look.label}</span>
        </span>
      </button>
      <span className="bz-row-when">
        <strong>{day(business.createdAt)}</strong>
        <span>{pending ? `Waiting since ${sinceDay(business.createdAt)}` : `Applied ${sinceDay(business.createdAt)}`}</span>
      </span>
      <span className="bz-row-status">
        <span className={`pill ${look.cls}`}>{look.label}</span>
      </span>
      <span className="bz-row-actions">
        {pending && (
          <>
            <button type="button" className="danger" disabled={busy} onClick={onReject}>
              Reject
            </button>
            <button type="button" className="primary" disabled={busy || !name} onClick={onApprove} title={name ? undefined : 'Needs a name first'}>
              Approve
            </button>
          </>
        )}
        <button type="button" className="bz-review" onClick={onOpen}>
          {pending ? 'Review' : 'Open'}
          <Icon name="arrowRight" size={16} stroke={2.2} />
        </button>
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The review panel

type Check = { ok: boolean; label: string; hint: string };

/** What an approval puts in front of customers, checked (§244). Advice, not a gate — except the name (§53). */
function readiness(b: AdminBusinessDetail): Check[] {
  const open = b.locations.filter((l) => l.isActive);
  const services = b.services.filter((s) => s.isActive);
  const destination = b.payoutDestinations[0];
  return [
    { ok: Boolean(nameOf(b)), label: 'A name', hint: 'Required — an approved blank would go straight into search.' },
    { ok: Boolean(b.description?.trim()), label: 'A description', hint: 'Shown on the shop page; worth asking for.' },
    { ok: Boolean(b.logoUrl), label: 'A logo', hint: 'Customers see initials until there is one.' },
    { ok: open.length > 0, label: 'An open branch', hint: 'Nothing is bookable without one.' },
    { ok: open.some((l) => l.latitude !== null), label: 'A branch on the map', hint: 'Customers nearby find it by its pin.' },
    {
      ok: services.some((s) => s.locations.length > 0),
      label: 'A service with a price',
      hint: 'Otherwise there is nothing to book.',
    },
    {
      ok: destination?.status === 'VERIFIED',
      label: destination ? (destination.status === 'VERIFIED' ? 'A checked payout number' : 'A payout number, not yet checked') : 'A payout number',
      hint: destination ? 'Check it under Payout numbers before money is owed.' : 'They can book without one; they cannot be paid.',
    },
  ];
}

function ReviewPanel({
  id,
  onClose,
  decide,
  busy,
}: {
  id: string;
  onClose: () => void;
  decide: ReturnType<typeof useDecisions>;
  busy: boolean;
}) {
  const money = useMoney();
  const business = useQuery({ queryKey: ['business', id], queryFn: () => getBusiness(id) });
  const b = business.data;
  const name = b ? nameOf(b) : null;

  const footer = b ? (
    <>
      {b.status === 'PENDING' && (
        <>
          <button type="button" className="danger" disabled={busy} onClick={() => decide.reject(b)}>
            <Icon name="xCircle" size={17} />
            Reject
          </button>
          <button type="button" className="primary" disabled={busy || !name} onClick={() => decide.approve(b)}>
            <Icon name="checkCircle" size={17} />
            {name ? 'Approve' : 'Needs a name first'}
          </button>
        </>
      )}
      {b.status === 'APPROVED' && (
        <button type="button" className="danger" disabled={busy} onClick={() => decide.suspend(b)}>
          <Icon name="pause" size={17} />
          Suspend
        </button>
      )}
      {b.status === 'SUSPENDED' && (
        <button type="button" className="primary" disabled={busy || !name} onClick={() => decide.reinstate(b)}>
          <Icon name="refresh" size={17} />
          Reinstate
        </button>
      )}
      {b.status === 'REJECTED' && (
        // The appeal path (§42): a rejected shop that fixed things can be approved.
        <button type="button" className="primary" disabled={busy || !name} onClick={() => decide.approve(b)}>
          <Icon name="checkCircle" size={17} />
          Approve after all
        </button>
      )}
    </>
  ) : undefined;

  return (
    <Panel
      eyebrow={b ? STATUS[b.status].label : 'Application'}
      title={b ? name ?? 'No name yet' : 'Loading…'}
      onClose={onClose}
      footer={footer}
      width={760}
    >
      {business.isLoading && (
        <div className="bz-panel-skel">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}
      {business.error && (
        <p className="error" role="alert">
          {business.error instanceof ApiError ? business.error.message : 'Could not load this business.'}
        </p>
      )}
      {b && (
        <div className="bz-review-body">
          {/* The shop as a customer will meet it. */}
          <div className="bz-hero" style={b.coverImageUrl ? { backgroundImage: `url(${b.coverImageUrl})` } : undefined}>
            {!b.coverImageUrl && <span className="bz-hero-empty">No cover photo</span>}
          </div>
          <div className="bz-ident">
            <ShopMark name={name} logoUrl={b.logoUrl} size={76} className="bz-ident-logo" />
            <div>
              <h3>{name ?? 'No name yet'}</h3>
              <p>
                {b.category?.name ?? 'No category'}
                {b.subcategory ? ` · ${b.subcategory.name}` : ''}
              </p>
              <p className="muted small">
                Applied {day(b.createdAt)} ({sinceDay(b.createdAt)}){b.phone ? ` · ${b.phone}` : ''}
              </p>
            </div>
          </div>

          {b.statusReason && b.status !== 'APPROVED' && (
            <div className={`bz-reason tone-${b.status === 'PENDING' ? 'warn' : 'danger'}`}>
              <Icon name="alert" size={17} />
              <span>
                <strong>Why it is {STATUS[b.status].label.toLowerCase()}</strong>
                {b.statusReason}
                <em>{day(b.statusChangedAt)}</em>
              </span>
            </div>
          )}

          <Section icon="checkCircle" title="Ready to go live?">
            <ul className="bz-checks">
              {readiness(b).map((c) => (
                <li key={c.label} className={c.ok ? 'is-ok' : 'is-missing'}>
                  <Icon name={c.ok ? 'checkCircle' : 'alert'} size={17} />
                  <span>
                    <strong>{c.label}</strong>
                    {!c.ok && <em>{c.hint}</em>}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section icon="info" title="About">
            {b.description?.trim() ? (
              <p className="bz-about">{b.description}</p>
            ) : (
              <p className="muted">No description. Customers see this on the shop page.</p>
            )}
          </Section>

          <Section icon="pin" title={`Branches · ${b.locations.length}`}>
            {b.locations.length === 0 ? (
              <p className="muted">None. Nothing is bookable until they add one.</p>
            ) : (
              <div className="bz-branches">
                {b.locations.map((l) => (
                  <article key={l.id} className={`bz-branch${l.isActive ? '' : ' is-closed'}`}>
                    <div className="bz-branch-map">
                      {l.latitude !== null && l.longitude !== null ? (
                        <StaticMap latitude={l.latitude} longitude={l.longitude} />
                      ) : (
                        <span className="bz-branch-nomap">
                          <Icon name="pin" size={22} />
                          No pin on the map yet
                        </span>
                      )}
                    </div>
                    <div className="bz-branch-text">
                      <strong>
                        {l.name}
                        {!l.isActive && <span className="pill">Closed</span>}
                      </strong>
                      <span>{l.address}</span>
                      <span className="muted small">
                        {l.district ? `${l.district.name}, ${l.district.province.name}` : 'No district'} · {l.capacity} at a time
                      </span>
                    </div>
                    {l.media.length > 0 && (
                      <div className="bz-photos">
                        {l.media.map((m) => (
                          <img key={m.url} src={m.url} alt="" loading="lazy" />
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </Section>

          <Section icon="tag" title={`Services · ${b.services.length}`}>
            {b.services.length === 0 ? (
              <p className="muted">None yet. There is nothing for a customer to book.</p>
            ) : (
              <ul className="bz-services">
                {b.services.map((s) => (
                  <li key={s.id} className={s.isActive ? '' : 'is-paused'}>
                    <span className="bz-service-thumb">
                      {s.images[0] ? <img src={s.images[0].url} alt="" loading="lazy" /> : <Icon name="tag" size={18} />}
                    </span>
                    <span className="bz-service-text">
                      <strong>
                        {s.name}
                        {!s.isActive && <span className="pill">Paused</span>}
                      </strong>
                      <span className="muted small">
                        {s.durationMinutes} min · {s.depositPercentage}% deposit
                      </span>
                      {/* Per branch, since §72 made price a property of where it is offered. */}
                      <span className="bz-prices">
                        {s.locations.length === 0
                          ? 'Not offered at any branch'
                          : s.locations.map((at) => (
                              <span key={at.location.id}>
                                {at.location.name} <b>{money.format(at.priceMinor)}</b>
                              </span>
                            ))}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="bz-two">
            <Section icon="users" title={`People · ${b.members.length}`}>
              <ul className="bz-people">
                {b.members.map((m) => (
                  <li key={m.id}>
                    <Avatar label={m.user.email} size={34} />
                    <span>
                      <strong>{m.user.email}</strong>
                      <em>{m.role.charAt(0) + m.role.slice(1).toLowerCase()}</em>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
            <Section icon="wallet" title="Paid to">
              {b.payoutDestinations[0] ? (
                <div className="bz-payto">
                  <NetworkMark network={b.payoutDestinations[0].provider === 'AIRTEL_MONEY' ? 'AIRTEL_MONEY' : 'MTN_MOMO'} size={36} />
                  <span>
                    <strong>{b.payoutDestinations[0].msisdn}</strong>
                    <span className={`pill ${b.payoutDestinations[0].status === 'VERIFIED' ? 'verified' : b.payoutDestinations[0].status === 'REJECTED' ? 'rejected' : 'unverified'}`}>
                      {b.payoutDestinations[0].status === 'VERIFIED' ? 'Checked' : b.payoutDestinations[0].status === 'REJECTED' ? 'Refused' : 'Not checked yet'}
                    </span>
                  </span>
                </div>
              ) : (
                <p className="muted">No payout number yet.</p>
              )}
            </Section>
          </div>
        </div>
      )}
    </Panel>
  );
}

function Section({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <section className="bz-section">
      <h4>
        <Icon name={icon} size={16} />
        {title}
      </h4>
      {children}
    </section>
  );
}
