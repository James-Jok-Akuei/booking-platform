import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/auth-context';
import {
  assignTicket,
  getTicket,
  listTickets,
  replyToTicket,
  setTicketStatus,
  type TicketAttachment,
  type TicketStatus,
} from '../api/admin';

const TABS: Array<{ value: TicketStatus | 'ALL'; label: string }> = [
  { value: 'OPEN', label: 'New' },
  { value: 'IN_PROGRESS', label: 'Being handled' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'ALL', label: 'All' },
];

/**
 * The transitions an ADMIN may make, from §24.3's table.
 *
 * Mirrored here only to decide which buttons exist — the server enforces it,
 * and a button for a move it will refuse is worse than no button. Reopening is
 * absent on purpose: only the reporter may do that, within the window, because
 * an admin reopening their own resolution would defeat the point of it.
 */
const NEXT: Partial<Record<TicketStatus, { to: TicketStatus; label: string }>> = {
  OPEN: { to: 'IN_PROGRESS', label: 'Start handling' },
  IN_PROGRESS: { to: 'RESOLVED', label: 'Mark resolved' },
  RESOLVED: { to: 'CLOSED', label: 'Close' },
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function TicketsPage() {
  const [status, setStatus] = useState<TicketStatus | 'ALL'>('OPEN');
  const [openId, setOpenId] = useState<string | null>(null);

  const tickets = useQuery({
    queryKey: ['tickets', status],
    queryFn: () => listTickets(status === 'ALL' ? {} : { status }),
  });

  return (
    <section>
      <header className="page-head">
        <h1>Support</h1>
        <div className="tabs">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={tab.value === status ? 'tab active' : 'tab'}
              onClick={() => setStatus(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {tickets.isLoading && <p className="muted">Loading…</p>}
      {tickets.data?.tickets.length === 0 && <p className="muted empty">Nothing here.</p>}

      {tickets.data && tickets.data.tickets.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Subject</th>
              <th>From</th>
              <th>Last activity</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {tickets.data.tickets.map((ticket) => (
              <tr
                key={ticket.id}
                className="clickable"
                onClick={() => setOpenId(ticket.id)}
              >
                <td>
                  <code>{ticket.reference}</code>
                </td>
                <td>
                  <strong>{ticket.subject}</strong>
                  <div className="muted small">
                    {ticket.category.replace(/_/g, ' ').toLowerCase()}
                  </div>
                </td>
                <td className="small">{ticket.reporterType.toLowerCase()}</td>
                <td className="small">{when(ticket.lastMessageAt ?? ticket.createdAt)}</td>
                <td>
                  <span className={`pill ${ticket.status.toLowerCase().replace('_', '-')}`}>
                    {ticket.status.replace('_', ' ')}
                  </span>
                  {ticket.reopenCount > 0 && (
                    // Reopened once is a resolution that did not hold. Worth
                    // seeing before you open it.
                    <div className="muted small">reopened ×{ticket.reopenCount}</div>
                  )}
                  {!ticket.assignedAdminId && ticket.status !== 'CLOSED' && (
                    <div className="muted small">unassigned</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {openId && <TicketDrawer id={openId} onClose={() => setOpenId(null)} />}
    </section>
  );
}

/**
 * The original filename is not kept — storage names every object with a UUID —
 * so the link says what kind of thing it is instead. Since §81 this can be a
 * PDF statement or a spreadsheet, not only a screenshot.
 */
const describeFile = (mimeType: string) => {
  if (mimeType.startsWith('image/')) return 'View image';
  if (mimeType === 'application/pdf') return 'View PDF';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'View spreadsheet';
  if (mimeType.includes('word')) return 'View document';
  if (mimeType === 'text/csv') return 'View CSV';
  if (mimeType === 'text/plain') return 'View text file';
  return 'View attachment';
};

function Attachments({ files }: { files: TicketAttachment[] }) {
  if (files.length === 0) return null;
  return (
    <div className="attachments">
      {files.map((file) => (
        <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="small">
          {describeFile(file.mimeType)} ({Math.max(1, Math.round(file.sizeBytes / 1024))} KB)
        </a>
      ))}
    </div>
  );
}

function TicketDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);

  const ticket = useQuery({ queryKey: ['ticket', id], queryFn: () => getTicket(id) });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    queryClient.invalidateQueries({ queryKey: ['tickets'] });
  };

  const send = useMutation({
    mutationFn: () => replyToTicket(id, reply.trim(), internal),
    onSuccess: () => {
      setReply('');
      refresh();
    },
  });

  const assign = useMutation({
    mutationFn: () => assignTicket(id, user!.id),
    onSuccess: refresh,
  });

  const move = useMutation({
    mutationFn: (input: { to: TicketStatus; note?: string }) =>
      setTicketStatus(id, input.to, input.note),
    onSuccess: refresh,
  });

  const data = ticket.data;
  const next = data ? NEXT[data.status] : undefined;

  const onSend = (event: FormEvent) => {
    event.preventDefault();
    send.mutate();
  };

  const advance = () => {
    if (!next) return;
    if (next.to === 'RESOLVED') {
      // Required by the server, and genuinely the record of what was decided:
      // the reporter is told this, and it is what a reopen argues against.
      const note = window.prompt(
        'What was the outcome? The reporter is told this, and it is the record ' +
          'of what was decided.',
      );
      if (note === null) return;
      if (note.trim().length < 3) {
        window.alert('Please write at least a few words.');
        return;
      }
      move.mutate({ to: next.to, note: note.trim() });
      return;
    }
    move.mutate({ to: next.to });
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        {!data ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <header className="drawer-head">
              <div>
                <code>{data.reference}</code>
                <h2>{data.subject}</h2>
                <p className="muted small">
                  {data.category.replace(/_/g, ' ').toLowerCase()} · from a{' '}
                  {data.reporterType.toLowerCase()} · opened {when(data.createdAt)}
                </p>
              </div>
              {/* An X, not the word "Close" — the status action below is also
                  "Close", and the two mean very different things. */}
              <button
                type="button"
                className="icon-button"
                onClick={onClose}
                aria-label="Close this panel"
                title="Close this panel"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M4 4l8 8M12 4l-8 8"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </header>

            <div className="drawer-actions">
              <span className={`pill ${data.status.toLowerCase().replace('_', '-')}`}>
                {data.status.replace('_', ' ')}
              </span>
              {!data.assignedAdminId && (
                <button type="button" disabled={assign.isPending} onClick={() => assign.mutate()}>
                  Assign to me
                </button>
              )}
              {data.assignedAdminId === user?.id && (
                <span className="muted small">Assigned to you</span>
              )}
              {data.assignedAdminId && data.assignedAdminId !== user?.id && (
                <span className="muted small">Assigned to another admin</span>
              )}
              {next && (
                <button
                  type="button"
                  className="primary"
                  disabled={move.isPending}
                  onClick={advance}
                >
                  {next.label}
                </button>
              )}
              {/* No reopen button: only the reporter may reopen, within the
                  window (§24.3). Saying so beats a button that 400s. */}
              {data.status === 'RESOLVED' && (
                <span className="muted small">
                  Only the reporter can reopen this, and only for a while.
                </span>
              )}
            </div>

            {data.resolutionNote && (
              <p className="notice">
                <strong>Outcome:</strong> {data.resolutionNote}
              </p>
            )}

            <div className="thread">
              {data.messages.map((message, index) => (
                <div
                  key={message.id}
                  className={message.isInternal ? 'message internal' : 'message'}
                >
                  <div className="muted small">
                    {message.author?.email ?? message.authorType.toLowerCase()} ·{' '}
                    {when(message.createdAt)}
                    {message.isInternal && <strong> · internal note</strong>}
                  </div>
                  <p>{message.body}</p>
                  <Attachments files={message.attachments} />
                  {index === 0 && <Attachments files={data.attachments} />}
                </div>
              ))}
            </div>

            {data.status !== 'CLOSED' && (
              <form className="reply" onSubmit={onSend}>
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder={
                    internal ? 'A note only admins will see…' : 'Reply to the reporter…'
                  }
                  rows={3}
                />
                <div className="reply-actions">
                  <label className="inline small">
                    <input
                      type="checkbox"
                      checked={internal}
                      onChange={(event) => setInternal(event.target.checked)}
                    />
                    Internal note — the reporter never sees this
                  </label>
                  <button
                    type="submit"
                    className="primary"
                    disabled={send.isPending || reply.trim() === ''}
                  >
                    {send.isPending ? 'Sending…' : internal ? 'Add note' : 'Reply'}
                  </button>
                </div>
              </form>
            )}

            {(send.error || assign.error || move.error) && (
              <p className="error small" role="alert">
                {(send.error ?? assign.error ?? move.error) instanceof ApiError
                  ? (send.error ?? assign.error ?? move.error)!.message
                  : 'That did not work.'}
              </p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
