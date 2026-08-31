/**
 * Manual smoke test for the chat WebSocket layer (DECISIONS.md §22).
 *
 * There is no automated test suite yet, and the socket layer cannot be
 * exercised with curl the way every other module has been. This is the
 * equivalent harness: it authenticates, joins a room, drives a real REST
 * POST and asserts the push arrives.
 *
 * Usage — tokens come from a normal OTP login:
 *   node scripts/ws-smoke-test.js <customerJwt> <outsiderJwt> <businessJwt> <threadId>
 *
 * Exits 0 only if the joined participant received both messages and the
 * non-participant received none.
 */
   REST POST after confirming the join, so there is no race with the shell. */
const { io } = require('socket.io-client');
const URL = 'http://localhost:3000/chat';
const [, , CUST_TOKEN, OUT_TOKEN, BIZ_TOKEN, THREAD] = process.argv;
const log = (...a) => console.log('   ', ...a);

function connect(token) {
  return new Promise((resolve) => {
    const socket = io(URL, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false, timeout: 6000 });
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve({ ...r, socket }); } };
    socket.on('connected', (p) => done({ ok: true, payload: p }));
    socket.on('error', (e) => done({ ok: false, reason: e.message }));
    socket.on('connect_error', (e) => done({ ok: false, reason: e.message }));
    socket.on('disconnect', (r) => done({ ok: false, reason: `disconnected (${r})` }));
    setTimeout(() => done({ ok: false, reason: 'timed out' }), 6000);
  });
}
const emit = (s, ev, body) => new Promise((res) => {
  const t = setTimeout(() => res({ ok: false, error: 'no ack' }), 5000);
  s.emit(ev, body, (a) => { clearTimeout(t); res(a); });
});

(async () => {
  console.log('\n--- A. Connection authentication ---');
  require('dotenv').config({ quiet: true });
  const jwt = require('jsonwebtoken');
  for (const [label, token] of [
    ['no token at all', undefined],
    ['garbage token', 'not.a.real.jwt'],
    ['valid shape, wrong signature', jwt.sign({ sub: 'x', email: 'a@b.c', role: 'CUSTOMER' }, 'wrong-key')],
    ['correctly signed but EXPIRED', jwt.sign({ sub: 'x', email: 'a@b.c', role: 'CUSTOMER' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '-1h' })],
    ['valid customer token', CUST_TOKEN],
  ]) {
    const r = await connect(token);
    log(`${label.padEnd(30)} -> ${r.ok ? 'CONNECTED as ' + r.payload.role : 'REJECTED: ' + r.reason}`);
    r.socket.close();
  }

  console.log('\n--- B. Room joins ---');
  const cust = await connect(CUST_TOKEN);
  const outsider = await connect(OUT_TOKEN);
  log('participant joins own thread     ->', JSON.stringify(await emit(cust.socket, 'thread:join', { threadId: THREAD })));
  log('NON-participant joins same thread->', JSON.stringify(await emit(outsider.socket, 'thread:join', { threadId: THREAD })));
  log('missing threadId                 ->', JSON.stringify(await emit(cust.socket, 'thread:join', {})));

  console.log('\n--- C. Live delivery (REST POST -> socket push) ---');
  const got = [];
  let outsiderGot = 0;
  cust.socket.on('message:new', (m) => {
    got.push(m);
    log(`>>> ${new Date().toISOString().slice(11, 23)}  message:new  sender=${m.sender.role}  body=${JSON.stringify(m.body)}  photo=${m.photoUrl ? 'yes' : 'none'}`);
  });
  outsider.socket.on('message:new', () => { outsiderGot++; });

  const post = async (body) => {
    const form = new FormData();
    form.append('body', body);
    const t0 = Date.now();
    const res = await fetch(`http://localhost:3000/threads/${THREAD}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${BIZ_TOKEN}` }, body: form,
    });
    const j = await res.json();
    log(`REST POST  ${new Date(t0).toISOString().slice(11, 23)}  -> ${res.status} id=${j.id?.slice(0, 8)}`);
    return t0;
  };

  const t1 = await post('Yes, we have Saturday slots at 10am.');
  await new Promise((r) => setTimeout(r, 1500));
  const t2 = await post('Second message, still live.');
  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n--- D. Results ---');
  log(`participant (joined the room) received : ${got.length}`);
  log(`outsider    (never joined)    received : ${outsiderGot}   (must be 0)`);
  if (got.length) log(`bodies: ${JSON.stringify(got.map((m) => m.body))}`);

  console.log('\n--- E. thread:read over the socket ---');
  log('participant     ->', JSON.stringify(await emit(cust.socket, 'thread:read', { threadId: THREAD })));
  log('non-participant ->', JSON.stringify(await emit(outsider.socket, 'thread:read', { threadId: THREAD })));

  cust.socket.close(); outsider.socket.close();
  process.exit(got.length === 2 && outsiderGot === 0 ? 0 : 1);
})();
