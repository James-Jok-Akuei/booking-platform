import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  getExchangeRate,
  getPaymentProviders,
  getPayoutHold,
  getPlatformFee,
  setExchangeRate,
  setPayoutHold,
  setPlatformFee,
  setStaleness,
  type ExchangeRateSettings,
} from '../api/admin';
import { useMoney } from '../money';
import { ago } from '../lib/time';
import { confirmDialog } from '../ui/Dialog';
import { Icon, type IconName } from '../ui/Icon';
import { NETWORK_NAME, NetworkMark, type Network } from '../ui/NetworkMark';
import './settings.css';

const NETWORKS: Network[] = ['MTN_MOMO', 'AIRTEL_MONEY'];

/**
 * The platform's four numbers (§253; §16.3, §37, §38, §40, §96).
 *
 * Each a card that says its value large and what it means in money, and each
 * saved on its own — three of them move money, and one "Save settings" button
 * would let someone change the payout hold and silently ship a fee they had
 * typed over earlier and forgotten. A change opens in place, and the ones that
 * move money ask first, saying what changes and what does not.
 */
export function SettingsPage() {
  const queryClient = useQueryClient();
  const fee = useQuery({ queryKey: ['settings', 'fee'], queryFn: getPlatformFee });
  const rate = useQuery({ queryKey: ['settings', 'rate'], queryFn: getExchangeRate });
  const hold = useQuery({ queryKey: ['settings', 'hold'], queryFn: getPayoutHold });
  const providers = useQuery({ queryKey: ['settings', 'providers'], queryFn: getPaymentProviders });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['settings'] });

  return (
    <section className="st">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Settings</h1>
            <p className="muted">The platform’s four numbers. Each is saved on its own, because three of them move money.</p>
          </div>
        </header>
      </div>

      <div className="st-grid">
        <FeeCard value={fee.data?.platformFeePercentage} updatedAt={fee.data?.updatedAt ?? null} onSaved={invalidate} />
        <HoldCard value={hold.data?.payoutHoldDays} note={hold.data?.note} onSaved={invalidate} />
        <RateCard data={rate.data} onSaved={invalidate} />
        <ProvidersCard data={providers.data} loading={providers.isLoading} />
      </div>
    </section>
  );
}

function Card({
  icon,
  tone,
  label,
  value,
  sub,
  children,
  action,
}: {
  icon: IconName;
  tone: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <article className={`st-card tone-${tone}`}>
      <header>
        <span className="st-icon">
          <Icon name={icon} size={19} />
        </span>
        <span className="st-label">{label}</span>
        {action}
      </header>
      <div className="st-value">{value}</div>
      {sub && <p className="st-sub">{sub}</p>}
      {children}
    </article>
  );
}

/** A number changed in place: the input, Save and Cancel, and the server's words when it refuses. */
function Change({
  label,
  unit,
  initial,
  step,
  min,
  max,
  busy,
  error,
  onSave,
  onCancel,
}: {
  label: string;
  unit: string;
  initial: string;
  step: string;
  min: string;
  max?: string;
  busy: boolean;
  error: unknown;
  onSave: (value: number) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const n = Number(draft);
  const valid = draft.trim() !== '' && Number.isFinite(n) && n >= Number(min) && (max === undefined || n <= Number(max));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid && draft !== initial) onSave(n);
  };
  return (
    <form className="st-change" onSubmit={submit}>
      <label>
        <span>{label}</span>
        <span className="st-input">
          <input type="number" step={step} min={min} max={max} value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus />
          <b>{unit}</b>
        </span>
      </label>
      <div>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy || !valid || draft === initial}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error ? (
        <p className="error small" role="alert">
          {error instanceof ApiError ? error.message : 'Could not save.'}
        </p>
      ) : null}
    </form>
  );
}

function ChangeButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="st-edit" onClick={onClick}>
      <Icon name="pencil" size={14} /> Change
    </button>
  );
}

