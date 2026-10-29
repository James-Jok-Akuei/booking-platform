import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { Toggle } from '../components/Toggle';
import { createDistrict, listAdminPlaces, renameDistrict, setDistrictLive, type AdminDistrict, type AdminProvince } from '../api/admin';
import { confirmDialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { RwandaFlag } from '../ui/RwandaFlag';
import './taxonomy.css';
import { useCountries } from '../lib/countries';

const branches = (n: number) => `${n} ${n === 1 ? 'branch' : 'branches'}`;

/**
 * Where the platform is open (§252, §105).
 *
 * Rwanda's districts are a fact of the country; which of them this platform
 * trades in is a decision, made here. Each province is a card and each of its
 * districts a tile with its own switch — open ones lit, retired ones quiet —
 * so the country can be read at a glance. Opening a district puts it in the
 * shop's branch picker and the customer's filter; retiring takes it out of
 * both, and branches already there keep their listing and stay in search,
 * because they did not make this decision (§98.1). Nothing is deleted (§101).
 */
export function PlacesPage() {
  const queryClient = useQueryClient();
  const places = useQuery({ queryKey: ['admin-places'], queryFn: listAdminPlaces });
  const countries = useCountries();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin-places'] });

  // Each country's places together (§315), the default country first.
  const codes = [...new Set((places.data ?? []).map((p) => p.countryCode))].sort(
    (a, b) => Number(countries.find((c) => c.code === b)?.isDefault ?? false) - Number(countries.find((c) => c.code === a)?.isDefault ?? false),
  );

  return (
    <section className="tx">
      <div className="page-top">
        <header className="page-head">
          <div>
            <h1>Places</h1>
            <p className="muted">Where the platform is open. Retiring a district never removes the shops already there.</p>
          </div>
        </header>
      </div>

      {places.isLoading && (
        <div className="pl-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton tx-skel" />
          ))}
        </div>
      )}

      {codes.map((code) => (
        <CountryPlaces
          key={code}
          code={code}
          name={countries.find((c) => c.code === code)?.name ?? code}
          provinces={(places.data ?? []).filter((p) => p.countryCode === code)}
          onChanged={refresh}
        />
      ))}
    </section>
  );
}

