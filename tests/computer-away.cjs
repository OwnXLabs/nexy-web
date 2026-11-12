// The phone asks the computer and the computer is gone: the reply says so in plain words, the
// countdown stops, and the browser's own wording ("The user aborted a request") never shows.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/computer-away.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const AWAY = "Your computer isn't answering. Nexy will reconnect when it's back.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-away-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'local', NEXY_LLM_URL: 'http://127.0.0.1:9' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

async function ask(page, text) {
  await page.locator('#input').fill(text);
  await page.locator('#input').press('Enter');
}

// the reply's status line: its words, and whether a countdown still runs
const waitLine = (page) => page.evaluate(() => {
  const w = [...document.querySelectorAll('#thread .msg.ai .wait')].at(-1);
  return w ? { text: w.querySelector('.wl')?.textContent ?? '', clock: w.querySelector('.wt')?.textContent ?? '', eta: w.dataset.eta ?? null } : null;
});

test('a computer that stops answering mid-request is named plainly, without a countdown', { timeout: 120000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const s = await start();
  const b = await chromium.launch();
  try {
    const page = await b.newPage();
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });

    // 1. the request hangs and the computer fails its health check: plain words, the countdown stops
    await page.route('**/api/v1/chat', () => { /* never answered: the computer is off */ });
    await page.route('**/api/v1/health', (r) => r.abort('connectionrefused'));
    await ask(page, 'Are you there?');
    await page.waitForFunction((away) => [...document.querySelectorAll('#thread .msg.ai .wait .wl')].some((e) => e.textContent === away), AWAY, { timeout: 20000 });
    const hung = await waitLine(page);
    assert.equal(hung.eta, null, 'no countdown while the computer is away');
    assert.equal(hung.clock, '', 'no "about 17s left"');
    await page.reload();
    await page.unroute('**/api/v1/chat'); await page.unroute('**/api/v1/health');

    // 2. the request cannot reach the computer at all: the same words, never the browser's
    await page.locator('#input').waitFor({ timeout: 20000 });
    await page.route('**/api/v1/chat', (r) => r.abort('connectionrefused'));
    await ask(page, 'Still there?');
    await page.waitForFunction((away) => [...document.querySelectorAll('#thread .msg.ai .wait .wl')].some((e) => e.textContent === away), AWAY, { timeout: 15000 });
    assert.equal((await waitLine(page)).clock, '');
    assert.doesNotMatch(await page.locator('#thread').innerText(), /aborted|failed to fetch|load failed|busy or loading/i);
  } finally { await b.close(); s.p.kill(); }
});
