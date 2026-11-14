// Nexy Cloud mode: a gate in front signs people in and names them in x-nexy-user. Each person's
// chats are their own, a visitor can't pick a name, people get no whole-box features, each picks
// an engine (their own microVM's when they have one and its key), and the page and the prompt say
// Nexy Cloud with no agent screen. Stand-in engines record what they get.
// Run after `npm run build`: node --test tests/cloud-mode.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');

function engine(name, reply = `answer from ${name}`) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ path: req.url, auth: req.headers.authorization || '', user: req.headers['x-nexy-user'], body: body ? JSON.parse(body) : null });
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/v1/chat/completions')) res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] }));
      else if (req.url.startsWith('/api/')) res.end(JSON.stringify({ data: [], jobs: [] }));
      else res.end('{}');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-cloud-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_INSECURE_TRUST_ON_TCP: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, data, log: () => log }; } catch { await new Promise((r) => setTimeout(r, 150)); } }
  p.kill(); throw new Error('server did not start\n' + log);
}

// one browser: its own cookie jar, and the header the gate would add for it
function person(s, user) {
  let cookie = '';
  return async (p, init = {}) => {
    const r = await fetch(s.base + p, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(user ? { 'x-nexy-user': user } : {}), ...(init.headers || {}) } });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return r;
  };
}
const save = (req, id) => req('/api/v1/chats', { method: 'POST', body: JSON.stringify({ id, pid: 'p', title: id, html: '', history: [{ role: 'user', content: 'hi' }] }) });
const ids = async (req) => ((await (await req('/api/v1/chats')).json()).chats ?? []).map((c) => c.id);
const ask = async (req, text = 'hello', chat = 'c1') => (await (await req('/api/v1/chat', { method: 'POST', body: JSON.stringify({ chat, messages: [{ role: 'user', content: text }] }) })).json());
const gateOwner = (u) => `o_gate_${crypto.createHash('sha256').update(u).digest('hex').slice(0, 16)}`;

test('the gate names the person: chats are theirs, nobody else can claim the name', { timeout: 60000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const s = await start({ NEXY_TRUST_GATE_USER: '1', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'local', NEXY_LLM_URL: 'http://127.0.0.1:9' });
  try {
    const u01 = person(s, 'u01'), u02 = person(s, 'u02');
    assert.equal((await save(u01, 'cmine01')).status, 200);
    assert.deepEqual(await ids(u01), ['cmine01']);
    assert(!(await ids(u02)).includes('cmine01'), 'another person cannot list it');
    assert.equal((await u02('/api/v1/chats?id=cmine01')).status, 404, 'or open it by id');
    // the same name from a fresh browser is the same person (their chats follow them)
    assert.deepEqual(await ids(person(s, 'u01')), ['cmine01']);
    // kept where v0.0.3 kept them: the owner id is the same hash, so saved chats carry over
    assert(fs.existsSync(path.join(s.data, 'chats', gateOwner('u01'), 'cmine01.json')), 'stored under o_gate_<sha256(user)>');
    // an id the gate would never issue is ignored, not trusted
    const odd = person(s, '../u01');
    assert(!(await ids(odd)).includes('cmine01'), 'a malformed name is not the person');
    // a cookie can't carry a gate identity
    const forged = await fetch(s.base + '/api/v1/chats', { headers: { cookie: `own_owner=${gateOwner('u01')}` } });
    assert(!((await forged.json()).chats ?? []).some((c) => c.id === 'cmine01'), 'a forged own_owner cookie is refused');
    // xnode-auth is not trusted here, so its header names nobody
    const xauth = person(s, '');
    await xauth('/', { headers: { 'xnode-auth-user': 'u01' } });
    assert(!(await ids(xauth)).includes('cmine01'));
  } finally { s.p.kill(); }
});

