import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ApiError } from '../api/client';
import {
  getMe,
  listAppointments,
  verifyArrival,
  verifyManually,
  type Appointment,
} from '../api/business';
import { BookingChoices } from '../lib/BookingChoices';
import { useMoney } from '../money';
import { Avatar } from '../ui/Avatar';
import { CodeBoxes } from '../ui/CodeBoxes';
import { Icon } from '../ui/Icon';
import './checkin.css';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { dateLocale } from '../i18n/format';
import { plural } from '@lingui/core/macro';

/**
 * Checking a customer in (§191) — the thing a seller does more than anything
 * else in this app, given its own flow instead of a code box in a table row.
 *
 * 1. **Who has arrived?** Everyone still expected, today's first, each with
 *    how far they are from their time ("due now", "in 25 min", "10 min late").
 *    With one customer expected today, they are already chosen.
 * 2. **Their code.** Six boxes; the sixth digit checks them in. A wrong code
 *    shakes the boxes and shows the server's own words, attempts left and all.
 *    An owner or manager can check someone in without it (§54.3), in writing,
 *    here rather than in a browser prompt.
 * 3. **Checked in.** What they still owe at the shop — the one number the
 *    seller needs next — and a way straight on to the next customer.
 *
 * The code is the gate (§16.2). The server stores it hashed, so there is no
 * typing the code first and finding the booking from it: the booking is
 * chosen, then its code is checked.
 */

type Step = 'choose' | 'code' | 'manual' | 'done';

type OpenCheckIn = (appointment?: Appointment, options?: { manual?: boolean }) => void;

const CheckInContext = createContext<OpenCheckIn>(() => {});

/**
 * Opens the check-in window, optionally with the customer already chosen —
 * and, for an owner or manager, straight on "No code?".
 */
export const useCheckIn = () => useContext(CheckInContext);

export function CheckInProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; preset?: Appointment; manual?: boolean; key: number }>({
    open: false,
    key: 0,
  });
  const open = useCallback<OpenCheckIn>(
    (appointment, options) =>
      setState((was) => ({ open: true, preset: appointment, manual: options?.manual, key: was.key + 1 })),
    [],
  );
  const close = useCallback(() => setState((was) => ({ ...was, open: false })), []);

  return (
    <CheckInContext.Provider value={open}>
      {children}
      {state.open && (
        <CheckInDialog key={state.key} preset={state.preset} manual={state.manual} onClose={close} />
      )}
    </CheckInContext.Provider>
  );
}

// ---------------------------------------------------------------------------

const DAY = 86_400_000;

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });

