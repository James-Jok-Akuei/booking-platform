import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { getPlatformFee, listAdminCountries, updateCountry, type AdminCountry } from '../api/admin';
import { useMyAccess } from '../lib/access';
import { confirmDialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { NETWORK_NAME, NetworkMark, type Network } from '../ui/NetworkMark';
import { RwandaFlag } from '../ui/RwandaFlag';
import './countries.css';

const LANGUAGE: Record<string, string> = { en: 'English', rw: 'Kinyarwanda', fr: 'French' };

/** What each check is about, as a heading. */
const CHECK: Record<AdminCountry['checks'][number]['key'], string> = {
  pack: 'Known to the code',
  currency: 'Its money',
  clock: 'Its clock',
  phone: 'Phone numbers',
  networks: 'Mobile money',
  languages: 'Languages',
  places: 'Places',
};

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** The time it is there now, on its own clock. */
const nowIn = (timeZone: string) => {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date());
  } catch {
    return '—';
  }
};

/**
 * Countries (§315): where the platform runs, and what is different in each —
 * its money, its clock, its phone numbers and networks, its languages, its
 * places, and the platform's fee there.
 *
 * A country is added in code (its pack, and its places in the reference
 * data), never typed in here: what is here is switching one on once every
 * check passes, and giving it a fee of its own.
 */
export function CountriesPage() {
  const queryClient = useQueryClient();
  const countries = useQuery({ queryKey: ['admin-countries'], queryFn: listAdminCountries });
  const fee = useQuery({ queryKey: ['settings', 'fee'], queryFn: getPlatformFee });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin-countries'] });
  const live = (countries.data ?? []).filter((c) => c.isLive);

  return (
    <section className="cn">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Countries</h1>
            <p className="muted">
              Where the platform runs. A new country is added in code — its rules and its places — and switched on here once it is ready.
            </p>
          </div>
        </header>
      </div>

      {countries.data && (
        <p className="cn-lead">
          <Icon name="globe" size={16} />
          {live.length === 1 ? `Live in ${live[0].name}` : `Live in ${live.length} countries`} · each shop is in one, and customers see the shops of
          their own.
        </p>
      )}

      {countries.isLoading && <div className="skeleton cn-skel" />}
      {countries.error && (
        <p className="error" role="alert">
          {countries.error instanceof ApiError ? countries.error.message : 'Could not load the countries.'}
        </p>
      )}

      <div className="cn-list">
        {(countries.data ?? []).map((country, i) => (
          <CountryCard key={country.code} country={country} platformFee={fee.data?.platformFeePercentage ?? null} index={i} onChanged={refresh} />
        ))}
      </div>
    </section>
  );
}

