import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon, type IconName } from './Icon';
import './dialog.css';
import { t } from '@lingui/core/macro';

/**
 * One designed dialog for every question the app asks (§193) — the business
 * app's version of the customer app's (§184). The browser's own
 * `confirm`/`prompt`/`alert` boxes look like a different program, cannot say
 * which choice is the dangerous one, and on a phone can be silenced for good
 * by one tap on "don't show again".
 *
 * Called like the browser's, but awaited:
 *
 *     if (await confirmDialog({ title: 'Remove this photo?', tone: 'danger' })) …
 *     const reason = await promptDialog({ title: 'Why are you cancelling?', minLength: 3 });
 *
 * One `DialogHost` is mounted at the root and shows them one at a time.
 */

export type Tone = 'danger' | 'accent' | 'ok' | 'info' | 'warn';

type Base = {
  title: string;
  body?: React.ReactNode;
  tone?: Tone;
  icon?: IconName;
  confirmLabel?: string;
  cancelLabel?: string;
};

type Request =
  | (Base & { kind: 'confirm'; resolve: (ok: boolean) => void })
  | (Base & { kind: 'alert'; resolve: () => void })
  | (Base & {
      kind: 'prompt';
      label?: string;
      placeholder?: string;
      initial?: string;
      minLength?: number;
      /** Said under the box until the answer is long enough. */
      minMessage?: string;
      /** A line of reassurance or warning under the box. */
      note?: React.ReactNode;
      multiline?: boolean;
      resolve: (value: string | null) => void;
    });

let queue: Request[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const push = (request: Request) => {
  queue = [...queue, request];
  emit();
};
const pop = () => {
  queue = queue.slice(1);
  emit();
};

export const confirmDialog = (options: Base) =>
  new Promise<boolean>((resolve) => push({ ...options, kind: 'confirm', resolve }));

export const alertDialog = (options: Base) =>
  new Promise<void>((resolve) => push({ ...options, kind: 'alert', resolve }));

export const promptDialog = (
  options: Base & {
    label?: string;
    placeholder?: string;
    initial?: string;
    minLength?: number;
    minMessage?: string;
    note?: React.ReactNode;
    multiline?: boolean;
  },
) => new Promise<string | null>((resolve) => push({ ...options, kind: 'prompt', resolve }));

const ICONS: Record<Tone, IconName> = {
  danger: 'alert',
  accent: 'sparkles',
  ok: 'checkCircle',
  info: 'info',
  warn: 'alert',
};

export function DialogHost() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => queue[0] ?? null,
  );
  if (!current) return null;
  return <DialogView key={queueKey(current)} request={current} />;
}

const keys = new WeakMap<Request, number>();
let next = 0;
const queueKey = (r: Request) => {
  if (!keys.has(r)) keys.set(r, ++next);
  return keys.get(r)!;
};

function DialogView({ request }: { request: Request }) {
  const tone = request.tone ?? (request.kind === 'alert' ? 'info' : 'accent');
  const [value, setValue] = useState(request.kind === 'prompt' ? request.initial ?? '' : '');
  const field = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const min = request.kind === 'prompt' ? request.minLength ?? 1 : 0;
  const tooShort = request.kind === 'prompt' && value.trim().length < min;

  const cancel = () => {
    if (request.kind === 'confirm') request.resolve(false);
    else if (request.kind === 'prompt') request.resolve(null);
    else request.resolve();
    pop();
  };
  const accept = () => {
    if (request.kind === 'confirm') request.resolve(true);
    else if (request.kind === 'prompt') {
      if (tooShort) return;
      request.resolve(value.trim());
    } else request.resolve();
    pop();
  };

  useEffect(() => {
    (request.kind === 'prompt' ? field.current : confirmButton.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmLabel =
    request.confirmLabel ?? (request.kind === 'alert' ? t`OK` : request.kind === 'prompt' ? t`Save` : t`Yes`);

  return (
    <div className="dlg-backdrop" onMouseDown={request.kind === 'alert' ? accept : cancel}>
      <div
        className={`dlg tone-${tone}`}
        role={request.kind === 'confirm' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="dlg-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="dlg-icon" aria-hidden="true">
          <Icon name={request.icon ?? ICONS[tone]} size={24} />
        </span>
        <h2 id="dlg-title">{request.title}</h2>
        {request.body && <div className="dlg-body">{request.body}</div>}

        {request.kind === 'prompt' && (
          <form
            className="dlg-form"
            onSubmit={(event) => {
              event.preventDefault();
              accept();
            }}
          >
            {request.label && <label htmlFor="dlg-field">{request.label}</label>}
            {request.multiline === false ? (
              <input
                id="dlg-field"
                ref={field}
                value={value}
                placeholder={request.placeholder}
                onChange={(event) => setValue(event.target.value)}
              />
            ) : (
              <textarea
                id="dlg-field"
                ref={field}
                rows={4}
                value={value}
                placeholder={request.placeholder}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) accept();
                }}
              />
            )}
            {value.trim().length > 0 && tooShort && request.minMessage && (
              <p className="dlg-hint">{request.minMessage}</p>
            )}
            {request.note && <p className="dlg-note">{request.note}</p>}
          </form>
        )}

        <div className="dlg-actions">
          {request.kind !== 'alert' && (
            <button type="button" onClick={cancel}>
              {request.cancelLabel ?? t`Cancel`}
            </button>
          )}
          <button
            ref={confirmButton}
            type="button"
            className={`dlg-confirm tone-${tone}`}
            disabled={tooShort}
            onClick={accept}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
