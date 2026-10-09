import { Fragment, type ReactNode } from 'react';
import { parseRich, type RichLine } from '../lib/richText';
import './richtext.css';

/**
 * A shop's formatted words, as read (§271): paragraphs, lists, bold and
 * italic from the stored text (`lib/richText.ts`). Built as elements, never
 * as HTML, so nothing a shop types can become markup.
 */
export function RichText({ text, className = '' }: { text: string | null | undefined; className?: string }) {
  const blocks = parseRich(text);
  if (blocks.length === 0) return null;
  return (
    <div className={`rich ${className}`}>
      {blocks.map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>
            {b.lines.map((line, n) => (
              <Fragment key={n}>
                {n > 0 && <br />}
                {runs(line)}
              </Fragment>
            ))}
          </p>
        ) : b.kind === 'ul' ? (
          <ul key={i}>
            {b.items.map((item, n) => (
              <li key={n}>{runs(item)}</li>
            ))}
          </ul>
        ) : (
          <ol key={i} start={b.start}>
            {b.items.map((item, n) => (
              <li key={n}>{runs(item)}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

function runs(line: RichLine): ReactNode {
  return line.map((r, i) => {
    let node: ReactNode = r.text;
    if (r.italic) node = <em>{node}</em>;
    if (r.bold) node = <strong>{node}</strong>;
    return <Fragment key={i}>{node}</Fragment>;
  });
}
