import { useCallback, useRef, useState } from 'react';
import { useDismiss } from './useDismiss';
import { Icon, type IconName } from './Icon';

import { t } from '@lingui/core/macro';

export type MoreItem = { label: string; icon: IconName; onClick: () => void; danger?: boolean };

/**
 * "⋯" — the rarer things to do with something (§193, §194): opened beside it,
 * closed by a click elsewhere or Esc. The everyday action stays a button of
 * its own; what is behind here is what should take one more step.
 */
export function MoreMenu({
  items,
  disabled,
  label = t`More`,
  align = 'right',
}: {
  items: MoreItem[];
  disabled?: boolean;
  label?: string;
  align?: 'right' | 'left';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);
  return (
    <div className={`more${open ? ' is-open' : ''}`} ref={ref}>
      <button
        type="button"
        className="more-btn"
        onClick={() => setOpen((was) => !was)}
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        title={label}
      >
        <Icon name="more" size={20} />
      </button>
      {open && (
        <div className={`menu more-menu${align === 'left' ? ' is-left' : ''}`} role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`menu-item${item.danger ? ' is-danger' : ''}`}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
