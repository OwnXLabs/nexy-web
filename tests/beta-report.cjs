// Beta builds: the Nexy Beta Program report against a stand-in report server. The preview is the
// body that arrives; each switch changes both; keys, tokens and personal details are gone; the
// hardware lines name no machine or person; "Report this chat" sends that thread only; remembered
// choices never include the conversation; the comment survives a close; screenshots come by
// button, paste or drop, five at most, removable, and fit the server's limits; an ultra-private
// chat sends nothing; a build that isn't a beta shows no BETA button. Run after `npm run build`:
//   PLAYWRIGHT_MODULE=<path to playwright> [SHOTS_DIR=<dir>] node --test tests/beta-report.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const SHOTS = process.env.SHOTS_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'a1'.repeat(32);
const TAIL = 'tailtok0123456789';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
const WALLET = '0x52908400098527886E0F7030069857D2E4169EE7';
// what the app's logs might hold; every secret and identifier here must be gone from what is sent
const LOGS = [...Array.from({ length: 250 }, (_, i) => `engine tick ${i}`), 'engine ready on 127.0.0.1:5000', 'GET /?nexy-key=0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f 200',
  'NEXY_ENGINE_KEY=logsecret1 port=5000', 'Authorization: Bearer logsecret2abc', '{"password":"logsecret3"}', 'Cookie: nexy_owner=logsecret4',
  'mail from jane.doe@example.com', 'call +61 412 345 678', 'opened /Users/janedoe/Library/Logs/nexy.log', 'peer 192.168.1.20:443',
  'en0 ether a4:83:e7:12:34:56', `wallet ${WALLET}`, 'model loaded in 2.1s'].join('\n');
const SECRETS = ['logsecret1', 'logsecret2', 'logsecret3', 'logsecret4', '0f0f0f0f0f0f0f0f', 'typedsecret', 'sk-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6q7', 'consolesecret', 'querysecret', KEY];
// what the app's hardware answer might wrongly carry; none of it may be sent
const HW = { os: 'macOS 26.1', arch: 'aarch64', cpu: 'Apple M3 Pro', ram_gb: 36, gpu: 'Apple M3 Pro', gpu_cores: 18, vram_gb: null, free_disk_gb: 812.4, tier: 'gpu',
  serial: 'C02XK0SERIAL', hostname: 'Janes-MacBook-Pro', user: 'janedoe', home: '/Users/janedoe', mac: 'a4:83:e7:12:34:56', ip: '192.168.1.20', wallet: WALLET };
const IDS = ['C02XK0SERIAL', 'Janes-MacBook-Pro', 'janedoe', 'a4:83:e7', '192.168.1.20', WALLET, 'jane.doe@example.com', '412 345 678'];
const CAPS = JSON.stringify({ v: 1, model: 'qwen3:8b', tier: 'gpu', tested: true, class: 'simple', tasks: { chat: 'allow', build_site: 'warn', build_game: 'block' } });

// stands in for update.ownx.co/beta/report, the desktop app's log tail and hardware, and the model
function fake() {
  const got = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/beta/report') {
        got.push({ headers: req.headers, raw, body: JSON.parse(raw) });
        res.writeHead(201, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, ref: 'NXR-7Q2F' }));
      }
      if (req.url === `/${TAIL}`) { res.writeHead(200); return res.end(LOGS); }
      if (req.url === `/${TAIL}/hardware`) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(HW)); }
      res.writeHead(500); res.end('no model here');
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, got, base: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-beta-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_STUDIOS: 'off', NEXY_BOX_FEATURES: 'open', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, data, stop: () => { p.kill(); fs.rmSync(data, { recursive: true, force: true }); } }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

const betaEnv = (f, more = {}) => ({ NEXY_BETA: '1', NEXY_BETA_REPORT_URL: `${f.base}/beta/report`, NEXY_INSTALL_KEY: KEY, NEXY_LOG_TAIL_URL: `${f.base}/${TAIL}`, NEXY_APP_VERSION: '0.2.3', NEXY_LLM_URL: f.base, NEXY_CAPS: CAPS, ...more });

