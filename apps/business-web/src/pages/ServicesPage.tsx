import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { SellerAgreementGate, useOutstandingLegal } from '../components/LegalGate';
import {
  createService,
  discardServiceDraft,
  listServiceDrafts,
  saveServiceDraft,
  startServiceDraft,
  type ServiceDraft,
  listLocations,
  listServices,
  setServiceOfferedAt,
  setServiceOfferedEverywhere,
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

  /**
   * The draft behind the "add a service" form (§123).
   *
   * One draft per open form, created when it opens and thrown away when the
   * service is actually created — a draft that outlived its service would sit in
   * the Unfinished list forever, describing something that already exists.
   *
   * The debounce lives HERE rather than in the form, because the form unmounts
   * the moment it closes and that is exactly when the last keystroke still needs
   * saving. A ref holds the timer so a re-render does not start a second one.
   */
  const [draftId, setDraftId] = useState<string | null>(null);
  const [resumed, setResumed] = useState<Service | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const drafts = useQuery({ queryKey: ['service-drafts'], queryFn: listServiceDrafts });
  const refreshDrafts = () =>
    queryClient.invalidateQueries({ queryKey: ['service-drafts'] });

  const discard = useMutation({
    mutationFn: discardServiceDraft,
    onSuccess: refreshDrafts,
  });

  const queueDraftSave = (values: {
    name: string;
    durationMinutes: number | null;
    depositPercentage: number | null;
    offers: Array<{ locationId: string; priceMinor: number }>;
  }) => {
    if (!draftId) return;
    if (timer.current) clearTimeout(timer.current);
    // Long enough that typing a name is one save rather than eleven, short
    // enough that closing the laptop lid loses a sentence and not a service.
    timer.current = setTimeout(() => {
      saveServiceDraft(draftId, {
        name: values.name || null,
        durationMinutes: values.durationMinutes,
        depositPercentage: values.depositPercentage,
        offers: values.offers,
      })
        .then(refreshDrafts)
        // Silent on purpose: an auto-save that interrupts with an error box
        // while somebody is typing is worse than one that quietly retries on the
        // next keystroke. Nothing is lost — the form still holds the text.
        .catch(() => undefined);
    }, 1200);
  };

  /** Reopens the form with a draft's contents, and keeps saving into it. */
  const resume = (draft: ServiceDraft) => {
    setDraftId(draft.id);
    setResumed({
      id: draft.id,
      name: draft.name ?? '',
      description: draft.description,
      durationMinutes: draft.durationMinutes ?? 30,
      depositPercentage: draft.depositPercentage ?? '20',
      isActive: true,
      locations: draft.offers.map((offer) => ({
        locationId: offer.locationId,
        priceMinor: offer.priceMinor,
      })),
    } as unknown as Service);
    setAdding(true);
  };

  const { sellerAgreement } = useOutstandingLegal();
  const [gateOpen, setGateOpen] = useState(false);

  const save = useMutation({
    mutationFn: (input: { id?: string; body: Record<string, unknown> }) =>
      input.id
        ? updateService(input.id, input.body)
        : createService(input.body as never),
    onSuccess: () => {
      setAdding(false);
      // The draft became a service. Keeping it would leave the Unfinished list
      // describing something that already exists.
      if (draftId) discard.mutate(draftId);
      setDraftId(null);
      setResumed(undefined);
      refresh();
    },
  });

  /** Every branch at once. Acts on the branches, never on the retired flag. */
  const everywhere = useMutation({
    mutationFn: (input: { id: string; isOffered: boolean }) =>
      setServiceOfferedEverywhere(input.id, input.isOffered),
    onSuccess: refresh,
  });

  /**
   * Un-retires a service whose own flag was turned off through the API.
   *
   * The screen never sets that flag — "everywhere" is a statement about
   * branches (§76) — but a service retired before this existed still needs a
   * way back.
   */
  const unretire = useMutation({
    mutationFn: (id: string) => updateService(id, { isActive: true }),
    onSuccess: refresh,
  });

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
      {gateOpen && sellerAgreement && (
        <SellerAgreementGate
          document={sellerAgreement}
          onCancel={() => setGateOpen(false)}
          onAccepted={async () => {
            setGateOpen(false);
            // Straight on to what they were trying to do. Accepting and then
            // being returned to where they started is a second thing to do.
            const draft = await startServiceDraft().catch(() => null);
            setDraftId(draft?.id ?? null);
            setAdding(true);
            refreshDrafts();
          }}
        />
      )}
      <header className="page-head">
        <h1>Services</h1>
        <button
          type="button"
          className="primary"
          onClick={async () => {
            if (adding) {
              // Closing keeps the draft. That is the whole point: the text is
              // still there under Unfinished when they come back.
              setAdding(false);
              setDraftId(null);
              setResumed(undefined);
              return;
            }
            setResumed(undefined);
            // Started BEFORE the form opens, so the first keystroke has
            // somewhere to go rather than being the one that gets lost.
            // Asked BEFORE the form opens, not after it is filled in (§126.4).
            // Making somebody write a whole service and then telling them they
            // cannot post it is the worst possible moment to raise this.
            if (sellerAgreement) {
              setGateOpen(true);
              return;
            }
            const draft = await startServiceDraft().catch(() => null);
            setDraftId(draft?.id ?? null);
            setAdding(true);
            refreshDrafts();
          }}
        >
          {adding ? 'Close' : 'Add a service'}
        </button>
      </header>

      <p className="muted small" style={{ maxWidth: '64ch' }}>
        Each service is offered at the branches you choose, at{' '}
        <strong>that branch's price</strong> — a city-centre shop can charge more
        than a quieter one for the same work. The deposit percentage is what a
        customer pays up front to hold the slot; the rest is settled with you
        directly.
      </p>

      {(save.error || everywhere.error || toggle.error || unretire.error) && (
        <p className="error" role="alert">
          {(save.error ?? everywhere.error ?? toggle.error ?? unretire.error) instanceof
          ApiError
            ? (save.error ?? everywhere.error ?? toggle.error ?? unretire.error)!.message
            : 'That did not work.'}
        </p>
      )}

      {/* Unfinished services, shared by the shop (§123). Above the form, because
          the question "did I already start this?" comes before writing it again. */}
      {!adding && (drafts.data?.length ?? 0) > 0 && (
        <div className="card">
          <h2>Unfinished</h2>
          <ul className="card-list">
            {drafts.data?.map((item) => (
              <li key={item.id}>
                <div className="card-row" style={{ cursor: 'default' }}>
                  <div>
                    <strong>{item.name || 'Untitled service'}</strong>
                    <div className="muted small">
                      Last saved {new Date(item.updatedAt).toLocaleString()} ·
                      started by {item.createdBy.email}
                    </div>
                  </div>
                  <div className="row-end">
                    <button type="button" onClick={() => resume(item)}>
                      Carry on
                    </button>
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        if (window.confirm('Throw this draft away?')) {
                          discard.mutate(item.id);
                        }
                      }}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {adding && (
        <ServiceForm
          key={draftId ?? 'new'}
          money={money}
          locations={locations.data ?? []}
          busy={save.isPending}
          initial={resumed}
          onSubmit={(body) => save.mutate({ body })}
          onChange={queueDraftSave}
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
                busy={save.isPending || everywhere.isPending || toggle.isPending || unretire.isPending}
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
                    everywhere.mutate({ id: service.id, isOffered: false });
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
                  busy={save.isPending || everywhere.isPending || toggle.isPending || unretire.isPending}
                  onSave={(body) => save.mutate({ id: service.id, body })}
                  onToggle={(locationId, isOffered) =>
                    toggle.mutate({ id: service.id, locationId, isOffered })
                  }
                  // Two different ways back, because they undo two different
                  // things: a service retired through the API needs its flag
                  // cleared, and one simply switched off everywhere needs its
                  // branches turned back on.
                  onRetire={() =>
                    service.isActive
                      ? everywhere.mutate({ id: service.id, isOffered: true })
                      : unretire.mutate(service.id)
                  }
                  retireLabel="Put back on sale"
                  retireIsRestore
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
  onChange,
}: {
  money: ReturnType<typeof useMoney>;
  locations: Location[];
  busy: boolean;
  initial?: Service;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel?: () => void;
  /**
   * Called whenever anything in the form changes, so a NEW service can be kept
   * as a draft while it is being written (§123). Absent when editing an existing
   * service, which is already saved and needs no draft.
   */
  onChange?: (values: {
    name: string;
    durationMinutes: number | null;
    depositPercentage: number | null;
    offers: Array<{ locationId: string; priceMinor: number }>;
  }) => void;
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

  // Reported on every change; the PAGE decides how often to actually save.
  // Debouncing here would put the timer in the component that unmounts when the
  // form closes, which is exactly when the last keystroke still needs saving.
  useEffect(() => {
    onChange?.({
      name,
      durationMinutes: Number(duration) || null,
      depositPercentage: deposit === '' ? null : Number(deposit),
      offers,
    });
    // `offers` is derived from `prices` and rebuilt each render, so watching it
    // directly would fire this on every render rather than on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, duration, deposit, prices]);

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
  const onSale = service.isActive
    ? service.locations.filter((o) => o.isOffered)
    : [];
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
        {onSale.length === 0 ? (
          // No branch is selling it. Stated plainly rather than left as an
          // empty column, but not as an error — it is a choice, not a fault.
          <span className="muted small">
            {service.isActive ? 'Switched off at every branch' : 'Service stopped'}
          </span>
        ) : null}
        {service.locations.length > 0 && (
          service.locations.map((offer) => (
            // A button per branch, worded like the row's whole-service action
            // so the pair reads as one idea at two scales: "here" and
            // "everywhere". It sits beside that branch's price rather than
            // among the row actions, where it could only mean all of them.
            <div
              key={offer.locationId}
              className={
                offer.isOffered && service.isActive ? 'branch-line' : 'branch-line off'
              }
            >
              <span className="branch-price-label">
                {money.format(offer.priceMinor)}
                <span className="muted small"> · {offer.location.name}</span>
              </span>
              {/* Reads the EFFECTIVE state, not the branch flag alone. A
                  retired service sells nothing anywhere, so offering to "stop
                  offering here" would be stopping something already stopped —
                  which is what this row used to say. */}
              {!service.isActive ? (
                <span className="muted small">service stopped</span>
              ) : offer.isOffered ? (
                <button
                  type="button"
                  className="link danger-link tiny"
                  disabled={busy}
                  onClick={() => onToggle(offer.locationId, false)}
                >
                  Stop offering here
                </button>
              ) : (
                <button
                  type="button"
                  className="link tiny"
                  disabled={busy}
                  onClick={() => onToggle(offer.locationId, true)}
                >
                  Put back on sale here
                </button>
              )}
            </div>
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
