import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  getExchangeRate,
  getPayoutHold,
  getPlatformFee,
  setExchangeRate,
  setPayoutHold,
  setPlatformFee,
  setStaleness,
} from '../api/admin';

/**
 * The four platform-wide numbers.
 *
 * Each one is saved on its own, because each one means something different and
 * three of them change money. A single "Save settings" button would let someone
 * adjust the payout hold and silently ship a fee change they had typed over
 * earlier and forgotten.
 */
export function SettingsPage() {
  const queryClient = useQueryClient();

  const fee = useQuery({ queryKey: ['settings', 'fee'], queryFn: getPlatformFee });
  const rate = useQuery({ queryKey: ['settings', 'rate'], queryFn: getExchangeRate });
  const hold = useQuery({ queryKey: ['settings', 'hold'], queryFn: getPayoutHold });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['settings'] });

  return (
    <section>
      <header className="page-head">
        <h1>Settings</h1>
      </header>

      <PlatformFeeCard
        value={fee.data?.platformFeePercentage}
        updatedAt={fee.data?.updatedAt ?? null}
        onSaved={invalidate}
      />

      <ExchangeRateCard data={rate.data} onSaved={invalidate} />

      <PayoutHoldCard
        value={hold.data?.payoutHoldDays}
        note={hold.data?.note}
        onSaved={invalidate}
      />
    </section>
  );
}

/** One setting, one form, one save. */
function SettingCard({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card setting">
      <div className="setting-head">
        <h2>{title}</h2>
        <p className="muted small">{description}</p>
      </div>
      {children}
    </div>
  );
}

function useSaved(mutation: { isSuccess: boolean }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!mutation.isSuccess) return;
    setSaved(true);
    const timer = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [mutation.isSuccess]);
  return saved;
}

function PlatformFeeCard({
  value,
  updatedAt,
  onSaved,
}: {
  value?: string;
  updatedAt: string | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState('');
  useEffect(() => setDraft(value ?? ''), [value]);

  const save = useMutation({
    mutationFn: (next: number) => setPlatformFee(next),
    onSuccess: onSaved,
  });
  const saved = useSaved(save);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(Number(draft));
  };

  return (
    <SettingCard
      title="Platform fee"
      description={
        <>
          The platform's share, as a percentage of the <strong>service price</strong>.
          Applies to <strong>future bookings only</strong> — every existing
          appointment keeps the fee it was booked at.
        </>
      }
    >
      <form onSubmit={submit} className="setting-form">
        <label htmlFor="fee">Percentage</label>
        <input
          id="fee"
          type="number"
          step="0.01"
          min="0"
          max="100"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={save.isPending || draft === (value ?? '')}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="ok small">Saved</span>}
      </form>

      {/* A raise is refused outright when any active service takes a deposit
          smaller than the new fee — the business's share would go negative
          (§40). The server names the offending services; show that verbatim. */}
      {save.error && (
        <p className="error small" role="alert">
          {save.error instanceof ApiError ? save.error.message : 'Could not save.'}
        </p>
      )}
      {updatedAt && (
        <p className="muted small">Last changed {new Date(updatedAt).toLocaleString()}</p>
      )}
    </SettingCard>
  );
}

