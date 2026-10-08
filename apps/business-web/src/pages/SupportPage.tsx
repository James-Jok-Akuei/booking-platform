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
import { ago } from '../lib/time';
import { Icon, type IconName } from '../ui/Icon';
import { Panel as SidePanel } from '../ui/Panel';
import './support.css';

/** An icon for each kind of question, the same in the list and the form. */
const CATEGORY_ICON: Record<TicketCategory, IconName> = {
  PAYMENT_ISSUE: 'wallet',
  APPOINTMENT_DISPUTE: 'calendar',
  ACCOUNT_ISSUE: 'store',
  TECHNICAL_ISSUE: 'zap',
  OTHER: 'help',
};

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

/** Asking for help, and the answers (§79, §80, §202). */
export function SupportPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState<TicketCategory | null>(null);

  const tickets = useQuery({ queryKey: ['my-tickets'], queryFn: () => listMyTickets() });
  const rows = tickets.data?.tickets ?? [];
  const live = rows.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS');
  const done = rows.filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED');

  return (
    <section className="hp">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Help</h1>
            <p className="muted">Ask us about anything — we reply on this page and by email.</p>
          </div>
        </header>
      </div>

      <header className="hp-hero">
        <div className="hp-hero-text">
          <span className="hp-hero-icon">
            <Icon name="help" size={24} />
          </span>
          <h2>How can we help?</h2>
          <p>
            Something wrong with a payout, a booking or your profile? Tell us here and you will get a reply in
            this page and by email.
          </p>
        </div>
        <div className="hp-topics">
          {TICKET_CATEGORIES.map((option) => (
            <button key={option.value} type="button" className="hp-topic" onClick={() => setComposing(option.value)}>
              <span>
                <Icon name={CATEGORY_ICON[option.value]} size={18} />
              </span>
              {option.label}
              <Icon name="arrowRight" size={15} className="hp-topic-go" />
            </button>
          ))}
        </div>
      </header>

      {tickets.isLoading && <div className="skeleton hp-skeleton" />}

      {tickets.data && rows.length === 0 && (
        <p className="hp-none">
          <Icon name="checkCircle" size={18} /> You have not asked us anything yet. That is a good sign.
        </p>
      )}

      {live.length > 0 && <TicketGroup title="Open" rows={live} onOpen={setOpenId} />}
      {done.length > 0 && <TicketGroup title="Finished" rows={done} onOpen={setOpenId} />}

      {composing && (
        <NewTicket
          initialCategory={composing}
          onClose={() => setComposing(null)}
          onCreated={(id) => {
            setComposing(null);
            setOpenId(id);
          }}
        />
      )}
      {openId && <TicketThread id={openId} onClose={() => setOpenId(null)} />}
    </section>
  );
}

function TicketGroup({
  title,
  rows,
  onOpen,
}: {
  title: string;
  rows: NonNullable<ReturnType<typeof listMyTickets> extends Promise<infer P> ? P : never>['tickets'];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="hp-group">
      <h2>
        {title} <span>{rows.length}</span>
      </h2>
      <ul>
        {rows.map((ticket) => (
          <li key={ticket.id}>
            <button type="button" className={`hp-ticket is-${STATUS[ticket.status].tone}`} onClick={() => onOpen(ticket.id)}>
              <span className="hp-ticket-icon">
                <Icon name={CATEGORY_ICON[ticket.category]} size={18} />
              </span>
              <span className="hp-ticket-text">
                <strong>{ticket.subject}</strong>
                <span>
                  {ticket.reference} · last activity {ago(ticket.lastMessageAt ?? ticket.createdAt)}
                </span>
              </span>
              <span className="hp-ticket-state">
                <span className={`pill ${STATUS[ticket.status].tone}`}>{STATUS[ticket.status].label}</span>
                <span>{STATUS[ticket.status].short}</span>
              </span>
              <Icon name="chevronRight" size={18} className="hp-ticket-go" />
            </button>
          </li>
        ))}
      </ul>
    </section>
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
        <Icon name="paperclip" size={16} />
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

function NewTicket({
  initialCategory,
  onClose,
  onCreated,
}: {
  initialCategory: TicketCategory;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<TicketCategory>(initialCategory);
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
    <SidePanel
      eyebrow="Ask for help"
      title="Tell us what happened"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="new-ticket"
            className="primary"
            disabled={create.isPending || subject.trim().length < 3 || body.trim() === ''}
          >
            <Icon name="send" size={16} />
            {create.isPending ? 'Sending…' : 'Send'}
          </button>
        </>
      }
    >
      <form id="new-ticket" onSubmit={submit} className="stack">
        <div className="stack-field">
          <span className="field-label">What is this about?</span>
          <div className="hp-cats" role="radiogroup">
            {TICKET_CATEGORIES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={category === option.value}
                className={category === option.value ? 'is-on' : ''}
                onClick={() => setCategory(option.value)}
              >
                <Icon name={CATEGORY_ICON[option.value]} size={16} />
                {option.label}
              </button>
            ))}
          </div>
        </div>

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
      </form>
    </SidePanel>
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
    <SidePanel
      eyebrow={data ? `${data.reference} · raised ${when(data.createdAt)}` : 'Your question'}
      title={data?.subject ?? 'Loading…'}
      onClose={onClose}
    >
      {!data ? (
        <div className="skeleton hp-skeleton" />
      ) : (
        <>
          <p className="hp-status">
            <span className={`pill ${STATUS[data.status].tone}`}>{STATUS[data.status].label}</span>
            <span>{STATUS[data.status].hint}</span>
          </p>

          {data.resolutionNote && (
            <p className="notice">
              <strong>What we did:</strong> {data.resolutionNote}
            </p>
          )}

          <div className="hp-thread">
            {data.messages.map((message, index) => (
              <div
                key={message.id}
                className={message.authorType === 'REPORTER' ? 'hp-msg is-mine' : 'hp-msg'}
              >
                <div className="hp-msg-who">
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
    </SidePanel>
  );
}
