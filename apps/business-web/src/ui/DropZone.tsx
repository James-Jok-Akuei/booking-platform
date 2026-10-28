import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '../api/business';
import { Icon } from './Icon';
import './drop-zone.css';
import { plural, t } from '@lingui/core/macro';

/**
 * Dropping files where a photo or a file is asked for (§305): drag one from
 * the computer onto the place that takes it, instead of hunting through a
 * file window. Every "Add a photo" button stays as it was — this is the
 * second way in, never the only one.
 *
 * While a file is dragged anywhere on the page, every place that takes one
 * lights up (the page guard below), so it is plain where it can go; over one,
 * it says what dropping does. A file of the wrong kind or too large is
 * explained there and then, in the words a seller uses.
 */

/** What a zone takes. Mirrors the server's allow-lists (§81, §83). */
export type FileKind = { types: string[]; extensions: string[]; words: string };

/** Photos for the shop, its branches and services, stories and messages. */
export const PHOTOS: FileKind = {
  types: ['image/jpeg', 'image/png', 'image/webp'],
  extensions: ['.jpg', '.jpeg', '.png', '.webp'],
  get words() { return t`a photo — JPG, PNG or WebP`; },
};

/** A business paper (§314): a scan or a photo of it. */
export const PAPERS: FileKind = {
  types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  extensions: ['.pdf', '.jpg', '.jpeg', '.png', '.webp'],
  get words() { return t`a PDF or a photo — PDF, JPG, PNG or WebP`; },
};

const extensionOf = (file: File) => file.name.slice(file.name.lastIndexOf('.')).toLowerCase();

/**
 * Splits dropped or picked files into those the place takes and a sentence
 * about the rest. Type OR extension, as the help-request picker does: some
 * browsers report an empty type for files the server accepts.
 */
export function sortFiles(files: File[], kind: FileKind) {
  const taken: File[] = [];
  const wrongKind: string[] = [];
  const tooBig: string[] = [];
  for (const file of files) {
    if (!kind.types.includes(file.type) && !kind.extensions.includes(extensionOf(file))) wrongKind.push(file.name);
    else if (file.size > MAX_UPLOAD_BYTES) tooBig.push(file.name);
    else taken.push(file);
  }
  const said: string[] = [];
  // Whole sentences per count, in the app's language (§308.7).
  const words = kind.words;
  const limit = MAX_UPLOAD_MB;
  if (wrongKind.length) {
    said.push(
      wrongKind.length === 1 && files.length === 1
        ? t`That isn’t ${words}.`
        : plural(wrongKind.length, {
            one: `# file isn’t ${words}, so it was left out.`,
            other: `# files aren’t ${words}, so they were left out.`,
          }),
    );
  }
  if (tooBig.length) {
    const name = tooBig[0];
    said.push(
      tooBig.length === 1
        ? t`“${name}” is over ${limit} MB — try a smaller copy.`
        : plural(tooBig.length, { one: `# file is over ${limit} MB and was left out.`, other: `# files are over ${limit} MB and were left out.` }),
    );
  }
  return { taken, problem: said.length ? said.join(' ') : null };
}

const carriesFiles = (event: { dataTransfer: DataTransfer | null }) =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files');

/**
 * A place files can be dropped. Wraps what is already there (the cover, a
 * grid of photos, a message box) and adds nothing until a file is over it.
 */
export function DropZone({
  onFiles,
  kind = PHOTOS,
  multiple = false,
  disabled = false,
  hint,
  className = '',
  noteInside = false,
  children,
}: {
  onFiles: (files: File[]) => void;
  kind?: FileKind;
  multiple?: boolean;
  disabled?: boolean;
  /** What dropping does: "Drop to make it your cover". */
  hint: string;
  className?: string;
  /** Say a problem over the zone's foot, where a note below would cover what follows (the cover). */
  noteInside?: boolean;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Entering a child fires "leave" on the parent: count, so the veil does not flicker.
  const depth = useRef(0);
  const timer = useRef<number | null>(null);
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  const say = (words: string | null) => {
    setProblem(words);
    if (timer.current) window.clearTimeout(timer.current);
    if (words) timer.current = window.setTimeout(() => setProblem(null), 6000);
  };

  const enter = (event: DragEvent) => {
    if (disabled || !carriesFiles(event)) return;
    event.preventDefault();
    depth.current += 1;
    setOver(true);
  };
  const hover = (event: DragEvent) => {
    if (disabled || !carriesFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const leave = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const drop = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    // Not stopped: the page hears it too, and puts the "drop here" outlines away.
    event.preventDefault();
    depth.current = 0;
    setOver(false);
    if (disabled) return;
    const all = Array.from(event.dataTransfer.files);
    const { taken, problem } = sortFiles(all, kind);
    const kept = multiple ? taken : taken.slice(0, 1);
    say(problem ?? (!multiple && taken.length > 1 ? t`One at a time here — the first one was used.` : null));
    if (kept.length) onFiles(kept);
  };

  return (
    <div
      className={`drop-zone${over ? ' is-over' : ''}${disabled ? ' is-disabled' : ''}${noteInside ? ' note-inside' : ''} ${className}`}
      onDragEnter={enter}
      onDragOver={hover}
      onDragLeave={leave}
      onDrop={drop}
    >
      {children}
      {over && (
        <div className="drop-veil" aria-hidden="true">
          <span>
            <Icon name="upload" size={20} />
            {hint}
          </span>
        </div>
      )}
      {problem && (
        <p className="drop-problem" role="alert">
          <Icon name="alert" size={15} />
          <span>{problem}</span>
          <button type="button" onClick={() => say(null)} aria-label={t`Close`}>
            <Icon name="close" size={13} />
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * The page's side (§305), set up once: while files are dragged over it, every
 * drop zone is lit; anywhere else the pointer says files cannot go there —
 * and a file let go outside a zone is ignored, where the browser would
 * otherwise open it in place of the app and lose whatever was being typed.
 */
export function guardFileDrops() {
  let depth = 0;
  const root = document.documentElement;
  const stop = () => {
    depth = 0;
    root.classList.remove('is-dragging-files');
  };
  const inZone = (target: EventTarget | null) =>
    target instanceof Element && target.closest('.drop-zone:not(.is-disabled)') !== null;
  window.addEventListener('dragenter', (event) => {
    if (!carriesFiles(event)) return;
    depth += 1;
    root.classList.add('is-dragging-files');
  });
  window.addEventListener('dragleave', (event) => {
    if (!carriesFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) stop();
  });
  window.addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (!inZone(event.target) && event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  });
  window.addEventListener('drop', (event) => {
    if (carriesFiles(event)) event.preventDefault();
    stop();
  });
  window.addEventListener('dragend', stop);
}
