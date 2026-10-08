import type { Location } from '../api/business';
import { Icon } from './Icon';

/**
 * Choosing a branch, as pills (§196, §199) — for pages that show one branch at
 * a time. Shown only when there is more than one to choose from.
 */
export function BranchPills({
  branches,
  value,
  onChange,
  extra,
}: {
  branches: Location[];
  value: string | null;
  onChange: (id: string) => void;
  /** A word after a branch's name, e.g. its rating. */
  extra?: (branch: Location) => string | null;
}) {
  if (branches.length < 2) return null;
  return (
    <div className="bpills" role="tablist" aria-label="Branch">
      {branches.map((b) => {
        const after = extra?.(b);
        return (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={b.id === value}
            className={`bpill${b.id === value ? ' is-active' : ''}`}
            onClick={() => onChange(b.id)}
          >
            <Icon name="pin" size={16} />
            {b.name}
            {!b.isActive && <em>closed</em>}
            {after && <em>{after}</em>}
          </button>
        );
      })}
    </div>
  );
}
