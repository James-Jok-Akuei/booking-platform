#!/usr/bin/env node
/**
 * The server's sentences, for translators (§308) — run from apps/backend.
 *
 *   node ../../scripts/i18n/server-messages.mjs
 *
 * Reads every sentence a customer or a seller can get from the server:
 *   - say(locale, '…')               emails, notices, labels
 *   - msg('…')                       the same, kept in a list and said later
 *   - throw new XxxException('…')    refusals, the filter says them in the reader's language
 *   - { message: '…' } in a check    the words of a refused form
 * and writes src/i18n/locales/<language>.po, the files translators work in —
 * keeping every translation already done, dropping sentences that are gone.
 * Then it builds src/i18n/catalogs.ts, what the server reads.
 *
 * Files only the administrators' console reaches (admin-*) are left out: the
 * console stays in English, so nobody should be asked to translate it.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(join(process.cwd(), 'package.json'));
const { parse } = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const traverse = traverseModule.default ?? traverseModule;

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const LOCALES = ['rw', 'fr'];
const OUT_DIR = join(SRC, 'i18n', 'locales');

const EXCEPTIONS = new Set([
  'BadRequestException', 'NotFoundException', 'ForbiddenException', 'ConflictException', 'UnauthorizedException',
  'UnprocessableEntityException', 'GoneException', 'PayloadTooLargeException', 'UnsupportedMediaTypeException',
  'PreconditionFailedException', 'NotAcceptableException', 'MethodNotAllowedException', 'RequestTimeoutException',
  'ServiceUnavailableException', 'HttpException', 'ImATeapotException', 'MisdirectedException', 'BadGatewayException',
]);

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'scripts' || name === 'i18n') continue;
      walk(path);
    } else if (/\.ts$/.test(name) && !/\.(spec|d)\.ts$/.test(name) && !/^admin-/.test(name)) {
      files.push(path);
    }
  }
})(SRC);

/** msgid → { kind, refs:Set, pattern?: { regex, names } } */
const found = new Map();
const add = (id, kind, file, line, pattern) => {
  if (!/\p{L}{2,}/u.test(id)) return;
  const entry = found.get(id) ?? { kinds: new Set(), refs: new Set(), pattern: null };
  entry.kinds.add(kind);
  entry.refs.add(`${relative(ROOT, file)}:${line}`);
  if (pattern) entry.pattern = pattern;
  found.set(id, entry);
};

const escapeIcu = (text) => text.replace(/'/g, "''").replace(/([{}])/g, "'$1'");
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A name for a value in a sentence, from the code that fills it. */
function nameOf(expr, index, taken) {
  let base = null;
  if (expr.type === 'Identifier') base = expr.name;
  else if (expr.type === 'MemberExpression' || expr.type === 'OptionalMemberExpression') {
    if (!expr.computed && expr.property.type === 'Identifier') base = expr.property.name;
  }
  if (!base || !/^[A-Za-z_]\w*$/.test(base)) base = `value${index}`;
  let name = base;
  let n = 2;
  while (taken.has(name)) name = `${base}${n++}`;
  taken.add(name);
  return name;
}

/** The ICU message — and, when it holds values, the pattern of its English — for a string, a template or a sum of them. */
function messageOf(node) {
  const parts = [];
  const flatten = (n) => {
    if (n.type === 'BinaryExpression' && n.operator === '+') {
      flatten(n.left);
      flatten(n.right);
    } else parts.push(n);
  };
  flatten(node);
  let icu = '';
  let regex = '';
  const names = [];
  const taken = new Set();
  let index = 0;
  for (const part of parts) {
    if (part.type === 'StringLiteral') {
      icu += escapeIcu(part.value);
      regex += escapeRegex(part.value);
    } else if (part.type === 'TemplateLiteral') {
      part.quasis.forEach((quasi, i) => {
        const text = quasi.value.cooked ?? quasi.value.raw;
        icu += escapeIcu(text);
        regex += escapeRegex(text);
        if (i < part.expressions.length) {
          const name = nameOf(part.expressions[i], index++, taken);
          icu += `{${name}}`;
          regex += '(.+?)';
          names.push(name);
        }
      });
    } else {
      // A value that is not written here (a variable): it stands for itself.
      const name = nameOf(part, index++, taken);
      icu += `{${name}}`;
      regex += '(.+?)';
      names.push(name);
    }
  }
  if (!/\p{L}{2,}/u.test(icu.replace(/\{[^}]*\}/g, ''))) return null;
  return { icu, pattern: names.length ? { regex: `^${regex}$`, names } : null };
}

