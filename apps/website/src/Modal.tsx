import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';

/** A window over the page: closes on Escape, the backdrop or ✕, and holds the page still while open. */
export function Modal({
  title,
  onClose,
  wide = false,
  className = '',
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal${wide ? ' is-wide' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={18} stroke={2.2} />
        </button>
        {children}
      </div>
    </div>
  );
}
