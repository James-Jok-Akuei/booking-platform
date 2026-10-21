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
import { AddressField, useDistrictFrom } from '../components/AddressField';
import { confirmDialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { Stars } from '../ui/Stars';
import { Switch } from '../ui/Switch';
import './hours.css';
import { useAccess } from '../access';
import { Trans } from '@lingui/react/macro';
import { plural, t } from '@lingui/core/macro';
import { dayName } from '../i18n/format';

/** Day names in the app's language (§308), Sunday first. */
const DAYS = () => [0, 1, 2, 3, 4, 5, 6].map((day) => dayName(day));
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
  // Opening and closing branches is the whole shop's; a manager runs their
  // own branches' hours and details; staff look (§277).
  const access = useAccess();

  // "Add a branch" from anywhere else (For you, §206) arrives as ?add=1 and
  // opens the form; the address is tidied so a reload does not open it again.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('add') !== '1') return;
    if (access.runsBusiness) setAdding(true);
    setParams(
      (next) => {
        next.delete('add');
        return next;
      },
      { replace: true },
    );
  }, [params, setParams, access.runsBusiness]);

  return (
    <section className="hr">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1><Trans>Branches & hours</Trans></h1>
            <p className="muted">
              <Trans>Every place you work from, when it is open, and how many people it can take at once.</Trans>
            </p>
          </div>
          {access.runsBusiness && (
            <button type="button" className="primary hr-add" onClick={() => setAdding(true)}>
              <Icon name="plus" size={18} stroke={2.4} />{' '}
              <Trans>Add a branch</Trans>
            </button>
          )}
        </header>
      </div>

      {!access.allBranches && (
        <p className="hr-scope">
          <Icon name="pin" size={16} />
          {access.runsBranches
            ? t`These are the branches you look after. You can change their hours and details; the owner opens and closes branches.`
            : t`These are the branches you work at. The owner or a manager changes their hours.`}
        </p>
      )}
      {access.allBranches && !access.runsBranches && (
        <p className="hr-scope">
          <Icon name="shield" size={16} />{' '}
          <Trans>The owner or a manager changes the hours. You can see them here.</Trans>
        </p>
      )}

      {locations.isLoading && <div className="skeleton hr-skeleton" />}

      {/* Three other pages send people here to add their first branch (§117), so
          this is the screen that has to say what to do when there are none. */}
      {locations.data?.length === 0 && (
        <div className="hr-empty">
          <span>
            <Icon name="pin" size={30} />
          </span>
          <h2><Trans>No branches yet</Trans></h2>
          {access.runsBusiness ? (
            <>
              <p>
                <Trans>
                  Add one — until then there is nothing for a customer to book and nothing to set hours
                  for.
                </Trans>
              </p>
              <button type="button" className="primary" onClick={() => setAdding(true)}>
                <Icon name="plus" size={18} stroke={2.4} />{' '}
                <Trans>Add a branch</Trans>
              </button>
            </>
          ) : (
            <p><Trans>The owner has not given you a branch yet. Ask them to choose yours on the People page.</Trans></p>
          )}
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
            canChange={access.runsBranches}
            canOpenClose={access.runsBusiness}
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
  canChange,
  canOpenClose,
}: {
  location: Location;
  index: number;
  money: ReturnType<typeof useMoney>;
  onSaved: () => void;
  onEdit: () => void;
  /** Its hours, details and places (§277). */
  canChange: boolean;
  /** Closing or reopening it. */
  canOpenClose: boolean;
}) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const today = new Date().getDay();
  const todays = location.hours.find((h) => h.dayOfWeek === today);
  const hasPin = location.latitude !== null && location.longitude !== null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['locations'] });
  const fail = (error: unknown) => setProblem(error instanceof ApiError ? error.message : t`That did not work.`);

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
      title: t`Close ${location.name}?`,
      body: (
        <p>
          <Trans>
            It stops taking bookings and customers will not find it. Nothing is deleted — past
            bookings, reviews and takings stay, and you can reopen it at any time.
          </Trans>
        </p>
      ),
      tone: 'danger',
      icon: 'pause',
      confirmLabel: t`Close this branch`,
      cancelLabel: t`Keep it open`,
    });
    if (ok) close.mutate();
  };

  return (
    <article
      className={`hr-card${location.isActive ? '' : ' is-closed'}${canChange ? '' : ' is-readonly'}`}
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
            <span>{canChange ? t`No pin yet — add one under Edit details` : t`No pin yet`}</span>
          </div>
        )}
        <div className="hr-hero-shade" />
        <div className="hr-hero-text">
          <span className={`hr-state${location.isActive ? (todays && !todays.isClosed ? ' is-open' : '') : ' is-shut'}`}>
            <i />
            {!location.isActive
              ? t`Closed`
              : todays && !todays.isClosed
                ? t`Today ${todays.openTime} – ${todays.closeTime}`
                : t`Closed today`}
          </span>
          <h2>{location.name}</h2>
          <p>
            <Icon name="pin" size={14} />
            {location.district
              ? `${location.district.name}, ${location.district.province.name}`
              : t`No district set — customers cannot find this branch by place`}
          </p>
        </div>
        {(canChange || canOpenClose) && (
          <div className="hr-hero-actions">
            {canChange && (
              <button type="button" onClick={onEdit}>
                <Icon name="pencil" size={16} />{' '}
                <Trans>Edit details</Trans>
              </button>
            )}
            {canOpenClose &&
              (location.isActive ? (
                <button type="button" className="hr-close-btn" disabled={close.isPending} onClick={askClose}>
                  {close.isPending ? t`Closing…` : t`Close this branch`}
                </button>
              ) : (
                <button type="button" className="primary" disabled={reopen.isPending} onClick={() => reopen.mutate()}>
                  {reopen.isPending ? t`Reopening…` : t`Reopen this branch`}
                </button>
              ))}
          </div>
        )}
      </div>

      <div className="hr-facts">
        <span>
          <Icon name="store" size={15} />
          {location.address}
        </span>
        <span>
          <Icon name="tag" size={15} /><Trans>cheapest service {money.format(location.fromPriceMinor)}</Trans>
        </span>
        {location.ratingCount > 0 && (
          <span>
            <Stars value={Number(location.ratingAvg)} size={13} />
            <Trans>
              rated {location.ratingAvg} over{' '}
              {location.ratingCount}
            </Trans>
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
          <Trans>
            This branch is closed. It takes no new bookings and customers cannot find it. Everything that
            happened here is kept.
          </Trans>
        </p>
      )}

      <div className="hr-body">
        <WeekEditor location={location} onSaved={onSaved} readOnly={!canChange} />
        <PlacesCard location={location} onSaved={onSaved} readOnly={!canChange} />
      </div>
    </article>
  );
}

