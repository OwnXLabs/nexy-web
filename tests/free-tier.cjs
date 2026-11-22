// Nexy Cloud's free tier in the chat. While a reply waits in the free queue, the line under it says so and
// follows the place in the queue ("You're on the free tier · in the queue (2nd) · about 20 s"), read from the
// gate's /_auth/queue; then the line for where it is answered, as before. The daily free limit says when the free
// messages reset, in this device's time, with the plans (buying greyed out, "Coming soon", until checkout opens).
// Under the composer: the lane and what is left (the gate's /_auth/me), and a word when it runs low. Stand-in
// engine; the gate's answers are stood in by the test.
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
    const skip = page.locator('.m.ai').last().locator('[data-usage=queue]');
    assert.equal(await skip.innerText(), 'Paid plans skip the free queue. See plans');
    assert.equal(await skip.locator('a').getAttribute('href'), '/_auth/plans');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'queued-status.png') });
    await page.getByText('done: a free question').waitFor({ timeout: 30000 });
    assert.equal(await page.locator('[data-usage=queue]').count(), 0, 'gone once it is answered');
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

test('the daily free limit: when it resets, and the plans (buying greyed out until it opens)', { timeout: 120000 }, async () => {
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
      assert.match(await note.innerText(), /^You've used today's free messages\.\s+They reset at 8:00\sAM, in \d+ (min|h \d+ min)\./);
      assert.equal(await note.locator('a', { hasText: 'See plans' }).getAttribute('href'), '/_auth/plans');
      if (purchases) {
        assert.equal(await note.locator('a', { hasText: 'Get GPU credits' }).getAttribute('href'), '/_auth/plans');
        assert.equal(await note.locator('button').count(), 0);
      } else {
        const buy = note.locator('button');
        assert.deepEqual(await buy.allInnerTexts(), ['Monthly · $15', 'GPU credits · from $5']);
        for (const x of await buy.all()) assert(await x.isDisabled(), 'checkout off: greyed out');
        assert.match(await note.innerText(), /Coming soon/i);
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

// the gate's /_auth/me, changed by the test after each chat turn
const me = (free, credits) => ({ free: { used: free, cap: 50, reset_at: (Math.floor(Date.now() / 86400000) + 1) * 86400000 }, ...(credits ? { credits } : {}) });
async function withMe(b, base, states) {
  let turn = 0, state = states[0];
  const o = await open(b, base, async (p) => {
    await p.route('**/_auth/me', (r) => r.fulfill({ json: state }));
    await p.route('**/api/v1/chat', (r) => { if (r.request().method() === 'POST') state = states[Math.min(++turn, states.length - 1)]; return r.continue(); });
  });
  const ask = async (q) => {
    await o.page.locator('#input').fill(q);
    await o.page.locator('#input').press('Enter');
    await o.page.getByText(`done: ${q}`).waitFor({ timeout: 30000 });
    await sleep(800);
  };
  return { ...o, ask, pill: () => o.page.locator('#usage .ut').innerText(), last: () => o.page.locator('.m.ai').last() };
}

test('welcome GPU credits: the fast lane, what each message cost, then back to the free tier', { timeout: 150000 }, async () => {
  const e = await engine(0);
  const s = await start(cloud(e.url));
  const b = await chromium.launch();
  const c = (balance) => ({ balance, welcome: 40, fast: true, purchases: false });
  try {
    const o = await withMe(b, s.base, [me(0, c(40)), me(0, c(30)), me(0, c(20)), me(0, c(9))]);
    await o.page.locator('#usage').waitFor({ timeout: 20000 });
    assert.equal(await o.pill(), 'Fast lane · 40 GPU credits');
    assert.equal(await o.page.locator('#usage .ulink').getAttribute('href'), '/_auth/plans');

    await o.ask('first');
    assert.match(await o.last().locator('[data-usage=welcome]').innerText(), /^You have 40 welcome GPU credits\. .*no queue/);
    assert.equal(await o.last().locator('[data-answered-on]').innerText(), 'Fast lane, no queue · 10 GPU credits');
    assert.match(await o.last().locator('[data-usage=credits-low]').innerText(), /^30 GPU credits left, about 3 fast messages\./);
    assert.equal(await o.pill(), 'Fast lane · 30 GPU credits · about 3 fast messages');
    assert.equal(await o.page.locator('#usage').getAttribute('data-tone'), 'low');
    if (SHOTS) await o.page.screenshot({ path: path.join(SHOTS, 'usage-fast-lane.png') });

    await o.ask('second');
    assert.equal(await o.last().locator('[data-usage]').count(), 0, 'the welcome and the low word are said once');
    assert.equal(await o.pill(), 'Fast lane · 20 GPU credits · about 2 fast messages');

    await o.ask('third');
    const out = o.last().locator('[data-usage=credits-out]');
    assert.match(await out.innerText(), /^Your GPU credits are used up\. From here you're on the free tier: 50 of 50 messages left today/);
    assert.equal((await out.locator('button').all()).length, 2);
    for (const x of await out.locator('button').all()) assert(await x.isDisabled());
    assert.equal(await o.pill(), 'Free tier · 50 of 50 messages left today', 'too few credits for a message: the free tier');
    if (SHOTS) await o.page.screenshot({ path: path.join(SHOTS, 'usage-credits-out.png') });
    assert.deepEqual(o.errors, []);
    await o.ctx.close();
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});

test('the free tier: what is left under the composer, and one word when 5 are left', { timeout: 150000 }, async () => {
  const e = await engine(0);
  const s = await start(cloud(e.url));
  const b = await chromium.launch();
  try {
    const o = await withMe(b, s.base, [me(12), me(13), me(45), me(46)]);
    await o.page.locator('#usage').waitFor({ timeout: 20000 });
    assert.equal(await o.pill(), 'Free tier · 38 of 50 messages left today');
    assert.equal(await o.page.locator('#usage .ulink').innerText(), 'Skip the queue →');
    await o.ask('one');
    assert.equal(await o.pill(), 'Free tier · 37 of 50 messages left today');
    assert.equal(await o.page.locator('[data-usage]').count(), 0, 'nothing to say yet');
    await o.ask('two');
    assert.match(await o.last().locator('[data-usage=free-low]').innerText(), /^5 free messages left today\. They reset at 8:00\sAM\. Monthly has no daily limit and no queue\./);
    assert.equal(await o.page.locator('#usage').getAttribute('data-tone'), 'low');
    if (SHOTS) await o.page.screenshot({ path: path.join(SHOTS, 'usage-free-low.png') });
    await o.ask('three');
    assert.equal(await o.page.locator('[data-usage=free-low]').count(), 1, 'once a day');
    assert.deepEqual(o.errors, []);
    await o.ctx.close();
    // not on Nexy Cloud's gate: no usage line
    const n = await open(b, s.base, (p) => p.route('**/_auth/me', (r) => r.fulfill({ status: 404, body: '' })));
    await sleep(1500);
    assert.equal(await n.page.locator('#usage').count(), 0);
    await n.ctx.close();
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});
