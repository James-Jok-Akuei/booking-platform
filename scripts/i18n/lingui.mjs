#!/usr/bin/env node
/**
 * Lingui's extract and compile, run from an app's folder (§308).
 *
 *   node ../../scripts/i18n/lingui.mjs extract   # sentences → src/locales/*\/messages.po
 *   node ../../scripts/i18n/lingui.mjs compile   # .po → src/locales/*\/messages.ts
 *
 * Why not `lingui extract`: Lingui 6's command line only starts on Node
 * versions that have `import.meta.main` (24.2+), and on older ones it exits
 * silently having done nothing — which looks exactly like success. This calls
 * the same two functions the command line calls, on any Node it supports.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const step = process.argv[2];
if (step !== 'extract' && step !== 'compile') {
  console.error('usage: lingui.mjs <extract|compile>');
  process.exit(1);
}

/** A Lingui package, wherever npm put it: the app's own node_modules, or the shared one. */
const find = (pkg, file) => {
  for (const base of [join(process.cwd(), 'node_modules'), join(process.cwd(), '..', '..', 'node_modules')]) {
    const path = join(base, pkg, file);
    if (existsSync(path)) return pathToFileURL(path).href;
  }
  throw new Error(`${pkg}/${file} is not installed`);
};

const { getConfig } = await import(find('@lingui/conf', 'dist/index.mjs'));
const config = getConfig({ cwd: process.cwd() });
const workersOptions = { poolSize: 0 };

let ok;
if (step === 'extract') {
  const { default: extract } = await import(find('@lingui/cli', 'dist/lingui-extract.js'));
  ok = await extract(config, { verbose: false, clean: true, overwrite: false, watch: false, workersOptions });
} else {
  const { command: compile } = await import(find('@lingui/cli', 'dist/lingui-compile.js'));
  ok = await compile(config, {
    verbose: false,
    allowEmpty: true,
    failOnCompileError: true,
    workersOptions,
    typescript: true,
    namespace: 'es',
  });
}
process.exit(ok ? 0 : 1);
