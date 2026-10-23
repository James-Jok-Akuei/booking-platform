import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccess } from '../access';
import { navItemsFor } from '../nav';
import { Icon, type IconName } from '../ui/Icon';
import { useTour } from '../tour/Tour';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import { EmptyState } from '../ui/EmptyState';

/** Each group's heading, in the app's language (§308); the keys above stay as they are. */
const SECTION_TITLE: Record<Entry['section'], () => string> = {
  Actions: () => t`Actions`,
  Pages: () => t`Pages`,
  Account: () => t`Account`,
};

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
 * Search, or jump anywhere (§190). Opened with ⌘K / Ctrl K, with "/", or from
 * the top bar.
 *
 * Twelve pages in five groups is a lot to hold in your head on a busy day; this
 * finds one by any word for it ("prices" finds Services, "momo" finds Getting
 * paid). It only goes to pages and starts things the app already does — it is
 * a faster way to reach them, not a second set of features.
 */
export function CommandPalette({
  onClose,
  onCheckIn,
  onSignOut,
}: {
  onClose: () => void;
  onCheckIn: () => void;
  onSignOut: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const access = useAccess();
  const tour = useTour();

  const entries = useMemo<Entry[]>(() => {
    const go = (to: string) => () => {
      onClose();
      navigate(to);
    };
    return [
      {
        id: 'check-in',
        label: t`Check in a customer`,
        hint: t`Type the code they read out to you`,
        icon: 'ticket',
        section: 'Actions',
        words: t({ message: 'verify code arrival redeem arrived', context: 'search words' }),
        run: () => {
          onClose();
          onCheckIn();
        },
      },
      // Offered only to those who may do them (§277).
      ...(access.runsBusiness
        ? [
            {
              id: 'add-service',
              label: t`Add a service`,
              hint: t`Put something new on your menu`,
              icon: 'plus' as const,
              section: 'Actions' as const,
              words: t({ message: 'new service price create', context: 'search words' }),
              run: go('/services'),
            },
          ]
        : []),
      ...(access.runsBranches
        ? [
            {
              id: 'block-time',
              label: t`Take time off`,
              hint: t`Close a day, or block a break`,
              icon: 'calendarX' as const,
              section: 'Actions' as const,
              words: t({ message: 'holiday closed break lunch', context: 'search words' }),
              run: go('/closures'),
            },
          ]
        : []),
      ...navItemsFor(access).map<Entry>((item) => ({
        id: item.to,
        label: item.label,
        hint: item.hint,
        icon: item.icon,
        section: 'Pages',
        tag: item.group ?? t`Your day`,
        words: `${item.keywords} ${item.group ?? ''}`,
        run: go(item.to),
      })),
      {
        id: 'tour',
        label: t`Take the welcome tour`,
        hint: t`How a booking reaches you, and where everything is`,
        icon: 'play',
        section: 'Account',
        words: t({ message: 'tour guide walkthrough new start learn how it works show me around', context: 'search words' }),
        run: () => {
          onClose();
          tour.start();
        },
      },
      {
        id: 'sign-out',
        label: t`Sign out`,
        hint: t`Leave this account on this device`,
        icon: 'logout',
        section: 'Account',
        words: t({ message: 'log out exit', context: 'search words' }),
        run: () => {
          onClose();
          onSignOut();
        },
      },
    ];
  }, [navigate, onCheckIn, onClose, onSignOut, access, tour]);

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
        aria-label={t`Search or jump to a page`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="cp-search">
          <Icon name="search" size={20} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t`Search pages and actions…`}
            aria-label={t`Search pages and actions`}
            role="combobox"
            aria-expanded="true"
            aria-controls="cp-list"
          />
          <kbd className="kbd"><Trans>Esc</Trans></kbd>
        </div>

        <div className="cp-list" id="cp-list" role="listbox" ref={listRef}>
          {sections.length === 0 && (
            <EmptyState
              size="card"
              className="cp-empty"
              art="search"
              title={t`Nothing called “${query}”`}
              text={t`Try a page name, or a word like “prices” or “holiday”.`}
            />
          )}
          {sections.map((group) => (
            <div key={group.section} className="cp-section">
              <p className="cp-section-title">{SECTION_TITLE[group.section]()}</p>
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
          <span><Trans><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> to move</Trans></span>
          <span><Trans><kbd className="kbd">↵</kbd> to open</Trans></span>
          <span><Trans><kbd className="kbd">esc</kbd> to close</Trans></span>
        </div>
      </div>
    </div>
  );
}
