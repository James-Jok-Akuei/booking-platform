import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { ImageButton } from '../components/ImageButton';
import {
  addServiceImage,
  getServiceImages,
  removeServiceImage,
} from '../api/business';

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

  /**
   * Posting a NEW service is one act (§165): the service, then its photos, in
   * the order they were chosen, with the button saying which photo is going.
   * The service exists from the first step; a photo that fails after it is
   * reported with the service kept, never a service that quietly vanished.
   */
  const [posting, setPosting] = useState<string | null>(null);
  const [postProblem, setPostProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (input: { id?: string; body: Record<string, unknown>; files?: File[] }) => {
      if (input.id) return updateService(input.id, input.body);
      setPostProblem(null);
      setPosting('Posting the service…');
      const created = await createService(input.body as never);
      const files = input.files ?? [];
      const failed: string[] = [];
      for (const [index, file] of files.entries()) {
        setPosting(`Uploading photo ${index + 1} of ${files.length}…`);
        try {
          await addServiceImage(created.id, file);
        } catch (error) {
          failed.push(error instanceof ApiError ? error.message : file.name);
        }
      }
      if (failed.length > 0) {
        setPostProblem(
          `The service is posted, but ${failed.length} of ${files.length} photo(s) did not upload: ` +
            `${failed[0]}. Add them from Edit on the service below.`,
        );
      }
      return created;
    },
    onSettled: () => setPosting(null),
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
          busyLabel={posting ?? undefined}
          creating
          onSubmit={(body, files) => save.mutate({ body, files })}
          onChange={queueDraftSave}
        />
      )}
      {postProblem && (
        <p className="error small" role="alert">
          {postProblem}
        </p>
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
  busyLabel,
  creating = false,
  initial,
  onSubmit,
  onCancel,
  onChange,
}: {
  money: ReturnType<typeof useMoney>;
  locations: Location[];
  busy: boolean;
  /** What the button says while busy, e.g. "Uploading photo 2 of 5…". */
  busyLabel?: string;
  /** A NEW service (or a draft of one): photos are chosen here and the button posts. */
  creating?: boolean;
  initial?: Service;
  /** `files` are the photos chosen for a NEW service, cover first (§165). */
  onSubmit: (body: Record<string, unknown>, files: File[]) => void;
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
  // Whether one booking may be for more than one, and what "more" means (§136).
  const [quantityMode, setQuantityMode] = useState<Service['quantityMode']>(
    initial?.quantityMode ?? 'SINGLE',
  );
  const [maxQuantity, setMaxQuantity] = useState(
    String(initial && initial.maxQuantity > 1 ? initial.maxQuantity : 5),
  );
  // Photos chosen while writing a NEW service (§165). Held as files until
  // "Post", because a photo needs a service to belong to and there is none
  // yet; an existing service has ServicePhotos below it instead.
  const [files, setFiles] = useState<File[]>([]);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);
  const PHOTO_LIMIT = 11;

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
    onSubmit(
      {
      name: name.trim(),
      durationMinutes: Number(duration),
      depositPercentage: Number(deposit),
      quantityMode,
      // Sent only when it means something; the server stores 1 for SINGLE.
      ...(quantityMode === 'SINGLE' ? {} : { maxQuantity: Number(maxQuantity) }),
      offers,
      },
      files,
    );
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
      <div>
        <label htmlFor="sqty">Can a customer book more than one?</label>
        <select
          id="sqty"
          value={quantityMode}
          onChange={(e) => setQuantityMode(e.target.value as Service['quantityMode'])}
        >
          <option value="SINGLE">No — one per booking</option>
          <option value="PEOPLE">Yes — for several people</option>
          <option value="UNITS">Yes — several for one customer</option>
        </select>
        <span className="muted small">
          {quantityMode === 'PEOPLE' &&
            'Like 3 haircuts. Each person needs a place in your shop. If the group is bigger than the places you have, they are served one after another and the booking takes longer.'}
          {quantityMode === 'UNITS' &&
            'Like 3 passport photos. One customer, one visit, the same length — only the price is multiplied.'}
          {quantityMode === 'SINGLE' && 'Every booking is for one.'}
        </span>
      </div>
      {quantityMode !== 'SINGLE' && (
        <div>
          <label htmlFor="smax">Most in one booking</label>
          <input
            id="smax"
            type="number"
            min="2"
            max="1000"
            value={maxQuantity}
            onChange={(e) => setMaxQuantity(e.target.value)}
            required
          />
          <span className="muted small">Any number from 2 to 1000. The price above is for one.</span>
        </div>
      )}
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

      {creating && (
        <div className="service-photos">
          <div className="branch-head">
            <strong>Photos</strong>
            <span className="muted small">
              {files.length} of {PHOTO_LIMIT} · the first one is the cover
            </span>
          </div>
          <p className="muted small">
            Customers see these when they pick this service. Add them now and they go up
            with it; you can change them later from Edit.
          </p>
          <div className="photo-grid">
            {previews.map((url, index) => (
              <figure key={url}>
                <img src={url} alt="" />
                {index === 0 && <span className="muted small">Cover</span>}
                <button
                  type="button"
                  className="link danger-link"
                  onClick={() => setFiles((was) => was.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </figure>
            ))}
          </div>
          {files.length < PHOTO_LIMIT && (
            <>
              <input
                id="new-service-photos"
                type="file"
                multiple
                className="visually-hidden"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                disabled={busy}
                onChange={(event) => {
                  const picked = Array.from(event.target.files ?? []);
                  setFiles((was) => [...was, ...picked].slice(0, PHOTO_LIMIT));
                  event.target.value = '';
                }}
              />
              <label htmlFor="new-service-photos" className={busy ? 'file-trigger disabled' : 'file-trigger'}>
                {files.length === 0 ? 'Add photos' : 'Add more photos'}
              </label>
            </>
          )}
        </div>
      )}

      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy
            ? (busyLabel ?? 'Saving…')
            : creating
              ? 'Post this service'
              : 'Save changes'}
        </button>
        {creating && !busy && offers.length > 0 && (
          <span className="muted small">
            Goes live at {offers.length} {offers.length === 1 ? 'branch' : 'branches'}
            {files.length > 0 ? ` with ${files.length} ${files.length === 1 ? 'photo' : 'photos'}` : ''}.
          </span>
        )}
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
  const [photos, setPhotos] = useState(false);

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
            busyLabel={undefined}
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
    <>
    <tr>
      <td>
        <div className="service-name">
          {/* The cover, so a glance down the list shows which services have a
              photo and which do not. */}
          {service.images.length > 0 ? (
            <img className="service-thumb" src={service.images[0].url} alt="" />
          ) : (
            <span className="service-thumb empty" aria-hidden="true" />
          )}
          <span>
            <strong>{service.name}</strong>
            <div className="muted small">
              {service.images.length === 0
                ? 'No photos'
                : `${service.images.length} photo${service.images.length === 1 ? '' : 's'}`}
            </div>
          </span>
        </div>
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
      <td>
        {service.durationMinutes} min
        {service.quantityMode !== 'SINGLE' && (
          <div className="muted small">
            up to {service.maxQuantity} {service.quantityMode === 'PEOPLE' ? 'people' : 'per booking'}
          </div>
        )}
      </td>
      <td className="actions">
        <button type="button" className="link" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          type="button"
          className="link"
          aria-expanded={photos}
          onClick={() => setPhotos((open) => !open)}
        >
          {photos ? 'Hide photos' : 'Photos'}
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
    {/* A full-width row beneath, the same way editing expands: the five
        columns are too narrow for a photo grid. */}
    {photos && (
      <tr>
        <td colSpan={5}>
          <ServicePhotos serviceId={service.id} />
        </td>
      </tr>
    )}
    </>
  );
}

