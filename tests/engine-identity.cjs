// Who speaks: Nexy Engine speaks as Nexy (persona, naming rules, identity guard); Hermes and
// OpenClaw speak as themselves to anyone who may pick engines. A demo visitor and the Mac, Windows
// and phone apps always meet Nexy. Engine failures are plain words on every engine.
// NEXY_DEFAULT_ENGINE picks the engine for anyone who has not picked one. Stand-in gateways only.
// Run after `npm run build`: node --test tests/engine-identity.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { openclawStandin } = require('./standins/openclaw.cjs');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'oc-identity-token';
const SELF = "I'm Hermes Agent, built by Nous Research.";
const FAULT = 'API call failed after 3 retries: HTTP 500 at /var/lib/hermes/profiles/x';
const PERSONA = /You are Nexy\b/;
const NEVER_NAME = /Never name the engine, model or company behind you/;
// a long enough reply that the stream shows it while it is written
const LONG = `${SELF} I can search the web, read pages and keep notes for you across our chats, and I am glad to help with whatever you are working on today.`;

// a gateway whose reply depends on the question: whole, or streamed word by word
function gateway(name) {
  const chats = [];
  const reply = (q) => (name === 'plain' ? 'answer from plain' : q === 'fault' ? FAULT : q === 'long' ? LONG : q === 'who' ? SELF : `answer from ${name}`);
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      if (!req.url.startsWith('/v1/chat/completions')) {
        res.setHeader('content-type', 'application/json');
        return res.end(req.url.startsWith('/api/jobs') ? '{"jobs":[]}' : '{"data":[]}');
      }
      const b = JSON.parse(raw || '{}');
      chats.push(b);
      const text = reply(b.messages.at(-1).content);
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }] })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const w of text.split(/(?<= )/)) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w }, finish_reason: null }] })}\n\n`); await sleep(15); }
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, chats, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, NEXY_EVAL: '', HOST: '127.0.0.1', PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, log: () => log }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start\n' + log);
}

// Hermes (the deploy-time agent), Nexy Engine, OpenClaw and the plain model they fall back to
async function engines(extra = {}) {
  const hermes = await gateway('hermes'), nexy = await gateway('nexy-engine'), plain = await gateway('plain');
  const oc = await openclawStandin({ token: TOKEN, reply: (b) => { const q = b.messages.at(-1).content; return q === 'fault' ? FAULT : q === 'long' ? LONG : q === 'who' ? SELF : 'answer from openclaw'; } });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-identity-'));
  const keyFile = path.join(data, 'openclaw.key'); fs.writeFileSync(keyFile, TOKEN + '\n', { mode: 0o600 });
  const s = await start({
    NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_SCREEN: 'none', NEXY_LLM_URL: plain.url,
    NEXY_AGENT_URL: hermes.url, NEXY_AGENT_KEY: 'hermes-key',
    NEXY_ENGINES: 'nexy-engine,openclaw', NEXY_ENGINE_NEXY_ENGINE_URL: nexy.url, NEXY_ENGINE_NEXY_ENGINE_KEY: 'nexy-key',
    NEXY_ENGINE_OPENCLAW_URL: oc.url, NEXY_ENGINE_OPENCLAW_KEY_FILE: keyFile, ...extra,
  });
  const ocChats = () => oc.seen.filter((x) => x.path === '/v1/chat/completions').map((x) => x.body);
  const sent = { hermes: () => hermes.chats, 'nexy-engine': () => nexy.chats, openclaw: ocChats };
  const close = () => { s.p.kill(); [hermes, nexy, plain].forEach((g) => g.srv.close()); oc.close(); fs.rmSync(data, { recursive: true, force: true }); };
  return { s, hermes, nexy, plain, oc, sent, close };
}

function client(base, cookie = '') {
  const jar = { c: cookie };
  return async (p, body, extra = {}) => {
    const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(jar.c ? { cookie: jar.c } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const set = r.headers.get('set-cookie'); if (set) jar.c = set.split(';')[0];
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* a stream */ }
    return { status: r.status, json, text };
  };
}
// every text event of a streamed turn, and its end
function streamed(text) {
  const out = { texts: [], done: null };
  let ev = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('event:')) ev = line.slice(6).trim();
    else if (line.startsWith('data:')) { const d = JSON.parse(line.slice(5)); if (ev === 'text') out.texts.push(d.text); if (ev === 'done') out.done = d; }
  }
  return out;
}
const systemOf = (chats) => chats.at(-1).messages.find((m) => m.role === 'system').content;
const replyOf = (r) => r.json.choices[0].message.content;

test('Hermes and OpenClaw speak as themselves; Nexy Engine speaks as Nexy', { timeout: 90000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const e = await engines();
  const req = client(e.s.base);
  try {
    for (const engine of ['hermes', 'openclaw', 'nexy-engine']) {
      const chat = `cwho${engine.replace(/-/g, '')}`;
      let r = await req('/api/v1/chat', { chat, engine, messages: [{ role: 'user', content: 'who' }] });
      assert.equal(r.status, 200, r.text);
      const system = systemOf(e.sent[engine]());
      r.reply = replyOf(r);
      const s = await req('/api/v1/chat', { chat, engine, stream: true, messages: [{ role: 'user', content: 'long' }] });
      const st = streamed(s.text);
      if (engine === 'nexy-engine') {
        assert.match(system, PERSONA, 'Nexy Engine gets the persona');
        assert.match(system, NEVER_NAME, 'and the naming rule');
        assert.doesNotMatch(r.reply, /Hermes|Nous/, 'a leaked engine name is rewritten');
        assert.match(r.reply, /I'm Nexy/);
        assert(st.texts.every((t) => !/Hermes|Nous/.test(t)), 'never shown while it is written either');
        assert.doesNotMatch(replyOf({ json: st.done.body }), /Hermes|Nous/);
      } else {
        assert.doesNotMatch(system, PERSONA, `${engine} gets no Nexy persona`);
        assert.doesNotMatch(system, NEVER_NAME, `${engine} gets no naming rule`);
        assert.match(system, /Today is /, 'the date stays');
        assert.equal(r.reply, SELF, `${engine}'s own words reach the page unchanged`);
        assert(st.texts.some((t) => t.startsWith(SELF)), `${engine}'s words show unchanged while written`);
        assert.equal(replyOf({ json: st.done.body }), LONG);
      }
    }
  } finally { e.close(); }
});

