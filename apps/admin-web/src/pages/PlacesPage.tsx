import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { Toggle } from '../components/Toggle';
import {
  createDistrict,
  listAdminPlaces,
  renameDistrict,
  setDistrictLive,
  type AdminDistrict,
  type AdminProvince,
} from '../api/admin';

/**
 * Where the platform is open for business.
 *
 * Rwanda's districts are a fact of the country; which of them this platform
 * trades in is a decision, and it is made here. Open Musanze when there is
 * somebody to serve there, retire it if that changes.
 *
 * Nothing is deleted (§101). Retiring takes a district out of the business
 * picker and the customer's filter — branches already there keep their listing
 * and stay in search, because they did not make this decision (§98.1).
 */
export function PlacesPage() {
  const queryClient = useQueryClient();
  const places = useQuery({ queryKey: ['admin-places'], queryFn: listAdminPlaces });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-places'] });

  const open = places.data?.flatMap((p) => p.districts.filter((d) => d.isLive)).length ?? 0;
  const total = places.data?.flatMap((p) => p.districts).length ?? 0;

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Places</h1>
          <p className="muted">
            Where the platform is open. Retiring one never removes the businesses
            already there.
          </p>
        </div>
        {places.data && (
          <span className="muted small">
            {open} of {total} districts open
          </span>
        )}
      </header>

      {places.isLoading && <p className="muted">Loading…</p>}

      <ul className="taxonomy">
        {places.data?.map((province) => (
          <ProvinceCard key={province.id} province={province} onChanged={refresh} />
        ))}
      </ul>
    </section>
  );
}

function ProvinceCard({
  province,
  onChanged,
}: {
  province: AdminProvince;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const fail = (error: unknown) =>
    setProblem(error instanceof ApiError ? error.message : 'That did not work.');
  const done = () => {
    setProblem(null);
    onChanged();
  };

  const add = useMutation({
    mutationFn: () =>
      createDistrict({ provinceId: province.id, name: name.trim(), code: code.trim() }),
    onSuccess: () => {
      setName('');
      setCode('');
      done();
    },
    onError: fail,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate();
  };

  const open = province.districts.filter((d) => d.isLive).length;

  return (
    <li className={open > 0 ? 'cat' : 'cat off'}>
      <div className="cat-head">
        <div>
          <strong>{province.name}</strong>
          <div className="muted small">
            {open} of {province.districts.length} open
            {open === 0 && ' — this province is not offered at all'}
          </div>
        </div>
      </div>

      {problem && (
        <p className="error small" role="alert">
          {problem}
        </p>
      )}

      <ul className="subs">
        {province.districts.map((district) => (
          <DistrictRow
            key={district.id}
            district={district}
            onChanged={done}
            onError={fail}
          />
        ))}
      </ul>

      <form className="sub-add" onSubmit={submit}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Add a district, e.g. Kinigi"
        />
        <input
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="CODE"
          size={10}
        />
        <button
          type="submit"
          disabled={add.isPending || name.trim().length < 2 || code.trim().length < 2}
        >
          Add
        </button>
      </form>
    </li>
  );
}

function DistrictRow({
  district,
  onChanged,
  onError,
}: {
  district: AdminDistrict;
  onChanged: () => void;
  onError: (error: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);

  const toggle = useMutation({
    mutationFn: (isLive: boolean) => setDistrictLive(district.id, isLive),
    onSuccess: onChanged,
    onError,
  });
  const rename = useMutation({
    mutationFn: (name: string) => renameDistrict(district.id, name),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError,
  });

  const onToggle = (next: boolean) => {
    const n = district.branchCount;
    // Names the consequence rather than asking "are you sure". The reassurance
    // about existing branches is the part worth reading.
    const message = next
      ? `Open the platform in ${district.name}?\n\nBusinesses will be able to put a branch here, and customers will see it as a filter.`
      : `Retire ${district.name}?\n\n` +
        'No new branch can be put here, and customers will not see it as a filter.' +
        (n > 0
          ? `\n\nThe ${n} branch${n === 1 ? '' : 'es'} already here keep their listing and stay in search. Nothing is removed.`
          : '');
    if (window.confirm(message)) toggle.mutate(next);
  };

  return (
    <li>
      {editing ? (
        <form
          className="sub-add"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem('name') as HTMLInputElement;
            rename.mutate(input.value.trim());
          }}
        >
          <input name="name" defaultValue={district.name} autoFocus />
          <button type="submit" className="primary" disabled={rename.isPending}>
            Save
          </button>
          <button type="button" className="link" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div>
          <span>{district.name}</span>
          <span className="muted small">
            {' '}
            · {district.branchCount} branch{district.branchCount === 1 ? '' : 'es'}
            {district.branchCount > 0 && !district.isLive && ' · still listed'}
          </span>
        </div>
      )}

      <div className="people-actions">
        <Toggle
          checked={district.isLive}
          disabled={toggle.isPending}
          onChange={onToggle}
          label={district.isLive ? 'Open' : 'Retired'}
        />
        {!editing && (
          <button type="button" className="link" onClick={() => setEditing(true)}>
            Rename
          </button>
        )}
      </div>
    </li>
  );
}
