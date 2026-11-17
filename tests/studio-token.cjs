// Studio service tokens: with NEXY_<STUDIO>_TOKEN_FILE set, every server-side call to that studio
// carries its own token (the proxy, the feed and its build names, the hub in chat), and no other
// studio, redirect target, page, response or log ever sees it. A wrong or missing token fails with
// plain words; a rotated file is picked up without a restart; unset sends no header, as before.
// Run after `npm run build`: node --test tests/studio-token.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (srv) => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${srv.address().port}`)));
const IDS = ['qiki', 'images', 'beat', 'voice', 'docs', 'startup', 'build', 'hub'];
const LABEL = { docs: 'Own Docs', build: 'Own Build', images: 'Own Image Studio' };
const COOKIE = 'own_owner=o_alice_0123456789abcdef';

// somewhere a studio might redirect to: it must never get a token
async function spy() {
  const got = [];
  const srv = http.createServer((req, res) => { got.push(req.headers.authorization ?? null); res.end('spied'); });
  const base = await listen(srv);
  return { got, base, close: () => srv.close() };
}

// one stand-in studio: records every request's Authorization; refuses a wrong one when `want` is set
async function studio(id, out) {
  const s = { id, want: null, seen: [] };
  const srv = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const p = new URL(req.url, 'http://x').pathname;
    s.seen.push({ method: req.method, path: p, auth: req.headers.authorization ?? null });
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (s.want && req.headers.authorization !== `Bearer ${s.want}`) return send(401, { error: 'unauthorized' });
    if (p === '/api/out') { res.writeHead(302, { location: `${out()}/caught` }); return res.end(); }
    if (p === '/api/ping') return send(200, { ok: true, id });
    if (req.method !== 'GET') return send(200, { ok: true, id, got: raw.length });
    if (p.endsWith('/preview')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<title>Built</title><h1>hi</h1>'); }
    if (id === 'qiki' && p === '/api/v1/director/runs') return send(200, { runs: [{ id: 'q1', prompt: 'a site', startedAt: 1 }] });
    if (id === 'build' && p === '/api/director/runs') return send(200, { runs: [{ id: 'b1', kind: 'html', prompt: 'a page', startedAt: 3 }] });
    if (['images', 'beat', 'voice'].includes(id) && p === '/api/history') return send(200, { entries: [{ id: `${id}1`, prompt: 'x', ts: 2 }] });
    if (id === 'docs' && p === '/api/v1/documents') return send(200, { docs: [{ id: 7, filename: 'a.txt', created_at: '2026-11-01' }] });
    if (id === 'startup' && p === '/api/pm/projects') return send(200, { projects: [{ id: 'p1', title: 'P', createdAt: 4 }] });
    send(404, { error: 'no such route' });
  });
  s.base = await listen(srv);
  s.close = () => srv.close();
  return s;
}

// the hub over MCP: no tools granted, so chat's connector step also reads the registry
async function hubStandIn(s) {
  const srv = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const p = new URL(req.url, 'http://x').pathname;
    s.seen.push({ method: req.method, path: p, auth: req.headers.authorization ?? null });
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (s.want && req.headers.authorization !== `Bearer ${s.want}`) return send(401, { error: 'unauthorized' });
    if (p === '/mcp') { const m = JSON.parse(raw || '{}'); return send(200, { jsonrpc: '2.0', id: m.id, result: { tools: [] } }); }
    if (p === '/registry/catalog') return send(200, { entries: [] });
    if (p === '/registry/grants/nexy') return send(200, { app: 'nexy', entries: [] });
    if (p === '/api/ping' || req.method === 'POST') return send(200, { ok: true, id: 'hub' });
    send(404, { error: 'no such route' });
  });
  s.base = await listen(srv);
  s.close = () => srv.close();
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-studio-token-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data,
    NEXY_ENGINE: 'local', NEXY_LLM_URL: 'http://127.0.0.1:9', NEXY_BOX_FEATURES: 'open', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  p.stdout.on('data', (c) => { log += c; }); p.stderr.on('data', (c) => { log += c; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { await fetch(base + '/api/v1/health'); return { p, base, log: () => log, stop: () => { p.kill(); fs.rmSync(data, { recursive: true, force: true }); } }; }
    catch { await sleep(150); }
  }
  p.kill(); throw new Error('server did not start');
}

