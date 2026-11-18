// A shared Own 1 reached with a guest code (NEXY_OWN1_GUEST=1, set by the desktop app): it takes
// text only and its AI can be down. Against a stand-in /infer that answers 400 "guests may send text
// only" or 503, chat says so in plain words, logs it apart from a failed turn and asks the box once;
// the page offers no image attachments. Without the flag, a 503 stays the usual failure.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/guest-code.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const TEXT_ONLY = 'This shared Own 1 takes text only; describe the image in words.';
const OFFLINE = "The shared Own 1's AI is offline right now. Try again in a few minutes.";
const BUSY = "The shared Own 1 is busy with its owner's work. Try again shortly.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (srv) => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${srv.address().port}`)));

// the Own 1's /infer as the app's router passes it on: `answer` picks what it says
async function infer() {
  const s = { answer: 'ok', asked: 0, streamed: 0 };
  const srv = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    if (!req.url.endsWith('/chat/completions')) { res.writeHead(404).end('{}'); return; }
    s.asked++;
    if (JSON.parse(raw || '{}').stream) s.streamed++;
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (s.answer === 'text-only') return send(400, { error: 'guests may send text only' });
    if (s.answer === 'down') return send(503, { error: 'the AI is not answering' });
    if (s.answer === 'router-503') return send(503, { error: { message: 'your Own1 answered 503', type: 'router' } });
    // busy said in words that are not the router's JSON sentence: still busy, never offline
    if (s.answer === 'busy-text') { res.writeHead(503, { 'content-type': 'text/plain' }); return res.end(BUSY); }
    if (s.answer === 'refuse') return send(s.code, { error: { message: s.say, type: 'router' } });
    send(200, { choices: [{ message: { content: 'Hello from the shared Own 1.' }, finish_reason: 'stop' }] });
  });
  s.url = await listen(srv);
  s.close = () => srv.close();
  return s;
}

// the app's engine, failing the way an agent does when its model server refused
async function gateway(say) {
  const srv = http.createServer(async (req, res) => {
    for await (const _ of req);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: say }));
  });
  const url = await listen(srv);
  return { url, close: () => srv.close() };
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-guest-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data,
    NEXY_BOX_FEATURES: 'open', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'local', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  p.stdout.on('data', (c) => { log += c; }); p.stderr.on('data', (c) => { log += c; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { await fetch(base + '/api/v1/health'); return { base, log: () => log, stop: () => { p.kill(); fs.rmSync(data, { recursive: true, force: true }); } }; }
    catch { await sleep(150); }
  }
  p.kill(); throw new Error('server did not start');
}

const ask = async (base, stream) => {
  const r = await fetch(base + '/api/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json', ...(stream ? { accept: 'text/event-stream' } : {}) },
    body: JSON.stringify({ chat: 'g1', stream, messages: [{ role: 'user', content: 'What is in this photo?' }] }) });
  const text = await r.text();
  if (!stream) return { status: r.status, body: JSON.parse(text) };
  const done = text.split('\n\n').find((b) => b.startsWith('event: done'));
  return JSON.parse(done.split('\ndata: ')[1]);
};
const replyOf = (r) => r.body?.choices?.[0]?.message?.content;
const results = (log) => log.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((j) => j.endpoint === 'chat').map((j) => j.result);

let m, b;
test.before(async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  m = await infer();
  b = await chromium.launch();
});
test.after(async () => { await b?.close(); m?.close(); });