test('an engine failure is plain words on every engine, whole and streamed', { timeout: 90000 }, async () => {
  const e = await engines();
  const req = client(e.s.base);
  try {
    for (const engine of ['hermes', 'openclaw', 'nexy-engine']) {
      const chat = `cfault${engine.replace(/-/g, '')}`;
      const r = await req('/api/v1/chat', { chat, engine, messages: [{ role: 'user', content: 'fault' }] });
      assert.equal(r.status, 200, r.text);
      assert.equal(replyOf(r), 'answer from plain', `${engine}: the model alone answers instead`);
      const st = streamed((await req('/api/v1/chat', { chat, engine, stream: true, messages: [{ role: 'user', content: 'fault' }] })).text);
      for (const t of [...st.texts, JSON.stringify(st.done)]) assert.doesNotMatch(t, /API call failed|500|\/var\/lib/, `${engine}: no raw failure on screen`);
    }
  } finally { e.close(); }
});

test('a demo visitor, who has no picker, always meets Nexy', { timeout: 60000 }, async () => {
  const e = await engines({ NEXY_BOX_FEATURES: '' });
  const req = client(e.s.base);
  try {
    assert.equal((await req('/api/v1/engines')).status, 403, 'no picker');
    const r = await req('/api/v1/chat', { chat: 'cvisitor1', messages: [{ role: 'user', content: 'who' }] });
    assert.equal(r.status, 200, r.text);
    assert.equal(e.hermes.chats.length, 1, 'the default engine answered');
    assert.match(systemOf(e.hermes.chats), PERSONA);
    assert.match(systemOf(e.hermes.chats), NEVER_NAME);
    assert.doesNotMatch(replyOf(r), /Hermes|Nous/, 'never exposed to a visitor');
    const st = streamed((await req('/api/v1/chat', { chat: 'cvisitor1', stream: true, messages: [{ role: 'user', content: 'long' }] })).text);
    assert(st.texts.every((t) => !/Hermes|Nous/.test(t)));
  } finally { e.close(); }
});

