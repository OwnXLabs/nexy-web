// Web search installing in the background on a computer's first start: the chat home says
// "Setting up web search…" with its progress and no Download, and goes when it is ready; a search
// asked for meanwhile is answered plainly that search is still setting up, never from the model
// alone as if it had searched. A stand-in for the app's search front door plays a slow install.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/search-setup.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SETTING_UP = "Web search is still setting up on this computer; try again in a minute.";

const listen = (srv) => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${srv.address().port}`)));

// the app's front door: /status as the install goes, /search with its plain reason
async function frontDoor() {
  const door = { state: 'installing', completed: 0, total: 50_000_000, searches: 0 };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/s3cret/status') {
      const body = door.state === 'installing' ? { state: 'installing', completed: door.completed, total: door.total } : { state: door.state };
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    }
    if (u.pathname === '/s3cret/search') {
      door.searches++;
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ results: [], nexy_unavailable: 'Nexy is still setting up web search on this computer.' }));
    }
    res.writeHead(404).end();
  });
  door.url = (await listen(srv)) + '/s3cret';
  door.srv = srv;
  return door;
}

// the model: records each call, answers from "history"
async function model() {
  const m = { calls: 0 };
  m.srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      m.calls++;
      const body = JSON.parse(b || '{}');
      const reply = 'From what we discussed earlier, prices were about $1.20.';
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
        return res.end('data: [DONE]\n\n');
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] }));
    });
  });
  m.url = await listen(m.srv);
  return m;
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-searchsetup-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'local', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

const chat = (base, said, history = []) => fetch(base + '/api/v1/chat', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify({ messages: [...history, { role: 'user', content: said }] }),
}).then((r) => r.json());

test('search installing: the home says so with progress, no Download; a search asked meanwhile is answered plainly', { timeout: 120000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const door = await frontDoor();
  const m = await model();
  const s = await start({ NEXY_SEARXNG_URL: door.url, NEXY_LLM_URL: m.url });
  const b = await chromium.launch();
  try {
    // a research question in an existing long chat, while search installs
    const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i} about solar panel prices` }));
    const r = await chat(s.base, 'search the web for the latest solar panel prices', history);
    assert.equal(r.choices?.[0]?.message?.content, SETTING_UP, JSON.stringify(r));
    assert.equal(m.calls, 0, 'the model never answered it as if it had searched');
    // a question that needs no search still goes to the model
    const plain = await chat(s.base, 'write a haiku about tea');
    assert.match(plain.choices?.[0]?.message?.content ?? '', /prices were/);
    assert.equal(m.calls, 1);

    const page = await b.newPage();
    door.completed = 20_000_000;
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    await page.locator('#searchchip').waitFor({ timeout: 10000 });
    assert.match(await page.locator('#searchchip').innerText(), /^Setting up web search… 40%$/);
    door.completed = 35_000_000;
    await page.waitForFunction(() => /70%/.test(document.querySelector('#searchchip')?.textContent ?? ''), null, { timeout: 10000 });
    const home = await page.locator('body').innerText();
    assert.doesNotMatch(home, /Web search isn.t on this computer/);
    assert.equal(await page.locator('button:visible', { hasText: /download/i }).count(), 0, 'no Download that would start a second install');

    // installed: the line goes, and a search is no longer held back
    door.state = 'ready';
    await page.locator('#searchchip').waitFor({ state: 'detached', timeout: 10000 });
    await chat(s.base, 'search the web for the latest solar panel prices');
    assert.equal(m.calls, 2, 'with search ready the question reaches the engine');

    // an install that failed: said plainly too, never as if it searched
    door.state = 'failed';
    const f = await chat(s.base, 'look up the latest solar panel prices');
    assert.match(f.choices?.[0]?.message?.content ?? '', /^Web search couldn't be set up on this computer yet\./);
    assert.equal(m.calls, 2);
  } finally { await b.close(); s.p.kill(); door.srv.close(); m.srv.close(); }
});

test('an Own1 search (no /status) is ready as before', { timeout: 60000 }, async () => {
  const m = await model();
  const plainSearx = http.createServer((req, res) => res.writeHead(404).end());
  const url = await listen(plainSearx);
  const s = await start({ NEXY_SEARXNG_URL: url, NEXY_LLM_URL: m.url });
  try {
    await chat(s.base, 'search the web for the latest solar panel prices');
    assert.equal(m.calls, 1);
    const st = await (await fetch(s.base + '/api/v1/search-status')).json();
    assert.equal(st.state, 'ready');
  } finally { s.p.kill(); plainSearx.close(); m.srv.close(); }
});