// two saved chats, so "Report this chat" can be told apart from the open one
const now = Date.now();
const CHATS = {
  ca: { id: 'ca', title: 'Bakery site', pid: '_', ts: now, html: '<div class="msg m me"><div class="bub">Build a bakery site</div></div>', history: [{ role: 'user', content: 'Build a bakery site' }, { role: 'assistant', content: 'Done, here it is' }] },
  cb: { id: 'cb', title: 'Holiday plan', pid: '_', ts: now - 1000, html: '<div class="msg m me"><div class="bub">Plan a trip</div></div>', history: [{ role: 'user', content: 'Plan a trip to Lisbon, mail me at jane.doe@example.com' }, { role: 'assistant', content: 'Day one: Alfama' }, { role: 'user', content: 'x'.repeat(2500) }] },
};
async function openPage(b, base, { width = 1400, height = 1000, chats = false } = {}) {
  const ctx = await b.newContext({ viewport: { width, height }, hasTouch: width < 800 });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  if (chats) await page.route('**/api/v1/chats**', (route) => {
    const req = route.request(), u = new URL(req.url()), id = u.searchParams.get('id');
    const body = id ? { chat: CHATS[id] } : req.method() === 'GET' ? { chats: Object.values(CHATS).map(({ id, title, pid, ts }) => ({ id, title, pid, ts })), examples: [] } : { ok: true };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(base + '/');
  await page.locator('#input').waitFor({ timeout: 20000 });
  return { page, ctx, errors };
}
const ready = (page) => page.waitForFunction(() => !document.querySelector('.prp [data-send]')?.disabled && /\{/.test(document.querySelector('#prpPreview')?.textContent || ''), null, { timeout: 15000 });
const preview = async (page) => JSON.parse(await page.locator('#prpPreview').textContent());
const sameAsPreview = (body, pv) => assert.deepEqual({ ...body, ...(body.screenshot ? { screenshot: pv.screenshot } : {}) }, pv, 'what arrived is what the preview showed');
const shot = (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, name) });
// images made in the page, so paste and drop carry real files
const dropImages = (page, n, big, how) => page.evaluate(async ({ n, big, how }) => {
  const files = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas'); c.width = big ? 2200 : 320; c.height = big ? 1500 : 200;
    const g = c.getContext('2d'), d = g.createImageData(c.width, c.height);
    for (let k = 0; k < d.data.length; k++) d.data[k] = big ? (Math.random() * 255) | 0 : (k * (i + 3)) % 255;
    g.putImageData(d, 0, 0);
    files.push(new File([await new Promise((r) => c.toBlob(r, 'image/png'))], `s${i}.png`, { type: 'image/png' }));
  }
  const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f));
  if (how === 'paste') document.querySelector('#prpText').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  else document.querySelector('.prp').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}, { n, big, how });
const thumbs = (page) => page.locator('.prp .shots figure').count();

