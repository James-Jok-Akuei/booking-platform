import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { listTickets, supportHistory, type SupportBody } from '../api/admin';
import { SUPPORT_KIND } from '../lib/supportWords';
import { ago, clock, shortDay } from '../lib/time';
import { Icon, type IconName } from '../ui/Icon';
import { Panel } from '../ui/Panel';
// The booking panel's form pieces — the reason, the help requests, the red line (§249).
import '../pages/appointments.css';
import './support.css';

export type TicketPick = { id: string; reference: string; subject: string };

/** One line of what will happen, with a mark or a face beside it. */
export type Consequence = { mark: ReactNode | IconName; text: ReactNode };

/**
 * Doing something for a shop or a customer (§297): what will happen, said in
 * full before anything else; why — the only record of the decision; and the
 * help request it answers, where a note saying what was done is written. The
 * one form every support action uses, so each reads and records the same way.
 */
export function SupportPanel({
  eyebrow,
  title,
  tone = 'accent',
  warning,
  consequences,
  tickets = [],
  ticketId: fixedTicket,
  placeholder,
  minReason = 5,
  reasonLabel = 'Why — kept with what you did',
  extra,
  ready = true,
  confirmLabel,
  busyLabel = 'Working…',
  run,
  onDone,
  onBack,
  onClose,
  width = 640,
  noTicketHint,
}: {
  eyebrow: string;
  title: string;
  tone?: 'accent' | 'danger';
  /** A line in red above everything: it moves money, or cannot be undone. */
  warning?: ReactNode;
  consequences: Consequence[];
  /** Help requests to choose from. Left out with `ticketId`, which is then always the one. */
  tickets?: TicketPick[];
  ticketId?: string;
  placeholder: string;
  minReason?: number;
  reasonLabel?: string;
  /** More fields, between the reason and the help requests. */
  extra?: ReactNode;
  /** The extra fields are filled in well enough to go. */
  ready?: boolean;
  confirmLabel: string;
  busyLabel?: string;
  run: (body: SupportBody) => Promise<unknown>;
  onDone: (result: unknown) => void;
  onBack?: () => void;
  onClose: () => void;
  width?: number;
  /** Said under the choice when there are no help requests to choose from. */
  noTicketHint?: string;
}) {
  const [reason, setReason] = useState('');
  const [picked, setPicked] = useState<string>(fixedTicket ?? tickets[0]?.id ?? '');
  const ticketId = fixedTicket ?? picked;
  const enough = reason.trim().length >= minReason;

  const go = useMutation({
    mutationFn: () => run({ reason: reason.trim(), ...(ticketId ? { ticketId } : {}) }),
    onSuccess: onDone,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (enough && ready && !go.isPending) go.mutate();
  };

  return (
    <Panel
      eyebrow={eyebrow}
      title={title}
      onClose={onClose}
      width={width}
      footer={
        <>
          <button type="button" onClick={onBack ?? onClose} disabled={go.isPending}>
            {onBack ? 'Back' : 'Cancel'}
          </button>
          <button
            type="submit"
            form="sa-form"
            className={tone === 'danger' ? 'danger' : 'primary'}
            disabled={go.isPending || !enough || !ready}
          >
            {go.isPending ? busyLabel : confirmLabel}
          </button>
        </>
      }
    >
      {warning && (
        <div className="ad-banner is-danger">
          <Icon name="alert" size={18} />
          <span>{warning}</span>
        </div>
      )}

      <ul className="ad-consequences sa-consequences">
        {consequences.map((c, i) => (
          <li key={i}>
            {typeof c.mark === 'string' ? (
              <span className="ad-consequence-icon">
                <Icon name={c.mark as IconName} size={15} />
              </span>
            ) : (
              c.mark
            )}
            <span>{c.text}</span>
          </li>
        ))}
      </ul>

      <form id="sa-form" className="ad-form" onSubmit={submit}>
        <label>
          <span>{reasonLabel}</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={500}
            autoFocus
            placeholder={placeholder}
          />
          {reason.trim().length > 0 && !enough && <small>A few more words — at least {minReason} letters.</small>}
        </label>

        {extra}

        {!fixedTicket && (
          <fieldset>
            <legend>The help request it answers</legend>
            <div className="ad-ticket-picks">
              {tickets.map((t) => (
                <label key={t.id} className={picked === t.id ? 'is-on' : ''}>
                  <input type="radio" name="sa-ticket" checked={picked === t.id} onChange={() => setPicked(t.id)} />
                  <span className="ad-ref">{t.reference}</span>
                  <span>{t.subject}</span>
                </label>
              ))}
              <label className={picked === '' ? 'is-on' : ''}>
                <input type="radio" name="sa-ticket" checked={picked === ''} onChange={() => setPicked('')} />
                <span>{tickets.length === 0 ? 'No help request — they asked another way' : 'None of these'}</span>
              </label>
            </div>
            <small>
              {tickets.length > 0
                ? 'A note saying what you did is written into it, for them to read.'
                : (noTicketHint ?? 'They have no help request open. They are told what was done all the same.')}
            </small>
          </fieldset>
        )}
        {fixedTicket && (
          <p className="sa-note">
            <Icon name="help" size={14} /> A note saying what you did is written into this help request.
          </p>
        )}

        {go.error && (
          <p className="error small" role="alert">
            {go.error instanceof ApiError ? go.error.message : 'That did not work.'}
          </p>
        )}
      </form>
    </Panel>
  );
}

/** A shop's or a person's help requests still being dealt with — the ones a support action may answer (§297). */
export function useOpenRequests(whose: { businessId?: string; reporterId?: string }): TicketPick[] {
  const page = useQuery({
    queryKey: ['tickets', 'open-for', whose],
    queryFn: () => listTickets({ ...whose, open: 'true', limit: 10 }),
  });
  return (page.data?.tickets ?? []).map((t) => ({ id: t.id, reference: t.reference, subject: t.subject }));
}

/** One support action, as a button in a list of what can be done. */
export function SupportActButton({
  icon,
  label,
  note,
  tone,
  onClick,
}: {
  icon: IconName;
  label: string;
  note: string;
  tone?: 'danger';
  onClick: () => void;
}) {
  return (
    <button type="button" className={`sa-act${tone ? ` is-${tone}` : ''}`} onClick={onClick}>
      <span className="sa-act-icon">
        <Icon name={icon} size={17} />
      </span>
      <span className="sa-act-words">
        <strong>{label}</strong>
        <span>{note}</span>
      </span>
      <Icon name="chevronRight" size={15} />
    </button>
  );
}

/**
 * What support did — about a booking, a shop, a person or a help request —
 * with who, when and why. The shop and the customer see what and when; only
 * here is it said who.
 */
export function SupportHistory({
  filter,
  empty,
  onOpen,
}: {
  filter: { appointmentId?: string; businessId?: string; userId?: string; ticketId?: string };
  empty?: string;
  onOpen?: () => void;
}) {
  const history = useQuery({ queryKey: ['support-history', filter], queryFn: () => supportHistory(filter) });
  const rows = history.data?.actions ?? [];
  if (history.isLoading) return <div className="skeleton sa-skel" />;
  if (rows.length === 0) return empty ? <p className="sa-empty">{empty}</p> : null;
  return (
    <ol className="sa-history">
      {rows.map((row) => {
        const kind = SUPPORT_KIND[row.kind];
        return (
          <li key={row.id}>
            <span className="sa-history-mark">
              <Icon name={kind.icon} size={14} />
            </span>
            <div>
              <strong>{kind.label}</strong>
              <span className="sa-history-why">“{row.reason}”</span>
              <span className="sa-history-meta">
                {row.by} · <time title={`${shortDay(row.createdAt)}, ${clock(row.createdAt)}`}>{ago(row.createdAt)}</time>
                {row.ticket && (
                  <>
                    {' · '}
                    <Link to={`/tickets?status=ALL&open=${row.ticket.id}`} onClick={onOpen}>
                      {row.ticket.reference}
                    </Link>
                  </>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