let studios, theSpy, dir;
const seen = [];  // every response Nexy gave: status, headers and body
async function call(base, url, init = {}) {
  const r = await fetch(base + url, { ...init, headers: { cookie: COOKIE, ...(init.headers ?? {}) } });
  const body = await r.text();
  seen.push(JSON.stringify([...r.headers]) + body);
  return { status: r.status, body, json: () => JSON.parse(body) };
}
const urls = () => Object.fromEntries(IDS.map((id) => [`NEXY_${id.toUpperCase()}_URL`, studios[id].base]));
const tokenEnv = (file) => Object.fromEntries(IDS.map((id) => [`NEXY_${id.toUpperCase()}_TOKEN_FILE`, file(id)]));
const tokenOf = (id) => `tok-${id}-${crypto.randomBytes(12).toString('hex')}`;
const chat = (base) => call(base, '/api/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ chat: 'c1', messages: [{ role: 'user', content: 'search my email for Acme Billing' }] }) });
const reset = () => IDS.forEach((id) => { studios[id].seen.length = 0; });

test.before(async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  theSpy = await spy();
  studios = {};
  for (const id of IDS.filter((i) => i !== 'hub')) studios[id] = await studio(id, () => theSpy.base);
  studios.hub = { id: 'hub', want: null, seen: [] };
  await hubStandIn(studios.hub);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-studio-tokens-'));
});
test.after(() => { IDS.forEach((id) => studios[id]?.close()); theSpy?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('each studio gets its own token on every call; a rotated one is used without a restart; a wrong or missing one is said plainly', { timeout: 120000 }, async () => {
  const tokens = Object.fromEntries(IDS.map((id) => [id, tokenOf(id)]));
  const file = (id) => path.join(dir, `${id}.token`);
  for (const id of IDS) { fs.writeFileSync(file(id), `  ${tokens[id]}\n`); studios[id].want = tokens[id]; }
  reset();
  const s = await start({ ...urls(), ...tokenEnv(file) });
  try {
    // the proxy, GET and POST (build start and poll, autopilot, review all go this way)
    for (const id of IDS) {
      assert.equal((await call(s.base, `/api/apps/${id}/api/ping`)).status, 200, `${id} ping`);
      const post = await call(s.base, `/api/apps/${id}/api/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"brief":"x"}' });
      assert.equal(post.status, 200, `${id} POST`);
    }
    // the browser's own Authorization is never passed on, and never replaces the studio's
    assert.equal((await call(s.base, '/api/apps/images/api/ping', { headers: { authorization: 'Bearer from-the-browser' } })).status, 200);
    // the feed reads every history, then fetches build pages to name them
    const feed = (await call(s.base, '/api/v1/feed')).json();
    assert.deepEqual(feed.degraded, [], 'no studio refused the feed');
    assert.deepEqual(new Set(feed.items.map((i) => i.app)), new Set(['qiki', 'images', 'beat', 'voice', 'docs', 'startup', 'build']));
    for (let i = 0; i < 40 && !studios.build.seen.some((x) => x.path.endsWith('/preview')); i++) await sleep(100);
    assert.ok(studios.build.seen.some((x) => x.path.endsWith('/preview')), 'the build page was fetched to name it');
    // chat's connector step reaches the hub (MCP and the registry) with the hub's token
    const c = await chat(s.base);
    assert.match(c.body, /isn't connected to Nexy/);
    assert.ok(studios.hub.seen.some((x) => x.path === '/mcp') && studios.hub.seen.some((x) => x.path.startsWith('/registry/')), 'hub MCP and registry called');
    // a redirect to another origin does not carry the token
    await call(s.base, '/api/apps/images/api/out');
    assert.deepEqual(theSpy.got, [null], 'the redirect target saw no token');

    for (const id of IDS) {
      assert.ok(studios[id].seen.length > 0, `${id} was called`);
      for (const x of studios[id].seen) assert.equal(x.auth, `Bearer ${tokens[id]}`, `${id} ${x.method} ${x.path} carried its own token only`);
    }

    // rotation: a new token in the file is sent within a few seconds, no restart
    const next = tokenOf('images');
    fs.writeFileSync(file('images'), next); studios.images.want = next; tokens.images = next;
    await sleep(5500);
    assert.equal((await call(s.base, '/api/apps/images/api/ping')).status, 200, 'the rotated token is used');

    // a wrong token everywhere: plain words from every route, no "sign in again", no status code
    for (const id of IDS) fs.writeFileSync(file(id), `wrong-${id}`);
    await sleep(5500);
    for (const id of IDS) {
      const r = await call(s.base, `/api/apps/${id}/api/ping`);
      assert.equal(r.status, 500, `${id} refused`);
      assert.match(r.json().error, /turned Nexy away: its service key on this Own 1 is missing or out of date/, id);
    }
    assert.match((await call(s.base, '/api/apps/docs/api/ping')).json().error, /^Own Docs turned Nexy away/);
    const bad = (await call(s.base, '/api/v1/feed')).json();
    assert.equal(bad.degraded.length, 7, 'every history refused');
    for (const d of bad.degraded) assert.match(d.error, /turned Nexy away: its service key/, d.app);
    assert.match((await chat(s.base)).body, /couldn't read your Gmail just now: the connector service turned Nexy away \(its service key on this Own 1 is missing or out of date\)/);

    // nothing Nexy said, and nothing it logged, holds a token; nor does the page
    seen.push(await (await fetch(s.base + '/')).text(), await (await fetch(s.base + '/api/v1/manifest')).text());
    const all = seen.join('\n') + s.log();
    for (const t of Object.values(tokens)) assert.ok(!all.includes(t), 'a token leaked into a response or log');
    assert.ok(!/tok-[a-z]+-[0-9a-f]{24}/.test(all), 'no token of any studio leaked');
  } finally { s.stop(); }
});

test('a token file that cannot be read: a warning naming the setting, no header, plain words', { timeout: 60000 }, async () => {
  for (const id of IDS) studios[id].want = tokenOf(id);
  reset();
  const s = await start({ ...urls(), ...tokenEnv((id) => path.join(dir, `missing-${id}.token`)) });
  try {
    const r = await call(s.base, '/api/apps/build/api/ping');
    assert.equal(r.status, 500);
    assert.match(r.json().error, /^Own Build turned Nexy away/);
    assert.match((await chat(s.base)).body, /connector service turned Nexy away/);
    assert.equal(studios.build.seen[0].auth, null, 'no header without a token');
    assert.match(s.log(), /NEXY_BUILD_TOKEN_FILE unreadable \(ENOENT\)/);
  } finally { s.stop(); }
});

test('no token files set: no Authorization header anywhere, and a studio 401 passes through as before', { timeout: 60000 }, async () => {
  for (const id of IDS) studios[id].want = null;
  reset();
  const s = await start(urls());
  try {
    for (const id of IDS) assert.equal((await call(s.base, `/api/apps/${id}/api/ping`, { headers: { authorization: 'Bearer from-the-browser' } })).status, 200, id);
    const feed = (await call(s.base, '/api/v1/feed')).json();
    assert.deepEqual(feed.degraded, []);
    await chat(s.base);
    for (const id of IDS) for (const x of studios[id].seen) assert.equal(x.auth, null, `${id} ${x.path} got no header`);
    studios.docs.want = 'needs-one';
    const r = await call(s.base, '/api/apps/docs/api/ping');
    assert.equal(r.status, 401, 'unchanged: the studio\'s own answer');
    assert.deepEqual(r.json(), { error: 'unauthorized' });
  } finally { s.stop(); studios.docs.want = null; }
});
