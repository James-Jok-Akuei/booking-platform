import type { ReactNode } from 'react';
import { EmptyArt } from './EmptyArt';
import type { EmptyArtName } from './emptyArtData';

/**
 * A page, or a part of one, with nothing in it yet (§311).
 *
 * An empty page must not look like a full page with its rows missing — that
 * reads as broken. It gets its own face: a drawing of what will be here, one
 * line on what fills it, and the first step to take.
 *
 * - `page`: the whole page is empty, and the page's usual parts make way for
 *   this (with `framed`, on a white card of its own);
 * - `card`: one card or list on a page that has other things on it;
 * - `row`: a small strip, beside other content.
 */
export function EmptyState({
  art,
  title,
  text,
  children,
  below,
  size = 'page',
  framed = false,
  className = '',
}: {
  art: EmptyArtName;
  title: ReactNode;
  text?: ReactNode;
  /** The buttons: the first step that fills it. */
  children?: ReactNode;
  /** Under the buttons — a few words on what will show here. */
  below?: ReactNode;
  size?: 'page' | 'card' | 'row';
  framed?: boolean;
  className?: string;
}) {
  const Title = size === 'page' ? 'h2' : 'strong';
  return (
    <div className={`es es-${size}${framed ? ' es-framed' : ''} ${className}`}>
      <div className="es-art">
        <EmptyArt name={art} />
      </div>
      <div className="es-words">
        <Title className="es-title">{title}</Title>
        {text && <p className="es-text">{text}</p>}
        {size === 'row' && children && <div className="es-actions">{children}</div>}
      </div>
      {size !== 'row' && children && <div className="es-actions">{children}</div>}
      {below && <div className="es-below">{below}</div>}
    </div>
  );
}

/** "What will show here": a few small points under an empty page's buttons. */
export function EmptyHints({ items }: { items: Array<{ icon: ReactNode; text: ReactNode }> }) {
  return (
    <ul className="es-hints">
      {items.map((item, i) => (
        <li key={i} style={{ animationDelay: `${260 + i * 90}ms` }}>
          <span>{item.icon}</span>
          {item.text}
        </li>
      ))}
    </ul>
  );
}
