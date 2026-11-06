// The agent's screen in the work pane: ⌘K "Watch the agent's screen" opens it; with no screen on
// this machine it says so plainly; a browsing question opens it by itself when one is running.
// Serve a build with NEXY_SCREEN_DIR pointing at an empty dir, then:
// PLAYWRIGHT_MODULE=/path/to/playwright NEXY_BASE=http://127.0.0.1:4389 node tests/screen.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const BASE = process.env.NEXY_BASE || 'http://127.0.0.1:4389';

(async () => {
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
    await p.route('**/api/v1/chat', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) }));
    await p.goto(BASE + '/?eval=1'); await p.waitForTimeout(1200);
    await p.keyboard.press('Meta+k'); await p.fill('#cmdIn', 'screen'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => { const t = document.querySelector('.screen-msg')?.textContent ?? ''; return t && !/Connecting/.test(t); });
    assert.equal((await p.textContent('#cvTitle')).trim(), "The agent's screen");
    assert.match(await p.textContent('.screen-msg'), /not running on this machine/);
    console.log('PASS no screen here: the pane says so');

    // pretend a screen is running: a browsing question opens the pane by itself
    await p.route('**/api/v1/screen', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ available: true, password: 'x', path: '/screen/ws' }) }));
    await p.click('#cvClose').catch(() => {});
    await p.fill('#input', 'Search the web for the latest kernel'); await p.press('#input', 'Enter');
    await p.waitForSelector('.screen-live', { timeout: 5000 });
    console.log('PASS a browsing question opens the agent\'s screen');
    assert.deepEqual(errors, [], 'no page errors');
  } finally { await b.close(); }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
