// Nexy Cloud's GPU credits in the page: the balance in the sidebar, Top up only while Buy works (the gate's
// /api/credits says so), the purchase page in an overlay, the plan in Settings, and the free daily limit's
// message in a chat with Top up only when Buy works. A turn the gate put in the paid lane asks the engine for
// cloud boost and carries the gate's ticket. Stand-in engine; the gate's routes are stood in by the test.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/gpu-credits.cjs
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

function engine() {
  const asked = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (!req.url.startsWith('/v1/chat/completions')) return res.end('{"data":[]}');
      const b = JSON.parse(body || '{}');
      if (b.stream) asked.push({ ...b, ticket: req.headers['x-nexy-ticket'] });
      if (!b.stream) return res.end(JSON.stringify({ choices: [{ message: { content: 'A title' }, finish_reason: 'stop' }] }));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hello there' }, finish_reason: 'stop' }], nexy: { tools: [] } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, asked, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-credits-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_INSECURE_TRUST_ON_TCP: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start\n' + log);
}

// the gate's routes, as a test stands them in
async function gate(page, credits, chat429) {
  await page.route('**/api/credits', (r) => r.fulfill({ json: credits }));
  await page.route('**/_auth/top-up', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><p id=tp>Top up page</p><script>parent.postMessage({type:"nexy-credits",balance:840},location.origin)</script>' }));
  if (chat429) await page.route('**/api/v1/chat', (r) => r.request().method() === 'POST'
    ? r.fulfill({ status: 429, json: { error: "You've used today's free messages. They come back at midnight UTC.", free_cap: true, cap: 50, top_up: credits.buy } })
    : r.continue());
}

test('GPU credits: balance, Top up, Settings, the free limit and the paid lane', { timeout: 180000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const e = await engine();
  const s = await start({
    NEXY_PLACE: 'cloud', NEXY_STUDIOS: 'off', NEXY_TRUST_GATE_USER: '1', NEXY_ENGINES: 'nexy-engine', NEXY_DEFAULT_ENGINE: 'nexy-engine',
    NEXY_ENGINE_NEXY_ENGINE_URL: e.url, NEXY_ENGINE_NEXY_ENGINE_KEY: 'k', NEXY_LLM_URL: e.url, NEXY_NETWORK_MODEL: 'qwen3-1.7b',
  });
  const b = await chromium.launch();
  const open = async (credits, headers = {}, chat429 = false) => {
    const ctx = await b.newContext({ extraHTTPHeaders: { 'x-nexy-user': 't01', ...headers } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (x) => errors.push(x.message));
    await gate(page, credits, chat429);
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    return { page, ctx, errors };
  };
  try {
    // Buy works: the balance and Top up; Top up opens the purchase page, which reports the new balance
    const paid = { available: true, balance: 340, buy: true, top_up: { credits: 500, usd: 5 }, free: { used: 3, cap: 50 } };
    let { page, ctx, errors } = await open(paid);
    await page.locator('#credits [data-credits-balance]').filter({ hasText: '340 GPU credits' }).waitFor();
    await page.locator('#credits [data-topup]').click();
    await page.frameLocator('#ovTopUp iframe').locator('#tp').waitFor();
    assert(await page.locator('#ovTopUp').evaluate((el) => el.classList.contains('open')));
    await page.locator('#ovTopUp [data-close]').click();
    assert(!(await page.locator('#ovTopUp').evaluate((el) => el.classList.contains('open'))));
    // Settings: the plan, Top up, Manage account
    await page.evaluate(async () => { document.querySelector('#settingsBtn')?.click(); });
    await page.locator('#ovSet').waitFor({ state: 'attached' });
    await page.locator('#setNav [data-sec="cloud"]').click();
    await page.locator('#setBody').getByText('Manage account').waitFor();
    assert.equal(await page.locator('#setBody a', { hasText: 'Manage account' }).getAttribute('href'), '/_auth/account');
    assert.equal(await page.locator('#setBody [data-topup]').count(), 1);
    const text = (await page.locator('#setBody').innerText()).toLowerCase();
    assert(!/wallet address|ethereum|web3|crypto|token sale/.test(text), 'no web3 words in Settings');
    assert.deepEqual(errors, []);
    await ctx.close();

    // Buy not set up: no Top up anywhere, the free count instead
    ({ page, ctx, errors } = await open({ available: true, balance: 0, buy: false, top_up: { credits: 500, usd: 5 }, free: { used: 12, cap: 50 } }, {}, true));
    await page.locator('#credits').filter({ hasText: '38 of 50 left today' }).waitFor();
    assert.equal(await page.locator('[data-topup]').count(), 0, 'no Top up without Buy');
    // the free limit reached: its words, no Top up, and no retrying
    await page.locator('#input').fill('one more question');
    await page.locator('#input').press('Enter');
    await page.locator('[data-free-cap]').filter({ hasText: "You've used today's free messages" }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-free-cap] [data-topup]').count(), 0);
    assert.deepEqual(errors, []);
    await ctx.close();

    // the limit with Buy working: Top up in the message
    ({ page, ctx, errors } = await open({ ...paid, balance: 0 }, {}, true));
    await page.locator('#input').fill('one more question');
    await page.locator('#input').press('Enter');
    await page.locator('[data-free-cap] [data-topup]').waitFor({ timeout: 20000 });
    await ctx.close();

    // the paid lane: cloud boost first, and the gate's ticket goes to the engine
    ({ page, ctx, errors } = await open(paid, { 'x-nexy-lane': 'paid', 'x-nexy-ticket': 't01.1795.paid.Sig' }));
    await page.locator('#input').fill('a paid question');
    await page.locator('#input').press('Enter');
    await page.getByText('hello there').waitFor({ timeout: 20000 });
    assert.equal(e.asked.at(-1).upstream_model, 'qwen3-1.7b+boost+own1');
    assert.equal(e.asked.at(-1).ticket, 't01.1795.paid.Sig');
    await ctx.close();
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});
