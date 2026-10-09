import { Fragment, type ReactNode } from 'react';

/**
 * A legal document's plain text (§122.4), laid out as a page (§253).
 *
 * The text stays plain — blank lines between paragraphs, never HTML — and
 * this only reads its shape: a line in capitals is a heading ("1. WHO WE
 * ARE"), lines starting "- " are a list, the rest are paragraphs. Anything in
 * [SQUARE BRACKETS] is a blank still to be filled in before launch, and is
 * marked so it cannot be missed.
 */
export const blocksOf = (body: string) =>
  body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

/** How many [BLANKS] are still in the text. */
export const blanksIn = (body: string) => (body.match(/\[[^\]\n]{2,80}\]/g) ?? []).length;

const isHeading = (block: string) => !block.includes('\n') && block.length <= 90 && /[A-Z]/.test(block) && block === block.toUpperCase();
const isList = (block: string) => block.split('\n').every((line) => /^\s*[-•]\s+/.test(line));

function withBlanks(text: string): ReactNode {
  const parts = text.split(/(\[[^\]\n]{2,80}\])/g);
  return parts.map((part, i) =>
    /^\[[^\]]+\]$/.test(part) ? (
      <mark key={i} className="lx-blank">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function Block({ text, first }: { text: string; first: boolean }) {
  if (isHeading(text)) return first ? <h2 className="lx-title">{withBlanks(text)}</h2> : <h3>{withBlanks(text)}</h3>;
  if (isList(text))
    return (
      <ul>
        {text.split('\n').map((line, i) => (
          <li key={i}>{withBlanks(line.replace(/^\s*[-•]\s+/, ''))}</li>
        ))}
      </ul>
    );
  return <p>{withBlanks(text)}</p>;
}

export type Change = { kind: 'same' | 'added' | 'removed'; text: string };

/**
 * What changed, paragraph by paragraph: the longest run the two versions
 * share, and what was added or taken out around it. Paragraphs, not words —
 * a reader asking "what moved?" wants the clause, not the comma.
 */
export function diffBlocks(before: string[], after: string[]): Change[] {
  const n = before.length;
  const m = after.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: Change[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ kind: 'same', text: after[j] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: 'removed', text: before[i++] });
    else out.push({ kind: 'added', text: after[j++] });
  }
  while (i < n) out.push({ kind: 'removed', text: before[i++] });
  while (j < m) out.push({ kind: 'added', text: after[j++] });
  return out;
}

export function LegalText({ body, against }: { body: string; against?: string | null }) {
  const blocks = blocksOf(body);
  if (against === undefined || against === null) {
    return (
      <div className="lx">
        {blocks.map((b, i) => (
          <Block key={i} text={b} first={i === 0} />
        ))}
      </div>
    );
  }
  const changes = diffBlocks(blocksOf(against), blocks);
  return (
    <div className="lx">
      {changes.map((c, i) => (
        <div key={i} className={`lx-change is-${c.kind}`}>
          <Block text={c.text} first={i === 0 && c.kind === 'same'} />
        </div>
      ))}
    </div>
  );
}
