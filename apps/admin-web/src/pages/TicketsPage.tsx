import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/auth-context';
import { useMoney } from '../money';
import {
  assignTicket,
  getTicket,
  listTickets,
  replyToTicket,
  setTicketStatus,
  type AdminTicket,
  type TicketAttachment,
  type TicketCategory,
  type TicketStatus,
} from '../api/admin';
import { BOOKING_STATUS, reservationNo } from '../lib/bookingLook';
import { ago, clock } from '../lib/time';
import { useMediaQuery } from '../shell/useMediaQuery';
import { Avatar } from '../ui/Avatar';
import { confirmDialog, promptDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { ShopMark } from '../ui/ShopMark';
import './tickets.css';

type Tab = TicketStatus | 'ALL' | 'MINE';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'OPEN', label: 'New' },
  { value: 'IN_PROGRESS', label: 'Being handled' },
  { value: 'MINE', label: 'Mine' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'ALL', label: 'All' },
];

const STATUS: Record<TicketStatus, { label: string; cls: string }> = {
  OPEN: { label: 'New', cls: 'tkt-open' },
  IN_PROGRESS: { label: 'Being handled', cls: 'tkt-active' },
  RESOLVED: { label: 'Resolved', cls: 'tkt-resolved' },
  CLOSED: { label: 'Closed', cls: 'tkt-closed' },
};

const CATEGORY: Record<TicketCategory, { label: string; icon: IconName }> = {
  PAYMENT_ISSUE: { label: 'Payment', icon: 'banknote' },
  APPOINTMENT_DISPUTE: { label: 'Booking dispute', icon: 'calendarX' },
  ACCOUNT_ISSUE: { label: 'Account', icon: 'user' },
  TECHNICAL_ISSUE: { label: 'Technical problem', icon: 'alert' },
  OTHER: { label: 'Something else', icon: 'help' },
};

/**
 * The transitions an ADMIN may make, from §24.3's table — mirrored only to
 * decide which buttons exist; the server enforces it. Reopening is absent on
 * purpose: only the reporter may, within the window.
 */
const NEXT: Partial<Record<TicketStatus, { to: TicketStatus; label: string; icon: IconName; note?: string }>> = {
  // Starting a ticket is taking it: the server makes it yours (§24.3), so one
  // button does both rather than "Take it" and "Start handling" side by side.
  OPEN: { to: 'IN_PROGRESS', label: 'Start handling', icon: 'play', note: 'It becomes yours, and they are told someone is on it.' },
  IN_PROGRESS: { to: 'RESOLVED', label: 'Mark resolved', icon: 'checkCircle' },
  RESOLVED: { to: 'CLOSED', label: 'Close', icon: 'xCircle', note: 'They can reopen it for 14 days after it was resolved.' },
};

const PAGE = 30;

/**
 * Support, as an inbox in two panes (§247, §24) — the business app's Messages
 * (§198), for the people who answer everyone else's problems.
 *
 * The tickets down the left, newest word first, each with who raised it (or
 * which shop), the subject, the latest message and whether anyone has it;
 * the open one on the right as a conversation — the reporter's messages on
 * the left, answers on the right, internal notes in amber across the middle —
 * with the booking it is about when it is about one, and the next step at the
 * top. On a phone the list and the conversation take the screen in turn.
 */