test('without NEXY_TRUST_GATE_USER the header is just a header', { timeout: 60000 }, async () => {
  const s = await start({ NEXY_STUDIOS: 'off', NEXY_ENGINE: 'local', NEXY_LLM_URL: 'http://127.0.0.1:9' });
  try {
    const a = person(s, 'u01');
    await save(a, 'cone1');
    assert(!(await ids(person(s, 'u01'))).includes('cone1'), 'x-nexy-user names nobody when the gate is not trusted');
    assert(!fs.existsSync(path.join(s.data, 'chats', gateOwner('u01'))));
  } finally { s.p.kill(); }
});

test('a gate user gets no whole-box features', { timeout: 60000 }, async () => {
  const hermes = await engine('hermes');
  // even with owner mode switched on by mistake: the gate's people are not the box's owner
  const s = await start({ NEXY_TRUST_GATE_USER: '1', NEXY_BOX_FEATURES: 'owner', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: hermes.url, NEXY_AGENT_KEY: 'k' });
  try {
    const u01 = person(s, 'u01');
    assert.equal((await u01('/api/v1/memory')).status, 403, 'memory');
    assert.equal((await u01('/api/v1/routines')).status, 403, 'routines');
    assert(!hermes.seen.some((x) => x.path.startsWith('/api/')), 'the shared agent\'s sessions and jobs were never read');
  } finally { s.p.kill(); hermes.srv.close(); }
});

test('engines: each person picks one, their own microVM with its own key, x-nexy-user sent', { timeout: 90000 }, async () => {
  const hermes = await engine('hermes'), think = await engine('think'), shared = await engine('shared'), vm1 = await engine('vm1'), vm3 = await engine('vm3');
  const s = await start({
    NEXY_TRUST_GATE_USER: '1', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'gateway',
    NEXY_AGENT_URL: hermes.url, NEXY_AGENT_KEY: 'key-hermes',
    NEXY_ENGINES: 'hermes-think,nexy-engine',
    NEXY_ENGINE_HERMES_THINK_URL: think.url, NEXY_ENGINE_HERMES_THINK_KEY: 'key-hermes',
    NEXY_ENGINE_HERMES_THINK_LABEL: 'Thinking', NEXY_ENGINE_HERMES_THINK_NOTE: 'Slower, more careful answers',
    NEXY_ENGINE_NEXY_ENGINE_URL: shared.url, NEXY_ENGINE_NEXY_ENGINE_KEY: 'key-shared',
    // u03 has a VM but no key: it keeps to the shared engine and its VM is never called
    NEXY_ENGINE_NEXY_ENGINE_USER_URLS: `u01=${vm1.url},u03=${vm3.url}`,
    NEXY_ENGINE_NEXY_ENGINE_USER_KEYS: 'u01:key-vm1,u02:key-vm2',
  });
  try {
    const u01 = person(s, 'u01'), u02 = person(s, 'u02'), u03 = person(s, 'u03');
    const list = await (await u01('/api/v1/engines')).json();
    assert.deepEqual(list.engines.map((e) => [e.id, e.label]), [['hermes', 'Hermes'], ['hermes-think', 'Thinking'], ['nexy-engine', 'Nexy Engine']]);
    assert.equal(list.engines[1].note, 'Slower, more careful answers');
    assert.equal(list.selected, 'hermes');

    assert.match(JSON.stringify(await ask(u01)), /answer from hermes/, 'the default is the standard agent');
    for (const who of [u01, u02, u03]) assert.equal((await who('/api/v1/engines', { method: 'POST', body: JSON.stringify({ id: 'nexy-engine' }) })).status, 200);
    const r1 = await ask(u01);
    assert.match(r1.choices[0].message.content, /answer from vm1/, 'u01 reaches their own microVM');
    assert.equal(r1.via, 'nexy-engine');
    assert.match((await ask(u02)).choices[0].message.content, /answer from shared/, 'a user with a key but no VM uses the shared engine');
    assert.match((await ask(u03)).choices[0].message.content, /answer from shared/, 'a VM without a key is never used');
    assert.equal(vm3.seen.length, 0);

    assert((await u02('/api/v1/engines', { method: 'POST', body: JSON.stringify({ id: 'hermes-think' }) })).ok);
    assert.match((await ask(u02)).choices[0].message.content, /answer from think/);
    assert.equal((await (await u01('/api/v1/engines')).json()).selected, 'nexy-engine', 'one person\'s pick is not another\'s');

    const chats = (e) => e.seen.filter((x) => x.path.startsWith('/v1/chat'));
    assert(chats(vm1).every((x) => x.auth === 'Bearer key-vm1' && x.user === 'u01'), 'the VM gets only its key, and the person');
    assert(chats(shared).length === 2 && chats(shared).every((x) => x.auth === 'Bearer key-shared'), 'the shared engine gets only its own key');
    assert.deepEqual(chats(shared).map((x) => x.user).sort(), ['u02', 'u03'], 'the shared engine keeps each person apart by x-nexy-user');
    assert(chats(hermes).every((x) => x.auth === 'Bearer key-hermes'));
    assert(![hermes, think, shared].some((e) => e.seen.some((x) => /key-vm/.test(x.auth))), 'no VM key reaches another engine');
  } finally { s.p.kill(); [hermes, think, shared, vm1, vm3].forEach((e) => e.srv.close()); }
});

