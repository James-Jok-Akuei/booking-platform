import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  createService,
  listLocations,
  listServices,
  setServiceOfferedAt,
  retireService,
  updateService,
  type Location,
  type Service,
} from '../api/business';
import { useMoney } from '../money';

/**
 * What the business sells, and for how much.
 *
 * Services belong to the BUSINESS, not to a location (§10.2) — so a price
 * change applies at every branch at once. The page says so, because an owner
 * with two branches will reasonably expect otherwise.
 */
export function ServicesPage() {
  const queryClient = useQueryClient();
  const money = useMoney();
  const [adding, setAdding] = useState(false);

  const services = useQuery({ queryKey: ['services'], queryFn: listServices });
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['services'] });

  const save = useMutation({
    mutationFn: (input: { id?: string; body: Record<string, unknown> }) =>
      input.id
        ? updateService(input.id, input.body)
        : createService(input.body as never),
    onSuccess: () => {
      setAdding(false);
      refresh();
    },
  });

  const retire = useMutation({ mutationFn: retireService, onSuccess: refresh });

  /**
   * Pausing or resuming at one branch (§74). Separate from retiring, which is
   * "we have stopped doing this at all" rather than "not here, for now".
   */
  const toggle = useMutation({
    mutationFn: (input: { id: string; locationId: string; isOffered: boolean }) =>
      setServiceOfferedAt(input.id, input.locationId, input.isOffered),
    onSuccess: (result) => {
      // Pausing the last branch leaves it bookable by nobody. Worth saying
      // once, in the server's own words rather than a guess made here.
      if (!result.isOffered && result.offeredAtCount === 0) window.alert(result.message);
      refresh();
    },
  });

  /**
   * Grouped by whether a customer can book it, not by the `isActive` flag.
   *
   * A service everybody has paused is in exactly the same position as a retired
   * one — in your catalogue, bookable by nobody — so it belongs in the same
   * section, where there is an obvious way to bring it back. Splitting on the
   * flag instead left it sitting among the live services with a red warning,
   * which reads as a fault rather than a choice.
   */
  const onSale =
    services.data?.filter((s) => s.isActive && s.locations.some((o) => o.isOffered)) ?? [];
  const notOnSale =
    services.data?.filter((s) => !s.isActive || !s.locations.some((o) => o.isOffered)) ??
    [];

  return (
    <section>
      <header className="page-head">
        <h1>Services</h1>
        <button type="button" className="primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : 'Add a service'}
        </button>
      </header>

      <p className="muted small" style={{ maxWidth: '64ch' }}>
        Each service is offered at the branches you choose, at{' '}
        <strong>that branch's price</strong> — a city-centre shop can charge more
        than a quieter one for the same work. The deposit percentage is what a
        customer pays up front to hold the slot; the rest is settled with you
        directly.
      </p>

      {(save.error || retire.error || toggle.error) && (
        <p className="error" role="alert">
          {(save.error ?? retire.error ?? toggle.error) instanceof ApiError
            ? (save.error ?? retire.error ?? toggle.error)!.message
            : 'That did not work.'}
        </p>
      )}

      {adding && (
        <ServiceForm
          money={money}
          locations={locations.data ?? []}
          busy={save.isPending}
          onSubmit={(body) => save.mutate({ body })}
        />
      )}

      {services.isLoading && <p className="muted">Loading…</p>}

      {onSale.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Price</th>
              <th>Deposit</th>
              <th>Length</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {onSale.map((service) => (
              <ServiceRow
                key={service.id}
                service={service}
                money={money}
                locations={locations.data ?? []}
                busy={save.isPending || retire.isPending || toggle.isPending}
                onSave={(body) => save.mutate({ id: service.id, body })}
                onToggle={(locationId, isOffered) =>
                  toggle.mutate({ id: service.id, locationId, isOffered })
                }
                onRetire={() => {
                  if (
                    window.confirm(
                      `Stop offering "${service.name}" at every branch?\n\n` +
                        'It moves to "Not on sale", keeps its prices, and you can put it ' +
                        'back at any time. Appointments already made are unaffected.',
                    )
                  ) {
                    retire.mutate(service.id);
                  }
                }}
              />
            ))}
          </tbody>
        </table>
      )}

      {notOnSale.length > 0 && (
        <>
          <h2 className="section-title">Not on sale</h2>
          <p className="muted small" style={{ maxWidth: '64ch' }}>
            Still yours, and bookable by nobody. Kept so past appointments
            resolve to what was booked. Switch a branch back on — or press
            <strong> Put back on sale </strong> if you retired it everywhere.
          </p>
          <table>
            <thead>
              <tr>
                <th>Service</th>
                <th>Branches</th>
                <th>Deposit</th>
                <th>Length</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {notOnSale.map((service) => (
                <ServiceRow
                  key={service.id}
                  service={service}
                  money={money}
                  locations={locations.data ?? []}
                  busy={save.isPending || retire.isPending || toggle.isPending}
                  onSave={(body) => save.mutate({ id: service.id, body })}
                  onToggle={(locationId, isOffered) =>
                    toggle.mutate({ id: service.id, locationId, isOffered })
                  }
                  onRetire={() => save.mutate({ id: service.id, body: { isActive: true } })}
                  retireLabel="Put back on sale"
                  retireIsRestore={!service.isActive}
                />
              ))}
            </tbody>
          </table>
        </>
      )}

    </section>
  );
}