test('on a guest code: a text-only refusal and a box whose AI is down are said plainly, the box asked once, not logged as failed', { timeout: 60000 }, async () => {
  const s = await start({ NEXY_OWN1_GUEST: '1', NEXY_LLM_URL: m.url });
  try {
    for (const stream of [false, true]) {
      m.answer = 'text-only'; m.asked = 0;
      let r = await ask(s.base, stream);
      assert.equal(r.status, 200); assert.equal(replyOf(r), TEXT_ONLY); assert.equal(m.asked, 1, 'asked once');
      for (const down of ['down', 'router-503']) {
        m.answer = down; m.asked = 0;
        r = await ask(s.base, stream);
        assert.equal(r.status, 200, down); assert.equal(replyOf(r), OFFLINE, down); assert.equal(m.asked, 1, `${down}: asked once`);
      }
    }
    const got = results(s.log());
    assert.ok(got.includes('guest-text-only') && got.includes('guest-offline'), 'named in the turn log');
    assert.ok(!got.some((x) => /failed/.test(x)), `no failed turn: ${got.join(',')}`);
    m.answer = 'ok';
    assert.equal(replyOf(await ask(s.base, false)), 'Hello from the shared Own 1.');
  } finally { s.stop(); }
});

test('on a guest code through the app\'s engine: its failure carrying the box\'s words, then the model alone, still said plainly', { timeout: 60000 }, async () => {
  const g = await gateway('agent gateway upstream failed: HTTP 503: your Own1 answered 503');
  const s = await start({ NEXY_OWN1_GUEST: '1', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: g.url, NEXY_AGENT_KEY: 'k', NEXY_LLM_URL: m.url });
  try {
    m.answer = 'down';
    assert.equal(replyOf(await ask(s.base, false)), OFFLINE);
    m.answer = 'text-only';
    assert.equal(replyOf(await ask(s.base, false)), TEXT_ONLY);
  } finally { s.stop(); g.close(); }
});

test('not on a guest code: a 503 is the usual failure, never "shared Own 1"', { timeout: 60000 }, async () => {
  const s = await start({ NEXY_LLM_URL: m.url });
  try {
    m.answer = 'down';
    const r = await ask(s.base, false);
    assert.equal(r.status, 502);
    assert.doesNotMatch(JSON.stringify(r.body), /shared Own 1/);
  } finally { s.stop(); m.answer = 'ok'; }
});