test('engine picks stay box-only without a gate user', { timeout: 60000 }, async () => {
  const hermes = await engine('hermes'), b = await engine('b');
  const s = await start({ NEXY_STUDIOS: 'off', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: hermes.url, NEXY_ENGINES: 'nexy-engine', NEXY_ENGINE_NEXY_ENGINE_URL: b.url });
  try {
    assert.equal((await fetch(s.base + '/api/v1/engines')).status, 403, 'unchanged where nobody is signed in');
    assert.equal((await fetch(s.base + '/api/v1/engines', { headers: { 'x-nexy-user': 'u01' } })).status, 403, 'an untrusted header signs nobody in');
  } finally { s.p.kill(); hermes.srv.close(); b.srv.close(); }
});

test('Nexy Cloud: the page, the prompt and the replies say so; no agent screen', { timeout: 60000 }, async () => {
  const hermes = await engine('hermes', 'Open it here. [[take-control: sign in to GitHub]]');
  const s = await start({ NEXY_TRUST_GATE_USER: '1', NEXY_PLACE: 'cloud', NEXY_SCREEN: 'none', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: hermes.url, NEXY_AGENT_KEY: 'k' });
  try {
    const u01 = person(s, 'u01');
    const html = await (await u01('/')).text();
    assert.match(html, /data-place="cloud"/);
    assert.match(html, /id="pmWsName">Nexy Cloud</);
    const r = await ask(u01, 'open github.com and sign me in');
    assert.equal(r.choices[0].message.content, 'Open it here.', 'a hand-over marker never reaches the page');
    const sys = hermes.seen.find((x) => x.path.startsWith('/v1/chat')).body.messages[0].content;
    assert.match(sys, /^You are Nexy, the assistant in Nexy Cloud, hosted by OwnX on servers it operates\./);
    assert.doesNotMatch(sys, /Own1 machine|this computer|not a cloud service|runs on this device/);
    assert.doesNotMatch(sys, /take-control|watch your browser|open it in your\s+browser/i, 'no screen to hand over or watch');
  } finally { s.p.kill(); hermes.srv.close(); }
});

test('the Own1 prompt is unchanged without NEXY_PLACE and NEXY_SCREEN', { timeout: 60000 }, async () => {
  const hermes = await engine('hermes', 'Done. [[take-control: sign in to GitHub]]');
  const s = await start({ NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: hermes.url, NEXY_AGENT_KEY: 'k', NEXY_SCREEN_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-scr-')) });
  try {
    const r = await ask(person(s, ''), 'hello');
    assert.match(r.choices[0].message.content, /\[\[take-control: sign in to GitHub\]\]/, 'the marker is the Take control button on an Own1');
    const sys = hermes.seen.find((x) => x.path.startsWith('/v1/chat')).body.messages[0].content;
    assert.match(sys, /^You are Nexy, the assistant on an Own1 machine\./);
    assert.match(sys, /take-control/);
    assert(!hermes.seen.some((x) => x.user), 'no x-nexy-user without a gate');
  } finally { s.p.kill(); hermes.srv.close(); }
});