function ServiceForm({
  money,
  locations,
  busy,
  initial,
  onSubmit,
  onCancel,
}: {
  money: ReturnType<typeof useMoney>;
  locations: Location[];
  busy: boolean;
  initial?: Service;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [duration, setDuration] = useState(String(initial?.durationMinutes ?? 30));
  const [deposit, setDeposit] = useState(initial?.depositPercentage ?? '20');

  /**
   * One price box per branch, empty meaning "not offered here".
   *
   * Price and branch are the SAME decision since §72 — a price with no branch
   * means nothing — so they are one control rather than a checkbox that then
   * reveals a field. An empty box is how you stop offering it somewhere.
   */
  const [prices, setPrices] = useState<Record<string, string>>(() => {
    const byLocation = new Map(
      (initial?.locations ?? []).map((o) => [o.locationId, o.priceMinor]),
    );
    return Object.fromEntries(
      locations.map((l) => [
        l.id,
        byLocation.has(l.id) ? money.toMajor(byLocation.get(l.id)!) : '',
      ]),
    );
  });

  const offers = locations
    .filter((l) => prices[l.id]?.trim() !== '' && prices[l.id] !== undefined)
    .map((l) => ({ locationId: l.id, priceMinor: money.toMinor(prices[l.id]) }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (offers.length === 0) {
      window.alert('Give a price at a least one branch, or nobody can book it.');
      return;
    }
    onSubmit({
      name: name.trim(),
      durationMinutes: Number(duration),
      depositPercentage: Number(deposit),
      offers,
    });
  };

  return (
    <form className="card service-form" onSubmit={submit}>
      <div>
        <label htmlFor="sname">Name</label>
        <input id="sname" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div>
        <label htmlFor="sdur">Minutes</label>
        <input
          id="sdur"
          type="number"
          min="5"
          step="5"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          required
        />
      </div>
      <div>
        <label htmlFor="sdep">Deposit %</label>
        <input
          id="sdep"
          type="number"
          min="0"
          max="100"
          value={deposit}
          onChange={(e) => setDeposit(e.target.value)}
          required
        />
      </div>
      <div className="branch-prices">
        <span className="muted small">Price per branch ({money.code})</span>
        {locations.map((location) => (
          <label key={location.id} className="branch-price">
            <span>{location.name}</span>
            <input
              type="number"
              min="0"
              step={money.exponent === 0 ? '1' : '0.01'}
              placeholder="not offered"
              value={prices[location.id] ?? ''}
              onChange={(e) =>
                setPrices((current) => ({ ...current, [location.id]: e.target.value }))
              }
            />
          </label>
        ))}
        <span className="muted small">Leave a branch blank to stop offering it there.</span>
      </div>

      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {onCancel && (
          <button type="button" className="link" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function ServiceRow({
  service,
  money,
  locations,
  busy,
  onSave,
  onRetire,
  onToggle,
  retireLabel,
  retireIsRestore,
}: {
  service: Service;
  money: ReturnType<typeof useMoney>;
  locations: Location[];
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
  onRetire: () => void;
  onToggle: (locationId: string, isOffered: boolean) => void;
  /** Wording for the row's whole-service action. */
  retireLabel?: string;
  /** True in the "not on sale" table, where the action restores rather than retires. */
  retireIsRestore?: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <tr>
        <td colSpan={5}>
          <ServiceForm
            money={money}
            locations={locations}
            busy={busy}
            initial={service}
            onCancel={() => setEditing(false)}
            onSubmit={(body) => {
              onSave(body);
              setEditing(false);
            }}
          />
        </td>
      </tr>
    );
  }

  // The deposit is a percentage, so it differs per branch wherever the price
  // does. Shown against the cheapest, which is the smallest a customer ever
  // hands over.
  const onSale = service.locations.filter((o) => o.isOffered);
  const cheapest = onSale.length ? Math.min(...onSale.map((o) => o.priceMinor)) : null;
  const depositMinor =
    cheapest === null
      ? null
      : Math.round((cheapest * Number(service.depositPercentage)) / 100);

  return (
    <tr>
      <td>
        <strong>{service.name}</strong>
      </td>
      <td>
        {service.locations.filter((o) => o.isOffered).length === 0 ? (
          // No branch is selling it. Stated plainly rather than left as an
          // empty column, but not as an error — it is a choice, not a fault.
          <span className="muted small">Switched off at every branch</span>
        ) : null}
        {service.locations.length > 0 && (
          service.locations.map((offer) => (
            // The switch sits next to that branch's price, not in the row's
            // shared actions — it is a decision about one shop, and a single
            // control among the row actions could only mean all of them.
            <label
              key={offer.locationId}
              className={offer.isOffered ? 'branch-line' : 'branch-line off'}
            >
              <input
                type="checkbox"
                checked={offer.isOffered}
                disabled={busy}
                onChange={(e) => onToggle(offer.locationId, e.target.checked)}
                title={offer.isOffered ? 'On sale here' : 'Paused here'}
              />
              {money.format(offer.priceMinor)}
              <span className="muted small"> · {offer.location.name}</span>
              {!offer.isOffered && <span className="muted small">(paused)</span>}
            </label>
          ))
        )}
      </td>
      <td>
        {service.depositPercentage}%
        {depositMinor !== null && (
          <div className="muted small">from {money.format(depositMinor)} up front</div>
        )}
      </td>
      <td>{service.durationMinutes} min</td>
      <td className="actions">
        <button type="button" className="link" onClick={() => setEditing(true)}>
          Edit
        </button>
        {/* Only shown where it means something: a service already off sale
            everywhere has nothing left to retire. */}
        {retireIsRestore ? (
          <button type="button" className="link" disabled={busy} onClick={onRetire}>
            {retireLabel ?? 'Put back on sale'}
          </button>
        ) : (
          !retireLabel && (
            <button
              type="button"
              className="link danger-link"
              disabled={busy}
              onClick={onRetire}
            >
              Stop offering everywhere
            </button>
          )
        )}
      </td>
    </tr>
  );
}