export function TicketsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('status') as Tab | null) ?? 'OPEN';
  const openId = params.get('open');
  const q = params.get('q') ?? '';
  const [typed, setTyped] = useState(q);
  // On a phone the open ticket is the whole screen, drawn at the top of the
  // page so nothing around it can clip it — as Messages does (§198).
  const phone = useMediaQuery('(max-width: 860px)');

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

  useEffect(() => {
    const t = setTimeout(() => {
      if (typed.trim() !== q) patch({ q: typed.trim() || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  // "Mine" is the work on your plate: what you are handling now. What you
  // finished is under Resolved and Closed with everyone else's.
  const filter = (t: Tab) =>
    t === 'ALL' ? {} : t === 'MINE' ? { status: 'IN_PROGRESS' as const, assignedAdminId: user?.id } : { status: t };

  const list = useInfiniteQuery({
    queryKey: ['tickets', tab, q],
    queryFn: ({ pageParam }) => listTickets({ ...filter(tab), ...(q ? { q } : {}), limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.tickets.length < last.total ? last.offset + PAGE : undefined),
    refetchInterval: 60_000,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.tickets) ?? [], [list.data]);

  const counts = useQuery({
    queryKey: ['tickets', 'counts', q, user?.id],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(TABS.map(async (t) => [t.value, (await listTickets({ ...filter(t.value), ...(q ? { q } : {}), limit: 1 })).total] as const)),
      ) as Record<Tab, number>,
  });

  const open = (id: string | null) => patch({ open: id });

  // Arriving from a notice with a reference (§247): find that ticket, show the
  // tab it is in, and open it.
  const ref = params.get('ref');
  useEffect(() => {
    if (!ref) return;
    let gone = false;
    void listTickets({ q: ref, limit: 5 })
      .then((page) => page.tickets.find((t) => t.reference === ref) ?? null)
      .catch(() => null)
      .then((hit) => {
        if (gone) return;
        patch({ ref: null, q: null, status: hit ? (hit.status === 'OPEN' ? null : hit.status) : 'ALL', open: hit?.id ?? null });
      });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  // The open ticket's row is brought into view in the list.
  const shownOnArrival = useRef<string | null>(null);
  useEffect(() => {
    if (!openId || shownOnArrival.current === openId || rows.length === 0) return;
    shownOnArrival.current = openId;
    document.querySelector('.sp-ticket.is-open')?.scrollIntoView({ block: 'nearest' });
  }, [openId, rows.length]);

  return (
    <section className="sp">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Support</h1>
            <p className="muted">Questions and problems from customers and shops.</p>
          </div>
        </header>
      </div>

      <div className={`sp-inbox${openId ? ' has-open' : ''}`}>
        <aside className="sp-list">
          <div className="sp-list-top">
            <label className="sp-search">
              <Icon name="search" size={17} />
              <input
                type="search"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Search a reference, subject or email"
                aria-label="Search tickets"
              />
            </label>
            <div className="sp-filters" role="tablist" aria-label="Show">
              {TABS.map((t) => [
                t.value === 'RESOLVED' && <span key="break" className="sp-filters-break" aria-hidden="true" />,
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.value}
                  className={tab === t.value ? 'is-on' : ''}
                  onClick={() => patch({ status: t.value === 'OPEN' ? null : t.value })}
                >
                  {t.label}
                  {counts.data && counts.data[t.value] > 0 && (
                    <span className={t.value === 'OPEN' ? 'is-hot' : ''}>{counts.data[t.value]}</span>
                  )}
                </button>,
              ])}
            </div>
          </div>

          <ul className="sp-tickets">
            {list.isLoading &&
              [0, 1, 2].map((i) => (
                <li key={i}>
                  <div className="skeleton sp-skel" />
                </li>
              ))}
            {rows.map((t) => (
              <li key={t.id}>
                <Row t={t} active={t.id === openId} mine={t.assignedAdminId === user?.id} onOpen={() => open(t.id)} />
              </li>
            ))}
          </ul>

          {list.data && rows.length === 0 && (
            <p className="sp-none">
              {q ? `Nothing found for “${q}”.` : tab === 'OPEN' ? 'No new tickets — all caught up.' : tab === 'MINE' ? 'Nothing is with you.' : 'Nothing here.'}
            </p>
          )}
          {list.hasNextPage && (
            <button type="button" className="sp-more" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
            </button>
          )}
        </aside>

        <div className="sp-pane">
          {openId && !phone ? (
            <Conversation key={openId} id={openId} onBack={() => open(null)} />
          ) : (
            <div className="sp-welcome">
              <span>
                <Icon name="help" size={34} />
              </span>
              <h2>
                {counts.data && counts.data.OPEN > 0
                  ? `${counts.data.OPEN} new ${counts.data.OPEN === 1 ? 'ticket is' : 'tickets are'} waiting`
                  : 'Choose a ticket'}
              </h2>
              <p>Pick one on the left to read it, take it, and answer. Replies reach the reporter by email and in their app.</p>
            </div>
          )}
        </div>
      </div>

      {openId &&
        phone &&
        createPortal(
          <div className="sp-phone">
            <Conversation key={openId} id={openId} onBack={() => open(null)} />
          </div>,
          document.body,
        )}
    </section>
  );
}

function Row({ t, active, mine, onOpen }: { t: AdminTicket; active: boolean; mine: boolean; onOpen: () => void }) {
  const look = STATUS[t.status];
  const shop = t.reporterType === 'BUSINESS' && t.businessProfile;
  const latest = t.latest;
  const unanswered = t.status === 'OPEN' || (latest?.authorType === 'REPORTER' && t.status === 'IN_PROGRESS');
  return (
    <button type="button" className={`sp-ticket${active ? ' is-open' : ''}${unanswered ? ' is-unanswered' : ''}`} onClick={onOpen}>
      {shop ? (
        <ShopMark name={t.businessProfile!.name} logoUrl={t.businessProfile!.logoUrl} size={42} />
      ) : (
        <Avatar label={t.reporter.email} size={42} />
      )}
      <span className="sp-ticket-text">
        <span className="sp-ticket-top">
          <strong>{shop ? t.businessProfile!.name ?? t.reporter.email : t.reporter.email}</strong>
          <em>{ago(t.lastMessageAt)}</em>
        </span>
        <span className="sp-ticket-subject">{t.subject}</span>
        {latest && (
          <span className="sp-ticket-latest">
            {latest.isInternal ? <b>Note: </b> : latest.authorType === 'ADMIN' ? <b>Support: </b> : null}
            {latest.body}
          </span>
        )}
        <span className="sp-ticket-meta">
          <span className={`pill ${look.cls}`}>{look.label}</span>
          <span className="sp-ref">{t.reference}</span>
          {t.status !== 'CLOSED' && t.status !== 'RESOLVED' && (
            <span className={`sp-who${t.assignedAdminId ? '' : ' is-free'}`}>
              {t.assignedAdminId ? (mine ? 'With you' : `With ${t.assignedAdmin?.email.split('@')[0] ?? 'another admin'}`) : 'Nobody has it'}
            </span>
          )}
          {t.reopenCount > 0 && <span className="sp-reopened">Reopened ×{t.reopenCount}</span>}
        </span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// The conversation

/** The filename is not kept (storage names files by id), so a link says what kind of thing it is. */
const describeFile = (mimeType: string) => {
  if (mimeType.startsWith('image/')) return 'Image';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'Spreadsheet';
  if (mimeType.includes('word')) return 'Document';
  if (mimeType === 'text/csv') return 'CSV';
  if (mimeType === 'text/plain') return 'Text file';
  return 'Attachment';
};

function Files({ files }: { files: TicketAttachment[] }) {
  if (files.length === 0) return null;
  return (
    <span className="sp-files">
      {files.map((f) => (
        <a key={f.id} href={f.url} target="_blank" rel="noreferrer">
          <Icon name={f.mimeType.startsWith('image/') ? 'image' : 'paperclip'} size={14} />
          {describeFile(f.mimeType)} · {Math.max(1, Math.round(f.sizeBytes / 1024))} KB
        </a>
      ))}
    </span>
  );
}

function Conversation({ id, onBack }: { id: string; onBack: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const money = useMoney();
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const ticket = useQuery({ queryKey: ['ticket', id], queryFn: () => getTicket(id), refetchInterval: 20_000 });
  const data = ticket.data;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    void queryClient.invalidateQueries({ queryKey: ['tickets'] });
  };

  const send = useMutation({
    mutationFn: () => replyToTicket(id, reply.trim(), internal),
    onSuccess: () => {
      setReply('');
      refresh();
    },
  });
  const assign = useMutation({ mutationFn: () => assignTicket(id, user!.id), onSuccess: refresh });
  const move = useMutation({
    mutationFn: (input: { to: TicketStatus; note?: string }) => setTicketStatus(id, input.to, input.note),
    onSuccess: refresh,
  });

  const count = data?.messages.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  if (!data) {
    return (
      <div className="sp-convo">
        <div className="sp-convo-skel">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      </div>
    );
  }

  const next = NEXT[data.status];
  const cat = CATEGORY[data.category];
  const mine = data.assignedAdminId === user?.id;

  const advance = async () => {
    if (!next) return;
    if (next.to === 'RESOLVED') {
      // Required by the server: the reporter is told it, and it is what a reopen argues against.
      const note = await promptDialog({
        title: 'Mark this ticket resolved?',
        body: <p>The reporter is told the outcome, and it is the record of what was decided.</p>,
        label: 'What was the outcome?',
        placeholder: 'For example: refunded the deposit in full; the shop has been reminded of its hours.',
        minLength: 3,
        minMessage: 'Please write at least a few words.',
        multiline: true,
        tone: 'ok',
        icon: 'checkCircle',
        confirmLabel: 'Resolve',
        cancelLabel: 'Not yet',
      });
      if (note !== null) move.mutate({ to: next.to, note: note.trim() });
      return;
    }
    if (next.to === 'CLOSED') {
      const ok = await confirmDialog({
        title: 'Close this ticket for good?',
        body: (
          <p>
            Nobody can reopen a closed ticket — not you, and not <strong>{data.reporter.email}</strong>. Left alone, it closes by itself 14 days
            after it was resolved.
          </p>
        ),
        tone: 'warn',
        icon: 'xCircle',
        confirmLabel: 'Close it',
        cancelLabel: 'Leave it open',
      });
      if (!ok) return;
    }
    move.mutate({ to: next.to });
  };

  const takeOver = async () => {
    if (data.assignedAdminId) {
      const ok = await confirmDialog({
        title: 'Take this ticket over?',
        body: (
          <p>
            It is with <strong>{data.assignedAdmin?.email ?? 'another administrator'}</strong> now. It moves to you and leaves their “Mine”.
          </p>
        ),
        tone: 'info',
        icon: 'userCheck',
        confirmLabel: 'Take it over',
        cancelLabel: 'Leave it with them',
      });
      if (!ok) return;
    }
    assign.mutate();
  };

  const onSend = (event: FormEvent) => {
    event.preventDefault();
    if (reply.trim()) send.mutate();
  };

  const error = send.error ?? assign.error ?? move.error;

  return (
    <div className="sp-convo">
      <header className="sp-convo-head">
        <button type="button" className="sp-back" onClick={onBack} aria-label="Back to the tickets">
          <Icon name="chevronLeft" size={20} />
        </button>
        <div className="sp-convo-title">
          <span className="sp-convo-cat">
            <Icon name={cat.icon} size={14} />
            {cat.label} · {data.reference}
          </span>
          <h2>{data.subject}</h2>
          <span className="sp-convo-from">
            From {data.reporterType === 'BUSINESS' ? `${data.businessProfile?.name ?? 'a shop'} (${data.reporter.email})` : data.reporter.email} ·
            opened {ago(data.createdAt)}
          </span>
        </div>
        <span className={`pill sp-head-pill ${STATUS[data.status].cls}`}>{STATUS[data.status].label}</span>
      </header>

      <div className="sp-steps">
        {next && (
          <button type="button" className="primary" disabled={move.isPending} onClick={() => void advance()}>
            <Icon name={next.icon} size={16} />
            {next.label}
          </button>
        )}
        {data.assignedAdminId ? (
          <span className={`sp-holder${mine ? ' is-mine' : ''}`}>
            <Icon name="userCheck" size={15} />
            <span>{mine ? 'With you' : `With ${data.assignedAdmin?.email ?? 'another administrator'}`}</span>
          </span>
        ) : (
          data.status === 'IN_PROGRESS' && <span className="sp-holder is-free">Nobody has it</span>
        )}
        {data.status === 'IN_PROGRESS' && !mine && (
          <button type="button" disabled={assign.isPending} onClick={() => void takeOver()}>
            <Icon name="userCheck" size={16} />
            {data.assignedAdminId ? 'Take over' : 'Take it'}
          </button>
        )}
        {next?.note && <span className="sp-steps-note">{next.note}</span>}
      </div>

      <div className="sp-thread">
        {data.appointment && (
          <Link className="sp-booking" to={`/appointments?open=${data.appointment.id}`}>
            <Icon name="calendarCheck" size={18} />
            <span>
              <strong>{data.appointment.service.name}</strong> at {data.appointment.location.name}
              <em>
                {new Date(data.appointment.startTime).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })},{' '}
                {clock(data.appointment.startTime)} · No. {reservationNo(data.appointment.id)} · {data.appointment.depositPaidAt ? 'deposit' : 'deposit due'}{' '}
                {money.format(data.appointment.depositAmountMinor, data.appointment.currency)}
              </em>
            </span>
            <span className={`pill ${BOOKING_STATUS[data.appointment.status].cls}`}>{BOOKING_STATUS[data.appointment.status].label}</span>
          </Link>
        )}

        {data.resolutionNote && (
          <div className="sp-outcome">
            <Icon name="checkCircle" size={17} />
            <span>
              <strong>Outcome</strong>
              {data.resolutionNote}
            </span>
          </div>
        )}

        {data.messages.map((m, i) => {
          const side = m.isInternal ? 'note' : m.authorType === 'ADMIN' ? 'ours' : 'theirs';
          return (
            <div key={m.id} className={`sp-msg is-${side}`}>
              <span className="sp-msg-head">
                {side === 'note' ? (
                  <b>
                    <Icon name="eye" size={13} /> Internal note — {m.author.email}
                  </b>
                ) : (
                  <b>{side === 'ours' ? (m.author.id === user?.id ? 'You' : m.author.email) : m.author.email}</b>
                )}
                <em>{ago(m.createdAt)}</em>
              </span>
              <p>{m.body}</p>
              <Files files={m.attachments} />
              {i === 0 && <Files files={data.attachments} />}
            </div>
          );
        })}
        <div ref={end} />
      </div>

      {error && (
        <p className="error sp-error" role="alert">
          <Icon name="alert" size={15} />
          {error instanceof ApiError ? error.message : 'That did not work.'}
        </p>
      )}

      {data.status !== 'CLOSED' ? (
        <form className={`sp-compose${internal ? ' is-note' : ''}`} onSubmit={onSend}>
          <div className="sp-compose-kind" role="tablist" aria-label="Write">
            <button type="button" role="tab" aria-selected={!internal} className={!internal ? 'is-on' : ''} onClick={() => setInternal(false)}>
              <Icon name="send" size={14} /> Reply to {data.reporterType === 'BUSINESS' ? 'the shop' : 'the customer'}
            </button>
            <button type="button" role="tab" aria-selected={internal} className={internal ? 'is-on' : ''} onClick={() => setInternal(true)}>
              <Icon name="eye" size={14} /> Internal note
            </button>
          </div>
          <div className="sp-compose-row">
            <textarea
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  if (reply.trim()) send.mutate();
                }
              }}
              placeholder={internal ? 'A note only administrators will see…' : 'Write your answer…'}
              rows={2}
            />
            <button type="submit" className="primary" disabled={send.isPending || reply.trim() === ''} aria-label={internal ? 'Add the note' : 'Send the reply'}>
              <Icon name={internal ? 'check' : 'send'} size={18} />
            </button>
          </div>
          <span className="sp-compose-hint">{internal ? 'The reporter never sees a note.' : '⌘ Enter to send · they are told by email and in their app'}</span>
        </form>
      ) : (
        <p className="sp-closed">This ticket is closed.</p>
      )}
    </div>
  );
}
