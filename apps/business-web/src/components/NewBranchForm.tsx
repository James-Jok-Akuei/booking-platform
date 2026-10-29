import { useState } from 'react';
import { MapPin } from './MapPin';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { createLocation, listProvinces } from '../api/business';
import { Icon } from '../ui/Icon';
import { Panel } from '../ui/Panel';
import { Select } from '../ui/Select';
import { AddressField, useDistrictFrom } from './AddressField';
import type { FoundAddress } from '../api/business';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

/**
 * Pulls a latitude and longitude out of whatever someone pasted.
 *
 * A business owner does not know their coordinates and should not have to. What
 * they DO have is a Google Maps link — the thing everyone here already sends
 * over WhatsApp to say where they are — so this reads the three shapes those
 * links come in, plus a plain pair for anyone who does know.
 *
 *   -1.9536, 30.0606
 *   https://maps.google.com/maps?q=-1.9536,30.0606
 *   https://www.google.com/maps/@-1.9536,30.0606,17z
 *   https://www.google.com/maps/place/Kigali/@-1.9536,30.0606,15z
 *
 * A shortened `maps.app.goo.gl` link carries no coordinates at all — it has to
 * be opened first — so that case is named explicitly rather than failing as
 * "could not read that".
 */
export function parseCoordinates(
  input: string,
): { latitude: number; longitude: number } | { error: string } {
  const text = input.trim();
  if (!text) return { error: t`Paste a Google Maps link, or type the coordinates.` };

  if (/goo\.gl|maps\.app/.test(text)) {
    return {
      error: t`That is a shortened link, which hides the coordinates. Open it in a browser first, then copy the full address from the bar.`,
    };
  }

  // `@lat,lng` wins over `q=lat,lng`: a /place/ URL carries both, and the one
  // after the @ is where the map is actually centred.
  const at = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const query = text.match(/[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  const bare = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  const found = at ?? query ?? bare;

  if (!found) {
    return {
      error: t`Could not find coordinates in that. Paste a Google Maps link, or type them as "-1.9536, 30.0606".`,
    };
  }

  const latitude = Number(found[1]);
  const longitude = Number(found[2]);

  if (latitude < -90 || latitude > 90) {
    return { error: t`${latitude} is not a latitude — it has to be between -90 and 90.` };
  }
  if (longitude < -180 || longitude > 180) {
    return { error: t`${longitude} is not a longitude — it has to be between -180 and 180.` };
  }
  // The server refuses this too (IsNotNullIsland). Caught here so the message
  // explains rather than reciting a validator's name.
  if (latitude === 0 && longitude === 0) {
    return {
      error: t`0, 0 is a point in the Atlantic Ocean. That is usually what a map shows when it has not found anything yet.`,
    };
  }

  return { latitude, longitude };
}

/**
 * Where a branch is (§157): a pasted map link or a typed pair, or the browser's
 * own position for someone filling this in at the shop — and the pin on a map,
 * because a pin either looks like your shop or it does not.
 */
export function PlaceField({
  value,
  onChange,
  onProblem,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  onProblem: (problem: string | null) => void;
  hint: string;
}) {
  const [locating, setLocating] = useState(false);
  const coordinates = value.trim() ? parseCoordinates(value) : null;

  /** The browser's own position, for someone filling this in at the shop. */
  const useMyPosition = () => {
    if (!navigator.geolocation) {
      onProblem(t`This browser cannot find your position. Paste a map link instead.`);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange(`${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`);
        onProblem(null);
        setLocating(false);
      },
      () => {
        setLocating(false);
        onProblem(t`Could not get your position. Allow location for this site, or paste a Google Maps link instead.`);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  return (
    <div className="bf-field">
      <label htmlFor="bf-place"><Trans>Where it is</Trans></label>
      <div className="bf-place">
        <span className="bf-place-icon">
          <Icon name="pin" size={18} />
        </span>
        <input
          id="bf-place"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onProblem(null);
          }}
          placeholder={t`Paste a Google Maps link, or -1.9536, 30.0606`}
        />
        <button type="button" className="bf-locate" onClick={useMyPosition} disabled={locating}>
          <Icon name="zap" size={15} />
          {locating ? t`Finding you…` : t`Use my current position`}
        </button>
      </div>
      <span className="bf-help">{hint}</span>
      {coordinates && 'error' in coordinates && (
        <p className="error small" role="alert">
          {coordinates.error}
        </p>
      )}
      {coordinates && !('error' in coordinates) && (
        <div className="bf-map">
          <p>
            <Icon name="checkCircle" size={15} />
            <Trans>
              Found {coordinates.latitude.toFixed(5)},{' '}
              {coordinates.longitude.toFixed(5)}. Check that the pin is on your shop before saving —
              customers' distances are measured from it.
            </Trans>
          </p>
          <MapPin latitude={coordinates.latitude} longitude={coordinates.longitude} />
        </div>
      )}
    </div>
  );
}

/** Districts grouped by province, because thirty in one flat list is not how anyone thinks about where they are (§104). */
export function DistrictField({
  value,
  onChange,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  hint: string;
}) {
  // Reference data, so it is fetched once and kept.
  const provinces = useQuery({ queryKey: ['provinces'], queryFn: listProvinces, staleTime: Infinity });
  return (
    <div className="bf-field">
      <label htmlFor="bf-district"><Trans>District</Trans></label>
      <Select
        id="bf-district"
        value={value}
        onChange={onChange}
        placeholder={t`Choose a district`}
        sheetTitle={t`District`}
        icon="pin"
        options={
          provinces.data?.flatMap((province) =>
            province.districts.map((district) => ({ value: district.id, label: district.name, group: province.name })),
          ) ?? []
        }
      />
      <span className="bf-help">{hint}</span>
    </div>
  );
}

/** As long as the server takes (§318's FIND_US_MAX): about three lines on a phone. */
const FIND_US_MAX = 280;

/**
 * How to find the door (§318). The pin finds the building, and in a building
 * of twenty shops that is not the door — so the shop says the rest in its own
 * words: the floor, the entrance, what it is opposite. Customers read it under
 * the map, on their booking and in its email.
 */
export function FindUsField({ id, value, onChange }: { id: string; value: string; onChange: (next: string) => void }) {
  return (
    <div className="bf-field">
      <label htmlFor={id}>
        <Trans>How to find us <em>optional</em></Trans>
      </label>
      <textarea
        id={id}
        rows={3}
        value={value}
        maxLength={FIND_US_MAX}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t`2nd floor of Kigali Heights, opposite the MTN shop. Ask the guard at the door.`}
      />
      <span className="bf-help bf-findus">
        <span>
          <Trans>The pin finds the building; this finds your door. Customers read it under the map and on their booking.</Trans>
        </span>
        <span className="bf-count" aria-hidden="true">
          {value.length}/{FIND_US_MAX}
        </span>
      </span>
    </div>
  );
}

/**
 * Opening a branch (§117), in the panel from the right (§195).
 *
 * Coordinates are required by the server on create and optional on update
 * (§43.2), because a branch with no position never appears in a distance search
 * and being found by someone nearby is what discovery is for.
 */
export function NewBranchPanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [place, setPlace] = useState('');
  const [findUs, setFindUs] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [fromAddress, setFromAddress] = useState<string | null>(null);
  const districtFrom = useDistrictFrom();

  // A chosen suggestion drops the pin, and picks the district when it names one (§228).
  const onPick = (found: FoundAddress) => {
    setPlace(`${found.latitude.toFixed(6)}, ${found.longitude.toFixed(6)}`);
    const district = districtFrom(found);
    if (district) setDistrictId(district);
    setProblem(null);
    setFromAddress(district ? t`The pin and the district were filled in from this address.` : t`The pin was filled in from this address.`);
  };

  const create = useMutation({
    mutationFn: (body: Parameters<typeof createLocation>[0]) => createLocation(body),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (error) =>
      setProblem(error instanceof ApiError ? error.message : 'Could not open that branch.'),
  });

  const coordinates = place.trim() ? parseCoordinates(place) : null;
  const ready =
    name.trim().length >= 2 &&
    address.trim().length >= 3 &&
    // Required for a NEW branch (§135.8). Without it the branch disappears the
    // moment a customer picks their area, and nothing tells them it exists.
    districtId !== '' &&
    coordinates !== null &&
    !('error' in coordinates);

  return (
    <Panel
      eyebrow={t`Add a branch`}
      title={t`A new branch`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            <Trans>Cancel</Trans>
          </button>
          <button type="submit" form="new-branch" className="primary" disabled={!ready || create.isPending}>
            {create.isPending ? t`Opening…` : t`Open this branch`}
          </button>
        </>
      }
    >
      <form
        id="new-branch"
        className="bf"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = parseCoordinates(place);
          if ('error' in parsed) {
            setProblem(parsed.error);
            return;
          }
          setProblem(null);
          create.mutate({
            name: name.trim(),
            address: address.trim(),
            latitude: parsed.latitude,
            longitude: parsed.longitude,
            ...(districtId ? { districtId } : {}),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
            ...(findUs.trim() ? { findUs: findUs.trim() } : {}),
          });
        }}
      >
        <div className="bf-two">
          <div className="bf-field">
            <label htmlFor="bf-name"><Trans>Branch name</Trans></label>
            <input
              id="bf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder={t`Kimironko Branch`}
              autoFocus
            />
          </div>
          <div className="bf-field">
            <label htmlFor="bf-phone"><Trans>Phone for this branch <em>optional</em></Trans>
            </label>
            <input
              id="bf-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={30}
              placeholder={t`Leave empty to use the business phone`}
            />
          </div>
        </div>

        <div className="bf-field">
          <label htmlFor="bf-address"><Trans>Address</Trans></label>
          <AddressField
            id="bf-address"
            value={address}
            onChange={(next) => {
              setAddress(next);
              setFromAddress(null);
            }}
            onPick={onPick}
            placeholder={t`Start typing — KG 9 Ave, Kimironko…`}
          />
          <span className={`bf-help${fromAddress ? ' is-ok' : ''}`}>
            {fromAddress ? t`${fromAddress} Check the pin below is on your shop.` : t`Pick a suggestion to drop the pin on the map for you.`}
          </span>
        </div>

        <PlaceField
          value={place}
          onChange={setPlace}
          onProblem={setProblem}
          hint={t`Customers find you by how near you are. Choose a suggested address above, paste the shop's Google Maps link, or press the button if you are there now.`}
        />

        <DistrictField
          value={districtId}
          onChange={setDistrictId}
          hint={t`Customers filter by this. It is how this branch appears when someone searches their area, so it has to be chosen.`}
        />

        <FindUsField id="bf-findus" value={findUs} onChange={setFindUs} />

        {problem && (
          <p className="error small" role="alert">
            {problem}
          </p>
        )}

        {/* Said before the save, not after: a new branch is closed every day
            until its hours are set, and a business that does not know that
            reads an empty calendar as the platform being broken. */}
        <p className="bf-note">
          <Icon name="clock" size={16} />
          <Trans>
            A new branch starts closed every day. Set its hours once it is open, or customers will see
            nothing bookable.
          </Trans>
        </p>
      </form>
    </Panel>
  );
}
