// Nexy Cloud in the page: nothing about credits or buying; Settings has Manage account; the free daily limit's
// refusal is shown in the chat as it is, with no button and no retry. A turn the gate put in the paid lane (off
// today) asks the engine for cloud boost and carries the gate's ticket. Stand-in engine; the gate's refusal is
// stood in by the test.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/cloud-lanes.cjs
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
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-lanes-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_INSECURE_TRUST_ON_TCP: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start\n' + log);
}

test('Nexy Cloud: no credits UI, Manage account, the free limit, and the paid lane', { timeout: 180000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const e = await engine();
  const s = await start({
    NEXY_PLACE: 'cloud', NEXY_STUDIOS: 'off', NEXY_TRUST_GATE_USER: '1', NEXY_ENGINES: 'nexy-engine', NEXY_DEFAULT_ENGINE: 'nexy-engine',
    NEXY_ENGINE_NEXY_ENGINE_URL: e.url, NEXY_ENGINE_NEXY_ENGINE_KEY: 'k', NEXY_LLM_URL: e.url, NEXY_NETWORK_MODEL: 'qwen3-1.7b',
  });
  const b = await chromium.launch();
  const open = async (headers = {}, capped = false) => {
    const ctx = await b.newContext({ extraHTTPHeaders: { 'x-nexy-user': 't01', ...headers } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (x) => errors.push(x.message));
    let chats = 0;
    if (capped) await page.route('**/api/v1/chat', (r) => {
      if (r.request().method() !== 'POST') return r.continue();
      chats++;
      return r.fulfill({ status: 429, json: { error: "You've used today's free messages. They come back at midnight UTC.", free_cap: true, cap: 50 } });
    });
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    return { page, ctx, errors, chats: () => chats };
  };
  try {
    let { page, ctx, errors, chats } = await open({}, true);
    const words = /gpu credits|top up|buy credits|balance/i;
    assert(!words.test(await page.locator('body').innerText()), 'nothing about credits on the page');
    assert.equal(await page.locator('#credits, [data-topup]').count(), 0);
    // the free limit: its words and the plans; buying is greyed out until it opens; asked once
    await page.locator('#input').fill('one more question');
    await page.locator('#input').press('Enter');
    await page.locator('[data-free-cap]').filter({ hasText: "You've used today's free messages" }).waitFor({ timeout: 20000 });
    const buy = await page.locator('[data-free-cap] button').all();
    assert.equal(buy.length, 2);
    for (const x of buy) assert(await x.isDisabled(), 'nothing can be bought yet');
    await sleep(1500);
    assert.equal(chats(), 1, 'the refusal is not retried');
    // Settings, Nexy Cloud: Manage account, nothing about credits
    // the profile menu: Billing & usage and Plans (Nexy Cloud only)
    assert.equal(await page.locator('#pmUsage').getAttribute('href'), '/_auth/usage');
    assert.equal(await page.locator('#pmPlans').getAttribute('href'), '/_auth/plans');
    await page.evaluate(() => { document.querySelector('#settingsBtn')?.click(); });
    await page.locator('#setNav [data-sec="cloud"]').click();
    await page.locator('#setBody').getByText('Manage account').waitFor();
    assert.equal(await page.locator('#setBody a', { hasText: 'Manage account' }).getAttribute('href'), '/_auth/account');
    assert.equal(await page.locator('#setBody a', { hasText: 'Billing & usage' }).getAttribute('href'), '/_auth/usage');
    assert.equal(await page.locator('#setBody a', { hasText: 'See plans' }).getAttribute('href'), '/_auth/plans');
    const text = await page.locator('#setBody').innerText();
    assert(!/top up|buy credits|wallet address|ethereum|web3|crypto/i.test(text), text);
    assert.deepEqual(errors, []);
    await ctx.close();

    // the paid lane (when a paid gateway is set up): cloud boost first, and the gate's ticket goes to the engine
    ({ page, ctx, errors } = await open({ 'x-nexy-lane': 'paid', 'x-nexy-ticket': 't01.1795.paid.Sig' }));
    await page.locator('#input').fill('a paid question');
    await page.locator('#input').press('Enter');
    await page.getByText('hello there').waitFor({ timeout: 20000 });
    assert.equal(e.asked.at(-1).upstream_model, 'qwen3-1.7b+boost+own1');
    assert.equal(e.asked.at(-1).ticket, 't01.1795.paid.Sig');
    await ctx.close();
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});
