import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useMoney } from '../money';
import {
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
import { ShopActPanel, ShopSupportSection, type ShopAct } from './ShopSupport';
import { AdviceSent, ApprovePanel } from './ApproveShop';
import './businesses.css';
import { WriteFirst } from '../components/WriteFirst';
import { RichText } from '../ui/RichText';
import { hasRichText } from '../lib/richText';
import { EmptyState } from '../ui/EmptyState';

type Tab = 'WAITING' | 'SETTING_UP' | 'APPROVED' | 'SUSPENDED' | 'REJECTED' | 'ALL';

/**
 * A PENDING shop is one of two things (§255): one that has sent itself for
 * review and waits on us, and one still setting up, which waits on nobody. The
 * queue is the first; the second has its own tab, so the count that matters
 * is not inflated by sign-ups that stopped half way.
 */
const TABS: Array<{ value: Tab; label: string; query: { status?: BusinessStatus; submitted?: 'true' | 'false' } }> = [
  { value: 'WAITING', label: 'Awaiting review', query: { status: 'PENDING', submitted: 'true' } },
  { value: 'SETTING_UP', label: 'Setting up', query: { status: 'PENDING', submitted: 'false' } },
  { value: 'APPROVED', label: 'Approved', query: { status: 'APPROVED' } },
  { value: 'SUSPENDED', label: 'Suspended', query: { status: 'SUSPENDED' } },
  { value: 'REJECTED', label: 'Rejected', query: { status: 'REJECTED' } },
  { value: 'ALL', label: 'All', query: {} },
];

const STATUS: Record<BusinessStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Awaiting review', cls: 'pending' },
  APPROVED: { label: 'Approved', cls: 'approved' },
  SUSPENDED: { label: 'Suspended', cls: 'suspended' },
  REJECTED: { label: 'Rejected', cls: 'rejected' },
};

/**
 * A shop's state as a word, telling the two kinds of PENDING apart (§255),
 * and an approved shop that has not posted itself yet — not in the app (§268).
 */
const lookOf = (b: { status: BusinessStatus; submittedAt: string | null; publishedAt: string | null }) =>
  b.status === 'PENDING' && !b.submittedAt
    ? { label: 'Setting up', cls: 'setting-up' }
    : b.status === 'APPROVED' && !b.publishedAt
      ? { label: 'Approved · not posted', cls: 'unposted' }
      : STATUS[b.status];

/** Old links say `status=PENDING`; that was always the queue. */
const tabFrom = (raw: string | null): Tab =>
  raw === null || raw === 'PENDING' ? 'WAITING' : TABS.some((t) => t.value === raw) ? (raw as Tab) : 'WAITING';

const PAGE = 25;

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** "today", "yesterday", "5 days ago" — how long an application has waited. */
const sinceDay = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

const nameOf = (b: { name: string | null }) => (b.name?.trim() ? b.name : null);

type Kind = { category: { name: string }; subcategory: { name: string }; otherLabel: string | null };
type Kinded = {
  category: { name: string } | null;
  subcategory: { name: string } | null;
  kinds: Kind[];
};

/** A kind as customers read it: what the shop wrote under "Other" (§267), in quotes, else the type. */
const kindWords = (k: Kind) => (k.otherLabel ? `“${k.otherLabel}”` : k.subcategory.name);

/** Its main kind, and how many more it lists (§265). */
const kindLine = (b: Kinded) => {
  const first = b.kinds[0];
  const main = first
    ? `${first.category.name} · ${kindWords(first)}`
    : b.category
      ? `${b.category.name}${b.subcategory ? ` · ${b.subcategory.name}` : ''}`
      : 'No category';
  const more = Math.max(0, b.kinds.length - 1);
  return more ? `${main} + ${more} more` : main;
};

/** Every kind it lists, the main one first (§265); a write-in is marked as the shop's own words (§267). */
const allKinds = (b: Kinded) =>
  b.kinds.length > 1 || b.kinds.some((k) => k.otherLabel)
    ? b.kinds.map((k) => (k.otherLabel ? `${kindWords(k)} (written in under ${k.category.name} · Other)` : `${k.subcategory.name} (${k.category.name})`)).join(', ')
    : kindLine(b);

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
 * Approving opens its own step (§303): the things that would make the shop
 * easier to book and are not in yet, ticked, to send as advice with a note —
 * and a preview of what the shop will read.
 */