test('the page on a guest code: no image attachments, an image picked anyway said plainly, the offline answer shown; off a guest code unchanged', { timeout: 90000 }, async () => {
  const s = await start({ NEXY_OWN1_GUEST: '1', NEXY_LLM_URL: m.url });
  const plain = await start({ NEXY_LLM_URL: m.url });
  try {
    const page = await b.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    const accept = await page.locator('#filePick').getAttribute('accept');
    assert.ok(accept && !/image/.test(accept) && /\.pdf/.test(accept), `text files only: ${accept}`);
    assert.match(await page.locator('#attachBtn').getAttribute('title'), /takes text only, no images/);
    await page.locator('#filePick').setInputFiles([{ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') }]);
    await page.getByText(`photo.png: ${TEXT_ONLY}`).waitFor({ timeout: 15000 });
    m.answer = 'down'; m.streamed = 0;
    await page.locator('#input').fill('Hello?');
    await page.locator('#input').press('Enter');
    await page.locator('#thread .msg.ai .bub').last().getByText(OFFLINE).waitFor({ timeout: 20000 });
    await sleep(1500);
    assert.equal(m.streamed, 1, 'the question asked once, no retries (a chat title is asked apart)');
    assert.deepEqual(errors, []);

    const other = await b.newPage();
    await other.goto(plain.base + '/');
    await other.locator('#input').waitFor({ timeout: 20000 });
    assert.equal(await other.locator('#filePick').getAttribute('accept'), null, 'off a guest code: as before');
    await other.locator('#filePick').setInputFiles([{ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') }]);
    await other.getByText("photo.png: images can't be read here yet").waitFor({ timeout: 15000 });
  } finally { s.stop(); plain.stop(); m.answer = 'ok'; }
});

// The app's router refuses in plain words ({error:{message}}): offline or busy 503, daily limit 429,
// code expired or revoked 403. Said as the reply, never as JSON; the raw text only in the turn log.
const REFUSALS = [
  [503, "The shared Own 1 is offline right now. Try again in a few minutes.", 'model-offline'],
  [429, "You have used today's messages on this shared Own 1. They reset at midnight.", 'model-limit'],
  [403, 'This guest code has expired or was revoked. Ask the owner for a new one.', 'model-denied'],
];
const lines = (log) => log.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((j) => j.endpoint === 'chat');
const plainOnly = (r, said, why) => {
  assert.equal(r.status, 200, why); assert.equal(replyOf(r), said, why);
  assert.doesNotMatch(JSON.stringify(r.body), /model server|llama-swap|\\"error\\"|\{\\"|router\b/, `${why}: no raw words: ${JSON.stringify(r.body)}`);
};

// Nexy Engine failing a turn because its model server refused: finish_reason "error", nexy.error the raw text
async function nexyEngine(state) {
  const srv = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    if (!req.url.endsWith('/chat/completions')) { res.writeHead(404).end('{}'); return; }
    state.asked++;
    const error = `model server ${state.code}: ${JSON.stringify({ error: { message: state.say, type: 'router' } })}`.slice(0, 213);
    const last = { choices: [{ index: 0, delta: {}, finish_reason: 'error' }], nexy: { error } };
    if (JSON.parse(raw || '{}').stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' } }] })}\n\ndata: ${JSON.stringify(last)}\n\ndata: [DONE]\n\n`);
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'error' }], nexy: { error } }));
    }
  });
  const url = await listen(srv);
  return { url, close: () => srv.close() };
}

test('the router refusing the model alone: its words are the reply, whole and streamed, asked once, the raw text in the turn log only', { timeout: 60000 }, async () => {
  for (const guest of ['1', '']) {
    const s = await start({ NEXY_OWN1_GUEST: guest, NEXY_LLM_URL: m.url });
    try {
      for (const [code, said, result] of REFUSALS) for (const stream of [false, true]) {
        Object.assign(m, { answer: 'refuse', code, say: said, asked: 0 });
        const why = `${code} guest=${guest || 'no'} stream=${stream}`;
        plainOnly(await ask(s.base, stream), said, why);
        assert.equal(m.asked, 1, `${why}: asked once`);
      }
      const got = lines(s.log());
      for (const [code, said, result] of REFUSALS) {
        const l = got.find((j) => j.result === result);
        assert.ok(l, `${result} in the turn log`); assert.equal(l.status, code);
        assert.ok(l.error.includes(JSON.stringify(said)), `the raw text kept in the log: ${l.error}`);
      }
      assert.ok(!got.some((j) => /failed/.test(j.result)), `no failed turn: ${got.map((j) => j.result).join(',')}`);
    } finally { s.stop(); m.answer = 'ok'; }
  }
});

test('Nexy Engine reporting the router\'s refusal as "model server <code>: <json>": its words are the reply, the model alone not asked again', { timeout: 60000 }, async () => {
  const st = { asked: 0 };
  const g = await nexyEngine(st);
  const s = await start({ NEXY_OWN1_GUEST: '1', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: g.url, NEXY_AGENT_KEY: 'k', NEXY_LLM_URL: m.url });
  try {
    for (const [code, said, result] of REFUSALS) for (const stream of [false, true]) {
      Object.assign(st, { code, say: said, asked: 0 }); m.asked = 0;
      const why = `engine ${code} stream=${stream}`;
      plainOnly(await ask(s.base, stream), said, why);
      assert.equal(st.asked, 1, `${why}: the engine asked once`); assert.equal(m.asked, 0, `${why}: the model alone not asked`);
    }
    const got = lines(s.log());
    for (const [, , result] of REFUSALS) assert.ok(got.some((j) => j.result === result && /model server \d{3}: \{/.test(j.error)), `${result} logged with the raw text`);
  } finally { s.stop(); g.close(); }
});

test('a model failure that is not the router\'s refusal is unchanged: the usual plain failure, no JSON', { timeout: 60000 }, async () => {
  const s = await start({ NEXY_LLM_URL: m.url });
  try {
    for (const [code, say] of [[500, 'CUDA out of memory'], [503, 'your Own1 answered 503']]) {
      Object.assign(m, { answer: 'refuse', code, say });
      const r = await ask(s.base, false);
      assert.equal(r.status, 502, `${code}`);
      assert.deepEqual(r.body, { error: 'the model on this machine did not answer' });
    }
  } finally { s.stop(); m.answer = 'ok'; }
});

// the engine passing on the router's busy refusal cut short, so no JSON sentence can be read from it
async function cutEngine() {
  const srv = http.createServer(async (req, res) => {
    for await (const _ of req);
    const error = `model server 503: {"error":{"message":"${BUSY}","type":"router"}}`.slice(0, 95); // cut inside the sentence
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'error' }], nexy: { error } }));
  });
  const url = await listen(srv);
  return { url, close: () => srv.close() };
}

