// In the Android app the page sits under the app's own floating Nexy button (lower left, 104-148px
// above the bottom). Scrolled to the end, the last message must sit above it, not under it. The
// model is a stand-in. SHOTS=<dir> also saves before/after screenshots.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/phone-layout.cjs
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
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36';
const REPLY = Array.from({ length: 8 }, (_, i) => `Point ${i + 1}: keep the shelves counted and the credit book separate from the stock book.`).join('\n\n') + '\n\nWould you like me to draft a stamp card template?';

function model() {
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: REPLY }, finish_reason: 'stop' }] })); });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(llm) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-phone-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'local', NEXY_LLM_URL: llm }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

test('in the Android app the last message ends above the floating Nexy button', { timeout: 90000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const m = await model();
  const s = await start(m.url);
  const b = await chromium.launch();
  try {
    const page = await b.newPage({ viewport: { width: 411, height: 845 }, userAgent: ANDROID_APP, isMobile: true, hasTouch: true });
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('html').getAttribute('data-shell'), 'android');
    await page.locator('#input').fill('Give me ideas to bring more customers to my sari-sari store');
    await page.locator('#input').press('Enter');
    await page.getByText('stamp card template').waitFor({ timeout: 20000 });
    // the app's button, where MainActivity puts it: 44px, 12px from the left, 104px above the bottom
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'appButton';
      d.style.cssText = 'position:fixed;left:12px;bottom:104px;width:44px;height:44px;border-radius:50%;background:rgba(16,16,22,.63);border:1px solid rgba(255,255,255,.25);z-index:9999';
      document.body.append(d);
    });
    const end = async () => {
      await page.evaluate(() => { const t = document.querySelector('#thread'); t.scrollTop = t.scrollHeight; });
      await sleep(300);
      return page.evaluate(() => {
        const last = [...document.querySelectorAll('#thread .msg.ai .bub')].at(-1).getBoundingClientRect();
        return { lastBottom: last.bottom, buttonTop: document.querySelector('#appButton').getBoundingClientRect().top };
      });
    };
    if (process.env.SHOTS) {
      await page.evaluate(() => { delete document.documentElement.dataset.shell; });
      await end();
      await page.screenshot({ path: path.join(process.env.SHOTS, 'phone-button-before.png') });
      await page.evaluate(() => { document.documentElement.dataset.shell = 'android'; });
    }
    const r = await end();
    if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, 'phone-button-after.png') });
    assert(r.lastBottom <= r.buttonTop, `last message ends at ${r.lastBottom}px, the button starts at ${r.buttonTop}px`);
  } finally { await b.close(); s.p.kill(); m.srv.close(); }
});
