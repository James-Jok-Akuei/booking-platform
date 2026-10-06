import { useState } from 'react';
import { MapPin } from './MapPin';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { createLocation, listProvinces } from '../api/business';

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
  if (!text) return { error: 'Paste a Google Maps link, or type the coordinates.' };

  if (/goo\.gl|maps\.app/.test(text)) {
    return {
      error:
        'That is a shortened link, which hides the coordinates. Open it in a ' +
        'browser first, then copy the full address from the bar.',
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
      error:
        'Could not find coordinates in that. Paste a Google Maps link, or type ' +
        'them as "-1.9536, 30.0606".',
    };
  }

  const latitude = Number(found[1]);
  const longitude = Number(found[2]);

  if (latitude < -90 || latitude > 90) {
    return { error: `${latitude} is not a latitude — it has to be between -90 and 90.` };
  }
  if (longitude < -180 || longitude > 180) {
    return { error: `${longitude} is not a longitude — it has to be between -180 and 180.` };
  }
  // The server refuses this too (IsNotNullIsland). Caught here so the message
  // explains rather than reciting a validator's name.
  if (latitude === 0 && longitude === 0) {
    return {
      error:
        '0, 0 is a point in the Atlantic Ocean. That is usually what a map shows ' +
        'when it has not found anything yet.',
    };
  }

  return { latitude, longitude };
}

/**
 * Opening a branch.
 *
 * This did not exist until §117, while three other pages told people to "add a
 * branch first, under Branches & hours" — so a newly approved business was
 * instructed three times to do something the app could not do.
 *
 * Coordinates are required by the server on create and optional on update
 * (§43.2), because a branch with no position never appears in a distance search
 * and being found by someone nearby is what discovery is for.
 */
export function NewBranchForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [place, setPlace] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const provinces = useQuery({ queryKey: ['provinces'], queryFn: listProvinces });

  const create = useMutation({
    mutationFn: (body: Parameters<typeof createLocation>[0]) => createLocation(body),
    onSuccess: () => {
      setOpen(false);
      setName('');
      setAddress('');
      setPhone('');
      setDistrictId('');
      setPlace('');
      setProblem(null);
      onCreated();
    },
    onError: (error) =>
      setProblem(
        error instanceof ApiError ? error.message : 'Could not open that branch.',
      ),
  });

  /** The browser's own position, for someone filling this in at the shop. */
  const useMyPosition = () => {
    if (!navigator.geolocation) {
      setProblem('This browser cannot find your position. Paste a map link instead.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPlace(
          `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`,
        );
        setProblem(null);
        setLocating(false);
      },
      () => {
        setLocating(false);
        setProblem(
          'Could not get your position. Allow location for this site, or paste a ' +
            'Google Maps link instead.',
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  if (!open) {
    return (
      <div className="row-end">
        <button type="button" className="primary" onClick={() => setOpen(true)}>
          Add a branch
        </button>
      </div>
    );
  }

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
    <form
      className="card"
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
        });
      }}
    >
      <h2>A new branch</h2>

      <label>
        Branch name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Kimironko Branch"
          autoFocus
        />
      </label>

      <label>
        Address
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={300}
          placeholder="KG 9 Ave, Kimironko"
        />
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
          Customers find you by how near you are. Open the shop in Google Maps and
          copy the link from the address bar — or press the button below if you are
          there now.
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
        <>
          <p className="muted small">
            Found {coordinates.latitude.toFixed(5)}, {coordinates.longitude.toFixed(5)}. Check
            that the pin is on your shop before saving — customers' distances are measured
            from it.
          </p>
          <MapPin latitude={coordinates.latitude} longitude={coordinates.longitude} />
        </>
      )}

      <label>
        District
        <select value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
          <option value="">Choose a district</option>
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
          Customers filter by this. It is how this branch appears when someone
          searches their area, so it has to be chosen.
        </span>
      </label>

      <label>
        Phone for this branch <span className="muted small">(optional)</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={30}
          placeholder="Leave empty to use the business phone"
        />
      </label>

      {problem && (
        <p className="error small" role="alert">
          {problem}
        </p>
      )}

      {/* Said before the save, not after: a new branch is closed every day until
          its hours are set, and a business that does not know that reads an
          empty calendar as the platform being broken. */}
      <p className="muted small">
        A new branch starts closed every day. Set its hours below once it is open,
        or customers will see nothing bookable.
      </p>

      <div className="row-end">
        <button type="button" className="link" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!ready || create.isPending}>
          {create.isPending ? 'Opening…' : 'Open this branch'}
        </button>
      </div>
    </form>
  );
}
