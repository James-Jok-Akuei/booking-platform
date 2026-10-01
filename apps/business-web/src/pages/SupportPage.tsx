import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_LABEL,
  ACCEPTED_TYPES,
  MAX_ATTACHMENTS,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
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
 * on, when it actually means the opposite — they are waiting on support.
 *
 * ~~"Waiting for us"~~ (§80.2) said "us" to a business reading their own
 * screen, where "us" is most naturally *them*. "Support" cannot be misread as
 * their own team, and stays right once they have staff with their own logins.
 *
 * `short` is for the list, `hint` for the open ticket. Both exist because the
 * list previously showed a label with no explanation anywhere near it, which
 * is how the ambiguity went unnoticed.
 */
const STATUS: Record<
  TicketStatus,
  { label: string; short: string; hint: string; tone: string }
> = {
  OPEN: {
    label: 'Waiting for support',
    short: 'Nobody has picked it up yet',
    hint: 'We have it. Nobody has picked it up yet.',
    tone: 'tkt-open',
  },
  IN_PROGRESS: {
    label: 'Being looked at',
    short: 'Someone is on it',
    hint: 'Someone is working on this.',
    tone: 'tkt-active',
  },
  RESOLVED: {
    label: 'Resolved',
    short: `You can reopen it for ${REOPEN_WINDOW_DAYS} days`,
    hint: 'We think this is sorted.',
    tone: 'tkt-resolved',
  },
  CLOSED: {
    label: 'Closed',
    short: 'Finished',
    hint: 'Finished. Raise a new one if it comes back.',
    tone: 'tkt-closed',
  },
};

/**
 * The original filename is not kept — storage names every object with a UUID
 * so a crafted upload name cannot steer the object key. So the link says what
 * kind of thing it is, which is the part a reader needs before clicking.
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
                <div className="row-status">
                  <span className={`pill ${STATUS[ticket.status].tone}`}>
                    {STATUS[ticket.status].label}
                  </span>
                  <span className="muted small">{STATUS[ticket.status].short}</span>
                </div>
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

/**
 * A file field that accumulates, and says what it is holding.
 *
 * Adding a second file used to replace the first: one `File` in state, and a
 * fresh `<input type="file">` reports only its own latest selection. The state
 * is now a list and each selection is appended, which is what "add another"
 * means to everyone except the DOM.
 *
 * The input is referenced by `htmlFor`, never wrapped: a <label> around a file
 * input re-dispatches the click to its control, which can open the picker
 * twice and makes a selection look ignored.
 *
 * Type and size are checked here, mirroring the server, so a file that will be
 * refused is refused before a 15MB upload rather than after one.
 */
function FilePicker({
  id,
  files,
  onChange,
}: {
  id: string;
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const [problems, setProblems] = useState<string[]>([]);

  const add = (chosen: FileList | null) => {
    if (!chosen || chosen.length === 0) return;
    const rejected: string[] = [];
    const accepted: File[] = [];

    for (const file of Array.from(chosen)) {
      // Type OR extension: browsers report an empty or non-standard `type` for
      // HEIC and for some Office files, so judging on type alone rejects files
      // the server would accept.
      const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      const looksAllowed =
        ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXTENSIONS.includes(extension);

      if (!looksAllowed) {
        rejected.push(`${file.name} — we cannot take ${extension || 'that kind of file'}.`);
      } else if (file.size > MAX_UPLOAD_BYTES) {
        rejected.push(
          `${file.name} — ${Math.round(file.size / 1024 / 1024)}MB, over the ${MAX_UPLOAD_MB}MB limit.`,
        );
      } else if (
        // Same name and size twice is the picker being opened again, not a
        // second file worth uploading.
        files.some((held) => held.name === file.name && held.size === file.size)
      ) {
        rejected.push(`${file.name} — already added.`);
      } else {
        accepted.push(file);
      }
    }

    const room = MAX_ATTACHMENTS - files.length;
    if (accepted.length > room) {
      for (const file of accepted.slice(room)) {
        rejected.push(`${file.name} — that would be more than ${MAX_ATTACHMENTS} files.`);
      }
    }

    setProblems(rejected);
    onChange([...files, ...accepted.slice(0, Math.max(0, room))]);
  };

  const full = files.length >= MAX_ATTACHMENTS;

  return (
    <div className="file-field">
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}`}>
              <span className="file-name">{file.name}</span>
              <span className="muted small">
                {Math.max(1, Math.round(file.size / 1024))} KB
              </span>
              <button
                type="button"
                className="link"
                onClick={() => onChange(files.filter((held) => held !== file))}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        id={id}
        type="file"
        multiple
        className="visually-hidden"
        accept={[...ACCEPTED_TYPES, ...ACCEPTED_EXTENSIONS].join(',')}
        disabled={full}
        // Cleared after every selection so picking the same file again still
        // fires `change` — without this, removing a file and re-adding it does
        // nothing at all.
        onChange={(event) => {
          add(event.target.files);
          event.target.value = '';
        }}
      />
      <label htmlFor={id} className={full ? 'file-trigger disabled' : 'file-trigger'}>
        {files.length === 0 ? 'Attach a file' : 'Add another file'}
      </label>
      {full && (
        <span className="muted small">{MAX_ATTACHMENTS} files is the limit.</span>
      )}

      {problems.length > 0 && (
        <ul className="error small" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
  const [attachments, setAttachments] = useState<File[]>([]);

  const create = useMutation({
    mutationFn: () =>
      raiseTicket({ category, subject: subject.trim(), body: body.trim(), attachments }),
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

        <div className="stack-field">
          <span className="field-label">Anything that shows the problem</span>
          <span className="muted small">
            Optional. {ACCEPTED_LABEL} — up to {MAX_ATTACHMENTS} files, {MAX_UPLOAD_MB}MB
            each. A statement or an invoice helps most for anything about money.
          </span>
          <FilePicker
            id="new-ticket-attachments"
            files={attachments}
            onChange={setAttachments}
          />
        </div>

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
  const [attachments, setAttachments] = useState<File[]>([]);

  const ticket = useQuery({ queryKey: ['my-ticket', id], queryFn: () => getMyTicket(id) });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['my-ticket', id] });
    queryClient.invalidateQueries({ queryKey: ['my-tickets'] });
  };

  const send = useMutation({
    mutationFn: () => replyToMyTicket(id, reply.trim(), attachments),
    onSuccess: () => {
      setReply('');
      setAttachments([]);
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
                <FilePicker
                  id="reply-attachments"
                  files={attachments}
                  onChange={setAttachments}
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
