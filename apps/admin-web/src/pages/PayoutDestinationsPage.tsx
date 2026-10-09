import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  listPayoutDestinations,
  rejectPayoutDestination,
  verifyPayoutDestination,
  type PayoutDestination,
  type PayoutDestinationStatus,
} from '../api/admin';
import { promptDialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { NETWORK_NAME, NetworkMark, networkOf, type Network } from '../ui/NetworkMark';
import { ShopMark } from '../ui/ShopMark';
import './destinations.css';

type Tab = PayoutDestinationStatus | 'ALL';

/** Plain words for the four states (§245): "to check", not "unverified". */
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'UNVERIFIED', label: 'To check' },
  { value: 'VERIFIED', label: 'Checked' },
  { value: 'REJECTED', label: 'Refused' },
  { value: 'SUPERSEDED', label: 'Replaced' },
  { value: 'ALL', label: 'All' },
];

const STATUS: Record<PayoutDestinationStatus, { label: string; cls: string }> = {
  UNVERIFIED: { label: 'To check', cls: 'unverified' },
  VERIFIED: { label: 'Checked', cls: 'verified' },
  REJECTED: { label: 'Refused', cls: 'rejected' },
  SUPERSEDED: { label: 'Replaced', cls: 'superseded' },
};

const PAGE = 25;

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const sinceDay = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};

