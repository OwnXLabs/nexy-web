// "Report a problem" end to end on a real Nexy server; every other API call is simulated.
// The report lands on disk with a screenshot, recent errors, failed requests and what is open,
// and an ultra-private chat refuses to make one.
// Serve with NEXY_DATA_DIR=<tmp> HOST=127.0.0.1 PORT=4389 node dist/server/entry.mjs, then
// PLAYWRIGHT_MODULE=... NEXY_BASE=http://127.0.0.1:4389 REPORTS_DIR=<tmp>/reports node tests/problem-report.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const BASE = process.env.NEXY_BASE || 'http://127.0.0.1:4389', DIR = process.env.REPORTS_DIR;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
const output = { id: 'site-1', kind: 'html', title: 'Bakery website', source: '<h1>Fresh bread</h1>' };
const chat = { id: 'creport', title: 'Bakery', pid: '_', ts: Date.now(), outputs: [output], activeOutput: output.id,
  html: '<div class="msg m me"><div class="bub">Build a bakery site</div></div>', history: [{ role: 'user', content: 'Build a bakery site' }, { role: 'assistant', content: 'Done' }] };

(async () => {
  const browser = await chromium.launch();
  try {
    for (const [width, height] of [[1600, 1000], [390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: width < 800 });
      const page = await ctx.newPage();
      await page.route('**/api/**', async (route) => {
        const req = route.request(), u = new URL(req.url());
        if (u.pathname === '/api/v1/problem-report' || u.pathname.startsWith('/api/v1/private')) return route.continue();
        if (u.pathname === '/api/v1/broken') return route.fulfill({ status: 500, body: 'no' });
        const body = u.pathname === '/api/v1/chats' ? (u.searchParams.has('id') ? { chat } : req.method() === 'POST' ? { ok: true } : { chats: [{ id: chat.id, title: chat.title, pid: '_', ts: chat.ts }], examples: [] }) : { items: [], projects: [], runs: [], connections: [] };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.goto(BASE + '/?eval=1');
      await page.waitForSelector(`[data-chat="${chat.id}"]`);
      await page.$eval(`[data-chat="${chat.id}"]`, (b) => b.click());
      await page.waitForTimeout(500);
      await page.evaluate(() => { console.error('test error from nexy'); return fetch('/api/v1/broken').catch(() => {}); });
      const opened = await page.evaluate(() => document.body.classList.contains('canvas-open') ? document.querySelector('#cvTitle')?.textContent.trim() || null : null);
      const before = fs.existsSync(DIR) ? fs.readdirSync(DIR).length : 0;
      await page.click(width < 800 ? '#mReport' : '#reportBtn');
      const box = await page.locator('.prp').boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= width, `the form fits a ${width}px screen`);
      await page.fill('#prpText', `Share did nothing at ${width}px`);
      const chooser = page.waitForEvent('filechooser');
      await page.click('[data-shot]');
      await (await chooser).setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
      await page.waitForSelector('.prp .shots figure img');
      await page.click('[data-send]');
      await page.waitForSelector('text=Thanks, saved', { timeout: 10000 });
      const files = fs.readdirSync(DIR);
      assert.equal(files.length, before + 2, 'a report and its screenshot were written');
      const r = JSON.parse(fs.readFileSync(path.join(DIR, files.filter((f) => f.endsWith('.json')).sort().at(-1)), 'utf8'));
      assert.equal(r.app, 'nexy');
      // the report names the app's version, from the server (tests/run.sh sets it)
      assert.equal(r.context.version, process.env.NEXY_APP_VERSION || '', 'the app version is in the report');
      assert(r.context.errors.some((e) => /test error from nexy/.test(e.msg)), 'recent console error included');
      assert(r.context.requests.some((q) => q.url === '/api/v1/broken' && q.status === 500), 'failed request included');
      assert.equal(r.context.state.chat, chat.id, 'the open chat is named');
      // what is open on the canvas, exactly as the screen showed it when the report was made
      const shown = r.context.state.open ? r.context.state.open.title : null;
      assert.equal(shown, opened, 'the open canvas item matches the screen');
      console.log(`PASS ${width}px: report ${r.id} saved with screenshot, errors, requests and the open chat`);
      await page.click('[data-x]');
      await ctx.close();
    }
    // an ultra-private chat keeps nothing, reports included
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.route('**/api/**', (route) => new URL(route.request().url()).pathname.startsWith('/api/v1/private') ? route.continue() : route.fulfill({ contentType: 'application/json', body: '{"chats":[],"examples":[],"items":[]}' }));
    await page.goto(BASE + '/?eval=1');
    await page.waitForTimeout(800);
    await page.click('#privBtn');
    await page.waitForTimeout(500);
    const before = fs.readdirSync(DIR).length;
    await page.click('#reportBtn');
    await page.waitForSelector('text=Reports are off in an ultra-private chat');
    assert.equal(await page.locator('#prpText').count(), 0, 'no form to fill in');
    assert.equal(fs.readdirSync(DIR).length, before, 'nothing written');
    console.log('PASS ultra-private chat: reports are off, nothing written');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
