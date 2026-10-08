import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useMediaQuery } from '../shell/useMediaQuery';
import { Icon, type IconName } from './Icon';
import { Portal } from './Portal';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  /** A heading the option sits under — a province over its districts. */
  group?: string;
  hint?: string;
  icon?: IconName;
};

/**
 * The app's own dropdown (§227), in place of the browser's: a white card
 * under the field with a ✓ by the chosen option, the one under the pointer
 * or the arrow keys highlighted, and — for a long list — a search box and
 * headings. On a phone it rises as a sheet from the bottom, as the app's
 * dialogs do, with big rows to tap.
 *
 * Keyboard: ↑ ↓ (or typing a letter) to move, Enter or Space to choose, Esc
 * to close, Home/End to the ends. It closes on a press anywhere else.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder = 'Choose one',
  disabled = false,
  icon,
  label,
  id,
  className = '',
  variant = 'field',
  searchable,
  sheetTitle,
}: {
  value: T | '';
  onChange: (next: T) => void;
  options: Array<SelectOption<T>>;
  placeholder?: string;
  disabled?: boolean;
  /** An icon before the chosen label. */
  icon?: IconName;
  /** Read out to a screen reader when there is no visible label tied to it. */
  label?: string;
  id?: string;
  className?: string;
  /** `field` looks like the app's inputs; `bare` fills a container that is styled already. */
  variant?: 'field' | 'bare';
  /** A search box at the top; on by default for more than ten options. */
  searchable?: boolean;
  /** The heading of the sheet on a phone. */
  sheetTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ top: number; left: number; width: number; maxHeight: number; up: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const listId = useId();
  const sheet = useMediaQuery('(max-width: 600px)');
  const withSearch = searchable ?? options.length > 10;

  const chosen = options.find((o) => o.value === value) ?? null;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.group ?? ''} ${o.hint ?? ''}`.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) trigger.current?.focus();
  }, []);

  const openList = () => {
    if (disabled) return;
    const at = options.findIndex((o) => o.value === value);
    setActive(at >= 0 ? at : 0);
    setOpen(true);
  };

  const choose = (option: SelectOption<T> | undefined) => {
    if (!option) return;
    onChange(option.value);
    close();
  };

  // Under the field, or above it when there is no room below.
  const measure = useCallback(() => {
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return;
    const below = window.innerHeight - box.bottom - 12;
    const above = box.top - 12;
    const up = below < 240 && above > below;
    const room = up ? above : below;
    const width = Math.max(box.width, 220);
    setPlace({
      top: up ? box.top - 6 : box.bottom + 6,
      left: Math.min(box.left, window.innerWidth - width - 12),
      width,
      maxHeight: Math.max(160, Math.min(340, room - 6)),
      up,
    });
  }, []);

  useLayoutEffect(() => {
    if (open && !sheet) measure();
  }, [open, sheet, measure]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || pop.current?.contains(target)) return;
      close(false);
    };
    const follow = () => (sheet ? undefined : measure());
    document.addEventListener('pointerdown', away);
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    if (withSearch) requestAnimationFrame(() => search.current?.focus());
    else requestAnimationFrame(() => pop.current?.focus());
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [open, sheet, measure, close, withSearch]);

  // Keep the highlighted row in view.
  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onListKey = (event: KeyboardEvent) => {
    const last = shown.length - 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(last, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(last);
    } else if (event.key === 'Enter' || (event.key === ' ' && !withSearch)) {
      event.preventDefault();
      choose(shown[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close(false);
    } else if (!withSearch && event.key.length === 1 && /\S/.test(event.key)) {
      // Typing jumps to the first option that starts with what was typed.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + event.key.toLowerCase(), at: now };
      const hit = shown.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
    }
  };

  const onTriggerKey = (event: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      openList();
    }
  };

  let lastGroup: string | undefined;
  const list = (
    <div
      ref={pop}
      className={`sel-pop${sheet ? ' is-sheet' : ''}${place?.up ? ' is-up' : ''}`}
      style={
        sheet || !place
          ? undefined
          : {
              left: place.left,
              width: place.width,
              maxHeight: place.maxHeight,
              ...(place.up ? { bottom: window.innerHeight - place.top } : { top: place.top }),
            }
      }
      tabIndex={-1}
      onKeyDown={onListKey}
    >
      {sheet && (
        <header className="sel-sheet-head">
          <strong>{sheetTitle ?? label ?? placeholder}</strong>
          <button type="button" className="sel-sheet-close" onClick={() => close()} aria-label="Close">
            <Icon name="close" size={17} />
          </button>
        </header>
      )}
      {withSearch && (
        <label className="sel-search">
          <Icon name="search" size={16} />
          <input
            ref={search}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder="Search"
            aria-label="Search the list"
            aria-controls={listId}
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
          />
        </label>
      )}
      <ul className="sel-list" role="listbox" id={listId} aria-label={label ?? sheetTitle}>
        {shown.length === 0 && <li className="sel-none">Nothing matches “{query}”</li>}
        {shown.map((option, i) => {
          const heading = option.group && option.group !== lastGroup ? option.group : null;
          lastGroup = option.group;
          const selected = option.value === value;
          return (
            <li key={option.value} role="presentation">
              {heading && <p className="sel-group">{heading}</p>}
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-selected={selected}
                data-index={i}
                className={`sel-option${i === active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`}
                onPointerMove={() => setActive(i)}
                onClick={() => choose(option)}
              >
                {option.icon && <Icon name={option.icon} size={16} className="sel-option-icon" />}
                <span className="sel-option-text">
                  <span>{option.label}</span>
                  {option.hint && <em>{option.hint}</em>}
                </span>
                {selected && <Icon name="check" size={16} stroke={2.6} className="sel-check" />}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        className={`sel sel-${variant}${open ? ' is-open' : ''}${chosen ? '' : ' is-empty'} ${className}`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKey}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label ? `${label}: ${chosen?.label ?? placeholder}` : undefined}
      >
        {(chosen?.icon ?? icon) && <Icon name={(chosen?.icon ?? icon)!} size={16} className="sel-icon" />}
        <span className="sel-value">{chosen?.label ?? placeholder}</span>
        <Icon name="chevronDown" size={16} stroke={2.2} className="sel-chev" />
      </button>
      {open && (
        <Portal>
          {sheet && <div className="sel-backdrop" onPointerDown={() => close(false)} />}
          {list}
        </Portal>
      )}
    </>
  );
}
