import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import {
  closeLocation,
  listLocations,
  reopenLocation,
  setCapacity,
  setHours,
  updateLocation,
  type Hours,
  type Location,
} from '../api/business';
import { useMoney } from '../money';
import { StaticMap } from '../components/StaticMap';
import { DistrictField, NewBranchPanel, PlaceField, parseCoordinates } from '../components/NewBranchForm';
import { confirmDialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { Stars } from '../ui/Stars';
import { Switch } from '../ui/Switch';
import './hours.css';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday first, the way a working week is read; the stored days stay 0 = Sunday. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Every place the business works from, when each is open, and how many people
 * it can take at once (§12, §16.4, §195).
 *
 * Hours are per LOCATION, unlike services — a branch keeps its own week. The
 * whole week is submitted at once because the endpoint replaces it wholesale
 * (§12.7): sending one changed day would silently clear the other six.
 */
export function HoursPage() {
  const queryClient = useQueryClient();
  const money = useMoney();
  const locations = useQuery({ queryKey: ['locations'], queryFn: listLocations });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['locations'] });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);

  // "Add a branch" from anywhere else (For you, §206) arrives as ?add=1 and
  // opens the form; the address is tidied so a reload does not open it again.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('add') !== '1') return;
    setAdding(true);
    setParams(
      (next) => {
        next.delete('add');
        return next;
      },
      { replace: true },
    );
  }, [params, setParams]);

  return (
    <section className="hr">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Branches &amp; hours</h1>
            <p className="muted">
              Every place you work from, when it is open, and how many people it can take at once.
            </p>
          </div>
          <button type="button" className="primary hr-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} stroke={2.4} /> Add a branch
          </button>
        </header>
      </div>

      {locations.isLoading && <div className="skeleton hr-skeleton" />}

      {/* Three other pages send people here to add their first branch (§117), so
          this is the screen that has to say what to do when there are none. */}
      {locations.data?.length === 0 && (
        <div className="hr-empty">
          <span>
            <Icon name="pin" size={30} />
          </span>
          <h2>No branches yet</h2>
          <p>
            Add one — until then there is nothing for a customer to book and nothing to set hours
            for.
          </p>
          <button type="button" className="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} stroke={2.4} /> Add a branch
          </button>
        </div>
      )}

      <div className="hr-list">
        {locations.data?.map((location, i) => (
          <BranchCard
            key={location.id}
            index={i}
            location={location}
            money={money}
            onSaved={refresh}
            onEdit={() => setEditing(location)}
          />
        ))}
      </div>

      {adding && <NewBranchPanel onClose={() => setAdding(false)} onCreated={refresh} />}
      {editing && <EditBranchPanel location={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function BranchCard({
  location,
  index,
  money,
  onSaved,
  onEdit,
}: {
  location: Location;
  index: number;
  money: ReturnType<typeof useMoney>;
  onSaved: () => void;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const today = new Date().getDay();
  const todays = location.hours.find((h) => h.dayOfWeek === today);
  const hasPin = location.latitude !== null && location.longitude !== null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['locations'] });
  const fail = (error: unknown) => setProblem(error instanceof ApiError ? error.message : 'That did not work.');

  const close = useMutation({
    mutationFn: () => closeLocation(location.id),
    onSuccess: () => {
      setProblem(null);
      refresh();
    },
    onError: fail,
  });
  const reopen = useMutation({
    mutationFn: () => reopenLocation(location.id),
    onSuccess: () => {
      setProblem(null);
      refresh();
    },
    onError: fail,
  });

  /**
   * "Close", never "delete" (§89). It used to be a hard delete that cascaded
   * through every appointment ever made there — and the server now refuses while
   * bookings are still to happen, so the confirmation says what to do about that
   * rather than letting a 400 explain the rule.
   */
  const askClose = async () => {
    const ok = await confirmDialog({
      title: `Close ${location.name}?`,
      body: (
        <p>
          It stops taking bookings and customers will not find it. Nothing is deleted — past
          bookings, reviews and takings stay, and you can reopen it at any time.
        </p>
      ),
      tone: 'danger',
      icon: 'pause',
      confirmLabel: 'Close this branch',
      cancelLabel: 'Keep it open',
    });
    if (ok) close.mutate();
  };

  return (
    <article
      className={`hr-card${location.isActive ? '' : ' is-closed'}`}
      style={{ animationDelay: `${Math.min(index, 6) * 60}ms` }}
    >
      <div className="hr-hero">
        {hasPin ? (
          <div className="hr-map">
            <StaticMap latitude={location.latitude!} longitude={location.longitude!} focusX={0.72} />
          </div>
        ) : (
          <div className="hr-map is-empty">
            <Icon name="pin" size={28} />
            <span>No pin yet — add one under Edit details</span>
          </div>
        )}
        <div className="hr-hero-shade" />
        <div className="hr-hero-text">
          <span className={`hr-state${location.isActive ? (todays && !todays.isClosed ? ' is-open' : '') : ' is-shut'}`}>
            <i />
            {!location.isActive
              ? 'Closed'
              : todays && !todays.isClosed
                ? `Today ${todays.openTime} – ${todays.closeTime}`
                : 'Closed today'}
          </span>
          <h2>{location.name}</h2>
          <p>
            <Icon name="pin" size={14} />
            {location.district
              ? `${location.district.name}, ${location.district.province.name}`
              : 'No district set — customers cannot find this branch by place'}
          </p>
        </div>
        <div className="hr-hero-actions">
          <button type="button" onClick={onEdit}>
            <Icon name="pencil" size={16} /> Edit details
          </button>
          {location.isActive ? (
            <button type="button" className="hr-close-btn" disabled={close.isPending} onClick={askClose}>
              {close.isPending ? 'Closing…' : 'Close this branch'}
            </button>
          ) : (
            <button type="button" className="primary" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
              {reopen.isPending ? 'Reopening…' : 'Reopen this branch'}
            </button>
          )}
        </div>
      </div>

      <div className="hr-facts">
        <span>
          <Icon name="store" size={15} />
          {location.address}
        </span>
        <span>
          <Icon name="tag" size={15} />
          cheapest service {money.format(location.fromPriceMinor)}
        </span>
        {location.ratingCount > 0 && (
          <span>
            <Stars value={Number(location.ratingAvg)} size={13} /> rated {location.ratingAvg} over{' '}
            {location.ratingCount}
          </span>
        )}
        {location.phone && (
          <span>
            <Icon name="phone" size={15} />
            {location.phone}
          </span>
        )}
      </div>

      {problem && (
        <p className="notice hr-problem" role="alert">
          {problem}
        </p>
      )}

      {!location.isActive && (
        <p className="notice hr-problem">
          This branch is closed. It takes no new bookings and customers cannot find it. Everything that
          happened here is kept.
        </p>
      )}

      <div className="hr-body">
        <WeekEditor location={location} onSaved={onSaved} />
        <PlacesCard location={location} onSaved={onSaved} />
      </div>
    </article>
  );
}

function WeekEditor({ location, onSaved }: { location: Location; onSaved: () => void }) {
  const [week, setWeek] = useState<Hours[]>([]);
  const [dirty, setDirty] = useState(false);

  // Seeded from the server, and reset whenever it changes, so a successful save
  // leaves the form showing what was actually stored rather than what was typed.
  useEffect(() => {
    const byDay = new Map(location.hours.map((h) => [h.dayOfWeek, h]));
    setWeek(
      DAYS.map(
        (_, day) =>
          byDay.get(day) ?? {
            id: `new-${day}`,
            // Carried on the synthetic row too, so an unsaved day has the same
            // shape as a saved one (§128.40).
            locationId: location.id,
            dayOfWeek: day,
            openTime: '09:00',
            closeTime: '17:00',
            isClosed: true,
          },
      ),
    );
    setDirty(false);
  }, [location]);

  const saveHours = useMutation({
    mutationFn: () =>
      setHours(
        location.id,
        week.map((h) => ({
          dayOfWeek: h.dayOfWeek,
          openTime: h.openTime,
          closeTime: h.closeTime,
          isClosed: h.isClosed,
        })),
      ),
    onSuccess: () => {
      setDirty(false);
      onSaved();
    },
  });

  const update = (day: number, patch: Partial<Hours>) => {
    setDirty(true);
    saveHours.reset();
    setWeek((current) => current.map((h) => (h.dayOfWeek === day ? { ...h, ...patch } : h)));
  };

  /** The first open day's times, onto every other open day — still to be saved. */
  const copyFirst = () => {
    const first = WEEK_ORDER.map((d) => week.find((h) => h.dayOfWeek === d)).find((h) => h && !h.isClosed);
    if (!first) return;
    setDirty(true);
    saveHours.reset();
    setWeek((current) =>
      current.map((h) => (h.isClosed ? h : { ...h, openTime: first.openTime, closeTime: first.closeTime })),
    );
  };

  const openDays = week.filter((h) => !h.isClosed).length;
  const firstOpen = WEEK_ORDER.map((d) => week.find((h) => h.dayOfWeek === d)).find((h) => h && !h.isClosed);
  const today = new Date().getDay();

  return (
    <section className="hr-week">
      <header>
        <div>
          <h3>Opening hours</h3>
          <p>
            {openDays === 0 ? 'Closed every day — nothing can be booked' : `Open ${openDays} ${openDays === 1 ? 'day' : 'days'} a week`}
          </p>
        </div>
        {openDays > 1 && firstOpen && (
          <button type="button" className="hr-copy" onClick={copyFirst}>
            <Icon name="copy" size={15} />
            {DAYS[firstOpen.dayOfWeek].slice(0, 3)}’s hours to every open day
          </button>
        )}
      </header>

      <ol className="hr-days">
        {WEEK_ORDER.map((day) => {
          const h = week.find((x) => x.dayOfWeek === day);
          if (!h) return null;
          const from = minutes(h.openTime);
          const to = minutes(h.closeTime);
          const valid = !h.isClosed && to > from;
          return (
            <li key={day} className={`${h.isClosed ? 'is-off' : ''}${day === today ? ' is-today' : ''}`}>
              <span className="hr-day">
                {DAYS[day].slice(0, 3)}
                {day === today && <em>today</em>}
              </span>
              <Switch
                checked={!h.isClosed}
                label={`Open on ${DAYS[day]}`}
                onChange={(open) => update(day, { isClosed: !open })}
              />
              {h.isClosed ? (
                <span className="hr-closed">Closed</span>
              ) : (
                <span className="hr-times">
                  <input
                    type="time"
                    value={h.openTime}
                    aria-label={`${DAYS[day]} opens`}
                    onChange={(e) => update(day, { openTime: e.target.value })}
                  />
                  <span>to</span>
                  <input
                    type="time"
                    value={h.closeTime}
                    aria-label={`${DAYS[day]} closes`}
                    onChange={(e) => update(day, { closeTime: e.target.value })}
                  />
                </span>
              )}
              <span className="hr-bar" aria-hidden="true">
                {valid && (
                  <i style={{ left: `${(from / 1440) * 100}%`, width: `${((to - from) / 1440) * 100}%` }} />
                )}
              </span>
            </li>
          );
        })}
        <li className="hr-scale" aria-hidden="true">
          <span />
          <span />
          <span />
          <span className="hr-bar-scale">
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </span>
        </li>
      </ol>

      {saveHours.error && (
        <p className="error small" role="alert">
          {saveHours.error instanceof ApiError ? saveHours.error.message : 'Could not save.'}
        </p>
      )}

      <footer className={`hr-week-foot${dirty ? ' is-dirty' : ''}`}>
        <span>
          {saveHours.isSuccess ? (
            <span className="ok">
              <Icon name="checkCircle" size={16} /> Saved
            </span>
          ) : dirty ? (
            'You have changes that are not saved'
          ) : (
            'The whole week is saved together'
          )}
        </span>
        <button
          type="button"
          className="primary"
          disabled={saveHours.isPending || !dirty}
          onClick={() => saveHours.mutate()}
        >
          {saveHours.isPending ? 'Saving…' : 'Save the week'}
        </button>
      </footer>
    </section>
  );
}

/** "People served at once" (§16.4, §189): the places every time starts with. */
function PlacesCard({ location, onSaved }: { location: Location; onSaved: () => void }) {
  const [capacity, setCap] = useState(String(location.capacity));
  useEffect(() => setCap(String(location.capacity)), [location]);
  const saveCapacity = useMutation({
    mutationFn: () => setCapacity(location.id, Number(capacity)),
    onSuccess: onSaved,
  });
  const n = Math.max(0, Math.round(Number(capacity) || 0));
  const changed = capacity !== String(location.capacity);
  const step = (by: number) => setCap(String(Math.max(1, Math.min(500, (Number(capacity) || 1) + by))));

  return (
    <section className="hr-places">
      <h3>People served at once</h3>
      <div className="hr-stepper">
        <button type="button" onClick={() => step(-1)} disabled={n <= 1} aria-label="One fewer">
          <Icon name="minus" size={18} stroke={2.4} />
        </button>
        <input
          id={`cap-${location.id}`}
          type="number"
          min="1"
          value={capacity}
          onChange={(e) => setCap(e.target.value)}
          aria-label="People served at once"
        />
        <button type="button" onClick={() => step(1)} aria-label="One more">
          <Icon name="plus" size={18} stroke={2.4} />
        </button>
      </div>
      <div className="hr-seats" aria-hidden="true">
        {Array.from({ length: Math.min(n, 12) }, (_, i) => (
          <span key={i} style={{ animationDelay: `${i * 30}ms` }}>
            <Icon name="user" size={15} />
          </span>
        ))}
        {n > 12 && <em>+{n - 12}</em>}
      </div>
      {/* Capacity is what availability counts against (§16.4), and since
          §189 the only thing deciding how many one booking may be for. */}
      <p>
        How many customers this branch can look after at the same time — the same number for every
        service here. A booking for 3 people takes 3 places at that time; when every place is taken,
        customers see the time as booked. It is also the most people one booking can be for. Lowering
        it does not cancel bookings already made.
      </p>
      {saveCapacity.error && (
        <p className="error small" role="alert">
          {saveCapacity.error instanceof ApiError ? saveCapacity.error.message : 'Could not save.'}
        </p>
      )}
      <button
        type="button"
        className={changed ? 'primary' : ''}
        disabled={saveCapacity.isPending || !changed}
        onClick={() => saveCapacity.mutate()}
      >
        {saveCapacity.isPending ? 'Saving…' : changed ? 'Save' : saveCapacity.isSuccess ? 'Saved' : 'Save'}
      </button>
    </section>
  );
}

/** Editing a branch's details, in the panel from the right (§195). */
function EditBranchPanel({ location, onClose }: { location: Location; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address);
  const [phone, setPhone] = useState(location.phone ?? '');
  const [districtId, setDistrictId] = useState(location.district?.id ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  // The pin (§157). Shown as it is stored; changed by pasting a map link or
  // by standing in the shop and pressing the button.
  const [place, setPlace] = useState(
    location.latitude !== null && location.longitude !== null ? `${location.latitude}, ${location.longitude}` : '',
  );
  const coordinates = place.trim() ? parseCoordinates(place) : null;

  const save = useMutation({
    mutationFn: () =>
      updateLocation(location.id, {
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim() === '' ? null : phone.trim(),
        ...(districtId ? { districtId } : {}),
        ...(coordinates && !('error' in coordinates)
          ? { latitude: coordinates.latitude, longitude: coordinates.longitude }
          : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      onClose();
    },
    onError: (error) => setProblem(error instanceof ApiError ? error.message : 'That did not work.'),
  });

  return (
    <Panel
      eyebrow="Edit details"
      title={location.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="edit-branch" className="primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form
        id="edit-branch"
        className="bf"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="bf-two">
          <div className="bf-field">
            <label htmlFor="eb-name">Branch name</label>
            <input id="eb-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="bf-field">
            <label htmlFor="eb-phone">
              Phone for this branch <em>optional</em>
            </label>
            <input id="eb-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
          </div>
        </div>
        <div className="bf-field">
          <label htmlFor="eb-address">Address</label>
          <input id="eb-address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <PlaceField
          value={place}
          onChange={setPlace}
          onProblem={setProblem}
          hint="Customers' distances are measured from this pin. Paste the shop's Google Maps link, or press the button if you are at the shop now."
        />
        <DistrictField
          value={districtId}
          onChange={setDistrictId}
          hint="Customers filter by this. Without it, this branch does not appear when someone searches their area."
        />
        {problem && (
          <p className="error small" role="alert">
            {problem}
          </p>
        )}
      </form>
    </Panel>
  );
}