function CountryCard({
  country: c,
  platformFee,
  index,
  onChanged,
}: {
  country: AdminCountry;
  platformFee: string | null;
  index: number;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  // Changing a fee is money work (§317); seeing it is not.
  const { money } = useMyAccess();
  const [editing, setEditing] = useState(false);
  const failing = c.checks.filter((check) => !check.ok);
  const update = useMutation({
    mutationFn: (body: { platformFeePercentage?: number | null; isLive?: boolean }) => updateCountry(c.code, body),
    onSuccess: () => {
      setEditing(false);
      onChanged();
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const switchLive = async (on: boolean) => {
    const sure = await confirmDialog({
      title: on ? `Switch ${c.name} on?` : `Switch ${c.name} off?`,
      body: on ? (
        <p>
          Shops can sign up there and, once approved, customers in {c.name} can find and book them — on {c.timeZone} time, paying in {c.currency}.
        </p>
      ) : (
        <p>Its shops stop being found. Refused while any of them is live.</p>
      ),
      tone: on ? 'ok' : 'warn',
      icon: 'globe',
      confirmLabel: on ? 'Switch it on' : 'Switch it off',
      cancelLabel: 'Not now',
    });
    if (sure) update.mutate({ isLive: on });
  };

  const own = c.platformFeePercentage !== null;
  const shown = (pct: string) => `${Number(pct) % 1 === 0 ? Number(pct).toFixed(0) : Number(pct)}%`;

  return (
    <article className={`cn-card${c.isLive ? ' is-live' : ''}`} style={{ animationDelay: `${index * 50}ms` }}>
      <header className="cn-head">
        <span className="cn-flag">{c.code === 'RW' ? <RwandaFlag width={40} /> : <Icon name="globe" size={22} />}</span>
        <div className="cn-title">
          <h2>{c.name}</h2>
          <span>
            {c.code} · {c.liveSince ? `live since ${day(c.liveSince)}` : 'not live'}
          </span>
        </div>
        <span className="cn-pills">
          {c.isDefault && <span className="pill booked">Default</span>}
          <span className={`pill ${c.isLive ? 'approved' : 'pending'}`}>{c.isLive ? 'Live' : 'Not live'}</span>
        </span>
      </header>

      <dl className="cn-facts">
        <div>
          <dt>Money</dt>
          <dd>{c.currency}</dd>
        </div>
        <div>
          <dt>Clock</dt>
          <dd>
            {c.timeZone.replace('_', ' ')} <em>· {nowIn(c.timeZone)} there now</em>
          </dd>
        </div>
        <div>
          <dt>Phone numbers</dt>
          <dd>
            +{c.callingCode} <em>· {c.phoneExample}</em>
          </dd>
        </div>
        <div>
          <dt>Paid through</dt>
          <dd className="cn-networks">
            {c.networks.map((n) => (
              <span key={n}>
                <NetworkMark network={n as Network} size={20} />
                {NETWORK_NAME[n as Network]}
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt>Languages</dt>
          <dd>{c.locales.map((l) => LANGUAGE[l] ?? l).join(', ')}</dd>
        </div>
        <div>
          <dt>Shops</dt>
          <dd>
            {c.liveShops} live <em>· {c.shops} in all · {c.places} districts open</em>
          </dd>
        </div>
      </dl>

      <div className="cn-fee">
        <span className="cn-fee-icon">
          <Icon name="percent" size={17} />
        </span>
        <div>
          <strong>
            Fee {shown(c.effectiveFeePercentage)}
            <em>{own ? ' — its own' : ' — the platform’s'}</em>
          </strong>
          <span>
            {own && platformFee !== null
              ? `The platform’s is ${shown(platformFee)}. Bookings already made keep the fee they were made with.`
              : 'Set under Settings, for every country without a fee of its own.'}
          </span>
        </div>
        {!editing && money && (
          <span className="cn-fee-actions">
            {own && (
              <button type="button" disabled={update.isPending} onClick={() => update.mutate({ platformFeePercentage: null })}>
                Use the platform’s
              </button>
            )}
            <button type="button" onClick={() => setEditing(true)}>
              <Icon name="pencil" size={14} /> {own ? 'Change' : 'Give it its own'}
            </button>
          </span>
        )}
      </div>
      {editing && (
        <FeeChange
          initial={own ? String(Number(c.platformFeePercentage)) : String(Number(c.effectiveFeePercentage))}
          busy={update.isPending}
          onSave={(n) => update.mutate({ platformFeePercentage: n })}
          onCancel={() => {
            setEditing(false);
            update.reset();
          }}
        />
      )}

      <ul className="cn-checks" aria-label={`What ${c.name} needs to be on`}>
        {c.checks.map((check) => (
          <li key={check.key} className={check.ok ? 'is-ok' : 'is-missing'}>
            <Icon name={check.ok ? 'checkCircle' : 'alert'} size={16} />
            <span>
              <strong>{CHECK[check.key]}</strong>
              <em>{check.words}</em>
            </span>
          </li>
        ))}
      </ul>

      {update.error && !editing && (
        <p className="error small" role="alert">
          {update.error instanceof ApiError ? update.error.message : 'That did not work.'}
        </p>
      )}

      <footer className="cn-foot">
        {c.isDefault ? (
          <span className="muted small">The default country is always on: visitors who have not chosen one are here, and new shops start here.</span>
        ) : c.isLive ? (
          <button type="button" className="danger" disabled={update.isPending} onClick={() => void switchLive(false)}>
            Switch off
          </button>
        ) : (
          <>
            <span className="muted small">{failing.length === 0 ? 'Ready to switch on.' : `${failing.length} to do before it can be switched on.`}</span>
            <button type="button" className="primary" disabled={update.isPending || failing.length > 0} onClick={() => void switchLive(true)}>
              <Icon name="globe" size={15} /> Switch on
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

/** Its own fee, typed in place: two decimals, 0–100. */
function FeeChange({ initial, busy, onSave, onCancel }: { initial: string; busy: boolean; onSave: (n: number) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const n = Number(draft);
  const valid = draft.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onSave(Math.round(n * 100) / 100);
  };
  return (
    <form className="cn-change" onSubmit={submit}>
      <label>
        <span>Its own fee</span>
        <span className="cn-input">
          <input type="number" step="0.01" min="0" max="100" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
          <b>%</b>
        </span>
      </label>
      <div>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy || !valid}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
