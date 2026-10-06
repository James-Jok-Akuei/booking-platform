import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import {
  closeLocation,
  listProvinces,
  listLocations,
  reopenLocation,
  setCapacity,
  setHours,
  updateLocation,
  type Hours,
  type Location,
} from '../api/business';
import { useMoney } from '../money';
import { MapPin } from '../components/MapPin';
import { NewBranchForm, parseCoordinates } from '../components/NewBranchForm';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * When each branch is open, and how many people it can serve at once.
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

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Branches &amp; hours</h1>
          <p className="muted">
            Every place you work from, when it is open, and how many people it can
            take at once.
          </p>
        </div>
      </header>

      <NewBranchForm onCreated={refresh} />

      {locations.isLoading && <p className="muted">Loading…</p>}

      {/* Three other pages send people here to add their first branch (§117), so
          this is the screen that has to say what to do when there are none. */}
      {locations.data?.length === 0 && (
        <p className="muted empty">
          No branches yet. Add one above — until then there is nothing for a
          customer to book and nothing to set hours for.
        </p>
      )}

      {locations.data?.map((location) => (
        <LocationCard
          key={location.id}
          location={location}
          money={money}
          onSaved={refresh}
        />
      ))}
    </section>
  );
}

function LocationCard({
  location,
  money,
  onSaved,
}: {
  location: Location;
  money: ReturnType<typeof useMoney>;
  onSaved: () => void;
}) {
  const [week, setWeek] = useState<Hours[]>([]);
  const [capacity, setCap] = useState(String(location.capacity));

  // Seeded from the server, and reset whenever it changes, so a successful save
  // leaves the form showing what was actually stored rather than what was typed.
  useEffect(() => {
    const byDay = new Map(location.hours.map((h) => [h.dayOfWeek, h]));
    setWeek(
      DAYS.map((_, day) =>
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
    setCap(String(location.capacity));
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
    onSuccess: onSaved,
  });

  const saveCapacity = useMutation({
    mutationFn: () => setCapacity(location.id, Number(capacity)),
    onSuccess: onSaved,
  });

  const update = (day: number, patch: Partial<Hours>) =>
    setWeek((current) =>
      current.map((h) => (h.dayOfWeek === day ? { ...h, ...patch } : h)),
    );

  return (
    <div className={location.isActive ? 'card location' : 'card location closed'}>
      <div className="setting-head">
        <h2>
          {location.name}
          {!location.isActive && <span className="pill tkt-closed">Closed</span>}
        </h2>
        <p className="muted small">
          {location.district
            ? `${location.district.name}, ${location.district.province.name}`
            : 'No district set — customers cannot find this branch by place'}
        </p>
        <p className="muted small">
          {location.address} · cheapest service {money.format(location.fromPriceMinor)}
          {location.ratingCount > 0 &&
            ` · rated ${location.ratingAvg} over ${location.ratingCount}`}
        </p>
        <BranchActions location={location} />
      </div>

      {!location.isActive && (
        <p className="notice">
          This branch is closed. It takes no new bookings and customers cannot find
          it. Everything that happened here is kept.
        </p>
      )}

      <table className="hours">
        <tbody>
          {week.map((h) => (
            <tr key={h.dayOfWeek}>
              <td className="day">{DAYS[h.dayOfWeek]}</td>
              <td>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={!h.isClosed}
                    onChange={(e) => update(h.dayOfWeek, { isClosed: !e.target.checked })}
                  />
                  Open
                </label>
              </td>
              <td>
                <input
                  type="time"
                  value={h.openTime}
                  disabled={h.isClosed}
                  onChange={(e) => update(h.dayOfWeek, { openTime: e.target.value })}
                />
                {' to '}
                <input
                  type="time"
                  value={h.closeTime}
                  disabled={h.isClosed}
                  onChange={(e) => update(h.dayOfWeek, { closeTime: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="setting-form">
        <button
          type="button"
          className="primary"
          disabled={saveHours.isPending}
          onClick={() => saveHours.mutate()}
        >
          {saveHours.isPending ? 'Saving…' : 'Save the week'}
        </button>
        {saveHours.isSuccess && <span className="ok small">Saved</span>}
      </div>

      {saveHours.error && (
        <p className="error small" role="alert">
          {saveHours.error instanceof ApiError ? saveHours.error.message : 'Could not save.'}
        </p>
      )}

      <div className="setting-form">
        <label htmlFor={`cap-${location.id}`}>People served at once</label>
        <input
          id={`cap-${location.id}`}
          type="number"
          min="1"
          value={capacity}
          onChange={(e) => setCap(e.target.value)}
        />
        <button
          type="button"
          disabled={saveCapacity.isPending || capacity === String(location.capacity)}
          onClick={() => saveCapacity.mutate()}
        >
          Save
        </button>
      </div>
      {/* Capacity is what availability counts against: two chairs means two
          customers can hold the same slot (§16.4). */}
      <p className="muted small">
        Two chairs means two customers can book the same time. Lowering this does
        not cancel bookings already made.
      </p>
      {saveCapacity.error && (
        <p className="error small" role="alert">
          {saveCapacity.error instanceof ApiError
            ? saveCapacity.error.message
            : 'Could not save.'}
        </p>
      )}
    </div>
  );
}

/**
 * Editing a branch, and closing it.
 *
 * "Close", never "delete" (§89). It used to be a hard delete that cascaded
 * through every appointment ever made there — and the server now refuses while
 * bookings are still to happen, so the confirmation says what to do about that
 * rather than letting a 400 explain the rule.
 */
function BranchActions({ location }: { location: Location }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(location.name);
  const [address, setAddress] = useState(location.address);
  const [phone, setPhone] = useState(location.phone ?? '');
  const [districtId, setDistrictId] = useState(location.district?.id ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  // The pin (§157). Shown as it is stored; changed by pasting a map link or
  // by standing in the shop and pressing the button.
  const [place, setPlace] = useState(
    location.latitude !== null && location.longitude !== null
      ? `${location.latitude}, ${location.longitude}`
      : '',
  );
  const [locating, setLocating] = useState(false);
  const coordinates = place.trim() ? parseCoordinates(place) : null;
  const useMyPosition = () => {
    if (!navigator.geolocation) {
      setProblem('This browser cannot find your position. Paste a map link instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPlace(`${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`);
        setProblem(null);
        setLocating(false);
      },
      () => {
        setLocating(false);
        setProblem('Could not get your position. Allow location for this site, or paste a map link.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  // Reference data, so it is fetched once and kept.
  const provinces = useQuery({
    queryKey: ['provinces'],
    queryFn: listProvinces,
    staleTime: Infinity,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['locations'] });
  const fail = (error: unknown) =>
    setProblem(error instanceof ApiError ? error.message : 'That did not work.');

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
      setEditing(false);
      setProblem(null);
      refresh();
    },
    onError: fail,
  });

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

  if (editing) {
    return (
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label>
          Branch name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>
        <label>
          Address
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label>
          Phone for this branch <span className="muted small">(optional)</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
        </label>
        <label>
          Where it is
          <input
            value={place}
            onChange={(e) => {
              setPlace(e.target.value);
              setProblem(null);
            }}
            placeholder="Paste a Google Maps link, or -1.9536, 30.0606"
          />
          <span className="muted small">
            Customers' distances are measured from this pin. Paste the shop's Google Maps
            link, or press the button if you are at the shop now.
          </span>
        </label>
        <div className="row-end">
          <button type="button" className="link" onClick={useMyPosition} disabled={locating}>
            {locating ? 'Finding you…' : 'Use my current position'}
          </button>
        </div>
        {coordinates && 'error' in coordinates && (
          <p className="error small" role="alert">
            {coordinates.error}
          </p>
        )}
        {coordinates && !('error' in coordinates) && (
          <MapPin latitude={coordinates.latitude} longitude={coordinates.longitude} />
        )}
        <label>
          District
          <select value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
            <option value="">Choose a district</option>
            {/* Grouped by province, because thirty districts in one flat list
                is not how anyone thinks about where they are (§104). */}
            {provinces.data?.map((province) => (
              <optgroup key={province.id} label={province.name}>
                {province.districts.map((district) => (
                  <option key={district.id} value={district.id}>
                    {district.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="muted small">
            Customers filter by this. Without it, this branch does not appear when
            someone searches their area.
          </span>
        </label>
        {problem && (
          <p className="error small" role="alert">
            {problem}
          </p>
        )}
        <div className="row-end">
          <button type="button" className="link" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="branch-actions">
      <button type="button" onClick={() => setEditing(true)}>
        Edit details
      </button>

      {location.isActive ? (
        <button
          type="button"
          disabled={close.isPending}
          onClick={() => {
            if (
              window.confirm(
                `Close ${location.name}?\n\n` +
                  'It stops taking bookings and customers will not find it. ' +
                  'Nothing is deleted — past bookings, reviews and takings stay, ' +
                  'and you can reopen it at any time.',
              )
            ) {
              close.mutate();
            }
          }}
        >
          {close.isPending ? 'Closing…' : 'Close this branch'}
        </button>
      ) : (
        <button type="button" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
          {reopen.isPending ? 'Reopening…' : 'Reopen this branch'}
        </button>
      )}

      {problem && (
        <p className="error small" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
