// An image that takes 50 s on an Own1 (a cold model): one request, a countdown that says when it
// runs past the usual time, and no Try again anywhere until the job has really failed. A studio
// that says it is busy is waited for; a studio that fails gets Try again.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/slow-image.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a 64x64 colour gradient: passes the blank and noise checks
function png() {
  const w = 64, h = 64, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x * 4; raw[o + 1] = y * 4; raw[o + 2] = 128; }
  }
  const crc = (b) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

// the image studio: each POST answers as the next plan entry says
function studio(plan) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', async () => {
      if (req.url !== '/api/generate') return res.writeHead(404).end();
      const step = plan[Math.min(calls.length, plan.length - 1)];
      calls.push(Date.now());
      await sleep(step.ms);
      if (step.status) return res.writeHead(step.status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: step.error ?? 'busy' }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ image_b64: png() }));
    });
  });
  srv.requestTimeout = 0; srv.headersTimeout = 0;
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, calls, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(imagesUrl) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-slowimg-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_IMAGES_URL: imagesUrl }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

async function open(b, base, usualMs) {
  const ctx = await b.newContext();
  // the usual image time on this machine, as earlier images measured it
  await ctx.addInitScript((ms) => { localStorage.setItem('nexy.eta.image', JSON.stringify([ms])); }, usualMs);
  const page = await ctx.newPage();
  await page.goto(base + '/');
  await page.locator('#input').waitFor({ timeout: 20000 });
  await page.locator('#input').fill('generate an image of a lighthouse at dusk');
  await page.locator('#input').press('Enter');
  return page;
}

// "Try again" anywhere a person could see or hover it, the reply's own actions included
const tryAgain = (page) => page.evaluate(() => {
  const vis = (e) => { const s = getComputedStyle(e); return e.getClientRects().length > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const said = /try(ing)? again/i.test(document.querySelector('#thread')?.innerText ?? '') || /try(ing)? again/i.test(document.querySelector('.gen .gs')?.textContent ?? '');
  const btn = [...document.querySelectorAll('#thread .msg.ai [title="Try again"], #thread [data-retry]')].some(vis);
  return said || btn;
});

test('a 50 s image: one request, past the usual time said plainly, never Try again until it is done', { timeout: 150000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const st = await studio([{ ms: 50000 }]);
  const s = await start(st.url);
  const b = await chromium.launch();
  try {
    const page = await open(b, s.base, 20000);
    const t0 = Date.now();
    let longer = false;
    while (Date.now() - t0 < 70000) {
      // done: the finished reply has its own actions, as every reply does
      if (await page.getByText(/^Done\. It is/).count()) break;
      assert.equal(await tryAgain(page), false, `Try again shown at ${Math.round((Date.now() - t0) / 1000)} s`);
      const line = await page.locator('#thread .msg.ai .wait .wt').last().textContent().catch(() => '');
      if (/taking longer than usual/.test(line ?? '')) longer = true;
      await sleep(1000);
    }
    assert.ok(await page.getByText(/^Done\. It is/).count(), 'the image arrived');
    assert.ok(longer, 'past the usual 20 s the countdown says it is taking longer than usual');
    assert.equal(st.calls.length, 1, 'one request to the studio');
  } finally { await b.close(); s.p.kill(); st.srv.close(); }
});

test('a busy studio is waited for without Try again; a failing one gets Try again', { timeout: 120000 }, async () => {
  const st = await studio([{ ms: 100, status: 503 }, { ms: 2000 }]);
  const s = await start(st.url);
  const b = await chromium.launch();
  try {
    const page = await open(b, s.base, 20000);
    await page.getByText(/busy on this machine\. Waiting/).first().waitFor({ timeout: 15000 });
    assert.equal(await tryAgain(page), false);
    await page.getByText(/^Done\. It is/).waitFor({ timeout: 40000 });
    assert.equal(st.calls.length, 2);
  } finally { await b.close(); s.p.kill(); st.srv.close(); }

  const bad = await studio([{ ms: 500, status: 500, error: 'the image engine crashed' }]);
  const s2 = await start(bad.url);
  const b2 = await chromium.launch();
  try {
    const page = await open(b2, s2.base, 20000);
    await page.locator('#thread [data-retry]').waitFor({ timeout: 20000 });
    assert.equal(bad.calls.length, 1, 'a real failure is not asked again on its own');
  } finally { await b2.close(); s2.p.kill(); bad.srv.close(); }
});