/** One country's provinces and districts (§315), under a summary of where it is open. */
function CountryPlaces({ code, name, provinces, onChanged }: { code: string; name: string; provinces: AdminProvince[]; onChanged: () => void }) {
  const all = provinces.flatMap((p) => p.districts);
  const open = all.filter((d) => d.isLive);
  const listed = all.reduce((sum, d) => sum + d.branchCount, 0);

  return (
    <>
      {provinces.length > 0 && (
        <div className="pl-hero">
          {code === 'RW' ? <RwandaFlag width={44} /> : <Icon name="globe" size={30} />}
          <div>
            <strong>
              {name}: open in {open.length} of {all.length} districts
            </strong>
            <span>
              {provinces.filter((p) => p.districts.some((d) => d.isLive)).length} of {provinces.length} provinces · {branches(listed)} listed
            </span>
          </div>
          <div className="pl-bars" aria-hidden="true">
            {provinces.map((p) => {
              const on = p.districts.filter((d) => d.isLive).length;
              return (
                <span key={p.id} title={`${p.name}: ${on} of ${p.districts.length} open`}>
                  <i style={{ width: `${p.districts.length ? (on / p.districts.length) * 100 : 0}%` }} />
                  <em>{p.name.replace(' Province', '').replace('City of ', '')}</em>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="pl-list">
        {provinces.map((province, i) => (
          <Province key={province.id} province={province} index={i} onChanged={onChanged} />
        ))}
      </div>
    </>
  );
}

function Province({ province, index, onChanged }: { province: AdminProvince; index: number; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const fail = (error: unknown) => setProblem(error instanceof ApiError ? error.message : 'That did not work.');
  const done = () => {
    setProblem(null);
    onChanged();
  };

  const add = useMutation({
    mutationFn: () => createDistrict({ provinceId: province.id, name: name.trim(), code: code.trim() }),
    onSuccess: () => {
      setName('');
      setCode('');
      setAdding(false);
      done();
    },
    onError: fail,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length >= 2 && code.trim().length >= 2) add.mutate();
  };

  const on = province.districts.filter((d) => d.isLive).length;
  const listed = province.districts.reduce((sum, d) => sum + d.branchCount, 0);

  return (
    <article className={`pl-card${on === 0 ? ' is-off' : ''}`} style={{ animationDelay: `${Math.min(index, 6) * 50}ms` }}>
      <header className="pl-card-head">
        <span className="pl-ring" style={{ ['--p' as string]: `${province.districts.length ? (on / province.districts.length) * 100 : 0}` }}>
          <b>{on}</b>
        </span>
        <div>
          <strong>{province.name}</strong>
          <span>
            {on === 0 ? 'Not offered anywhere yet' : `${on} of ${province.districts.length} districts open`} · {branches(listed)}
          </span>
        </div>
        <code>{province.code}</code>
      </header>

      {problem && (
        <p className="error small tx-problem" role="alert">
          {problem}
        </p>
      )}

      <ul className="pl-districts">
        {province.districts.map((d) => (
          <District key={d.id} district={d} onChanged={done} onError={fail} />
        ))}
        <li className="pl-new">
          {adding ? (
            <form onSubmit={submit}>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="District" aria-label="District name" autoFocus />
              <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} placeholder="CODE" aria-label="Its code" />
              <div>
                <button type="button" onClick={() => setAdding(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary" disabled={add.isPending || name.trim().length < 2 || code.trim().length < 2}>
                  {add.isPending ? 'Adding…' : 'Add'}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => setAdding(true)}>
              <Icon name="plus" size={16} /> Add a district
            </button>
          )}
        </li>
      </ul>
    </article>
  );
}

function District({ district, onChanged, onError }: { district: AdminDistrict; onChanged: () => void; onError: (error: unknown) => void }) {
  const [editing, setEditing] = useState(false);
  const toggle = useMutation({ mutationFn: (isLive: boolean) => setDistrictLive(district.id, isLive), onSuccess: onChanged, onError });
  const rename = useMutation({
    mutationFn: (name: string) => renameDistrict(district.id, name),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError,
  });

  const onToggle = async (next: boolean) => {
    const n = district.branchCount;
    // Names the consequence rather than asking "are you sure"; the reassurance
    // about existing branches is the part worth reading.
    const sure = await confirmDialog({
      title: next ? `Open the platform in ${district.name}?` : `Retire ${district.name}?`,
      body: next ? (
        <p>Shops will be able to put a branch here, and customers will see it as a filter.</p>
      ) : (
        <p>
          No new branch can be put here, and customers will not see it as a filter.
          {n > 0 && ` The ${branches(n)} already here keep their listing and stay in search. Nothing is removed.`}
        </p>
      ),
      tone: next ? 'ok' : 'warn',
      icon: next ? 'pin' : 'pause',
      confirmLabel: next ? `Open ${district.name}` : `Retire ${district.name}`,
      cancelLabel: 'Not now',
    });
    if (sure) toggle.mutate(next);
  };

  return (
    <li className={`pl-district${district.isLive ? ' is-open' : ''}`}>
      {editing ? (
        <form
          className="tx-rename"
          onSubmit={(event) => {
            event.preventDefault();
            const input = event.currentTarget.elements.namedItem('name') as HTMLInputElement;
            if (input.value.trim().length >= 2) rename.mutate(input.value.trim());
          }}
        >
          <input name="name" defaultValue={district.name} autoFocus aria-label="New name" />
          <button type="submit" className="primary" disabled={rename.isPending}>
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span className="pl-pin">
            <Icon name="pin" size={15} />
          </span>
          <span className="pl-name">
            <b>{district.name}</b>
            <em>
              {branches(district.branchCount)}
              {district.branchCount > 0 && !district.isLive && ' · still listed'}
            </em>
          </span>
          <button type="button" className="tx-icon-btn is-quiet" onClick={() => setEditing(true)} aria-label={`Rename ${district.name}`} title="Rename">
            <Icon name="pencil" size={13} />
          </button>
          <Toggle checked={district.isLive} disabled={toggle.isPending} onChange={(v) => void onToggle(v)} label={district.isLive ? 'Open' : 'Retired'} />
        </>
      )}
    </li>
  );
}