/** "+250788100004" → "+250 788 100 004": read aloud in threes, as people say it. */
const spaced = (msisdn: string) => {
  const digits = msisdn.replace(/\D/g, '');
  if (digits.startsWith('250') && digits.length === 12) return `+250 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  return msisdn;
};

const same = (a: string | null, b: string) => Boolean(a) && a!.replace(/\D/g, '').slice(-9) === b.replace(/\D/g, '').slice(-9);

/**
 * Where a business gets paid, and the check before money goes there (§48,
 * §245).
 *
 * The queue is the reason payouts can run at all: an unchecked number PAUSES
 * that business's payouts rather than silently skipping them (§48.3), so a
 * business left here is a business not being paid. Each number is a card with
 * what the check needs beside it: the number spelled in threes with its
 * network's mark, whether its prefix agrees with the network given, whether it
 * is the shop's own phone, the number it replaces, and who gave it — with the
 * shop's phone a tap away. Checking asks how it was confirmed, which is the
 * only record of the decision once money has moved.
 */
export function PayoutDestinationsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('status') as Tab | null) ?? 'UNVERIFIED';
  const queryClient = useQueryClient();

  const list = useInfiniteQuery({
    queryKey: ['payout-destinations', tab],
    queryFn: ({ pageParam }) => listPayoutDestinations({ ...(tab === 'ALL' ? {} : { status: tab }), limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.destinations.length < last.total ? last.offset + PAGE : undefined),
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.destinations) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;

  const counts = useQuery({
    queryKey: ['payout-destinations', 'counts'],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          TABS.map(async (t) => [t.value, (await listPayoutDestinations({ ...(t.value === 'ALL' ? {} : { status: t.value }), limit: 1 })).total] as const),
        ),
      ) as Record<Tab, number>,
  });

  const act = useMutation({
    mutationFn: (input: { id: string; action: 'verify' | 'reject'; text: string }) =>
      input.action === 'verify' ? verifyPayoutDestination(input.id, input.text) : rejectPayoutDestination(input.id, input.text),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payout-destinations'] }),
  });

  const verify = async (d: PayoutDestination) => {
    const note = await promptDialog({
      title: 'Mark this number as checked?',
      body: (
        <p>
          <strong>{spaced(d.msisdn)}</strong> for <strong>{d.businessProfile.name ?? 'this business'}</strong>. Once checked,
          the shop’s money is sent to this number — and money sent does not come back.
        </p>
      ),
      label: 'How did you confirm it is theirs?',
      placeholder: 'For example: called the owner on the shop’s number; the name on MoMo matches.',
      note: 'Recorded, and the only account of this decision once money has moved.',
      minLength: 3,
      minMessage: 'A note of at least 3 characters.',
      multiline: true,
      tone: 'ok',
      icon: 'shield',
      confirmLabel: 'Mark as checked',
      cancelLabel: 'Not yet',
    });
    if (note !== null) act.mutate({ id: d.id, action: 'verify', text: note.trim() });
  };

  const reject = async (d: PayoutDestination) => {
    const reason = await promptDialog({
      title: 'Refuse this number?',
      body: <p>The business is told the reason and asked for another number. Until one is checked, their payouts wait.</p>,
      label: 'Reason — sent to them, so they know what to fix',
      placeholder: 'For example: the MoMo name does not match the business owner.',
      minLength: 3,
      minMessage: 'A reason of at least 3 characters.',
      multiline: true,
      tone: 'danger',
      icon: 'xCircle',
      confirmLabel: 'Refuse the number',
      cancelLabel: 'Not now',
    });
    if (reason !== null) act.mutate({ id: d.id, action: 'reject', text: reason.trim() });
  };

  return (
    <section className="pd">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Payout numbers</h1>
            <p className="muted">The mobile money numbers shops are paid to, checked before money goes there.</p>
          </div>
        </header>
        <div className="qtabs pin-from" role="tablist" aria-label="Show">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              className={`qtab${tab === t.value ? ' is-on' : ''}`}
              onClick={() =>
                setParams(
                  (now) => {
                    const out = new URLSearchParams(now);
                    if (t.value === 'UNVERIFIED') out.delete('status');
                    else out.set('status', t.value);
                    return out;
                  },
                  { replace: true },
                )
              }
            >
              {t.label}
              {counts.data && <span className={t.value === 'UNVERIFIED' && counts.data.UNVERIFIED > 0 ? 'is-hot' : ''}>{counts.data[t.value]}</span>}
            </button>
          ))}
        </div>
      </div>

      {tab === 'UNVERIFIED' && (counts.data?.UNVERIFIED ?? 0) > 0 && (
        <p className="pd-why">
          <Icon name="alert" size={18} />
          <span>
            A shop waiting here is <strong>not being paid</strong>: an unchecked number pauses its payouts rather than
            skipping them quietly.
          </span>
        </p>
      )}

      {act.error && (
        <p className="error q-error" role="alert">
          <Icon name="alert" size={16} />
          {act.error instanceof ApiError ? act.error.message : 'That did not work.'}
        </p>
      )}
      {list.error && (
        <p className="error q-error" role="alert">
          <Icon name="alert" size={16} />
          {list.error instanceof ApiError ? list.error.message : 'Could not load payout numbers.'}
        </p>
      )}

      {list.isLoading && (
        <div className="pd-grid">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton pd-skel" />
          ))}
        </div>
      )}

      {list.data && rows.length === 0 && (
        <div className="q-empty">
          <span>
            <Icon name={tab === 'UNVERIFIED' ? 'checkCircle' : 'wallet'} size={26} />
          </span>
          <strong>{tab === 'UNVERIFIED' ? 'Every number is checked' : 'No numbers here'}</strong>
          <p className="muted">
            {tab === 'UNVERIFIED'
              ? 'New numbers appear here, oldest first, as shops give them.'
              : 'None are in this state just now.'}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="pd-grid">
          {rows.map((d) => (
            <Card key={d.id} d={d} busy={act.isPending && act.variables?.id === d.id} onVerify={() => verify(d)} onReject={() => reject(d)} />
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
    </section>
  );
}

function Card({ d, busy, onVerify, onReject }: { d: PayoutDestination; busy: boolean; onVerify: () => void; onReject: () => void }) {
  const look = STATUS[d.status];
  const given: Network = d.provider === 'AIRTEL_MONEY' ? 'AIRTEL_MONEY' : 'MTN_MOMO';
  const byPrefix = networkOf(d.msisdn);
  const prefixDisagrees = byPrefix !== null && byPrefix !== given;
  const isShopPhone = same(d.businessProfile.phone, d.msisdn);
  const waiting = d.status === 'UNVERIFIED';

  return (
    <li className={`pd-card${waiting ? ' is-waiting' : ''}`}>
      <header className="pd-card-head">
        <ShopMark name={d.businessProfile.name} logoUrl={d.businessProfile.logoUrl} size={42} />
        <span className="pd-card-shop">
          <strong>{d.businessProfile.name ?? <em className="muted">No name</em>}</strong>
          <span>
            Given by {d.submittedBy.email} · {waiting ? `waiting since ${sinceDay(d.submittedAt)}` : day(d.submittedAt)}
          </span>
        </span>
        <span className={`pill ${look.cls}`}>{look.label}</span>
      </header>

      <div className="pd-number">
        <NetworkMark network={given} size={44} />
        <span>
          <strong>{spaced(d.msisdn)}</strong>
          <em>{NETWORK_NAME[given]}</em>
        </span>
      </div>

      <ul className="pd-facts">
        {byPrefix !== null && (
          <li className={prefixDisagrees ? 'is-warn' : 'is-ok'}>
            <Icon name={prefixDisagrees ? 'alert' : 'checkCircle'} size={16} />
            <span>
              {prefixDisagrees
                ? `Its prefix is ${NETWORK_NAME[byPrefix]}, but it was given as ${NETWORK_NAME[given]}.`
                : `The prefix agrees: an ${NETWORK_NAME[given]} number.`}
            </span>
          </li>
        )}
        <li className={isShopPhone ? 'is-ok' : ''}>
          <Icon name={isShopPhone ? 'checkCircle' : 'phone'} size={16} />
          {/* One span, so the link stays in the sentence rather than becoming its own column. */}
          <span>
            {isShopPhone ? (
              'The same as the shop’s own phone.'
            ) : d.businessProfile.phone ? (
              <>
                Not the shop’s phone ({spaced(d.businessProfile.phone)}) —{' '}
                <a href={`tel:${d.businessProfile.phone.replace(/\s/g, '')}`}>call the shop</a> to check.
              </>
            ) : (
              'The shop has no phone on file.'
            )}
          </span>
        </li>
        {d.replaces && (
          <li className="is-warn">
            <Icon name="refresh" size={16} />
            <span>
              Changes their number from {spaced(d.replaces.msisdn)}
              {d.replaces.status === 'VERIFIED' || d.replaces.status === 'SUPERSEDED' ? ' — worth a call before money goes elsewhere.' : '.'}
            </span>
          </li>
        )}
        {d.status === 'VERIFIED' && (
          <li className="is-ok">
            <Icon name="shield" size={16} />
            <span>
              Checked {d.verifiedBy ? `by ${d.verifiedBy.email} ` : ''}on {day(d.verifiedAt)}
              {d.verificationMethod === 'OTP' ? ' by a code to the phone' : ''}
              {d.verificationNote && <q>{d.verificationNote}</q>}
            </span>
          </li>
        )}
        {d.status === 'REJECTED' && d.rejectionReason && (
          <li className="is-danger">
            <Icon name="xCircle" size={16} />
            <span>
              Refused: <q>{d.rejectionReason}</q>
            </span>
          </li>
        )}
        {d.replacedBy && (
          <li>
            <Icon name="arrowRight" size={16} />
            <span>
              Replaced by {spaced(d.replacedBy.msisdn)} on {day(d.replacedBy.submittedAt)}
              {d.replacedBy.status !== 'VERIFIED' ? ` (${STATUS[d.replacedBy.status].label.toLowerCase()})` : ''}
            </span>
          </li>
        )}
      </ul>

      {waiting && (
        <footer className="pd-actions">
          <button type="button" className="danger" disabled={busy} onClick={onReject}>
            Refuse
          </button>
          <button type="button" className="primary pd-verify" disabled={busy} onClick={onVerify}>
            <Icon name="shield" size={17} />
            Mark as checked
          </button>
        </footer>
      )}
    </li>
  );
}
