// Nexy on a computer without an Own1 (the desktop app's own server, studios off): nothing it shows
// may fail with an app that isn't there. Requests for missing studios get a plain answer, the
// wording says "this computer", and the mic and settings don't point at apps that don't exist.
// The same page on an Own1 keeps everything. Run after `npm run build`:
//   PLAYWRIGHT_MODULE=<path to playwright> node --test tests/local-mode.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-local-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

async function ask(page, text) {
  await page.locator('#input').fill(text);
  await page.locator('#input').press('Enter');
}

test('a computer without an Own1: missing studios answer plainly, nothing says Own1', async () => {
  const s = await start({ NEXY_STUDIOS: 'off' });
  const b = await chromium.launch();
  try {
    const page = await b.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const appCalls = []; page.on('request', (r) => { if (r.url().includes('/api/apps/')) appCalls.push(r.url()); });
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    assert.equal((await page.locator('#pmWsName').textContent()).trim(), 'This computer');
    assert.equal(await page.locator('#micBtn').isVisible(), false, 'no mic without speech');
    for (const sel of ['#projList', '[data-tab="tasks"]', '[data-tab="agents"]']) assert.equal(await page.locator(sel).isVisible(), false, `${sel} hidden without projects`);

    for (const [say, what] of [['generate an image of a flying elephant', 'Making images'], ['build me a website for a ping pong ball business', 'Building websites and apps']]) {
      await ask(page, say);
      await page.getByText(`${what} isn't in Nexy on this computer yet`).waitFor({ timeout: 15000 });
    }
    await page.locator('#waveBtn').click();
    await page.getByText("Talking to Nexy isn't in Nexy on this computer yet").first().waitFor({ timeout: 5000 });
    assert.equal(await page.getByText('Make this a project').count(), 0, 'no projects without Own Startup');

    await page.locator('#profileBtn').click();
    await page.locator('#settingsBtn').click();
    for (const sec of ['general', 'nexy', 'team', 'connections', 'permissions', 'cloud', 'data', 'security', 'workspaces', 'about']) {
      await page.locator(`#ovSet [data-sec="${sec}"]`).click();
      await sleep(300);
      const t = await page.locator('#ovSet').innerText();
      assert.doesNotMatch(t, /Own ?1(?!\s+or Nexy Cloud)|unknown app|Not answering/i, `${sec}: ${t.slice(0, 300)}`);
    }
    const body = await page.locator('.msgs, #msgs, main').first().innerText().catch(() => '');
    assert.doesNotMatch(body, /unknown app|stopped/i);
    assert.deepEqual(appCalls.filter((u) => !/\/api\/apps\/(startup|build)\/api\/(pm\/projects|director\/runs)/.test(u)), [], 'no requests to missing studios beyond the quiet history checks');
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.p.kill(); }
});

test('the same page on an Own1 keeps its studios, mic and wording', async () => {
  const s = await start({});
  const b = await chromium.launch();
  try {
    const page = await b.newPage();
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    assert.equal((await page.locator('#pmWsName').textContent()).trim(), 'Own1');
    assert.equal(await page.locator('#micBtn').isVisible(), true);
    assert.equal(await page.locator('html').getAttribute('data-place'), 'own1');
    assert.match(await page.locator('html').getAttribute('data-apps'), /\bimages\b.*\bbuild\b/);
  } finally { await b.close(); s.p.kill(); }
});

test('a computer with some studios started shows exactly those, and still says this computer', async () => {
  const s = await start({ NEXY_STUDIOS: 'off', NEXY_BUILD_URL: 'http://127.0.0.1:9/a', NEXY_STARTUP_URL: 'http://127.0.0.1:9/b' });
  const b = await chromium.launch();
  try {
    const page = await b.newPage();
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('html').getAttribute('data-place'), 'computer');
    assert.equal(await page.locator('html').getAttribute('data-apps'), 'startup build');
    assert.equal((await page.locator('#pmWsName').textContent()).trim(), 'This computer');
    await ask(page, 'generate an image of a flying elephant');
    await page.getByText("Making images isn't in Nexy on this computer yet").waitFor({ timeout: 15000 });
  } finally { await b.close(); s.p.kill(); }
});