test('on a guest code: the shared Own 1 busy is said as busy, never as offline; a real outage still offline', { timeout: 60000 }, async () => {
  const g = await cutEngine();
  const s = await start({ NEXY_OWN1_GUEST: '1', NEXY_LLM_URL: m.url });
  const e = await start({ NEXY_OWN1_GUEST: '1', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: g.url, NEXY_AGENT_KEY: 'k', NEXY_LLM_URL: m.url });
  try {
    for (const stream of [false, true]) {
      Object.assign(m, { answer: 'busy-text', asked: 0 });
      let r = await ask(s.base, stream);
      assert.equal(r.status, 200); assert.equal(replyOf(r), BUSY, `the model alone, stream=${stream}`); assert.equal(m.asked, 1);
      // the router's own JSON sentence for busy: its words, as for its other refusals
      Object.assign(m, { answer: 'refuse', code: 503, say: BUSY, asked: 0 });
      r = await ask(s.base, stream);
      assert.equal(replyOf(r), BUSY, `the router's sentence, stream=${stream}`);
      Object.assign(m, { answer: 'busy-text', asked: 0 });
      r = await ask(e.base, stream);
      assert.equal(replyOf(r), BUSY, `through the engine, cut short, stream=${stream}`);
      assert.equal(m.asked, 0, 'the model alone not asked again');
      m.answer = 'down';
      assert.equal(replyOf(await ask(s.base, stream)), OFFLINE, 'offline is still offline');
    }
    assert.ok(results(s.log()).includes('guest-busy') && results(e.log()).includes('guest-busy'), 'named in the turn log');
  } finally { s.stop(); e.stop(); g.close(); m.answer = 'ok'; }
});

test('the page on a guest code says whose Own 1 it is: Guest, never Owner, never "privately on this computer"; an owner\'s page as before', { timeout: 90000 }, async () => {
  const named = await start({ NEXY_OWN1_GUEST: '1', NEXY_OWN1_GUEST_ON: "John's Own 1", NEXY_LLM_URL: m.url });
  const bare = await start({ NEXY_OWN1_GUEST: '1', NEXY_LLM_URL: m.url });
  const owner = await start({ NEXY_LLM_URL: m.url });
  const words = async (base) => {
    const page = await b.newPage();
    await page.goto(base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    await page.locator('#emptyState.home .t').waitFor({ timeout: 20000 });
    const w = { profile: (await page.locator('#profileBtn').innerText()).replace(/\s+/g, ' '), menu: (await page.locator('#pmenu .pm-h').textContent()).replace(/\s+/g, ' '),
      hello: await page.locator('#emptyState.home .t').innerText(), body: await page.locator('body').innerText() };
    await page.close();
    return w;
  };
  try {
    for (const [srv, on] of [[named, "John's Own 1"], [bare, 'the shared Own 1']]) {
      const w = await words(srv.base);
      assert.match(w.profile, /Guest/, w.profile); assert.ok(w.profile.includes(on), w.profile);
      assert.ok(w.menu.includes('Guest') && w.menu.includes(on), w.menu);
      assert.ok(w.hello.includes(` on ${on}`), w.hello);
      assert.doesNotMatch(w.body, /\bOwner\b|privately on this computer|This computer|on your Own ?1/, `guest page: ${on}`);
    }
    const w = await words(owner.base);
    assert.match(w.profile, /Owner/); assert.match(w.profile, /This computer/); assert.match(w.hello, /privately on this computer/);
  } finally { named.stop(); bare.stop(); owner.stop(); }
});
