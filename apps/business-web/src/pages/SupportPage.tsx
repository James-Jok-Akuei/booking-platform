import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  getMyTicket,
  listMyTickets,
  raiseTicket,
  reopenMyTicket,
  replyToMyTicket,
  REOPEN_WINDOW_DAYS,
  TICKET_CATEGORIES,
  type TicketAttachment,
  type TicketCategory,
  type TicketStatus,
} from '../api/business';

/**
 * What a business is told each status means.
 *
 * The enum names are ours, not theirs: "OPEN" reads like a thing they must act
 * on, when it actually means the opposite — they are waiting on us.
 */
const STATUS: Record<TicketStatus, { label: string; hint: string; tone: string }> = {
  OPEN: { label: 'Waiting for us', hint: 'We have it. Nobody has picked it up yet.', tone: 'tkt-open' },
  IN_PROGRESS: { label: 'Being looked at', hint: 'Someone is working on this.', tone: 'tkt-active' },
  RESOLVED: { label: 'Resolved', hint: 'We think this is sorted.', tone: 'tkt-resolved' },
  CLOSED: { label: 'Closed', hint: 'Finished. Raise a new one if it comes back.', tone: 'tkt-closed' },
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** The window is enforced server-side; this only decides whether to offer it. */
const withinReopenWindow = (resolvedAt: string | null) => {
  if (!resolvedAt) return false;
  const days = (Date.now() - new Date(resolvedAt).getTime()) / 86_400_000;
  return days < REOPEN_WINDOW_DAYS;
};

export function SupportPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const tickets = useQuery({ queryKey: ['my-tickets'], queryFn: () => listMyTickets() });

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Help</h1>
          <p className="muted">
            Something wrong with a payout, a booking or your profile? Tell us here and
            you will get a reply in this page and by email.
          </p>
        </div>
        <button type="button" className="primary" onClick={() => setComposing(true)}>
          Ask for help
        </button>
      </header>

      {tickets.isLoading && <p className="muted">Loading…</p>}

      {tickets.data?.tickets.length === 0 && (
        <p className="muted empty">
          You have not asked us anything yet. That is a good sign.
        </p>
      )}

      {tickets.data && tickets.data.tickets.length > 0 && (
        <ul className="card-list">
          {tickets.data.tickets.map((ticket) => (
            <li key={ticket.id}>
              <button type="button" className="card-row" onClick={() => setOpenId(ticket.id)}>
                <div>
                  <strong>{ticket.subject}</strong>
                  <div className="muted small">
                    {ticket.reference} · last activity {when(ticket.lastMessageAt ?? ticket.createdAt)}
                  </div>
                </div>
                <span className={`pill ${STATUS[ticket.status].tone}`}>
                  {STATUS[ticket.status].label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {composing && (
        <NewTicket
          onClose={() => setComposing(false)}
          onCreated={(id) => {
            setComposing(false);
            setOpenId(id);
          }}
        />
      )}
      {openId && <TicketThread id={openId} onClose={() => setOpenId(null)} />}
    </section>
  );
}

function Panel({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        {children}
      </aside>
    </div>
  );
}

function Attachments({ files }: { files: TicketAttachment[] }) {
  if (files.length === 0) return null;
  return (
    <div className="attachments">
      {files.map((file) => (
        <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="small">
          View attachment ({Math.max(1, Math.round(file.sizeBytes / 1024))} KB)
        </a>
      ))}
    </div>
  );
}

function CloseX({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="icon-button"
      onClick={onClose}
      aria-label="Close this panel"
      title="Close this panel"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function NewTicket({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<TicketCategory>('PAYMENT_ISSUE');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);

  const create = useMutation({
    mutationFn: () =>
      raiseTicket({ category, subject: subject.trim(), body: body.trim(), attachment }),
    onSuccess: (ticket) => {
      queryClient.invalidateQueries({ queryKey: ['my-tickets'] });
      onCreated(ticket.id);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Panel onClose={onClose}>
      <header className="drawer-head">
        <h2>Ask for help</h2>
        <CloseX onClose={onClose} />
      </header>

      <form onSubmit={submit} className="stack">
        <label>
          What is this about?
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as TicketCategory)}
          >
            {TICKET_CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          One line summary
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Payout for September has not arrived"
            maxLength={200}
          />
        </label>

        <label>
          What happened?
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={6}
            maxLength={5000}
            placeholder="Dates, amounts and the booking reference if you have one — it saves us asking."
          />
        </label>

        <label>
          A screenshot, if it helps <span className="muted small">(optional, JPG/PNG/WebP, up to 15MB)</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
          />
        </label>

        {create.error && (
          <p className="error small" role="alert">
            {create.error instanceof ApiError ? create.error.message : 'That did not send.'}
          </p>
        )}

        <div className="row-end">
          <button type="button" className="link" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={create.isPending || subject.trim().length < 3 || body.trim() === ''}
          >
            {create.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function TicketThread({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);

  const ticket = useQuery({ queryKey: ['my-ticket', id], queryFn: () => getMyTicket(id) });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['my-ticket', id] });
    queryClient.invalidateQueries({ queryKey: ['my-tickets'] });
  };

  const send = useMutation({
    mutationFn: () => replyToMyTicket(id, reply.trim(), attachment),
    onSuccess: () => {
      setReply('');
      setAttachment(null);
      refresh();
    },
  });

  const reopen = useMutation({ mutationFn: () => reopenMyTicket(id), onSuccess: refresh });

  const data = ticket.data;

  return (
    <Panel onClose={onClose}>
      {!data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <header className="drawer-head">
            <div>
              <h2>{data.subject}</h2>
              <p className="muted small">
                {data.reference} · raised {when(data.createdAt)}
              </p>
            </div>
            <CloseX onClose={onClose} />
          </header>

          <p>
            <span className={`pill ${STATUS[data.status].tone}`}>
              {STATUS[data.status].label}
            </span>{' '}
            <span className="muted small">{STATUS[data.status].hint}</span>
          </p>

          {data.resolutionNote && (
            <p className="notice">
              <strong>What we did:</strong> {data.resolutionNote}
            </p>
          )}

          <div className="thread">
            {data.messages.map((message, index) => (
              <div
                key={message.id}
                className={message.authorType === 'REPORTER' ? 'message mine' : 'message'}
              >
                <div className="muted small">
                  {message.authorType === 'REPORTER' ? 'You' : 'Support'} · {when(message.createdAt)}
                </div>
                <p>{message.body}</p>
                <Attachments files={message.attachments} />
                {/* A file sent when the ticket was raised belongs to the
                    ticket, so it is shown against the opening message where
                    whoever reads this would expect to find it. */}
                {index === 0 && <Attachments files={data.attachments} />}
              </div>
            ))}
          </div>

          {/* RESOLVED is the only state with anything to decide: accept it by
              doing nothing, or say it is not fixed. CLOSED is final, and the
              server refuses a reply to it, so no box is offered. */}
          {data.status === 'RESOLVED' && (
            <div className="stack">
              {withinReopenWindow(data.resolvedAt) ? (
                <>
                  <p className="muted small">
                    Still not right? You can reopen this for {REOPEN_WINDOW_DAYS} days after
                    it was resolved.
                  </p>
                  <button type="button" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
                    {reopen.isPending ? 'Reopening…' : 'This is not fixed'}
                  </button>
                </>
              ) : (
                <p className="muted small">
                  This was resolved more than {REOPEN_WINDOW_DAYS} days ago, so it can no
                  longer be reopened. Please raise a new one.
                </p>
              )}
            </div>
          )}

          {(data.status === 'OPEN' || data.status === 'IN_PROGRESS') && (
            <form
              className="reply"
              onSubmit={(event) => {
                event.preventDefault();
                send.mutate();
              }}
            >
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                rows={3}
                maxLength={5000}
                placeholder="Add anything else that might help…"
              />
              <div className="reply-actions">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
                />
                <button
                  type="submit"
                  className="primary"
                  disabled={send.isPending || reply.trim() === ''}
                >
                  {send.isPending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </form>
          )}

          {(send.error || reopen.error) && (
            <p className="error small" role="alert">
              {(send.error ?? reopen.error) instanceof ApiError
                ? (send.error ?? reopen.error)!.message
                : 'That did not work.'}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
