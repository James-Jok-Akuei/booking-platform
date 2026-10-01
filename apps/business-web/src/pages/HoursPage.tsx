import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { listLocations, setCapacity, setHours, type Hours, type Location } from '../api/business';
import { useMoney } from '../money';

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
        <h1>Branches &amp; hours</h1>
      </header>

      {locations.isLoading && <p className="muted">Loading…</p>}

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
    <div className="card location">
      <div className="setting-head">
        <h2>{location.name}</h2>
        <p className="muted small">
          {location.address} · cheapest service {money.format(location.fromPriceMinor)}
          {location.ratingCount > 0 &&
            ` · rated ${location.ratingAvg} over ${location.ratingCount}`}
        </p>
      </div>

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
