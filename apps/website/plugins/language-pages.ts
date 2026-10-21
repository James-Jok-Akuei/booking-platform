import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * A page per language, for search (§308.7): `/rw/` and `/fr/` are the same
 * page as `/`, with its title, description and share-picture words in that
 * language, `<html lang>` set, and every page naming the others
 * (`hreflang`), so Google shows each person the page in their language. The
 * app reads the language from the address (src/i18n).
 */
const LANGUAGES = ['rw', 'fr'] as const;

/** msgid → msgstr, from a language's .po file. */
function readPo(path: string): Map<string, string> {
  const words = new Map<string, string>();
  if (!existsSync(path)) return words;
  for (const block of readFileSync(path, 'utf8').split(/\n\n+/)) {
    const lines = block.split('\n');
    const field = (key: string) => {
      const at = lines.findIndex((l) => l.startsWith(`${key} `));
      if (at === -1) return '';
      let text = JSON.parse(lines[at].slice(key.length + 1)) as string;
      for (let k = at + 1; k < lines.length && lines[k].startsWith('"'); k++) text += JSON.parse(lines[k]) as string;
      return text;
    };
    const id = field('msgid');
    const said = field('msgstr');
    if (id && said) words.set(id, said);
  }
  return words;
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescape = (text: string) => text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const alternates = (siteUrl: string, own: string) =>
  [
    `<link rel="canonical" href="${siteUrl}${own}" />`,
    `<link rel="alternate" hreflang="en" href="${siteUrl}/" />`,
    ...LANGUAGES.map((l) => `<link rel="alternate" hreflang="${l}" href="${siteUrl}/${l}/" />`),
    `<link rel="alternate" hreflang="x-default" href="${siteUrl}/" />`,
  ].join('\n    ');

export function languagePages(siteUrl: string): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  return {
    name: 'language-pages',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
      root = config.root;
    },
    // The English page names the others too.
    transformIndexHtml: (html) => html.replace('</head>', `    ${alternates(siteUrl, '/')}\n  </head>`),
    closeBundle() {
      const index = join(outDir, 'index.html');
      if (!existsSync(index)) return;
      const html = readFileSync(index, 'utf8');
      for (const lang of LANGUAGES) {
        const words = readPo(join(root, 'src', 'locales', lang, 'messages.po'));
        let page = html.replace(/<html lang="en"/, `<html lang="${lang}"`);
        // Only the head's own words: the title, and the content of description and picture tags.
        page = page.replace(/<title>([^<]*)<\/title>/, (all, text: string) => {
          const said = words.get(unescape(text));
          return said ? `<title>${escape(said)}</title>` : all;
        });
        page = page.replace(/(<meta (?:name|property)="(?:description|og:title|og:description|og:image:alt|twitter:title|twitter:description)"\s+content=")([^"]*)(")/g, (all, start: string, text: string, end: string) => {
          const said = words.get(unescape(text));
          return said ? `${start}${escape(said)}${end}` : all;
        });
        page = page
          .replace(`<link rel="canonical" href="${siteUrl}/" />`, `<link rel="canonical" href="${siteUrl}/${lang}/" />`)
          .replace(`<meta property="og:url" content="${siteUrl}/" />`, `<meta property="og:url" content="${siteUrl}/${lang}/" />`);
        mkdirSync(join(outDir, lang), { recursive: true });
        writeFileSync(join(outDir, lang, 'index.html'), page);
      }
    },
  };
}