function FeeCard({ value, updatedAt, onSaved }: { value?: string; updatedAt: string | null; onSaved: () => void }) {
  const money = useMoney();
  const [open, setOpen] = useState(false);
  const save = useMutation({
    mutationFn: (next: number) => setPlatformFee(next),
    onSuccess: () => {
      setOpen(false);
      onSaved();
    },
  });
  const pct = value === undefined ? null : Number(value);
  const example = 10_000 * 10 ** money.exponent;

  const ask = async (next: number) => {
    const sure = await confirmDialog({
      title: `Change the platform fee to ${next}%?`,
      body: (
        <p>
          From {pct}% to <strong>{next}%</strong> of the service price, on <strong>bookings made from now on</strong>. Every booking already made keeps the
          fee it was booked at. A raise is refused if any service takes a deposit smaller than the new fee — the shop’s share would go below nothing.
        </p>
      ),
      tone: 'warn',
      icon: 'percent',
      confirmLabel: `Make it ${next}%`,
      cancelLabel: 'Keep it',
    });
    if (sure) save.mutate(next);
  };

  return (
    <Card
      icon="percent"
      tone="accent"
      label="Platform fee"
      value={
        pct === null ? (
          '…'
        ) : (
          <>
            {pct % 1 === 0 ? pct.toFixed(0) : pct}
            <small>%</small>
          </>
        )
      }
      sub={
        <>
          Of the <strong>service price</strong>, taken from the deposit. On a {money.format(example)} service, {pct === null ? '…' : money.format(Math.round((example * pct) / 100))} is
          the platform’s.
        </>
      }
      action={!open && <ChangeButton onClick={() => setOpen(true)} />}
    >
      {open && pct !== null && (
        <Change
          label="New fee"
          unit="%"
          initial={String(pct)}
          step="0.01"
          min="0"
          max="100"
          busy={save.isPending}
          error={save.error}
          onSave={(n) => void ask(n)}
          onCancel={() => {
            setOpen(false);
            save.reset();
          }}
        />
      )}
      <footer>Future bookings only{updatedAt && ` · changed ${ago(updatedAt)}`}</footer>
    </Card>
  );
}

