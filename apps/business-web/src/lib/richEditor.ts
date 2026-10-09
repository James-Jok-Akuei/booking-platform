import { parseRich, type RichLine, type Run } from './richText';

/**
 * Between the editor and the stored text (§271): the stored text as the
 * editor's HTML, and the editor's document back as the stored text.
 *
 * Writing it out is also where it is kept tidy, whatever was typed or
 * pasted: no empty paragraphs, no runs of spaces, no lists inside lists, and
 * every mark written the one way the apps read.
 */

const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const runsToHtml = (line: RichLine) =>
  line
    .map((r) => {
      let out = html(r.text);
      if (r.italic) out = `<em>${out}</em>`;
      if (r.bold) out = `<strong>${out}</strong>`;
      return out;
    })
    .join('');

/** The stored text as HTML the editor opens with. */
export function richToHtml(source: string | null | undefined): string {
  return parseRich(source)
    .map((b) =>
      b.kind === 'p'
        ? `<p>${b.lines.map(runsToHtml).join('<br>')}</p>`
        : b.kind === 'ul'
          ? `<ul>${b.items.map((i) => `<li><p>${runsToHtml(i)}</p></li>`).join('')}</ul>`
          : `<ol${b.start !== 1 ? ` start="${b.start}"` : ''}>${b.items.map((i) => `<li><p>${runsToHtml(i)}</p></li>`).join('')}</ol>`,
    )
    .join('');
}

// ---------------------------------------------------------------------------

/** The editor's document, as `editor.getJSON()` gives it. */
export type DocNode = {
  type: string;
  text?: string;
  marks?: Array<{ type: string }>;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
};

const WORDISH = /[\p{L}\p{N}]/u;

/** Text made safe to store: what would read as a mark is kept literal. */
function escapeText(text: string) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && '\\*_-.)•'.includes(text[i + 1] ?? '')) out += '\\\\';
    else if (c === '*') out += '\\*';
    else if (c === '_' && !(WORDISH.test(text[i - 1] ?? '') && WORDISH.test(text[i + 1] ?? ''))) out += '\\_';
    else out += c;
  }
  return out;
}

/** A line that would read as a list item, kept a line of text. */
const keepLine = (line: string) =>
  line.replace(/^([-•])(\s)/, '\\$1$2').replace(/^(\d{1,3})([.)])(\s)/, '$1\\$2$3');

/** Marks hug the words: spaces at either end go outside them. */
function wrap(inner: string, mark: string) {
  const core = inner.trim();
  if (!core) return inner;
  const lead = inner.slice(0, inner.indexOf(core[0]));
  const trail = inner.slice(inner.lastIndexOf(core[core.length - 1]) + 1);
  return `${lead}${mark}${core}${mark}${trail}`;
}

/** Consecutive runs that share a mark, so a bold phrase is one *…*. */
function grouped(runs: Run[], key: 'bold' | 'italic') {
  const groups: Array<{ on: boolean; runs: Run[] }> = [];
  for (const run of runs) {
    const on = Boolean(run[key]);
    const last = groups[groups.length - 1];
    if (last && last.on === on) last.runs.push(run);
    else groups.push({ on, runs: [run] });
  }
  return groups;
}

/**
 * Italic on part of a word ("un*believ*able") cannot be written with "_" —
 * it would read back as underscores. Such italic is dropped, not stored as
 * stray marks.
 */
function storableItalic(runs: Run[]): Run[] {
  const out = runs.map((r) => ({ ...r }));
  const text = out.map((r) => r.text).join('');
  let at = 0;
  for (let i = 0; i < out.length; ) {
    if (!out[i].italic) {
      at += out[i].text.length;
      i++;
      continue;
    }
    let j = i;
    let length = 0;
    while (j < out.length && out[j].italic) length += out[j++].text.length;
    const inner = text.slice(at, at + length);
    const start = at + (inner.length - inner.trimStart().length);
    const end = at + inner.trimEnd().length;
    if (WORDISH.test(text[start - 1] ?? '') || WORDISH.test(text[end] ?? '')) {
      for (let k = i; k < j; k++) delete out[k].italic;
    }
    at += length;
    i = j;
  }
  return out;
}

export function lineToRich(runs: Run[]): string {
  const line = grouped(storableItalic(runs), 'bold')
    .map((b) => {
      const inner = grouped(b.runs, 'italic')
        .map((g) => {
          const text = escapeText(g.runs.map((r) => r.text).join(''));
          return g.on ? wrap(text, '_') : text;
        })
        .join('');
      return b.on ? wrap(inner, '*') : inner;
    })
    .join('');
  return keepLine(line.replace(/[ \t]{2,}/g, ' ').trim());
}

/** A paragraph's runs, split into lines at its line breaks. */
function linesOf(node: DocNode): Run[][] {
  const lines: Run[][] = [[]];
  for (const child of node.content ?? []) {
    if (child.type === 'hardBreak') lines.push([]);
    else if (child.type === 'text' && child.text) {
      const marks = new Set((child.marks ?? []).map((m) => m.type));
      lines[lines.length - 1].push({
        text: child.text,
        ...(marks.has('bold') ? { bold: true } : {}),
        ...(marks.has('italic') ? { italic: true } : {}),
      });
    }
  }
  return lines;
}

/** Every item of a list, lists inside it run on as more items. */
function itemsOf(list: DocNode): string[] {
  const items: string[] = [];
  for (const item of list.content ?? []) {
    const own: string[] = [];
    for (const part of item.content ?? []) {
      if (part.type === 'paragraph') own.push(...linesOf(part).map(lineToRich).filter(Boolean));
      else if (part.type === 'bulletList' || part.type === 'orderedList') {
        if (own.length) items.push(own.splice(0).join(' '));
        items.push(...itemsOf(part));
      }
    }
    if (own.length) items.push(own.join(' '));
  }
  return items;
}

/** The editor's document as the text that is stored. */
export function docToRich(doc: DocNode): string {
  const blocks: string[] = [];
  for (const node of doc.content ?? []) {
    if (node.type === 'paragraph') {
      const lines = linesOf(node).map(lineToRich);
      // Lines broken with nothing between them close up; an empty paragraph is no gap.
      const text = lines.join('\n').replace(/\n{2,}/g, '\n').trim();
      if (text) blocks.push(text);
    } else if (node.type === 'bulletList') {
      const items = itemsOf(node);
      if (items.length) blocks.push(items.map((i) => `- ${i}`).join('\n'));
    } else if (node.type === 'orderedList') {
      const items = itemsOf(node);
      const start = Number(node.attrs?.start ?? 1) || 1;
      if (items.length) blocks.push(items.map((i, n) => `${start + n}. ${i}`).join('\n'));
    }
  }
  return blocks.join('\n\n');
}
