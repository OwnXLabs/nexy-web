// Before routing: a foreign Host gets 421 (DNS rebinding), a body over its route's cap gets 413,
// saved chats stop at the owner's storage cap (507), and with NEXY_SOCKET the server answers on a
// unix socket only, and a trust flag without one refuses to start. Runs the built server (npm run build first).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const DIST = resolve(__dirname, '../dist/server');
const dirs = [], procs = [];
after(() => { for (const p of procs) p.kill(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'nexy-gate-')); dirs.push(d); return d; };

// one request with exact control of Host, length and chunking
function req({ port, socketPath, path = '/api/v1/health', method = 'GET', host, headers = {}, body, chunked = false }) {
  return new Promise((ok, fail) => {
    const h = { ...headers };
    if (host !== undefined) h.host = host;
    if (body && !chunked) h['content-length'] = Buffer.byteLength(body);
    let got = null;
    const parts = [], done = () => ok({ ...got, text: Buffer.concat(parts).toString() });
    const r = http.request({ host: '127.0.0.1', port, socketPath, path, method, headers: h, setHost: host === undefined }, (res) => {
      got = { status: res.statusCode, headers: res.headers };
      res.on('data', (c) => parts.push(c)); res.on('end', done); res.on('error', done);
    });
    // a server may answer early (413) and close while the body is still going out
    r.on('error', (e) => (got ? done() : fail(e)));
    if (body) { if (chunked) for (let i = 0; i < body.length; i += 65536) r.write(body.slice(i, i + 65536)); else r.write(body); }
    r.end();
  });
}

