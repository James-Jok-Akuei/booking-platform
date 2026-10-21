import type { Location, MemberBranches } from '../api/business';
import { Icon } from '../ui/Icon';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

/**
 * Where someone works (§277): every branch — including any opened later — or
 * the ones ticked. Used when inviting someone and when changing it later, so
 * both say it the same way.
 */
export function BranchPicker({
  branches,
  value,
  onChange,
  compact = false,
}: {
  /** The open branches to choose from. */
  branches: Location[];
  value: MemberBranches;
  onChange: (next: MemberBranches) => void;
  /** In the narrow invite card: the two choices stacked. */
  compact?: boolean;
}) {
  const ticked = new Set(value.locationIds);
  const tick = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Kept in the branches' own order, so the list reads the same everywhere.
    onChange({ allLocations: false, locationIds: branches.filter((b) => next.has(b.id)).map((b) => b.id) });
  };

  return (
    <div className={`bp${compact ? ' is-compact' : ''}`}>
      <div className="bp-modes" role="radiogroup" aria-label={t`Which branches`}>
        <button
          type="button"
          role="radio"
          aria-checked={value.allLocations}
          className={`bp-mode${value.allLocations ? ' is-on' : ''}`}
          onClick={() => onChange({ allLocations: true, locationIds: [] })}
        >
          <span className="bp-mode-icon">
            <Icon name="layers" size={18} />
          </span>
          <span>
            <strong><Trans>Every branch</Trans></strong>
            <em><Trans>Including any you open later</Trans></em>
          </span>
          <i className="bp-dot" aria-hidden="true" />
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!value.allLocations}
          className={`bp-mode${!value.allLocations ? ' is-on' : ''}`}
          onClick={() =>
            // Starting from one branch, when there is only one to choose.
            onChange({ allLocations: false, locationIds: branches.length === 1 ? [branches[0].id] : value.locationIds })
          }
        >
          <span className="bp-mode-icon">
            <Icon name="pin" size={18} />
          </span>
          <span>
            <strong><Trans>Chosen branches</Trans></strong>
            <em><Trans>Only the ones you tick</Trans></em>
          </span>
          <i className="bp-dot" aria-hidden="true" />
        </button>
      </div>

      {!value.allLocations && (
        <ul className="bp-list" aria-label={t`Branches`}>
          {branches.map((b, i) => {
            const on = ticked.has(b.id);
            return (
              <li key={b.id} style={{ animationDelay: `${i * 35}ms` }}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className={`bp-branch${on ? ' is-on' : ''}`}
                  onClick={() => tick(b.id)}
                >
                  <span className="bp-box" aria-hidden="true">
                    <Icon name="check" size={13} stroke={3} />
                  </span>
                  <span className="bp-name">
                    <strong>{b.name}</strong>
                    <em>{b.district ? `${b.district.name}, ${b.district.province.name}` : b.address}</em>
                  </span>
                </button>
              </li>
            );
          })}
          {value.locationIds.length === 0 && (
            <li className="bp-need" role="status">
              <Icon name="info" size={14} />{' '}
              <Trans>Tick at least one branch.</Trans>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** "Every branch", or the branches' names — the same words on a row and an invitation. */
export function branchWords(value: MemberBranches, branches: Location[]) {
  if (value.allLocations) return t`Every branch`;
  const names = value.locationIds
    .map((id) => branches.find((b) => b.id === id)?.name)
    .filter((n): n is string => Boolean(n));
  return names.length ? names.join(', ') : t`No branch yet`;
}