const span = (minutes: number) => {
  const m = Math.round(Math.abs(minutes));
  if (m < 60) return t`${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? t`${h} h ${rest} min` : t`${h} h`;
};

/** How far a customer is from their time, said the way a person would. */
export function dueLabel(startIso: string, now = Date.now()) {
  const minutes = (new Date(startIso).getTime() - now) / 60_000;
  if (Math.abs(minutes) <= 10) return { text: t`Due now`, tone: 'now' as const };
  if (minutes > 0) return { text: t`in ${span(minutes)}`, tone: 'soon' as const };
  return { text: t`${span(minutes)} late`, tone: 'late' as const };
}

const minutesBetween = (a: Appointment) =>
  Math.round((new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 60_000);

const whatFor = (a: Appointment) =>
  a.quantity > 1 ? `${a.service.name} · ${plural(a.quantity, { one: '# person', other: '# people' })}` : a.service.name;

function CheckInDialog({
  preset,
  manual: startManual = false,
  onClose,
}: {
  preset?: Appointment;
  manual?: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const money = useMoney();
  const [step, setStep] = useState<Step>(preset ? (startManual ? 'manual' : 'code') : 'choose');
  const [chosen, setChosen] = useState<Appointment | null>(preset ?? null);
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [search, setSearch] = useState('');
  const [done, setDone] = useState<Appointment | null>(null);
  const autoChosen = useRef(Boolean(preset));

  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const canVerifyManually =
    me.data?.businessMembership?.role === 'OWNER' || me.data?.businessMembership?.role === 'MANAGER';

  const expected = useQuery({
    queryKey: ['appointments', 'check-in'],
    queryFn: () => listAppointments({ status: 'BOOKED', limit: 100 }),
  });

  const groups = useMemo(() => {
    const today = startOfToday();
    const rows = (expected.data?.appointments ?? []).filter((a) => {
      const q = search.trim().toLowerCase();
      return !q || `${a.customer.email} ${a.service.name} ${a.location.name}`.toLowerCase().includes(q);
    });
    const at = (a: Appointment) => new Date(a.startTime).getTime();
    const byTime = (x: Appointment, y: Appointment) => at(x) - at(y);
    return {
      today: rows.filter((a) => at(a) >= today && at(a) < today + DAY).sort(byTime),
      later: rows.filter((a) => at(a) >= today + DAY).sort(byTime),
      earlier: rows.filter((a) => at(a) < today).sort((x, y) => at(y) - at(x)),
    };
  }, [expected.data, search]);

  // One customer expected today: they are the one, so skip the choosing.
  useEffect(() => {
    if (autoChosen.current || !expected.data) return;
    autoChosen.current = true;
    if (groups.today.length === 1) {
      setChosen(groups.today[0]);
      setStep('code');
    }
  }, [expected.data, groups.today]);

  // Esc closes, from any step.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const finished = (result: Appointment) => {
    setDone({ ...chosen!, ...result });
    setStep('done');
    queryClient.invalidateQueries({ queryKey: ['appointments'] });
  };

  const verify = useMutation({
    mutationFn: (value: string) => verifyArrival(chosen!.id, value),
    onSuccess: finished,
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
      setShake(true);
      setCode('');
    },
  });

  const manual = useMutation({
    mutationFn: () => verifyManually(chosen!.id, note.trim()),
    onSuccess: finished,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'That did not work. Try again.'),
  });

  const choose = (appointment: Appointment) => {
    setChosen(appointment);
    setCode('');
    setError(null);
    setStep('code');
  };

  const again = () => {
    setChosen(null);
    setDone(null);
    setCode('');
    setNote('');
    setError(null);
    setSearch('');
    setStep('choose');
  };

  const stepIndex = step === 'choose' ? 0 : step === 'done' ? 2 : 1;
  const total = groups.today.length + groups.later.length + groups.earlier.length;

  return (
    <div className="ci-backdrop" onMouseDown={onClose}>
      <div
        className={`ci ci-step-${step}`}
        role="dialog"
        aria-modal="true"
        aria-label={t`Check in a customer`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ci-head">
          <div className="ci-badge">
            <Icon name="ticket" size={20} />
          </div>
          <div className="ci-titles">
            <h2><Trans>Check in</Trans></h2>
            <p>
              {step === 'choose' && t`Who has arrived?`}
              {step === 'code' && t`Ask for their code`}
              {step === 'manual' && t`Without the code`}
              {step === 'done' && t`All done`}
            </p>
          </div>
          <ol className="ci-steps" aria-label={t`Step ${stepIndex + 1} of 3`}>
            {[0, 1, 2].map((i) => (
              <li key={i} className={i < stepIndex ? 'is-done' : i === stepIndex ? 'is-now' : ''} />
            ))}
          </ol>
          <button type="button" className="ci-close" onClick={onClose} aria-label={t`Close`}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="ci-body" key={step}>
          {step === 'choose' && (
            <>
              <label className="ci-search">
                <Icon name="search" size={18} />
                <input
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t`Find by email or service`}
                  aria-label={t`Find a customer`}
                />
              </label>

              <div className="ci-list">
                {expected.isLoading &&
                  [0, 1, 2].map((i) => <div key={i} className="skeleton ci-skeleton" />)}

                {expected.data && total === 0 && (
                  <div className="ci-empty">
                    <span>
                      <Icon name="calendarCheck" size={26} />
                    </span>
                    <strong>{search ? t`Nobody matches “${search}”` : t`Nobody is expected`}</strong>
                    <p className="muted">
                      {search
                        ? t`Try part of their email, or the service.`
                        : t`Customers appear here once they have booked and paid their deposit.`}
                    </p>
                  </div>
                )}

                <Group title={t`Today`} rows={groups.today} onChoose={choose} today />
                <Group title={t`Coming up`} rows={groups.later} onChoose={choose} />
                <Group title={t`Earlier, not checked in`} rows={groups.earlier} onChoose={choose} />
              </div>
            </>
          )}

          {(step === 'code' || step === 'manual') && chosen && (
            <>
              <Who appointment={chosen} onChange={preset ? undefined : again} />

              {step === 'code' ? (
                <div className="ci-code">
                  <h3><Trans>What is their 6-digit code?</Trans></h3>
                  <p className="muted">
                    <Trans>It is in the email we sent them, and on the booking in their app.</Trans>
                  </p>
                  <CodeBoxes
                    value={code}
                    onChange={(next) => {
                      setCode(next);
                      if (error) setError(null);
                    }}
                    onComplete={(value) => verify.mutate(value)}
                    invalid={Boolean(error)}
                    shake={shake}
                    onShakeEnd={() => setShake(false)}
                    disabled={verify.isPending}
                    autoFocus
                  />
                  <p className={`ci-error ${error ? 'is-on' : ''}`} role="alert">
                    {error && (
                      <>
                        <Icon name="alert" size={16} />
                        {error}
                      </>
                    )}
                  </p>
                  <button
                    type="button"
                    className="primary ci-go"
                    disabled={code.length !== 6 || verify.isPending}
                    onClick={() => verify.mutate(code)}
                  >
                    {verify.isPending ? (
                      <>
                        <Trans><span className="ci-spinner" />Checking…</Trans>
                      </>
                    ) : (
                      <>
                        <Icon name="check" size={18} stroke={2.4} />{' '}
                        <Trans>Check in</Trans>
                      </>
                    )}
                  </button>
                  {canVerifyManually && (
                    <button
                      type="button"
                      className="link ci-nocode"
                      onClick={() => {
                        setError(null);
                        setStep('manual');
                      }}
                    >
                      <Trans>No code?</Trans>
                    </button>
                  )}
                </div>
              ) : (
                <div className="ci-manual">
                  <h3><Trans>Check in without the code</Trans></h3>
                  <p>
                    <Trans>
                      What did the customer recall — the booking time, the service, anything that
                      identified them?
                    </Trans>
                  </p>
                  <textarea
                    autoFocus
                    rows={4}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={t`For example: knew it was the 16:00 hot-towel shave, and showed the booking email on their phone.`}
                  />
                  <p className="ci-manual-note">
                    <Icon name="shield" size={16} />
                    <Trans>This is recorded against your name and every administrator is told.</Trans>
                  </p>
                  {note.trim().length > 0 && note.trim().length < 10 && (
                    <p className="muted small">
                      <Trans>Please write at least 10 characters. This is the record of the decision.</Trans>
                    </p>
                  )}
                  {error && (
                    <p className="ci-error is-on" role="alert">
                      <Icon name="alert" size={16} />
                      {error}
                    </p>
                  )}
                  <div className="ci-manual-actions">
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setError(null);
                        setStep('code');
                      }}
                    >
                      <Trans>Back to the code</Trans>
                    </button>
                    <button
                      type="button"
                      className="dark"
                      disabled={note.trim().length < 10 || manual.isPending}
                      onClick={() => manual.mutate()}
                    >
                      {manual.isPending ? t`Checking in…` : t`Check in without the code`}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 'done' && done && (
            <div className="ci-done">
              <div className="ci-tick" aria-hidden="true">
                <span className="ci-burst" />
                <svg viewBox="0 0 64 64" width="88" height="88">
                  <circle className="ci-tick-ring" cx="32" cy="32" r="29" />
                  <path className="ci-tick-mark" d="M20 33.5 28.5 42 45 24" />
                </svg>
              </div>
              <h2><Trans>Checked in</Trans></h2>
              <p className="ci-done-who">
                <Trans><strong>{done.customer.email}</strong> is with you now.</Trans>
              </p>

              <dl className="ci-receipt">
                <div>
                  <dt><Trans>Service</Trans></dt>
                  <dd>{whatFor(done)}</dd>
                </div>
                <div>
                  <dt><Trans>Time</Trans></dt>
                  <dd>
                    <Trans>{clock(done.startTime)} – {clock(done.endTime)} · {minutesBetween(done)} min</Trans>
                  </dd>
                </div>
                <div>
                  <dt><Trans>Deposit paid</Trans></dt>
                  <dd>{money.format(done.depositAmountMinor, done.currency)}</dd>
                </div>
                {done.servicePriceMinor !== null && (
                  <div className="ci-receipt-due">
                    <dt><Trans>Still to pay you at the shop</Trans></dt>
                    <dd>
                      {money.format(
                        Math.max(0, done.servicePriceMinor - done.depositAmountMinor),
                        done.currency,
                      )}
                    </dd>
                  </div>
                )}
              </dl>

              {/* What they chose (§300) — what to do for them, now they are here. */}
              <div className="ci-choices">
                <BookingChoices a={done} money={money} />
              </div>

              <p className="muted small ci-done-next">
                <Trans>
                  When they are finished, mark it done on{' '}
                  <Link to="/appointments" onClick={onClose}>
                  Appointments
                  </Link>.
                </Trans>
              </p>

              <div className="ci-done-actions">
                <button type="button" onClick={again}>
                  <Icon name="ticket" size={18} />{' '}
                  <Trans>Check in someone else</Trans>
                </button>
                <button type="button" className="dark" onClick={onClose} autoFocus>
                  <Trans>Done</Trans>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({
  title,
  rows,
  onChoose,
  today = false,
}: {
  title: string;
  rows: Appointment[];
  onChoose: (appointment: Appointment) => void;
  today?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="ci-group">
      <p className="ci-group-title">
        {title}
        <span>{rows.length}</span>
      </p>
      {rows.map((appointment) => {
        const due = today ? dueLabel(appointment.startTime) : null;
        return (
          <button key={appointment.id} type="button" className="ci-row" onClick={() => onChoose(appointment)}>
            <Avatar label={appointment.customer.email} size={42} />
            <span className="ci-row-text">
              <strong>{appointment.customer.email}</strong>
              <span>
                {whatFor(appointment)} · {appointment.location.name}
              </span>
            </span>
            <span className="ci-row-when">
              <strong>{clock(appointment.startTime)}</strong>
              {due ? (
                <span className={`ci-due is-${due.tone}`}>{due.text}</span>
              ) : (
                <span className="ci-due">{dayLabel(appointment.startTime)}</span>
              )}
            </span>
            <Icon name="chevronRight" size={18} className="ci-row-go" />
          </button>
        );
      })}
    </section>
  );
}

function Who({ appointment, onChange }: { appointment: Appointment; onChange?: () => void }) {
  const today = new Date(appointment.startTime).getTime() >= startOfToday() &&
    new Date(appointment.startTime).getTime() < startOfToday() + DAY;
  const due = today ? dueLabel(appointment.startTime) : null;
  return (
    <div className="ci-who">
      <Avatar label={appointment.customer.email} size={50} />
      <div className="ci-who-text">
        <strong>{appointment.customer.email}</strong>
        <span>
          <Trans>{whatFor(appointment)} · {minutesBetween(appointment)} min</Trans>
        </span>
        <span>
          {today ? t`Today` : dayLabel(appointment.startTime)}
          <Trans>
            at {clock(appointment.startTime)} ·{' '}
            {appointment.location.name}
          </Trans>
          {due && <em className={`ci-due is-${due.tone}`}>{due.text}</em>}
        </span>
      </div>
      {onChange && (
        <button type="button" className="ci-change" onClick={onChange}>
          <Trans>Change</Trans>
        </button>
      )}
    </div>
  );
}
