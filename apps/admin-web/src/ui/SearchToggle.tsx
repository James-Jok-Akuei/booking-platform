import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/**
 * A search that waits as an icon at the end of a row of tabs (§289), and
 * opens into a field when it is wanted — so a page whose work is the tabs
 * does not give a whole row to a box that is used now and then.
 *
 * It asks once typing pauses, stays open while it holds a search, and closes
 * with × (which clears it) or Escape on an empty field. "/" opens it from
 * anywhere on the page that is not already a field, as on most consoles.
 */
export function SearchToggle({
  value,
  onChange,
  placeholder,
  label,
}: {
  /** The search in force — kept in the address by the page. */
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
}) {
  const [typed, setTyped] = useState(value);
  const [open, setOpen] = useState(Boolean(value));
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Asks once typing pauses.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (typed.trim() !== value) onChange(typed.trim());
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  // Cleared from elsewhere (the empty state's button, a tab link).
  useEffect(() => {
    if (value === typed.trim()) return;
    setTyped(value);
    if (!value && document.activeElement !== input.current) setOpen(false);
    if (value) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      event.preventDefault();
      setOpen(true);
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const show = () => {
    setOpen(true);
    // After the field can take focus: it is inert while closed.
    window.requestAnimationFrame(() => input.current?.focus());
  };

  const close = () => {
    setTyped('');
    if (value) onChange('');
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className={`sx${open ? ' is-open' : ''}`} role="search">
      <button
        ref={button}
        type="button"
        className="sx-icon"
        onClick={() => (open ? input.current?.focus() : show())}
        aria-label={open ? label : `${label} — or press /`}
        aria-expanded={open}
        title={open ? undefined : 'Search (/)'}
      >
        <Icon name="search" size={18} />
      </button>
      <input
        ref={input}
        type="search"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            if (typed) setTyped('');
            else close();
          }
        }}
        onBlur={() => {
          if (!typed.trim() && !value) setOpen(false);
        }}
        placeholder={placeholder}
        aria-label={label}
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
      />
      {open && (
        <button type="button" className="sx-clear" onClick={close} aria-label="Clear and close the search">
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

/** A search that found nothing, and the way back (§289). */
export function NothingFound({ q, onClear }: { q: string; onClear: () => void }) {
  return (
    <div className="q-empty sx-empty">
      <span>
        <Icon name="search" size={26} />
      </span>
      <strong>Nothing matches “{q}”</strong>
      <p className="muted">Try a shop’s name, a branch or district, or the last digits of a number.</p>
      <button type="button" onClick={onClear}>
        <Icon name="close" size={15} />
        Clear the search
      </button>
    </div>
  );
}