test('beta: the modal, the preview is exactly what the team receives, secrets and identifiers removed', async () => {
  const f = await fake();
  const s = await start(betaEnv(f));
  const b = await chromium.launch();
  try {
    const { page, errors } = await openPage(b, s.base);
    assert.equal(await page.locator('html').getAttribute('data-beta'), '1');
    assert.equal(await page.locator('#reportBtn').count(), 0, 'the BETA button is the report button');
    await page.evaluate(() => { console.error('upload failed, token=consolesecret9'); return fetch('/api/v1/broken?key=querysecret').catch(() => {}); });
    await page.locator('#betaBtn').click();
    const dlg = page.locator('.prp');
    assert.equal(await dlg.locator('h2').innerText(), 'Thanks for being part of the Nexy Beta Program!');
    assert.match(await dlg.innerText(), /To help us ship faster, please share the information below:/);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'prpText', 'the comment box has the focus');
    for (const [id, on] of [['prpState', true], ['prpLogs', true], ['prpHw', true], ['prpConv', false]]) assert.equal(await page.isChecked(`#${id}`), on, `${id} starts ${on ? 'on' : 'off'}`);
    assert.match(await dlg.innerText(), /Kept 90 days at most, then deleted\. Never sold or used to train models\./);
    assert.equal(f.got.length, 0, 'nothing sent on opening');
    await page.fill('#prpText', 'Share did nothing. password: typedsecret and sk-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6q7');
    const chooser = page.waitForEvent('filechooser');
    await page.click('[data-shot]');
    await (await chooser).setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForSelector('.prp .shots figure img');
    await page.fill('#prpEmail', 'tester@example.com');
    await ready(page);
    const what = await page.locator('#prpWhat').innerText();
    assert.match(what, /Not this conversation/);
    assert.match(what, /1 screenshot \(\d+ KB\)/);
    assert.match(what, /tester@example\.com/);
    assert.match(what, /Hardware: \d+ lines about this computer/);
    await shot(page, 'modal-desktop.png');
    await page.locator('.prp summary').click();
    await page.locator('.prp').evaluate((e) => { e.scrollTop = e.scrollHeight; });
    await shot(page, 'modal-desktop-preview.png');
    const pv = await preview(page);
    assert.equal(f.got.length, 0, 'nothing sent before Send');
    await page.click('[data-send]');
    await page.getByText('Sent. Reference NXR-7Q2F.').waitFor({ timeout: 10000 });
    await shot(page, 'modal-sent.png');

    assert.equal(f.got.length, 1, 'one report sent');
    const [{ headers, raw, body }] = f.got;
    assert.equal(headers['x-install'], KEY, 'the install key rides in a header');
    assert.match(pv.screenshot, /^\[screenshot, \d+ KB\]$/);
    assert.match(body.screenshot, /^data:image\/jpeg;base64,/);
    sameAsPreview(body, pv);
    assert.deepEqual(Object.keys(body).sort(), ['app', 'email', 'errors', 'kind', 'logs', 'os', 'requests', 'screenshot', 'text', 'version'], 'only fields the report server keeps');
    assert.equal(body.version, '0.2.3');
    assert(body.requests.some((r) => r.url === '/api/v1/broken' && r.status === 404), 'failed request, no query string');
    assert(body.errors.some((e) => /upload failed, token=\[removed\]/.test(e.msg)), 'console error, token removed');
    const lines = body.logs.split('\n');
    assert(lines.length <= 200, `the server keeps 200 lines; ${lines.length} sent`);
    assert.deepEqual(lines.slice(0, 8), ['== hardware', 'os: macOS 26.1 (aarch64)', 'cpu: Apple M3 Pro', 'ram: 36 GB', 'gpu: Apple M3 Pro, 18 cores, no graphics memory of its own',
      'free disk: 812.4 GB', 'nexy tier: gpu', 'model: qwen3:8b, tested by Nexy (simple)'], 'the hardware lines lead the logs');
    assert.match(body.logs, /engine ready on 127\.0\.0\.1:5000/);
    assert.match(body.logs, /model loaded in 2\.1s/);
    assert.match(body.logs, /opened \/Users\/\[user\]\/Library/);
    assert.match(body.text, /^Share did nothing\. password: \[removed\]/);
    for (const x of [...SECRETS, ...IDS]) assert(!raw.includes(x), `"${x}" was not sent`);
    const local = fs.readdirSync(path.join(s.data, 'reports')).filter((n) => n.endsWith('.json'));
    assert.equal(local.length, 1, 'a copy kept on this computer');
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.stop(); f.srv.close(); }
});

test('beta: each switch changes the preview and the body the same way', async () => {
  const f = await fake();
  const s = await start(betaEnv(f));
  const b = await chromium.launch();
  try {
    const { page, errors } = await openPage(b, s.base);
    await page.evaluate(() => fetch('/api/v1/broken').catch(() => {}));
    await page.locator('#betaBtn').click();
    await page.fill('#prpText', 'switch test');
    await ready(page);
    const all = await preview(page);
    assert(all.errors.length + all.requests.length > 0 && all.logs.includes('== hardware') && all.logs.includes('engine tick'));
    await page.click('#prpState'); let p = await preview(page);
    assert.deepEqual([p.errors, p.requests], [[], []], 'what the app was doing: off');
    await page.click('#prpLogs'); p = await preview(page);
    assert(p.logs.startsWith('== hardware') && !p.logs.includes('engine tick'), 'logs off, hardware still on');
    await page.click('#prpHw'); p = await preview(page);
    assert.equal(p.logs, '', 'logs and hardware off');
    await page.click('#prpLogs'); p = await preview(page);
    assert(!p.logs.includes('== hardware') && p.logs.includes('engine tick'), 'logs on, hardware off');
    assert.equal(p.conversation, undefined, 'no conversation while off');
    const pv = await preview(page);
    await page.click('[data-send]');
    await page.getByText('Sent. Reference NXR-7Q2F.').waitFor({ timeout: 10000 });
    sameAsPreview(f.got[0].body, pv);
    assert.deepEqual([f.got[0].body.errors, f.got[0].body.requests], [[], []]);
    assert(!f.got[0].raw.includes('Apple M3 Pro'), 'no hardware sent when off');
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.stop(); f.srv.close(); }
});