/**
 * Photos of one service (§132).
 *
 * Mirrors the branch gallery on the shopfront page — same grid, same picker,
 * same confirm — because they are the same job on a different subject, and a
 * business should not have to learn two of them.
 *
 * The limit and the room left come from the SERVER, never from a constant
 * here: a number hardcoded in a client is a number that disagrees with the
 * server the first time either changes (§132.3).
 */
function ServicePhotos({ serviceId }: { serviceId: string }) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);

  const photos = useQuery({
    queryKey: ['service-images', serviceId],
    queryFn: () => getServiceImages(serviceId),
  });

  // Both lists change: this one, and the service list that carries the cover.
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['service-images', serviceId] });
    queryClient.invalidateQueries({ queryKey: ['services'] });
  };

  const add = useMutation({
    mutationFn: (file: File) => addServiceImage(serviceId, file),
    onSuccess: refresh,
    onError: (error) =>
      setProblem(error instanceof ApiError ? error.message : 'That did not upload.'),
  });

  const drop = useMutation({
    mutationFn: (imageId: string) => removeServiceImage(serviceId, imageId),
    onSuccess: refresh,
    onError: (error) =>
      setProblem(error instanceof ApiError ? error.message : 'That did not delete.'),
  });

  const full = (photos.data?.remaining ?? 1) <= 0;

  return (
    <div className="branch-gallery">
      <div className="branch-head">
        <strong>Photos of this service</strong>
        {photos.data && (
          <span className="muted small">
            {photos.data.count} of {photos.data.limit}
          </span>
        )}
      </div>

      <p className="muted small">
        Customers see these when they pick this service. The first one is the
        cover, so upload the best one first.
      </p>

      <div className="photo-grid">
        {photos.data?.images.map((photo, index) => (
          <figure key={photo.id}>
            <img src={photo.url} alt="" />
            {index === 0 && <span className="muted small">Cover</span>}
            <button
              type="button"
              className="link danger-link"
              disabled={drop.isPending}
              onClick={() => {
                if (window.confirm('Remove this photo? It cannot be brought back.')) {
                  setProblem(null);
                  drop.mutate(photo.id);
                }
              }}
            >
              Remove
            </button>
          </figure>
        ))}
      </div>

      {photos.data?.count === 0 && (
        <p className="muted small">
          No photos yet. A service with a photo is easier to choose than one
          without.
        </p>
      )}

      {full ? (
        <p className="muted small">
          This service is at its {photos.data?.limit} photo limit. Remove one to
          add another.
        </p>
      ) : (
        <ImageButton
          id={`service-photo-${serviceId}`}
          label="Add a photo"
          busy={add.isPending}
          onPick={(file) => {
            setProblem(null);
            if (file) add.mutate(file);
          }}
        />
      )}

      {problem && (
        <p className="error small" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}