export function BusinessesPage() {
  const [params, setParams] = useSearchParams();
  const tab = tabFrom(params.get('status'));
  const query = TABS.find((t) => t.value === tab)!.query;
  const openId = params.get('open');
  // Approving is a step of its own in the panel (§303), reachable from a row too.
  const approving = params.get('step') === 'approve';
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
    queryFn: ({ pageParam }) => listBusinesses({ ...query, ...(q ? { q } : {}), limit: PAGE, offset: pageParam }),
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
        TABS.map(async (t) => [t.value, (await listBusinesses({ ...t.query, ...(q ? { q } : {}), limit: 1 })).total] as const),
      );
      return Object.fromEntries(entries) as Record<Tab, number>;
    },
  });

  const act = useMutation({
    mutationFn: (input: { id: string; action: 'reinstate' | 'reject' | 'suspend'; reason?: string }) => {
      switch (input.action) {
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
              onClick={() => patch({ status: t.value === 'WAITING' ? null : t.value, open: null })}
            >
              {t.label}
              {counts.data && <span className={t.value === 'WAITING' && counts.data.WAITING > 0 ? 'is-hot' : ''}>{counts.data[t.value]}</span>}
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
        <EmptyState
          framed
          size="card"
          className="is-list"
          art={q ? 'search' : tab === 'WAITING' ? 'clear' : 'box'}
          title={q ? `Nothing found for “${q}”` : tab === 'WAITING' ? 'Nobody is waiting' : tab === 'SETTING_UP' ? 'Nobody is setting up' : 'No businesses here'}
          text={
            q
              ? 'Try part of the name, a phone number or an email.'
              : tab === 'WAITING'
                ? 'Every shop that asked has an answer. New ones appear here, oldest first, and you are told when one arrives.'
                : tab === 'SETTING_UP'
                  ? 'Shops that signed up and have not sent themselves for review yet appear here.'
                  : 'None are in this state just now.'
          }
        />
      )}

      {rows.length > 0 && (
        <ul className="bz-list">
          {rows.map((business) => (
            <Row
              key={business.id}
              business={business}
              busy={act.isPending && act.variables?.id === business.id}
              onOpen={() => patch({ open: business.id })}
              onApprove={() => patch({ open: business.id, step: 'approve' })}
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

      {openId && (
        <ReviewPanel
          id={openId}
          onClose={() => patch({ open: null, step: null })}
          decide={decide}
          busy={act.isPending}
          approving={approving}
          onApproving={(on) => patch({ step: on ? 'approve' : null })}
        />
      )}
    </section>
  );
}

/**
 * The other three decisions, each asked first in plain words (§242.4).
 * Approving has its own step, with advice (§303, `ApproveShop.tsx`).
 */
function useDecisions(run: (input: { id: string; action: 'reinstate' | 'reject' | 'suspend'; reason?: string }) => void) {
  const label = (b: { name: string | null }) => nameOf(b) ?? 'this business';
  return {
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
  const look = lookOf(business);
  // Only a shop that asked is waiting on us; one still setting up is not (§255).
  const pending = business.status === 'PENDING' && business.submittedAt !== null;
  const settingUp = business.status === 'PENDING' && business.submittedAt === null;
  return (
    <li className={`bz-row${pending ? ' is-pending' : ''}`}>
      <button type="button" className="bz-row-main" onClick={onOpen} aria-label={`Review ${name ?? 'this business'}`}>
        <ShopMark name={name} logoUrl={business.logoUrl} size={48} />
        <span className="bz-row-text">
          <strong>{name ?? <em className="muted">No name yet</em>}</strong>
          <span>
            {kindLine(business)}
          </span>
          {business.statusReason && business.status !== 'APPROVED' && <span className="bz-row-reason">“{business.statusReason}”</span>}
          {pending && business.lastRejectionReason && (
            <span className="bz-row-back">
              <Icon name="refresh" size={13} /> Sent back after a rejection
            </span>
          )}
          <span className={`pill ${look.cls}`}>{look.label}</span>
        </span>
      </button>
      <span className="bz-row-when">
        <strong>{day(pending ? business.submittedAt : business.createdAt)}</strong>
        <span>
          {pending
            ? `Waiting since ${sinceDay(business.submittedAt!)}`
            : settingUp
              ? `Signed up ${sinceDay(business.createdAt)}`
              : `Applied ${sinceDay(business.createdAt)}`}
        </span>
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

type Check = { key: string; ok: boolean; label: string; hint: string; gate?: boolean };

type ReadinessKey = AdminBusinessDetail['readiness']['items'][number]['key'];

/** The shop's own checklist (§255), in the reviewer's words. */
const CHECK_WORDS: Record<ReadinessKey, { label: string; hint: string }> = {
  name: { label: 'A name', hint: 'An approved blank would go straight into search.' },
  type: { label: 'What kind of shop', hint: 'Customers browse by type; it is missing from every list until it has one.' },
  phone: { label: 'A phone number', hint: 'How customers — and we — reach them.' },
  branch: { label: 'A branch on the map, with its district', hint: 'Customers nearby find it by its pin and its area.' },
  hours: { label: 'Opening hours', hint: 'No time can be booked without them.' },
  service: { label: 'A service offered at an open branch', hint: 'Otherwise there is nothing to book.' },
  logo: { label: 'A logo', hint: 'Customers see initials until there is one.' },
  payout: { label: 'A payout number', hint: 'They can take bookings without one; they cannot be paid.' },
};

/** What approval itself needs (§255) — less than the shop's checklist: any open branch, pinned or not. */
const GATE_WORDS: Partial<Record<ReadinessKey, string>> = {
  name: 'a name',
  branch: 'an open branch',
  hours: 'opening hours at a branch',
  service: 'a service offered at an open branch',
};

const inWords = (words: string[]) =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/**
 * What an approval puts in front of customers, checked (§244) — from the same
 * checklist the shop worked through (§255). The ones it cannot go live
 * without (`goLiveGaps`) are a gate: the server refuses, so the button does
 * too. The rest are advice.
 */
function checksOf(b: AdminBusinessDetail): Check[] {
  const gaps = new Set(b.readiness.goLiveGaps);
  const destination = b.payoutDestinations[0];
  const items: Check[] = b.readiness.items.map((item) => ({
    key: item.key,
    ok: item.done,
    gate: gaps.has(item.key),
    ...CHECK_WORDS[item.key],
  }));
  // The payout number: whether it has been checked matters to us, not to the shop.
  const payout = items.find((i) => i.key === 'payout');
  if (payout && destination) {
    payout.ok = destination.status === 'VERIFIED';
    payout.label = destination.status === 'VERIFIED' ? 'A checked payout number' : 'A payout number, not yet checked';
    payout.hint = 'Check it under Payout numbers before money is owed.';
  }
  items.push({
    key: 'description',
    ok: Boolean(b.description?.trim()),
    label: 'A description',
    hint: 'Shown on the shop page; worth asking for.',
  });
  return items;
}

function ReviewPanel({
  id,
  onClose,
  decide,
  busy,
  approving,
  onApproving,
}: {
  id: string;
  onClose: () => void;
  decide: ReturnType<typeof useDecisions>;
  busy: boolean;
  /** On the approval step (§303). */
  approving: boolean;
  onApproving: (on: boolean) => void;
}) {
  const money = useMoney();
  const business = useQuery({ queryKey: ['business', id], queryFn: () => getBusiness(id) });
  const [act, setAct] = useState<ShopAct | null>(null);
  const b = business.data;
  const name = b ? nameOf(b) : null;
  // What the server would refuse an approval for (§255): a shop no customer could book.
  const blocked = b ? b.readiness.goLiveGaps.length > 0 : true;

  const footer = b ? (
    <>
      {b.status === 'PENDING' && (
        <>
          <button type="button" className="danger" disabled={busy} onClick={() => decide.reject(b)}>
            <Icon name="xCircle" size={17} />
            Reject
          </button>
          <button type="button" className="primary" disabled={busy || blocked} onClick={() => onApproving(true)}>
            <Icon name="checkCircle" size={17} />
            {blocked ? 'Cannot go live yet' : 'Approve'}
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
        <button type="button" className="primary" disabled={busy || blocked} onClick={() => decide.reinstate(b)}>
          <Icon name="refresh" size={17} />
          Reinstate
        </button>
      )}
      {b.status === 'REJECTED' && (
        // The appeal path (§42): a rejected shop that fixed things can be approved.
        <button type="button" className="primary" disabled={busy || blocked} onClick={() => onApproving(true)}>
          <Icon name="checkCircle" size={17} />
          Approve after all
        </button>
      )}
    </>
  ) : undefined;

  if (b && act)
    return <ShopActPanel businessId={b.id} shopName={name ?? 'A shop'} act={act} onBack={() => setAct(null)} onClose={onClose} />;
  // Only a shop waiting on a decision, and one that could go live (§255).
  if (b && approving && !blocked && (b.status === 'PENDING' || b.status === 'REJECTED'))
    return <ApprovePanel business={b} shopName={name ?? 'A shop'} onBack={() => onApproving(false)} onClose={onClose} />;

  return (
    <Panel
      eyebrow={b ? lookOf(b).label : 'Application'}
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
                {allKinds(b)}
              </p>
              <p className="muted small">
                {b.submittedAt && b.status === 'PENDING'
                  ? `Sent for review ${day(b.submittedAt)} (${sinceDay(b.submittedAt)})`
                  : b.status === 'PENDING'
                    ? `Signed up ${day(b.createdAt)} — not sent for review yet`
                    : b.status === 'APPROVED' && !b.publishedAt
                      ? `Approved ${day(b.statusChangedAt)} — not posted by the shop yet, so customers cannot see it`
                      : `Applied ${day(b.createdAt)} (${sinceDay(b.createdAt)})`}
                {b.phone ? ` · ${b.phone}` : ''}
              </p>
            </div>
          </div>

          {/* Writing first to the owner (§287): a support conversation they can answer. */}
          <WriteFirst businessId={b.id} who="the owner" />

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

          {/* Sent back after a rejection (§255): what was asked last time, to check it was done. */}
          {b.status === 'PENDING' && b.lastRejectionReason && (
            <div className="bz-reason tone-ask">
              <Icon name="refresh" size={17} />
              <span>
                <strong>Sent back after a rejection — last time we said</strong>
                {b.lastRejectionReason}
              </span>
            </div>
          )}

          <Section icon="checkCircle" title="Ready to go live?">
            {blocked && (
              <p className="bz-gate">
                <Icon name="lock" size={15} />
                It cannot be approved until it has {inWords(b.readiness.goLiveGaps.map((k) => GATE_WORDS[k] ?? k))} —
                customers would find a shop they cannot book.
              </p>
            )}
            <ul className="bz-checks">
              {checksOf(b).map((c) => (
                <li key={c.key} className={c.ok ? 'is-ok' : c.gate ? 'is-gate' : 'is-missing'}>
                  <Icon name={c.ok ? 'checkCircle' : c.gate ? 'lock' : 'alert'} size={17} />
                  <span>
                    <strong>{c.label}</strong>
                    {!c.ok && (
                      <em>{c.gate ? `Approval needs ${GATE_WORDS[c.key as ReadinessKey]}. ${c.hint}` : c.hint}</em>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          {b.readiness.approvalAdvice && b.status === 'APPROVED' && (
            <Section icon="mail" title="Advice sent with the approval">
              <AdviceSent business={b} />
            </Section>
          )}

          <Section icon="info" title="About">
            {hasRichText(b.description) ? (
              <RichText text={b.description} className="bz-about" />
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

          {/* Support acting for the shop (§297). */}
          <ShopSupportSection businessId={b.id} onAct={setAct} onClose={onClose} />
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