test('beta: "Report this chat" sends that thread only, still after Send', async () => {
  const f = await fake();
  const s = await start(betaEnv(f));
  const b = await chromium.launch();
  try {
    const { page, errors } = await openPage(b, s.base, { chats: true });
    await page.waitForSelector('[data-chat="cb"]');
    await page.$eval('[data-chat="ca"]', (el) => el.click());
    await page.waitForTimeout(400);
    // the BETA button with This conversation on: the open chat, ca
    await page.locator('#betaBtn').click();
    await page.click('#prpConv');
    await ready(page);
    assert.deepEqual((await preview(page)).conversation.map((t) => t.text), ['Build a bakery site', 'Done, here it is']);
    await page.keyboard.press('Escape');
    // cb's menu: only cb, switched on already
    await page.$eval('[data-chat="cb"] .dots', (el) => el.click());
    await page.locator('#ctx .ci2', { hasText: 'Report this chat' }).click();
    await page.locator('.prp').waitFor();
    assert.equal(await page.isChecked('#prpConv'), true, 'This conversation is on');
    assert.match(await page.locator('#prpConvD').innerText(), /Only “Holiday plan”/);
    await page.fill('#prpText', 'the plan was wrong');
    await ready(page);
    const what = await page.locator('#prpWhat').innerText();
    assert.match(what, /“Holiday plan”: 3 messages/);
    assert.match(what, /1 message is cut to 2,000 characters/);
    const pv = await preview(page);
    assert.equal(f.got.length, 0, 'nothing sent before Send');
    await page.click('[data-send]');
    await page.getByText('Sent. Reference NXR-7Q2F.').waitFor({ timeout: 10000 });
    const { body, raw } = f.got[0];
    sameAsPreview(body, pv);
    assert.deepEqual(body.conversation.map((t) => t.role), ['user', 'assistant', 'user']);
    assert.equal(body.conversation[0].text, 'Plan a trip to Lisbon, mail me at [removed]', 'an email in the chat is removed');
    assert.equal(body.conversation[2].text.length, 2000);
    assert(!/bakery/i.test(raw), 'not the open chat');
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.stop(); f.srv.close(); }
});

test('beta: remembered choices, never the conversation; the comment survives a close; Settings shows the same choices', async () => {
  const f = await fake();
  const s = await start(betaEnv(f));
  const b = await chromium.launch();
  try {
    const { page, errors } = await openPage(b, s.base);
    await page.locator('#betaBtn').click();
    await page.fill('#prpText', 'half-written thought');
    await page.keyboard.press('Escape');
    await page.locator('#betaBtn').click();
    assert.equal(await page.inputValue('#prpText'), 'half-written thought', 'the draft came back');
    await page.click('#prpLogs');
    await page.click('#prpConv');
    await page.check('#prpRemember');
    await page.click('[data-save]');
    await page.getByText('Thanks, saved').waitFor();
    assert.equal(f.got.length, 0, 'Save on this computer only sends nothing');
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('nexy.report.defaults.v1')));
    assert.deepEqual(kept, { state: true, logs: false, hardware: true }, 'no conversation in what is kept');
    await page.click('.prp .btn[data-x]');
    await page.reload();
    await page.locator('#input').waitFor();
    await page.locator('#betaBtn').click();
    assert.equal(await page.inputValue('#prpText'), '', 'the draft went once saved');
    assert.deepEqual(await Promise.all(['#prpState', '#prpLogs', '#prpHw', '#prpConv', '#prpRemember'].map((x) => page.isChecked(x))), [true, false, true, false, true]);
    await page.keyboard.press('Escape');
    // Settings > Security and privacy: the same choices; a change there shows in the report
    await page.locator('#profileBtn').click();
    await page.locator('#settingsBtn').click();
    await page.locator('#ovSet [data-sec="security"]').click();
    const logsSw = page.locator('[data-rsw="logs"]');
    await logsSw.waitFor();
    assert.equal(await logsSw.getAttribute('aria-checked'), 'false');
    await logsSw.click();
    await page.locator('[data-rsw="logs"][aria-checked="true"]').waitFor();
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.querySelector('#betaBtn').click());
    await page.locator('.prp').waitFor();
    assert.equal(await page.isChecked('#prpLogs'), true, 'Settings and the report share one setting');
    // unticking Remember forgets them
    await page.click('#prpHw');
    await page.uncheck('#prpRemember');
    await page.fill('#prpText', 'x');
    await page.click('[data-save]');
    await page.getByText('Thanks, saved').waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('nexy.report.defaults.v1')), null);
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.stop(); f.srv.close(); }
});

