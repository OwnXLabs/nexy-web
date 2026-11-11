// Beta builds: "Send to the Nexy team" against a fake report server. What the preview shows is
// what arrives, keys and tokens are gone, an ultra-private chat sends nothing, and a build that
// isn't a beta shows no badge and no send choice. Run after `npm run build`:
//   PLAYWRIGHT_MODULE=<path to playwright> node --test tests/beta-report.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = 'a1'.repeat(32);
const TAIL = 'tailtok0123456789';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
// what the app's logs might hold; every secret here must be gone from what is sent
const LOGS = ['engine ready on 127.0.0.1:5000', 'GET /?nexy-key=0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f 200', 'NEXY_ENGINE_KEY=logsecret1 port=5000',
  'Authorization: Bearer logsecret2abc', '{"password":"logsecret3"}', 'Cookie: nexy_owner=logsecret4', 'model loaded in 2.1s'].join('\n');
const SECRETS = ['logsecret1', 'logsecret2', 'logsecret3', 'logsecret4', '0f0f0f0f0f0f0f0f', 'typedsecret', 'sk-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6q7', 'consolesecret', 'querysecret', KEY];

// stands in for update.ownx.co/beta/report, the desktop app's log tail and the model
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

const betaEnv = (f) => ({ NEXY_BETA: '1', NEXY_BETA_REPORT_URL: `${f.base}/beta/report`, NEXY_INSTALL_KEY: KEY, NEXY_LOG_TAIL_URL: `${f.base}/${TAIL}`, NEXY_APP_VERSION: '0.2.3', NEXY_LLM_URL: f.base });

async function openPage(b, base) {
  const page = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/');
  await page.locator('#input').waitFor({ timeout: 20000 });
  return { page, errors };
}

test('beta: the preview is exactly what the team receives, with keys and tokens removed', async () => {
  const f = await fake();
  const s = await start(betaEnv(f));
  const b = await chromium.launch();
  try {
    const { page, errors } = await openPage(b, s.base);
    assert.equal(await page.locator('html').getAttribute('data-beta'), '1');
    await page.evaluate(() => { console.error('upload failed, token=consolesecret9'); return fetch('/api/v1/broken?key=querysecret').catch(() => {}); });
    await page.locator('#betaBtn').click();
    await page.fill('#prpText', 'Share did nothing. password: typedsecret and sk-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6q7');
    const chooser = page.waitForEvent('filechooser');
    await page.click('[data-shot]');
    await (await chooser).setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForSelector('.shot img:not([hidden])');
    await page.check('#prpTeam');
    await page.locator('.team').waitFor({ state: 'visible' });
    await page.fill('#prpEmail', 'tester@example.com');
    assert.equal(await page.locator('[data-send]').textContent(), 'Save and send');
    const what = await page.locator('#prpWhat').innerText();
    assert.match(what, /Not this conversation/);
    assert.match(what, /The screenshot/);
    assert.match(what, /tester@example.com/);
    const preview = JSON.parse(await page.locator('#prpPreview').textContent());
    await page.click('[data-send]');
    await page.getByText('Sent. Reference NXR-7Q2F. A copy is kept on this computer.').waitFor({ timeout: 10000 });

    assert.equal(f.got.length, 1, 'one report sent');
    const [{ headers, raw, body }] = f.got;
    assert.equal(headers['x-install'], KEY, 'the install key rides in a header');
    assert.match(preview.screenshot, /^\[screenshot, \d+ KB\]$/);
    assert.match(body.screenshot, /^data:image\/jpeg;base64,/);
    assert.deepEqual({ ...body, screenshot: preview.screenshot }, preview, 'what arrived is what the preview showed');
    for (const k of ['kind', 'text', 'app', 'version', 'os', 'errors', 'requests', 'logs', 'email', 'screenshot']) assert(k in body, `body has ${k}`);
    assert.equal(body.conversation, undefined, 'no conversation unless ticked');
    assert.equal(body.version, '0.2.3');
    assert.equal(body.email, 'tester@example.com');
    assert(body.requests.some((r) => r.url === '/api/v1/broken' && r.status === 404), 'failed request, no query string');
    assert(body.errors.some((e) => /upload failed, token=\[removed\]/.test(e.msg)), 'console error, token removed');
    assert.match(body.logs, /engine ready on 127\.0\.0\.1:5000/);
    assert.match(body.logs, /model loaded in 2\.1s/);
    assert.match(body.text, /^Share did nothing\. password: \[removed\]/);
    for (const x of SECRETS) assert(!raw.includes(x), `"${x}" was not sent`);
    const local = fs.readdirSync(path.join(s.data, 'reports')).filter((n) => n.endsWith('.json'));
    assert.equal(local.length, 1, 'a copy kept on this computer');
    assert.deepEqual(errors, []);
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
    assert.equal(await page.locator('#prpTeam').count(), 0, 'no send choice');
    const codes = await page.evaluate(async () => [
      (await fetch('/api/v1/beta-report')).status,
      (await fetch('/api/v1/beta-report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'sneak' }) })).status,
    ]);
    assert.deepEqual(codes, [409, 409], 'the server refuses too');
    assert.equal(f.got.length, 0, 'nothing reached the team');
  } finally { await b.close(); s.stop(); f.srv.close(); }
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
    assert.equal(await page.locator('#prpTeam').count(), 0, 'no send choice');
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