test('NEXY_DEFAULT_ENGINE: the engine of anyone who has not picked; a pick still wins; unset or missing, as before', { timeout: 90000 }, async () => {
  let e = await engines({ NEXY_DEFAULT_ENGINE: 'nexy-engine' });
  try {
    const fresh = client(e.s.base);
    const list = (await fresh('/api/v1/engines')).json;
    assert.equal(list.default, 'nexy-engine', 'Settings shows the default');
    assert.equal(list.selected, 'nexy-engine', 'a fresh owner is on it');
    const saved = await fresh('/api/v1/chats', { id: 'cdefault1', pid: '_', title: 'New', html: '', history: [{ role: 'user', content: 'hi' }], base: 0 });
    assert.equal(saved.json.engine, 'nexy-engine', 'a new chat records it');
    const r = await fresh('/api/v1/chat', { chat: 'cdefault2', messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(replyOf(r), 'answer from nexy-engine');
    assert.equal(r.json.engine, 'nexy-engine');
    assert.equal(e.hermes.chats.length, 0, 'Hermes saw nothing');

    const picker = client(e.s.base);
    assert.equal((await picker('/api/v1/engines', { id: 'hermes' })).status, 200);
    assert.equal((await picker('/api/v1/engines')).json.selected, 'hermes', 'an explicit pick wins');
    assert.equal(replyOf(await picker('/api/v1/chat', { chat: 'cpicked1', messages: [{ role: 'user', content: 'hello' }] })), 'answer from hermes');
  } finally { e.close(); }

  e = await engines({ NEXY_DEFAULT_ENGINE: 'ironclaw' });
  try {
    const list = (await client(e.s.base)('/api/v1/engines')).json;
    assert.equal(list.default, 'hermes', 'a default that is not here falls back to the deploy-time agent');
    assert.match(e.s.log(), /NEXY_DEFAULT_ENGINE=ironclaw is not on this machine/);
  } finally { e.close(); }

  e = await engines();
  try {
    const list = (await client(e.s.base)('/api/v1/engines')).json;
    assert.equal(list.default, 'hermes', 'unset: the deploy-time agent, as before');
    assert.equal(list.selected, 'hermes');
    assert(!list.engines.some((x) => /the default/.test(x.note)), 'no engine says it is the default in its own note');
  } finally { e.close(); }
});

test('the Mac, Windows and phone apps: one engine, no picker, Nexy speaks, whatever leaks into the environment', { timeout: 60000 }, async () => {
  const e = await engines({ NEXY_STUDIOS: 'off', NEXY_DEFAULT_ENGINE: 'openclaw' });
  const req = client(e.s.base);
  try {
    const list = (await req('/api/v1/engines')).json;
    assert.equal(list.engines.length, 1, 'only the engine the app starts');
    assert.equal(list.engines[0].label, 'Nexy Engine');
    assert.equal(list.default, list.engines[0].id);
    const r = await req('/api/v1/chat', { chat: 'capp00001', messages: [{ role: 'user', content: 'who' }] });
    assert.equal(r.status, 200, r.text);
    assert.equal(e.hermes.chats.length, 1, 'the app\'s own engine (NEXY_AGENT_URL) answered');
    assert.equal(e.nexy.chats.length + e.sent.openclaw().length, 0, 'no other engine is reached');
    assert.match(systemOf(e.hermes.chats), PERSONA, 'the persona stays on');
    assert.doesNotMatch(replyOf(r), /Hermes|Nous/, 'and the guard');
    assert.equal((await req('/api/v1/chat', { chat: 'capp00002', engine: 'openclaw', messages: [{ role: 'user', content: 'hi' }] })).status, 400, 'another engine cannot be named');
  } finally { e.close(); }
});