test('beta: screenshots by paste and drop, five at most, Remove, within the size limits', async () => {
  const f = await fake();
  const s = await start(betaEnv(f));
  const b = await chromium.launch();
  try {
    const { page, errors } = await openPage(b, s.base);
    await page.locator('#betaBtn').click();
    await page.fill('#prpText', 'five screenshots');
    await dropImages(page, 1, false, 'paste');
    await page.waitForFunction(() => document.querySelectorAll('.prp .shots figure').length === 1);
    await dropImages(page, 4, true, 'drop');
    await page.waitForFunction(() => document.querySelectorAll('.prp .shots figure').length === 5, null, { timeout: 30000 });
    assert.equal(await page.locator('[data-shot]').isVisible(), false, 'no Add button at five');
    await dropImages(page, 1, false, 'paste');
    await page.getByText('Up to 5 screenshots. Remove one to add another.').waitFor();
    assert.equal(await thumbs(page), 5, 'a sixth is refused');
    await page.locator('.prp .shots figure').nth(1).locator('button', { hasText: 'Remove' }).click();
    assert.equal(await thumbs(page), 4);
    assert.equal(await page.locator('[data-shot]').isVisible(), true, 'Add is back');
    await ready(page);
    const what = await page.locator('#prpWhat').innerText();
    assert.match(what, /4 screenshots \(\d+ KB, \d+ KB, \d+ KB, \d+ KB\), sent as one image of \d+ KB/);
    const pv = await preview(page);
    assert.match(pv.screenshot, /^\[4 screenshots in one image, \d+ KB\]$/);
    await page.click('[data-send]');
    await page.getByText('Sent. Reference NXR-7Q2F.').waitFor({ timeout: 20000 });
    const { raw, body } = f.got[0];
    sameAsPreview(body, pv);
    const img = Buffer.from(body.screenshot.split(',')[1], 'base64');
    assert(img.length <= 1_500_000, `one screenshot under the server's 1.5 MB (${img.length})`);
    assert.deepEqual([...img.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG');
    assert(Buffer.byteLength(raw) <= 2 * 1024 * 1024, `the body under 2 MB (${Buffer.byteLength(raw)})`);
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.stop(); f.srv.close(); }
});

test('beta: the BETA button and the modal at 1280, 1600 and 390 px', async () => {
  const f = await fake();
  const s = await start(betaEnv(f));
  const b = await chromium.launch();
  try {
    for (const [width, height] of [[1280, 800], [1600, 1000], [390, 844]]) {
      const { page, ctx, errors } = await openPage(b, s.base, { width, height });
      const sel = width < 800 ? '#mBeta' : '#betaBtn', btn = page.locator(sel);
      await btn.waitFor();
      const r = await btn.boundingBox();
      assert(r.height >= 30 && r.width >= 60, `a bigger BETA button (${r.width}x${r.height})`);
      assert(r.x >= 0 && r.x + r.width <= width && r.y < 70, 'at the top, on screen');
      // nothing in the header overlaps it, and it sits at the right
      const hits = await page.evaluate((sel) => {
        const me = document.querySelector(sel), m = me.getBoundingClientRect();
        return [...me.parentElement.children].filter((e) => e !== me && e.checkVisibility()).map((e) => [e.id || e.className, e.getBoundingClientRect()])
          .filter(([, o]) => o.width && o.left < m.right - 1 && o.right > m.left + 1 && o.top < m.bottom - 1 && o.bottom > m.top + 1).map(([n]) => n);
      }, sel);
      assert.deepEqual(hits, [], `nothing covers the BETA button at ${width}px`);
      assert(r.x > width / 2, `on the right at ${width}px`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `beta-button-${width}.png`), clip: { x: 0, y: 0, width, height: Math.min(140, height) } });
      await btn.click();
      await page.locator('.prp').waitFor();
      await ready(page);
      const box = await page.locator('.prp').boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width + 0.5 && box.y >= 0, `the modal fits ${width}px`);
      const over = await page.evaluate(() => document.querySelector('.prp').scrollWidth - document.querySelector('.prp').clientWidth);
      assert(over <= 0, `no sideways scroll in the modal at ${width}px`);
      if (width < 800) { await shot(page, 'modal-phone.png'); await page.locator('.prp').evaluate((e) => { e.scrollTop = e.scrollHeight; }); await shot(page, 'modal-phone-bottom.png'); }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await b.close(); s.stop(); f.srv.close(); }
});