async function start(script, env) {
  const p = spawn(process.execPath, [join(DIST, script)], { env: { ...process.env, NEXY_DATA_DIR: tmp(), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(p);
  let log = '';
  p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const ready = () => env.NEXY_SOCKET ? req({ socketPath: env.NEXY_SOCKET }) : req({ port: Number(env.PORT) });
  for (let i = 0; i < 80; i++) {
    try { if ((await ready()).status < 500) return { p, log: () => log }; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start: ${log}`);
}

test('a rebound name gets 421 on every route; loopback on its own port and listed names pass', async () => {
  const port = await freePort();
  await start('entry.mjs', { HOST: '127.0.0.1', PORT: String(port), NEXY_HOSTS: 'nexy.example.test, my.example.test' });
  for (const path of ['/', '/api/v1/health', '/api/v1/chats'])
    for (const host of [`attacker.test:${port}`, 'attacker.test', `127.0.0.1:${port + 1}`, `localhost:${port + 1}`, `nexy.example.test.attacker.test:${port}`]) {
      const r = await req({ port, path, host });
      assert.equal(r.status, 421, `${host} ${path}`);
      assert.match(r.text, /only at its own address/);
    }
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, 'nexy.example.test', `NEXY.example.test:443`, 'my.example.test'])
    assert.notEqual((await req({ port, host })).status, 421, host);
});

test('a body over its route cap gets 413 in plain words, declared or chunked; larger routes keep their room', async () => {
  const port = await freePort();
  await start('entry.mjs', { HOST: '127.0.0.1', PORT: String(port) });
  const big = JSON.stringify({ text: 'x'.repeat(2 * 1024 * 1024) });
  for (const chunked of [false, true]) {
    const r = await req({ port, path: '/api/v1/engines', method: 'POST', headers: { 'content-type': 'application/json' }, body: big, chunked });
    assert.equal(r.status, 413, `chunked=${chunked}`);
    assert.match(JSON.parse(r.text).error, /too large to send to Nexy\. The limit here is 1 MB/);
  }
  const small = JSON.stringify({ text: 'x'.repeat(512 * 1024) });
  assert.notEqual((await req({ port, path: '/api/v1/engines', method: 'POST', headers: { 'content-type': 'application/json' }, body: small })).status, 413);
  // a 5 MB recording is the voice route's to judge, not the default cap's
  const wav = Buffer.alloc(5 * 1024 * 1024).toString('latin1');
  assert.notEqual((await req({ port, path: '/api/v1/voice/transcribe', method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav })).status, 413);
  // a 3 MB saved chat fits its route
  const chat = JSON.stringify({ id: 'cgatebig', pid: '_', title: 'Big', html: 'x'.repeat(1_900_000), history: [{ role: 'user', content: 'y'.repeat(15_000) }] });
  assert.equal((await req({ port, path: '/api/v1/chats', method: 'POST', headers: { 'content-type': 'application/json' }, body: chat })).status, 200);
});

test('saved chats stop at the owner\'s storage cap; a smaller save still goes through', async () => {
  const port = await freePort();
  await start('entry.mjs', { HOST: '127.0.0.1', PORT: String(port), NEXY_CHAT_STORAGE_MB: '0.05' }); // 52 KB
  const save = (id, n, cookie, base = 0) => req({ port, path: '/api/v1/chats', method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ id, pid: '_', title: id, html: 'x'.repeat(n), history: [], base }) });
  const first = await save('cgateone', 30_000);
  assert.equal(first.status, 200);
  const cookie = first.headers['set-cookie'][0].split(';')[0];
  const full = await save('cgatetwo', 30_000, cookie);
  assert.equal(full.status, 507);
  assert.match(JSON.parse(full.text).error, /saved chats are full\. Delete some older chats/);
  // another owner has their own room
  assert.equal((await save('cgatetwo', 30_000)).status, 200);
  assert.equal((await save('cgateone', 10_000, cookie, JSON.parse(first.text).ts)).status, 200);
});

test('with NEXY_SOCKET the server answers on the socket (0660, its group) and not over TCP', async () => {
  const port = await freePort(), sock = join(tmp(), 'web.sock');
  const gid = process.getgroups().find((g) => g !== process.getgid()) ?? process.getgid();
  const s = await start('serve.mjs', { HOST: '127.0.0.1', PORT: String(port), NEXY_SOCKET: sock, NEXY_SOCKET_GROUP: String(gid), NEXY_TRUST_XNODE_AUTH: '1' });
  const r = await req({ socketPath: sock, host: 'nexy.example.test', headers: {} });
  assert.equal(r.status, 421, 'the Host check applies on the socket too');
  assert.equal((await req({ socketPath: sock, host: `127.0.0.1:${port}` })).status, 200);
  assert.equal(statSync(sock).mode & 0o777, 0o660);
  assert.equal(statSync(sock).gid, gid, 'the socket belongs to NEXY_SOCKET_GROUP');
  await assert.rejects(req({ port }), { code: 'ECONNREFUSED' });
  assert.doesNotMatch(s.log(), /WARNING/);
});

test('a socket group the server cannot use stops it at start', async () => {
  const sock = join(tmp(), 'web.sock');
  const p = spawn(process.execPath, [join(DIST, 'serve.mjs')], { env: { ...process.env, NEXY_SOCKET: sock, NEXY_SOCKET_GROUP: 'no-such-group-nexy', NEXY_DATA_DIR: tmp() }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(p);
  let log = ''; p.stderr.on('data', (d) => { log += d; });
  const code = await new Promise((r) => p.on('exit', r));
  assert.equal(code, 1);
  assert.match(log, /no group no-such-group-nexy/);
  assert.equal(require('node:fs').existsSync(sock), false);
});

// exits with its code and what it logged, or null if still running after 15 s
function refused(script, env) {
  const p = spawn(process.execPath, [join(DIST, script)], { env: { ...process.env, NEXY_DATA_DIR: tmp(), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(p);
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  return new Promise((ok) => {
    const t = setTimeout(() => ok(null), 15_000);
    p.on('exit', (code) => { clearTimeout(t); ok({ code, log }); });
  });
}

test('a trusted identity header without NEXY_SOCKET refuses to start', async () => {
  for (const flag of ['NEXY_TRUST_XNODE_AUTH', 'NEXY_TRUST_GATE_USER'])
    for (const script of ['serve.mjs', 'entry.mjs']) {
      const port = await freePort();
      const r = await refused(script, { HOST: '127.0.0.1', PORT: String(port), [flag]: '1' });
      assert.ok(r, `${script} with ${flag} kept running`);
      assert.equal(r.code, 1, `${script} with ${flag}`);
      assert.match(r.log, new RegExp(`refusing to start: ${flag}=1 needs NEXY_SOCKET`));
    }
});

test('entry.mjs listens on TCP, so NEXY_SOCKET does not make it trust the header', async () => {
  const port = await freePort(), sock = join(tmp(), 'web.sock');
  const r = await refused('entry.mjs', { HOST: '127.0.0.1', PORT: String(port), NEXY_SOCKET: sock, NEXY_TRUST_GATE_USER: '1' });
  assert.ok(r, 'entry.mjs kept running');
  assert.equal(r.code, 1);
});