function HoldCard({ value, note, onSaved }: { value?: number; note?: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const save = useMutation({
    mutationFn: (days: number) => setPayoutHold(days),
    onSuccess: () => {
      setOpen(false);
      onSaved();
    },
  });

  const ask = async (next: number) => {
    const sure = await confirmDialog({
      title: `Hold payouts for ${next} ${next === 1 ? 'day' : 'days'}?`,
      body: (
        <p>
          Money becomes payable {next} {next === 1 ? 'day' : 'days'} after a booking is done, instead of {value}. It applies to bookings resolved
          from now on; dates already set are never rewritten.
        </p>
      ),
      tone: 'warn',
      icon: 'timer',
      confirmLabel: 'Change the hold',
      cancelLabel: 'Keep it',
    });
    if (sure) save.mutate(next);
  };

  return (
    <Card
      icon="timer"
      tone="night"
      label="Payout hold"
      value={
        value === undefined ? (
          '…'
        ) : (
          <>
            {value}
            <small> {value === 1 ? 'day' : 'days'}</small>
          </>
        )
      }
      sub="How long after a booking is done before its money can be paid out — time for a customer to say something went wrong."
      action={!open && <ChangeButton onClick={() => setOpen(true)} />}
    >
      <div className="st-line" aria-hidden="true">
        <span>
          <Icon name="checkCircle" size={14} /> Done
        </span>
        <i>
          <em>
            {value ?? '…'} {value === 1 ? 'day' : 'days'}
          </em>
        </i>
        <span>
          <Icon name="banknote" size={14} /> Payable
        </span>
      </div>
      {open && value !== undefined && (
        <Change
          label="New hold"
          unit="days"
          initial={String(value)}
          step="1"
          min="0"
          busy={save.isPending}
          error={save.error}
          onSave={(n) => void ask(Math.round(n))}
          onCancel={() => {
            setOpen(false);
            save.reset();
          }}
        />
      )}
      {note && <footer>{note}</footer>}
    </Card>
  );
}

function RateCard({ data, onSaved }: { data?: ExchangeRateSettings; onSaved: () => void }) {
  const [open, setOpen] = useState<'rate' | 'threshold' | null>(null);
  const saveRate = useMutation({
    mutationFn: (next: number) => setExchangeRate(next),
    onSuccess: () => {
      setOpen(null);
      onSaved();
    },
  });
  const saveThreshold = useMutation({
    mutationFn: (hours: number) => setStaleness(hours),
    onSuccess: () => {
      setOpen(null);
      onSaved();
    },
  });
  useEffect(() => {
    if (open === null) {
      saveRate.reset();
      saveThreshold.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const off = data && !data.conversionInUse;
  const rate = data?.exchangeRateUsdToProviderCurrency ? Number(data.exchangeRateUsdToProviderCurrency) : null;
  const age = data?.ageInHours ?? null;
  const threshold = data?.stalenessThresholdHours ?? 24;

  const ask = async (next: number) => {
    const sure = await confirmDialog({
      title: 'Change the exchange rate?',
      body: (
        <p>
          1 {data?.internalCurrency} = <strong>{next.toLocaleString(undefined, { maximumFractionDigits: 8 })} {data?.providerCurrency}</strong>, from{' '}
          {rate?.toLocaleString(undefined, { maximumFractionDigits: 8 })}. Deposits are charged at it from now on; a booking already paid keeps the rate it
          was paid at.
        </p>
      ),
      tone: 'warn',
      icon: 'refresh',
      confirmLabel: 'Use this rate',
      cancelLabel: 'Keep it',
    });
    if (sure) saveRate.mutate(next);
  };

  return (
    <Card
      icon="refresh"
      tone={data?.stale ? 'warn' : 'ask'}
      label="Exchange rate"
      value={
        !data ? (
          '…'
        ) : off ? (
          <>
            1<small> {data.internalCurrency} = 1 {data.providerCurrency}</small>
          </>
        ) : (
          <>
            {rate?.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            <small>
              {' '}
              {data.providerCurrency} to 1 {data.internalCurrency}
            </small>
          </>
        )
      }
      sub={
        off ? (
          <>
            <strong>No conversion is in use.</strong> The platform prices and collects in {data?.internalCurrency}, so the rate is fixed at 1 and cannot go
            stale.
          </>
        ) : (
          <>
            What one {data?.internalCurrency ?? 'unit'} buys in the currency the operator charges. <strong>Set by hand — there is no live feed.</strong>
          </>
        )
      }
      action={!off && data && open === null && <ChangeButton onClick={() => setOpen('rate')} />}
    >
      {!off && data && (
        <>
          {data.stale && data.warning && (
            <p className="st-warn" role="alert">
              <Icon name="alert" size={15} /> {data.warning}
            </p>
          )}
          <div className="st-meter" title={`Warns after ${threshold} hours`}>
            <i style={{ width: `${age === null ? 0 : Math.min(100, (age / Math.max(1, threshold)) * 100)}%` }} className={data.stale ? 'is-stale' : ''} />
          </div>
          <p className="st-meter-text">
            {age === null ? 'Never set' : `Set ${age} h ago`}
            {data.exchangeRateUpdatedBy && ` by ${data.exchangeRateUpdatedBy.email}`} · administrators are warned after{' '}
            <button type="button" className="st-inline" onClick={() => setOpen('threshold')}>
              {threshold} hours
            </button>
            . A stale rate never stops a booking.
          </p>
          {open === 'rate' && rate !== null && (
            <Change
              label={`1 ${data.internalCurrency} =`}
              unit={data.providerCurrency}
              initial={String(rate)}
              step="0.00000001"
              min="0.00000001"
              busy={saveRate.isPending}
              error={saveRate.error}
              onSave={(n) => void ask(n)}
              onCancel={() => setOpen(null)}
            />
          )}
          {open === 'threshold' && (
            <Change
              label="Warn administrators after"
              unit="hours"
              initial={String(threshold)}
              step="1"
              min="0"
              max="720"
              busy={saveThreshold.isPending}
              error={saveThreshold.error}
              onSave={(n) => saveThreshold.mutate(Math.round(n))}
              onCancel={() => setOpen(null)}
            />
          )}
        </>
      )}
      {data && <footer>{data.note}</footer>}
    </Card>
  );
}

/**
 * Which operators this deployment can take money through (§96). Read-only: it
 * is a consequence of which credentials are configured, and a switch here
 * would invite someone to "turn Airtel on" in a way that cannot work.
 */
function ProvidersCard({
  data,
  loading,
}: {
  data?: { providers: string[]; suggested: string | null; choiceRequired: boolean };
  loading: boolean;
}) {
  const on = new Set(data?.providers ?? []);
  return (
    <Card
      icon="phone"
      tone={data && on.size === 0 ? 'danger' : 'ok'}
      label="Payment providers"
      value={
        loading || !data ? (
          '…'
        ) : (
          <>
            {on.size}
            <small> of {NETWORKS.length} operators</small>
          </>
        )
      }
      sub={
        <>
          Which mobile money operators deposits can be taken through. <strong>Set by credentials, not here.</strong>
        </>
      }
    >
      <ul className="st-ops">
        {NETWORKS.map((n) => (
          <li key={n} className={on.has(n) ? 'is-on' : ''}>
            <NetworkMark network={n} size={36} />
            <span>
              <b>{NETWORK_NAME[n]}</b>
              <em>{on.has(n) ? 'Taking deposits' : 'Not configured'}</em>
            </span>
            <Icon name={on.has(n) ? 'checkCircle' : 'minus'} size={18} />
          </li>
        ))}
      </ul>
      {data && (
        <footer>
          {on.size === 0
            ? 'No operator is configured, so no deposit can be taken.'
            : data.choiceRequired
              ? 'More than one is available, so a customer is asked to choose.'
              : 'One operator, so nothing is asked of the customer.'}
        </footer>
      )}
    </Card>
  );
}