for (const file of files) {
  const code = readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'decorators-legacy', 'classProperties'] });
  } catch (error) {
    console.error(`skipped ${relative(ROOT, file)}: ${error.message}`);
    continue;
  }
  traverse(ast, {
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      const said = callee.type === 'Identifier' && callee.name === 'say' ? args[1] : null;
      const marked = callee.type === 'Identifier' && callee.name === 'msg' ? args[0] : null;
      const arg = said ?? marked;
      if (arg) {
        const text =
          arg.type === 'StringLiteral'
            ? arg.value
            : arg.type === 'TemplateLiteral' && arg.expressions.length === 0
              ? arg.quasis.map((q) => q.value.cooked).join('')
              : null;
        if (text !== null) add(text, 'say', file, arg.loc.start.line, null);
        // say(locale, rule.title): a sentence marked with msg() where it is written.
        else if (marked || ['TemplateLiteral', 'BinaryExpression'].includes(arg.type)) {
          console.error(`${relative(ROOT, file)}:${arg.loc.start.line}: say() and msg() take a written sentence — use {names} for values`);
        }
      }
    },
    NewExpression(path) {
      const { callee, arguments: args } = path.node;
      if (callee.type !== 'Identifier' || !EXCEPTIONS.has(callee.name) || !args[0]) return;
      const arg = args[0];
      if (!['StringLiteral', 'TemplateLiteral', 'BinaryExpression'].includes(arg.type)) return;
      const message = messageOf(arg);
      if (message) add(message.icu, 'error', file, arg.loc.start.line, message.pattern);
    },
    ObjectProperty(path) {
      const { key, value } = path.node;
      const name = key.type === 'Identifier' ? key.name : key.type === 'StringLiteral' ? key.value : null;
      if (name !== 'message' || !path.findParent((p) => p.isDecorator())) return;
      if (!['StringLiteral', 'TemplateLiteral', 'BinaryExpression'].includes(value.type)) return;
      const message = messageOf(value);
      if (message) add(message.icu, 'error', file, value.loc.start.line, message.pattern);
    },
  });
}

// ---- the .po files: keep what is translated, add what is new, drop what is gone ----

const poQuote = (text) =>
  `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`;
const poUnquote = (line) => JSON.parse(line.trim().replace(/\t/g, '\\t'));

function readPo(path) {
  const map = new Map();
  if (!existsSync(path)) return map;
  for (const block of readFileSync(path, 'utf8').split(/\n\n+/)) {
    const lines = block.split('\n');
    const field = (key) => {
      const start = lines.findIndex((l) => l.startsWith(`${key} `));
      if (start === -1) return null;
      let text = poUnquote(lines[start].slice(key.length + 1));
      for (let k = start + 1; k < lines.length && lines[k].startsWith('"'); k++) text += poUnquote(lines[k]);
      return text;
    };
    const id = field('msgid');
    const str = field('msgstr');
    if (id) map.set(id, str ?? '');
  }
  return map;
}

const ids = [...found.keys()].sort((a, b) => a.localeCompare(b));
mkdirSync(OUT_DIR, { recursive: true });
const catalogs = {};
for (const locale of LOCALES) {
  const path = join(OUT_DIR, `${locale}.po`);
  const before = readPo(path);
  const blocks = [
    [
      'msgid ""',
      'msgstr ""',
      '"MIME-Version: 1.0\\n"',
      '"Content-Type: text/plain; charset=utf-8\\n"',
      '"Content-Transfer-Encoding: 8bit\\n"',
      `"Language: ${locale}\\n"`,
      '"X-Source: apps/backend (scripts/i18n/server-messages.mjs)\\n"',
    ].join('\n'),
  ];
  const translated = {};
  for (const id of ids) {
    const entry = found.get(id);
    const str = before.get(id) ?? '';
    if (str) translated[id] = str;
    const notes = [];
    if (entry.kinds.has('error')) notes.push('#. A refusal: the app shows it as the reason something did not work.');
    if (entry.pattern) notes.push(`#. The names in {braces} are filled in by the server: ${entry.pattern.names.join(', ')}.`);
    blocks.push(
      [...notes, ...[...entry.refs].slice(0, 4).map((ref) => `#: ${ref}`), `msgid ${poQuote(id)}`, `msgstr ${poQuote(str)}`].join('\n'),
    );
  }
  writeFileSync(path, `${blocks.join('\n\n')}\n`);
  catalogs[locale] = translated;
  console.log(`${locale}: ${ids.length} sentences, ${Object.keys(translated).length} translated`);
}

const patterns = ids
  .filter((id) => found.get(id).pattern)
  .map((id) => ({ id, ...found.get(id).pattern }))
  // The most specific first, so "Please wait {s}s before requesting another code." wins over a looser one.
  .sort((a, b) => b.regex.length - a.regex.length);

writeFileSync(
  join(SRC, 'i18n', 'catalogs.ts'),
  `/* Written by \`npm run i18n\` (scripts/i18n/server-messages.mjs) from src/i18n/locales/*.po — do not edit by hand. */\n` +
    `export const CATALOGS: Partial<Record<'rw' | 'fr', Record<string, string>>> = ${JSON.stringify(catalogs, null, 2)};\n` +
    `export const ERROR_PATTERNS: Array<{ id: string; regex: RegExp; names: string[] }> = [\n` +
    patterns.map((p) => `  { id: ${JSON.stringify(p.id)}, regex: new RegExp(${JSON.stringify(p.regex)}, 's'), names: ${JSON.stringify(p.names)} },`).join('\n') +
    `\n];\n`,
);
console.log(`${ids.length} sentences in all, ${patterns.length} with values in them`);