function ExchangeRateCard({
  data,
  onSaved,
}: {
  data?: {
    internalCurrency: string;
    providerCurrency: string;
    exchangeRateUsdToProviderCurrency: string | null;
    conversionInUse: boolean;
    stale: boolean;
    warning: string | null;
    note: string;
    ageInHours: number | null;
    stalenessThresholdHours: number;
    exchangeRateUpdatedBy: { email: string } | null;
  };
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [threshold, setThreshold] = useState('');
  useEffect(() => {
    setDraft(data?.exchangeRateUsdToProviderCurrency ?? '');
    setThreshold(String(data?.stalenessThresholdHours ?? ''));
  }, [data]);

  const saveRate = useMutation({
    mutationFn: (next: number) => setExchangeRate(next),
    onSuccess: onSaved,
  });
  const saveThreshold = useMutation({
    mutationFn: (hours: number) => setStaleness(hours),
    onSuccess: onSaved,
  });
  const savedRate = useSaved(saveRate);

  return (
    <SettingCard
      title="Exchange rate"
      description={
        <>
          What one {data?.internalCurrency ?? 'unit'} buys in the currency the
          payment provider charges. <strong>Set by hand — there is no live feed.</strong>
        </>
      }
    >
      {/* When the provider charges in the unit of account there is nothing to
          convert: the rate is pinned at 1 and cannot go stale (§69.1). Saying so
          is better than showing an editable field that only accepts one value. */}
      {data && !data.conversionInUse ? (
        <p className="notice">
          <strong>No conversion is in use.</strong> The platform prices and
          collects in {data.internalCurrency}, so the rate is fixed at 1 and
          cannot go stale. This becomes editable only if the provider is
          switched to another currency.
        </p>
      ) : (
        <>
          {data?.stale && data.warning && (
            <p className="error small" role="alert">
              {data.warning}
            </p>
          )}
          <form
            className="setting-form"
            onSubmit={(event) => {
              event.preventDefault();
              saveRate.mutate(Number(draft));
            }}
          >
            <label htmlFor="rate">
              1 {data?.internalCurrency} = ? {data?.providerCurrency}
            </label>
            <input
              id="rate"
              type="number"
              step="0.00000001"
              min="0.00000001"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" disabled={saveRate.isPending}>
              {saveRate.isPending ? 'Saving…' : 'Save rate'}
            </button>
            {savedRate && <span className="ok small">Saved</span>}
          </form>

          <form
            className="setting-form"
            onSubmit={(event) => {
              event.preventDefault();
              saveThreshold.mutate(Number(threshold));
            }}
          >
            <label htmlFor="threshold">Warn admins after (hours)</label>
            <input
              id="threshold"
              type="number"
              min="0"
              max="720"
              value={threshold}
              onChange={(event) => setThreshold(event.target.value)}
            />
            <button type="submit" disabled={saveThreshold.isPending}>
              Save threshold
            </button>
          </form>

          {data?.ageInHours !== null && data?.ageInHours !== undefined && (
            <p className="muted small">
              Last set {data.ageInHours}h ago
              {data.exchangeRateUpdatedBy && ` by ${data.exchangeRateUpdatedBy.email}`}.
              A stale rate never blocks a booking — deposits are still charged at it.
            </p>
          )}
        </>
      )}

      {(saveRate.error || saveThreshold.error) && (
        <p className="error small" role="alert">
          {(saveRate.error ?? saveThreshold.error) instanceof ApiError
            ? (saveRate.error ?? saveThreshold.error)!.message
            : 'Could not save.'}
        </p>
      )}
      {data && <p className="muted small">{data.note}</p>}
    </SettingCard>
  );
}

function PayoutHoldCard({
  value,
  note,
  onSaved,
}: {
  value?: number;
  note?: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState('');
  useEffect(() => setDraft(value === undefined ? '' : String(value)), [value]);

  const save = useMutation({
    mutationFn: (days: number) => setPayoutHold(days),
    onSuccess: onSaved,
  });
  const saved = useSaved(save);

  return (
    <SettingCard
      title="Payout hold"
      description={
        <>
          How long after an appointment resolves before its money becomes
          payable. The hold in force <strong>at resolution time</strong> is the
          one that applies — dates already set are never rewritten.
        </>
      }
    >
      <form
        className="setting-form"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(Number(draft));
        }}
      >
        <label htmlFor="hold">Days</label>
        <input
          id="hold"
          type="number"
          min="0"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={save.isPending || draft === String(value ?? '')}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="ok small">Saved</span>}
      </form>
      {save.error && (
        <p className="error small" role="alert">
          {save.error instanceof ApiError ? save.error.message : 'Could not save.'}
        </p>
      )}
      {note && <p className="muted small">{note}</p>}
    </SettingCard>
  );
}
