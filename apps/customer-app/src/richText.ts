/**
 * A shop's formatted words (§271): a service's description and its "before
 * you come", and a shop's own description.
 *
 * Stored as plain text with a few marks — the way WhatsApp formats, which is
 * what sellers here already type — so everything written before still reads,
 * and every app draws it without trusting HTML from a shop:
 *
 *   *bold*  (also **bold**)     _italic_
 *   - a bullet                  (also "* " and "• ")
 *   1. a numbered line          (also "1) ")
 *   a blank line between paragraphs; a single line break stays a break
 *
 * Nothing else is formatting: a "#", a link or a table is just text. A mark
 * with nothing to close it is just its character, and a backslash before a
 * mark keeps it literal ("5\* rating").
 *
 * ONE copy per app — business-web, admin-web, customer-app — identical, like
 * the line drawings (check with `cmp`). The editor that writes it lives only
 * in business-web (`ui/RichTextField.tsx`).
 */

export type Run = { text: string; bold?: boolean; italic?: boolean };
/** One line of a paragraph, or one list item. */
export type RichLine = Run[];
export type RichBlock =
  | { kind: 'p'; lines: RichLine[] }
  | { kind: 'ul'; items: RichLine[] }
  | { kind: 'ol'; items: RichLine[]; start: number };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
/** What a backslash can make literal. */
const ESCAPABLE = '\\*_-.)•';

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Splits formatted text into paragraphs and lists, each line into runs. */
export function parseRich(source: string | null | undefined): RichBlock[] {
  const blocks: RichBlock[] = [];
  let paragraph: RichLine[] | null = null;
  const close = () => {
    if (paragraph) blocks.push({ kind: 'p', lines: paragraph });
    paragraph = null;
  };
  // A list carries on across blank lines between its items.
  const listOf = (kind: 'ul' | 'ol') => {
    const last = blocks[blocks.length - 1];
    return !paragraph && last?.kind === kind ? last : null;
  };

  for (const raw of (source ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      close();
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      const item = parseLine((bullet ? bullet[1] : numbered![2]).trim());
      const list = listOf(kind);
      close();
      if (list) list.items.push(item);
      else if (kind === 'ul') blocks.push({ kind: 'ul', items: [item] });
      else blocks.push({ kind: 'ol', items: [item], start: Number(numbered![1]) || 1 });
      continue;
    }
    (paragraph ??= []).push(parseLine(line.trim()));
  }
  close();
  return blocks;
}

/** Bold and italic within one line. */
export function parseLine(text: string): RichLine {
  const runs: Run[] = [];
  let bold: string | null = null;
  let italic: string | null = null;
  let buffer = '';
  const flush = () => {
    if (!buffer) return;
    const last = runs[runs.length - 1];
    if (last && Boolean(last.bold) === Boolean(bold) && Boolean(last.italic) === Boolean(italic)) last.text += buffer;
    else runs.push({ text: buffer, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) });
    buffer = '';
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length && ESCAPABLE.includes(text[i + 1])) {
      buffer += text[i + 1];
      i++;
      continue;
    }
    if (c === '*' || c === '_') {
      const double = text[i + 1] === c;
      // "**" and "__" are bold; "*" is bold too (WhatsApp); "_" is italic.
      const mark = double ? c + c : c;
      const isBold = c === '*' || double;
      const open: string | null = isBold ? bold : italic;
      if (open === mark ? canClose(text, i, mark) : !open && canOpen(text, i, mark) && closerAhead(text, i + mark.length, mark)) {
        flush();
        if (isBold) bold = open ? null : mark;
        else italic = open ? null : mark;
        i += mark.length - 1;
        continue;
      }
    }
    buffer += c;
  }
  flush();
  return runs;
}

/** A mark opens with something right after it — and "_" only at the start of a word. */
function canOpen(text: string, at: number, mark: string) {
  const after = text[at + mark.length];
  if (isSpace(after) || after === mark[0]) return false;
  return mark[0] !== '_' || !isWordChar(text[at - 1]);
}

/** A mark closes with something right before it — and "_" only at the end of a word. */
function canClose(text: string, at: number, mark: string) {
  if (isSpace(text[at - 1])) return false;
  return mark[0] !== '_' || !isWordChar(text[at + mark.length]);
}

/** Whether the mark is closed later on the line; if not, it is only its character. */
function closerAhead(text: string, from: number, mark: string) {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\') {
      j++;
      continue;
    }
    if (mark.length === 1 && text[j] === mark && text[j + 1] === mark) {
      j++;
      continue;
    }
    if (text.startsWith(mark, j) && j > from && canClose(text, j, mark)) return true;
  }
  return false;
}

/** The words alone, for a one- or two-line preview: items run on with " · ". */
export function richToPlain(source: string | null | undefined): string {
  const words = (line: RichLine) => line.map((r) => r.text).join('');
  return parseRich(source)
    .map((b) => (b.kind === 'p' ? b.lines.map(words).join(' ') : b.items.map(words).join(' · ')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether there is anything to read once the marks are gone. */
export const hasRichText = (source: string | null | undefined) => richToPlain(source).length > 0;
