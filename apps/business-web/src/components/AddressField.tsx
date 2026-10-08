import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProvinces, searchAddresses, type FoundAddress } from '../api/business';
import { Icon } from '../ui/Icon';

/** Letters before anything is asked, and the pause in typing that asks (§174). */
const MIN_LETTERS = 3;
const PAUSE_MS = 350;

type Found = { results: FoundAddress[]; available: boolean };

/** The typed letters picked out where they appear: **Kimir**onko Market. */
function Marked({ text, find }: { text: string; find: string }) {
  const at = find ? text.toLowerCase().indexOf(find.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <b>{text.slice(at, at + find.length)}</b>
      {text.slice(at + find.length)}
    </>
  );
}

/**
 * A branch's address, suggested while it is typed (§174, §228) — the search
 * the customer app uses for its offers address, here for a shop: three
 * letters are enough ("kimir" offers Kimironko, its market, the taxi park).
 * Choosing one fills in the address and hands back where it is, so the form
 * can drop the pin and, when the place names one, choose the district.
 *
 * Asked when typing pauses, never on every letter; a question overtaken by
 * more letters is cancelled; the last answers stay, dimmed, while the next
 * come. Only the letters are sent. ↓ ↑ Enter Esc work as in any list.
 */
export function AddressField({
  id,
  value,
  onChange,
  onPick,
  placeholder,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  onPick: (address: FoundAddress) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [asked, setAsked] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  // Set when a suggestion is chosen, so filling the field does not ask again.
  const picked = useRef<string | null>(null);

  const q = value.trim();

  useEffect(() => {
    if (!open || q.length < MIN_LETTERS || picked.current === value) return;
    const control = new AbortController();
    const timer = setTimeout(async () => {
      setAsking(true);
      setFailed(false);
      try {
        const answer = await searchAddresses(q, control.signal);
        setFound(answer);
        setAsked(q);
        setActive(0);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setFailed(true);
      } finally {
        if (!control.signal.aborted) setAsking(false);
      }
    }, PAUSE_MS);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
  }, [q, open, value]);

  // A press anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const results = found?.results ?? [];
  const choose = (address: FoundAddress) => {
    picked.current = address.label;
    onChange(address.label);
    onPick(address);
    setOpen(false);
  };

  const onKey = (event: KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  let body: ReactNode = null;
  if (q.length < MIN_LETTERS) body = <p className="af-note">Keep typing — three letters are enough to start.</p>;
  else if (failed) body = <p className="af-note">Could not search just now. Type the address in full.</p>;
  else if (found && !found.available) body = <p className="af-note">Address search is not available right now. Type it in full.</p>;
  else if (found && results.length === 0 && !asking) body = <p className="af-note">Nothing found for “{asked}”. Type it as you would say it.</p>;
  else if (results.length > 0)
    body = (
      <ul className={`af-list${asking ? ' is-asking' : ''}`} role="listbox" id={`${id}-list`}>
        {results.map((address, i) => (
          <li
            key={`${address.label}-${address.latitude}`}
            id={`${id}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            className={`af-option${i === active ? ' is-active' : ''}`}
            onPointerMove={() => setActive(i)}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => choose(address)}
          >
            <span className="af-icon">
              <Icon name="pin" size={15} />
            </span>
            <span className="af-text">
              <strong>
                <Marked text={address.label} find={asked} />
              </strong>
              <em>{address.detail}</em>
            </span>
          </li>
        ))}
      </ul>
    );
  else if (asking) body = <p className="af-note">Looking…</p>;

  return (
    <div className="af" ref={wrap}>
      <div className="af-input">
        <Icon name="search" size={17} />
        <input
          id={id}
          value={value}
          onChange={(event) => {
            picked.current = null;
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => value.trim() && picked.current !== value && setOpen(true)}
          onKeyDown={onKey}
          maxLength={300}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && results.length > 0 ? `${id}-opt-${active}` : undefined}
        />
        {asking && <span className="af-spin" aria-hidden="true" />}
      </div>
      {open && body && (
        <div className="af-pop">
          {body}
          <p className="af-credit">Suggestions from OpenStreetMap</p>
        </div>
      )}
    </div>
  );
}

/**
 * The district a found place is in, when it names one — "Gasabo District,
 * Kigali" — matched against the platform's own list (§104). A place that
 * names none ("Kimironko · Kigali") leaves the choice to the seller.
 */
export function useDistrictFrom() {
  const provinces = useQuery({ queryKey: ['provinces'], queryFn: listProvinces, staleTime: Infinity });
  return (address: FoundAddress): string | null => {
    const text = `${address.label} ${address.detail}`.toLowerCase();
    for (const province of provinces.data ?? []) {
      for (const district of province.districts) {
        if (new RegExp(`\\b${district.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) {
          return district.id;
        }
      }
    }
    return null;
  };
}
