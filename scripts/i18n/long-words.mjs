#!/usr/bin/env node
/**
 * The "long words" test language, `en-XA` (§308).
 *
 * Not a language anyone reads: every English sentence, its words stretched to
 * the length Kinyarwanda's often are ("Kwiyandikisha", "Ntibishoboka") and
 * French's a little more. Switching an app to it shows at once which button,
 * card or heading would break, overflow or crowd when the real translations
 * arrive — so the screens are made to hold up before, not after.
 *
 *   node scripts/i18n/long-words.mjs <app>/src/locales
 *
 * Reads `en/messages.po`, writes `en-XA/messages.po`. Placeholders ({name},
 * {0}), plural rules ({count, plural, one {…} other {…}}) and the markers of
 * styled words (<0>…</0>) are kept exactly; only the words between them grow.
 * Deterministic: the same sentence always stretches the same way.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: long-words.mjs <locales dir>');
  process.exit(1);
}
const source = join(dir, 'en', 'messages.po');
if (!existsSync(source)) {
  console.error(`no ${source} — run the extract step first`);
  process.exit(1);
}

// Kinyarwanda-like syllables, so the stretched words wrap like real ones would.
const SYLLABLES = ['aba', 'iki', 'mwa', 'nya', 'ugu', 'ko', 'ze', 'shya', 'ndi', 'rwa', 'mbi', 'ho'];

const hash = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** One word, longer: about 60% on average, and now and then a very long one. */
function stretch(word) {
  if (word.length < 3) return word;
  const h = hash(word);
  const target = Math.round(word.length * (h % 5 === 0 ? 2.4 : 1.6));
  let out = word;
  let i = h;
  while (out.length < target) {
    out += SYLLABLES[i % SYLLABLES.length];
    i = Math.floor(i / 7) + 3;
  }
  return out;
}

const stretchText = (text) => text.replace(/\p{L}+/gu, stretch);

/**
 * Stretches the words of an ICU message, leaving its structure alone: a
 * placeholder `{name}` is kept, a plural's branches are stretched inside, and
 * a `<0>` marker is kept.
 */
function stretchMessage(message) {
  let out = '';
  let i = 0;
  while (i < message.length) {
    const ch = message[i];
    if (ch === '<') {
      const end = message.indexOf('>', i);
      if (end !== -1) {
        out += message.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (ch === '{') {
      // Find the matching brace.
      let depth = 0;
      let j = i;
      for (; j < message.length; j++) {
        if (message[j] === '{') depth++;
        else if (message[j] === '}' && --depth === 0) break;
      }
      const inner = message.slice(i + 1, j);
      const comma = inner.indexOf(',');
      if (comma === -1) {
        out += `{${inner}}`; // a placeholder
      } else {
        // {count, plural, one {…} other {…}} — keep the head, stretch the branches.
        const head = inner.match(/^[^,]+,\s*\w+\s*,?/)?.[0] ?? '';
        let rest = inner.slice(head.length);
        rest = rest.replace(/\{((?:[^{}]|\{[^{}]*\})*)\}/g, (_, body) => `{${stretchMessage(body)}}`);
        out += `{${head}${rest}}`;
      }
      i = j + 1;
      continue;
    }
    // Plain text up to the next marker or placeholder.
    let j = i;
    while (j < message.length && message[j] !== '{' && message[j] !== '<') j++;
    out += stretchText(message.slice(i, j));
    i = j;
  }
  return out;
}

// ---- a small PO reader and writer: entries are blank-line separated ----

const unquote = (line) => JSON.parse(line.trim());
const quote = (text) => JSON.stringify(text);

function readField(lines, key) {
  const start = lines.findIndex((l) => l.startsWith(`${key} `));
  if (start === -1) return null;
  let text = unquote(lines[start].slice(key.length + 1));
  for (let k = start + 1; k < lines.length && lines[k].startsWith('"'); k++) text += unquote(lines[k]);
  return text;
}

const blocks = readFileSync(source, 'utf8').split(/\n\n+/);
const out = blocks.map((block, index) => {
  const lines = block.split('\n');
  const id = readField(lines, 'msgid');
  if (id === null) return block;
  if (index === 0 && id === '') {
    // The header: say which language this is.
    return block.replace(/"Language: [^"\\]*\\n"/, '"Language: en-XA\\n"');
  }
  // Everything before msgstr (comments, context, the English), then the stretched message.
  const at = lines.findIndex((l) => l.startsWith('msgstr'));
  const head = (at === -1 ? lines : lines.slice(0, at)).join('\n');
  return `${head}\nmsgstr ${quote(stretchMessage(id))}`;
});

mkdirSync(join(dir, 'en-XA'), { recursive: true });
writeFileSync(join(dir, 'en-XA', 'messages.po'), out.join('\n\n').replace(/\n*$/, '\n'));
console.log(`long words: ${blocks.length - 1} sentences stretched into ${join(dir, 'en-XA', 'messages.po')}`);
