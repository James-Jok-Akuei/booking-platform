import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NAV_ITEMS } from '../nav';
import { Icon, type IconName } from '../ui/Icon';
import { EmptyState } from '../ui/EmptyState';

type Entry = {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  section: 'Actions' | 'Pages' | 'Account';
  tag?: string;
  words: string;
  run: () => void;
};

/**
 * Search, or jump anywhere (§190, §242) — the business app's. Opened with
 * ⌘K / Ctrl K, with "/", or from the top bar.
 *
 * Twelve pages in four groups; this finds one by any word for it ("momo"
 * finds Payout numbers, "fee" finds Settings). It only goes to pages the
 * console already has — a faster way to reach them, not a second set of
 * features.
 */
export function CommandPalette({ onClose, onSignOut }: { onClose: () => void; onSignOut: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const go = (to: string) => () => {
      onClose();
      navigate(to);
    };
    return [
      {
        id: 'approve',
        label: 'Approve a shop',
        hint: 'The applications waiting, oldest first',
        icon: 'store',
        section: 'Actions',
        words: 'approval queue pending application',
        run: go('/businesses'),
      },
      {
        id: 'run-payouts',
        label: 'Run payouts',
        hint: 'Work out what each shop is owed',
        icon: 'send',
        section: 'Actions',
        words: 'pay businesses money owed',
        run: go('/payouts'),
      },
      {
        id: 'invite-admin',
        label: 'Invite an administrator',
        hint: 'Someone else to help run the platform',
        icon: 'users',
        section: 'Actions',
        words: 'admin invite team colleague access',
        run: go('/users'),
      },
      ...NAV_ITEMS.map<Entry>((item) => ({
        id: item.to,
        label: item.label,
        hint: item.hint,
        icon: item.icon,
        section: 'Pages',
        tag: item.group ?? 'Admin',
        words: `${item.keywords} ${item.group ?? ''}`,
        run: go(item.to),
      })),
      {
        id: 'sign-out',
        label: 'Sign out',
        hint: 'Leave this account on this device',
        icon: 'logout',
        section: 'Account',
        words: 'log out exit',
        run: () => {
          onClose();
          onSignOut();
        },
      },
    ];
  }, [navigate, onClose, onSignOut]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return entries;
    return entries.filter((entry) => {
      const text = `${entry.label} ${entry.hint} ${entry.words}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [entries, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      shown[active]?.run();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  let index = -1;
  const sections = (['Actions', 'Pages', 'Account'] as const)
    .map((section) => ({ section, rows: shown.filter((entry) => entry.section === section) }))
    .filter((group) => group.rows.length > 0);

  return (
    <div className="cp-backdrop" onMouseDown={onClose}>
      <div
        className="cp"
        role="dialog"
        aria-modal="true"
        aria-label="Search or jump to a page"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="cp-search">
          <Icon name="search" size={20} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages and actions…"
            aria-label="Search pages and actions"
            role="combobox"
            aria-expanded="true"
            aria-controls="cp-list"
          />
          <kbd className="kbd">Esc</kbd>
        </div>

        <div className="cp-list" id="cp-list" role="listbox" ref={listRef}>
          {sections.length === 0 && (
            <EmptyState
              size="card"
              className="cp-empty is-panel"
              art="search"
              title={`Nothing called “${query}”`}
              text="Try a page name, or a word like “momo” or “fee”."
            />
          )}
          {sections.map((group) => (
            <div key={group.section} className="cp-section">
              <p className="cp-section-title">{group.section}</p>
              {group.rows.map((entry) => {
                index += 1;
                const mine = index;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="option"
                    aria-selected={mine === active}
                    data-index={mine}
                    className={`cp-row ${mine === active ? 'is-active' : ''}`}
                    onMouseMove={() => setActive(mine)}
                    onClick={entry.run}
                  >
                    <span className="cp-row-icon">
                      <Icon name={entry.icon} size={18} />
                    </span>
                    <span className="cp-row-text">
                      <strong>{entry.label}</strong>
                      <span>{entry.hint}</span>
                    </span>
                    {entry.tag && <span className="cp-row-tag">{entry.tag}</span>}
                    <Icon name="arrowRight" size={16} className="cp-row-go" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="cp-foot">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> to move</span>
          <span><kbd className="kbd">↵</kbd> to open</span>
          <span><kbd className="kbd">esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
