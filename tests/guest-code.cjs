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
