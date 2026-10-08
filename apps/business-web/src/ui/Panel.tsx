import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Portal } from './Portal';

/**
 * The panel from the right that a form opens in (§194, §195): a little
 * coloured heading, the content scrolling in the middle, and — when given —
 * its buttons fixed at the foot, so Save is never scrolled out of reach.
 * Esc or a click outside closes it.
 */
export function Panel({
  eyebrow,
  title,
  onClose,
  children,
  footer,
  width = 720,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <Portal>
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="drawer panel"
        style={{ width: `min(${width}px, 100%)` }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="panel-head">
          <div>
            <p>{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close this panel">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="panel-body">{children}</div>
        {footer && <footer className="panel-foot">{footer}</footer>}
      </aside>
    </div>
    </Portal>
  );
}