function WeekEditor({ location, onSaved, readOnly }: { location: Location; onSaved: () => void; readOnly: boolean }) {
  const [week, setWeek] = useState<Hours[]>([]);
  const [dirty, setDirty] = useState(false);

  // Seeded from the server, and reset whenever it changes, so a successful save
  // leaves the form showing what was actually stored rather than what was typed.
  useEffect(() => {
    const byDay = new Map(location.hours.map((h) => [h.dayOfWeek, h]));
    setWeek(
      DAYS().map(
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
          <h3><Trans>Opening hours</Trans></h3>
          <p>
            {openDays === 0 ? t`Closed every day — nothing can be booked` : plural(openDays, { one: 'Open # day a week', other: 'Open # days a week' })}
          </p>
        </div>
        {openDays > 1 && firstOpen && !readOnly && (
          <button type="button" className="hr-copy" onClick={copyFirst}>
            <Icon name="copy" size={15} />
            {t`Copy ${DAYS()[firstOpen.dayOfWeek]}’s hours to every open day`}
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
                {dayName(day, 'short')}
                {day === today && <em><Trans>today</Trans></em>}
              </span>
              <Switch
                checked={!h.isClosed}
                label={t`Open on ${DAYS()[day]}`}
                disabled={readOnly}
                onChange={(open) => update(day, { isClosed: !open })}
              />
              {h.isClosed ? (
                <span className="hr-closed"><Trans>Closed</Trans></span>
              ) : (
                <span className="hr-times">
                  <input
                    type="time"
                    value={h.openTime}
                    readOnly={readOnly}
                    aria-label={t`${DAYS()[day]} opens`}
                    onChange={(e) => update(day, { openTime: e.target.value })}
                  />
                  {/* A dash reads the same in every language and fits the fixed column (§308.7); each box says opens/closes to a screen reader. */}
                  <span aria-hidden="true">–</span>
                  <input
                    type="time"
                    value={h.closeTime}
                    readOnly={readOnly}
                    aria-label={t`${DAYS()[day]} closes`}
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
          {saveHours.error instanceof ApiError ? saveHours.error.message : t`Could not save.`}
        </p>
      )}

      {!readOnly && (
        <footer className={`hr-week-foot${dirty ? ' is-dirty' : ''}`}>
          <span>
            {saveHours.isSuccess ? (
              <span className="ok">
                <Icon name="checkCircle" size={16} />{' '}
                <Trans>Saved</Trans>
              </span>
            ) : dirty ? (
              t`You have changes that are not saved`
            ) : (
              t`The whole week is saved together`
            )}
          </span>
          <button
            type="button"
            className="primary"
            disabled={saveHours.isPending || !dirty}
            onClick={() => saveHours.mutate()}
          >
            {saveHours.isPending ? t`Saving…` : t`Save the week`}
          </button>
        </footer>
      )}
    </section>
  );
}

/** "People served at once" (§16.4, §189): the places every time starts with. */
function PlacesCard({ location, onSaved, readOnly }: { location: Location; onSaved: () => void; readOnly: boolean }) {
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
      <h3><Trans>People served at once</Trans></h3>
      <div className={`hr-stepper${readOnly ? ' is-readonly' : ''}`}>
        {!readOnly && (
          <button type="button" onClick={() => step(-1)} disabled={n <= 1} aria-label={t`One fewer`}>
            <Icon name="minus" size={18} stroke={2.4} />
          </button>
        )}
        <input
          id={`cap-${location.id}`}
          type="number"
          min="1"
          value={capacity}
          readOnly={readOnly}
          onChange={(e) => setCap(e.target.value)}
          aria-label={t`People served at once`}
        />
        {!readOnly && (
          <button type="button" onClick={() => step(1)} aria-label={t`One more`}>
            <Icon name="plus" size={18} stroke={2.4} />
          </button>
        )}
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
        <Trans>
          How many customers this branch can look after at the same time — the same number for every
          service here. A booking for 3 people takes 3 places at that time; when every place is taken,
          customers see the time as booked. It is also the most people one booking can be for. Lowering
          it does not cancel bookings already made.
        </Trans>
      </p>
      {saveCapacity.error && (
        <p className="error small" role="alert">
          {saveCapacity.error instanceof ApiError ? saveCapacity.error.message : t`Could not save.`}
        </p>
      )}
      {!readOnly && (
        <button
          type="button"
          className={changed ? 'primary' : ''}
          disabled={saveCapacity.isPending || !changed}
          onClick={() => saveCapacity.mutate()}
        >
          {saveCapacity.isPending ? t`Saving…` : changed ? t`Save` : saveCapacity.isSuccess ? t`Saved` : t`Save`}
        </button>
      )}
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
  const [fromAddress, setFromAddress] = useState<string | null>(null);
  const districtFrom = useDistrictFrom();

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
    onError: (error) => setProblem(error instanceof ApiError ? error.message : t`That did not work.`),
  });

  return (
    <Panel
      eyebrow={t`Edit details`}
      title={location.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            <Trans>Cancel</Trans>
          </button>
          <button type="submit" form="edit-branch" className="primary" disabled={save.isPending}>
            {save.isPending ? t`Saving…` : t`Save`}
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
            <label htmlFor="eb-name"><Trans>Branch name</Trans></label>
            <input id="eb-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="bf-field">
            <label htmlFor="eb-phone"><Trans>Phone for this branch <em>optional</em></Trans>
            </label>
            <input id="eb-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
          </div>
        </div>
        <div className="bf-field">
          <label htmlFor="eb-address"><Trans>Address</Trans></label>
          <AddressField
            id="eb-address"
            value={address}
            onChange={(next) => {
              setAddress(next);
              setFromAddress(null);
            }}
            onPick={(found) => {
              // A chosen suggestion moves the pin, and the district when it names one (§228).
              setPlace(`${found.latitude.toFixed(6)}, ${found.longitude.toFixed(6)}`);
              const district = districtFrom(found);
              if (district) setDistrictId(district);
              setProblem(null);
              setFromAddress(district ? t`The pin and the district were moved to this address.` : t`The pin was moved to this address.`);
            }}
          />
          {fromAddress && <span className="bf-help is-ok"><Trans>{fromAddress} Check it below before saving.</Trans></span>}
        </div>
        <PlaceField
          value={place}
          onChange={setPlace}
          onProblem={setProblem}
          hint={t`Customers' distances are measured from this pin. Paste the shop's Google Maps link, or press the button if you are at the shop now.`}
        />
        <DistrictField
          value={districtId}
          onChange={setDistrictId}
          hint={t`Customers filter by this. Without it, this branch does not appear when someone searches their area.`}
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