test('beta: an ultra-private chat sends nothing', async () => {
  const f = await fake();
  const s = await start(betaEnv(f));
  const b = await chromium.launch();
  try {
    const { page } = await openPage(b, s.base);
    await page.locator('#privBtn').click();
    await sleep(400);
    // one private turn held on the server (the model is a stand-in that fails; the turn is held first)
    const said = await page.evaluate(() => fetch('/api/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ private: true, messages: [{ role: 'user', content: 'a private question' }] }), signal: AbortSignal.timeout(8000) }).then((r) => r.status, (e) => e.name));
    console.log(`private turn answered ${said}`);
    await page.locator('#betaBtn').click();
    await page.getByText('Reports are off in an ultra-private chat').waitFor();
    assert.equal(await page.locator('.prp [data-send], #prpConv').count(), 0, 'no send choice');
    const codes = await page.evaluate(async () => [
      (await fetch('/api/v1/beta-report')).status,
      (await fetch('/api/v1/beta-report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'sneak' }) })).status,
    ]);
    assert.deepEqual(codes, [409, 409], 'the server refuses too');
    assert.equal(f.got.length, 0, 'nothing reached the team');
  } finally { await b.close(); s.stop(); f.srv.close(); }
});

test('beta: a report address that is not https is refused', async () => {
  const f = await fake();
  const s = await start(betaEnv(f, { NEXY_BETA_REPORT_URL: 'http://reports.example.com/beta/report' }));
  try {
    const r = await fetch(`${s.base}/api/v1/beta-report`);
    assert.equal((await r.json()).ready, false, 'not ready over plain http');
    const p = await fetch(`${s.base}/api/v1/beta-report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }) });
    assert.equal(p.status, 503, 'and nothing is sent');
    assert.equal(f.got.length, 0);
  } finally { s.stop(); f.srv.close(); }
});

test('not a beta: no badge, no send choice, no route', async () => {
  const f = await fake();
  const s = await start({ NEXY_BETA_REPORT_URL: `${f.base}/beta/report`, NEXY_INSTALL_KEY: KEY });
  const b = await chromium.launch();
  try {
    const { page, errors } = await openPage(b, s.base);
    assert.equal(await page.locator('html').getAttribute('data-beta'), null);
    assert.equal(await page.locator('#betaBtn, #mBeta').count(), 0, 'no BETA badge');
    await page.locator('#reportBtn').click();
    await page.locator('#prpText').waitFor();
    assert.equal(await page.locator('#prpConv, [data-save]').count(), 0, 'no send choice');
    assert.match(await page.locator('.prp').innerText(), /never sent anywhere else/);
    const codes = await page.evaluate(async () => [
      (await fetch('/api/v1/beta-report')).status,
      (await fetch('/api/v1/beta-report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }) })).status,
    ]);
    assert.deepEqual(codes, [404, 404]);
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(300);
    assert.equal(await page.locator('#mBeta').count(), 0, 'no badge on a phone either');
    assert.equal(f.got.length, 0);
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.stop(); f.srv.close(); }
});
