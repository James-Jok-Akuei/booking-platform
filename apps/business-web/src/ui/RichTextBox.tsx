import { lazy, Suspense, type ComponentProps } from 'react';
import type { RichTextField } from './RichTextField';
import './richtext.css';

/**
 * The formatted-words box (§271), loaded when a page shows one. The editor
 * (ProseMirror under Tiptap) is about 400 kB that the other pages never
 * need; until it arrives, an empty box the same size holds its place.
 */
const Field = lazy(() => import('./RichTextField').then((m) => ({ default: m.RichTextField })));

export function RichTextBox(props: ComponentProps<typeof RichTextField>) {
  const rows = props.rows ?? 4;
  return (
    <Suspense
      fallback={
        <div className="rtf" aria-busy="true">
          <div className="rtf-bar rtf-bar-wait" />
          <div className="rtf-input" style={{ minHeight: `${rows * 1.55 + 1.3}em` }} />
        </div>
      }
    >
      <Field {...props} />
    </Suspense>
  );
}
