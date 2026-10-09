// Record a page in headless Chrome as a phone, frame by frame, while a script
// taps through it. Frames land in <dir>/frames/NNNNN.jpg; <dir>/log.json has
// each frame's time and every console marker the script printed (STEP …, TAP x y).
//   node rec.mjs <dir> <width> <height> <url> --in --js=steps.js [--wait=ms]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const S = dirname(fileURLToPath(import.meta.url));
const [dir, W, H, url, ...flags] = process.argv.slice(2);
const flag = (name) => flags.find((f) => f === `--${name}` || f.startsWith(`--${name}=`));
const value = (name) => flag(name)?.split('=').slice(1).join('=');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(join(S, dir, 'frames'), { recursive: true });

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'rec-'))}`, '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(150);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let id = 0;
const pending = new Map();
const frames = [];
const marks = [];
let recording = false;
ws.on('message', (m) => {
  const msg = JSON.parse(m);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Page.screencastFrame') {
    const { data, metadata, sessionId } = msg.params;
    if (recording) {
      const i = frames.length;
      writeFileSync(join(S, dir, 'frames', `${String(i).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
      frames.push({ i, t: metadata.timestamp });
    }
    ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId } }));
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (/^(STEP|TAP|NOTE|END)\b/.test(text)) marks.push({ t: msg.params.timestamp / 1000, text });
  }
});
const send = (method, params = {}) =>
  new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const run = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
const origin = new URL(url).origin;
const store = flag('in') ? JSON.parse(readFileSync(join(S, 'token.json'), 'utf8')) : null;
await send('Page.navigate', { url: origin + '/favicon.ico' });
await sleep(700);
await run(`localStorage.clear(); ${store ? `(()=>{const d=${JSON.stringify(store)};for(const k in d)localStorage.setItem(k,d[k]);})()` : ''}`);
await send('Page.navigate', { url });
await sleep(Number(value('wait') ?? 5000));

await send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: +W * 2, maxHeight: +H * 2, everyNthFrame: 1 });
recording = true;
await sleep(300);
const out = await run(readFileSync(join(S, value('js')), 'utf8'));
console.log('JS:', JSON.stringify(out.result?.result?.value ?? out.result?.exceptionDetails ?? out));
await sleep(800);
recording = false;
await send('Page.stopScreencast');
writeFileSync(join(S, dir, 'log.json'), JSON.stringify({ frames, marks }, null, 1));
console.log(`${frames.length} frames, ${marks.length} marks`);
ws.close();
chrome.kill('SIGKILL');
process.exit(0);
