// Nexy Cloud's free tier in the chat. While a reply waits in the free queue, the line under it says so and
// follows the place in the queue ("You're on the free tier · in the queue (2nd) · about 20 s"), read from the
// gate's /_auth/queue; then the line for where it is answered, as before. The daily free limit says when the free
// messages reset, in this device's time, and offers GPU credits only where they can be bought. Stand-in engine;
// the gate's answers are stood in by the test.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> [SHOTS=<dir>] node --test tests/free-tier.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || '';

// an engine that waits (the free queue), then says where it answers and writes
function engine(waitMs) {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      res.setHeader('content-type', 'application/json');
      if (!req.url.startsWith('/v1/chat/completions')) return res.end('{"data":[]}');
      const b = JSON.parse(body || '{}');
      if (!b.stream) return res.end(JSON.stringify({ choices: [{ message: { content: 'A title' }, finish_reason: 'stop' }] }));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      await sleep(waitMs);
      res.write(': route local\n\n');
      await sleep(1200);
      const q = String(b.messages?.at(-1)?.content ?? '');
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `done: ${q}` }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], nexy: { tools: [], answered_on: 'local' } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-free-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_INSECURE_TRUST_ON_TCP: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start\n' + log);
}

const cloud = (url) => ({
  NEXY_PLACE: 'cloud', NEXY_STUDIOS: 'off', NEXY_TRUST_GATE_USER: '1', NEXY_ENGINES: 'nexy-engine', NEXY_DEFAULT_ENGINE: 'nexy-engine',
  NEXY_ENGINE_NEXY_ENGINE_URL: url, NEXY_ENGINE_NEXY_ENGINE_KEY: 'k', NEXY_LLM_URL: url, NEXY_NETWORK_MODEL: 'qwen3-1.7b',
});

async function open(b, base, setup) {
  const ctx = await b.newContext({ extraHTTPHeaders: { 'x-nexy-user': 't01' }, timezoneId: 'Asia/Manila', locale: 'en-US', viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (x) => errors.push(x.message));
  await setup?.(page);
  await page.goto(base + '/');
  await page.locator('#input').waitFor({ timeout: 20000 });
  await page.evaluate(() => {
    window.__lines = [];
    setInterval(() => document.querySelectorAll('#thread .wait .wl').forEach((el) => {
      const t = el.textContent; if (t && window.__lines.at(-1) !== t) window.__lines.push(t);
    }), 50);
  });
  return { page, ctx, errors };
}

test('queued on the free tier: the place in the queue, then where it is answered', { timeout: 120000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const e = await engine(7000);
  const s = await start(cloud(e.url));
  const b = await chromium.launch();
  try {
    // the gate's answers while the call waits: 3rd, 2nd, 1st, then out of the queue
    const places = [{ position: 3, eta_s: 30 }, { position: 2, eta_s: 20 }, { position: 2, eta_s: 20 }, { position: 1, eta_s: 20 }];
    let polls = 0;
    const { page, ctx, errors } = await open(b, s.base, (p) => p.route('**/_auth/queue', (r) => r.fulfill({ json: places[polls++] ?? {} })));
    await page.locator('#input').fill('a free question');
    await page.locator('#input').press('Enter');
    await page.locator('#thread .wait .wl', { hasText: 'in the queue (2nd)' }).waitFor({ timeout: 20000 });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'queued-status.png') });
    await page.getByText('done: a free question').waitFor({ timeout: 30000 });
    const lines = await page.evaluate(() => window.__lines);
    const want = [
      "You're on the free tier · in the queue (3rd) · about 30 s",
      "You're on the free tier · in the queue (2nd) · about 20 s",
      "You're on the free tier · in the queue (1st) · about 20 s",
      'Answering on Nexy Cloud…',
    ];
    let at = -1;
    for (const w of want) { const i = lines.indexOf(w); assert(i > at, `${w} in order: ${JSON.stringify(lines)}`); at = i; }
    const n = polls;
    await sleep(4500);
    assert.equal(polls, n, 'no more queue reads once the reply is written');
    assert.deepEqual(errors, []);
    await ctx.close();

    // not on Nexy Cloud's gate (no such route): one read, then nothing
    let reads = 0;
    const o = await open(b, s.base, (p) => p.route('**/_auth/queue', (r) => { reads++; return r.fulfill({ status: 404, body: '' }); }));
    await o.page.locator('#input').fill('another free question');
    await o.page.locator('#input').press('Enter');
    await o.page.getByText('done: another free question').waitFor({ timeout: 30000 });
    assert.equal(reads, 1, JSON.stringify(await o.page.evaluate(() => window.__lines)));
    assert(!(await o.page.evaluate(() => window.__lines)).some((l) => /free tier/.test(l)));
    await o.ctx.close();
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});

test('the daily free limit: when it resets, and GPU credits only where they can be bought', { timeout: 120000 }, async () => {
  const e = await engine(0);
  const s = await start(cloud(e.url));
  const b = await chromium.launch();
  // midnight UTC is 8:00 AM in Manila
  const reset = (Math.floor(Date.now() / 86400000) + 1) * 86400000;
  try {
    for (const purchases of [false, true]) {
      let chats = 0;
      const { page, ctx, errors } = await open(b, s.base, (p) => p.route('**/api/v1/chat', (r) => {
        if (r.request().method() !== 'POST') return r.continue();
        chats++;
        return r.fulfill({ status: 429, json: { error: "You've used today's free messages. They reset at midnight UTC.", free_cap: true, cap: 50, reset_at: reset, purchases } });
      }));
      await page.locator('#input').fill('one more question');
      await page.locator('#input').press('Enter');
      const note = page.locator('.m.ai').last().locator('[data-free-cap]');
      await note.waitFor({ timeout: 20000 });
      assert.match(await note.innerText(), /^You've used today's free messages\. They reset at 8:00\sAM\./);
      if (purchases) {
        assert.equal(await note.locator('a[data-get-credits]').innerText(), 'Get GPU credits for fast answers');
        assert.equal(await note.locator('a[data-get-credits]').getAttribute('href'), '/_auth/top-up');
      } else {
        assert.equal(await note.locator('a, button').count(), 0, 'checkout off: no button or link');
        assert(!/credits/i.test(await note.innerText()));
      }
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `free-limit-${purchases ? 'checkout-on' : 'checkout-off'}.png`) });
      await sleep(1200);
      assert.equal(chats, 1, 'not retried');
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    // without a reset time: the gate's own words
    const { page, ctx } = await open(b, s.base, (p) => p.route('**/api/v1/chat', (r) => r.request().method() !== 'POST' ? r.continue()
      : r.fulfill({ status: 429, json: { error: "You've used today's free messages. They reset at midnight UTC.", free_cap: true } })));
    await page.locator('#input').fill('one more question');
    await page.locator('#input').press('Enter');
    await page.locator('.m.ai').last().locator('[data-free-cap]', { hasText: 'They reset at midnight UTC.' }).waitFor({ timeout: 20000 });
    await ctx.close();
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});
