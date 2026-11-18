// Images on a shared Own 1 (a guest code, or a device paired for AI only). The app gives the router's
// door to that Own 1 as NEXY_SHARED_IMAGES_URL; Nexy offers images, asks there once per image (counted
// there like chat), shows the picture as a local one, and says a refusal (the daily limit) in its own
// words. "Make images on this Mac" never shows on a shared Own 1, and a bare description becomes an
// image only right after one.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/guest-images.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const DAILY = "You've used today's requests on the shared Own 1. They reset tomorrow, or ask its owner for a new code.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (srv) => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${srv.address().port}`)));

// a 64x64 colour gradient: passes the blank and noise checks
function png() {
  const w = 64, h = 64, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = x * 4; raw[o + 1] = y * 4; raw[o + 2] = 128; }
  const crc = (b) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

// the router's door to the shared Own 1: chat answers, images counted; `refuse` answers as the router does
async function door() {
  const s = { images: [], chats: 0, refuse: null };
  const srv = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      s.images.push(JSON.parse(raw || '{}'));
      if (s.refuse) return send(s.refuse[0], { error: { message: s.refuse[1], type: 'router' } });
      return send(200, { created: 1, data: [{ b64_json: png() }] });
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') { s.chats++; return send(200, { choices: [{ message: { content: 'Hello from the shared Own 1.' }, finish_reason: 'stop' }] }); }
    if (req.url === '/v1/models') return send(200, { data: [{ id: 'txt2txt' }] });
    send(404, {});
  });
  s.url = await listen(srv);
  s.close = () => srv.close();
  return s;
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-guestimg-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data,
    NEXY_BOX_FEATURES: 'open', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'local', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { await fetch(base + '/api/v1/health'); return { base, stop: () => { p.kill(); fs.rmSync(data, { recursive: true, force: true }); } }; }
    catch { await sleep(150); }
  }
  p.kill(); throw new Error('server did not start');
}

async function open(b, base) {
  const page = await b.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/');
  await page.locator('#input').waitFor({ timeout: 20000 });
  await page.locator('#emptyState.home .t').waitFor({ timeout: 20000 });
  return { page, errors };
}
const say = async (page, text) => { await page.locator('#input').fill(text); await page.locator('#input').press('Enter'); };
const replies = (page) => page.locator('#thread .msg.ai .bub').allInnerTexts();
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(200); } return false; };

let d, b;
test.before(async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  d = await door();
  b = await chromium.launch();
});
test.after(async () => { await b?.close(); d?.close(); });

test('a guest makes an image on the shared Own 1: offered, asked once there, shown like a local one; a bare description only right after', { timeout: 120000 }, async () => {
  const s = await start({ NEXY_OWN1_GUEST: '1', NEXY_OWN1_GUEST_ON: "John's Own 1", NEXY_LLM_URL: d.url, NEXY_SHARED_IMAGES_URL: d.url });
  try {
    const { page, errors } = await open(b, s.base);
    assert.match(await page.locator('html').getAttribute('data-apps'), /\bimages\b/);
    const hello = await page.locator('#emptyState.home .t').innerText();
    assert.match(hello, /make images, using John's Own 1 as a guest/, hello);
    assert.ok(await page.locator('#emptyState [data-sug="Make an image"]').count(), 'a Make an image chip');
    // no image just before: a bare description is chat
    d.images = []; d.chats = 0;
    await say(page, 'a small red bicycle');
    assert.ok(await until(async () => d.chats > 0), 'went to chat');
    await sleep(500);
    assert.equal(d.images.length, 0, 'no image without an image ask');
    // the chip asks what to show; the description that follows is the image
    await say(page, 'Make an image');
    await page.getByText(/What should the image show\?/).waitFor({ timeout: 15000 });
    await say(page, 'a small red bicycle');
    await page.getByText(/^Done\. It is .*made on John's Own 1/).waitFor({ timeout: 30000 });
    assert.equal(d.images.length, 1, 'one request to the shared Own 1');
    assert.equal(d.images[0].model, 'txt2img');
    assert.match(d.images[0].prompt, /small red bicycle/);
    assert.equal(d.images[0].response_format, 'b64_json');
    const src = await page.locator('.img img').first().getAttribute('src');
    assert.match(src, /^data:image\/png;base64,/, 'the picture shows in the work pane');
    // right after an image, another description is the next image
    await say(page, 'now a blue one');
    assert.ok(await until(async () => d.images.length === 2, 30000), 'the next description is an image');
    const all = (await replies(page)).join('\n');
    assert.doesNotMatch(all, /on this (Mac|PC)|Make images on this|Nexy Home|privately/i);
    assert.deepEqual(errors, []);
  } finally { s.stop(); }
});

test('a refusal from the shared Own 1 (the daily limit) is said in its own words, asked once, no JSON or code', { timeout: 90000 }, async () => {
  const s = await start({ NEXY_OWN1_GUEST: '1', NEXY_OWN1_GUEST_ON: "John's Own 1", NEXY_LLM_URL: d.url, NEXY_SHARED_IMAGES_URL: d.url });
  try {
    const { page } = await open(b, s.base);
    d.images = []; d.refuse = [429, DAILY];
    await say(page, 'make an image of a lighthouse at dusk');
    await page.getByText(DAILY).first().waitFor({ timeout: 20000 });
    await sleep(1500);
    assert.equal(d.images.length, 1, 'not asked again on its own');
    const all = (await replies(page)).join('\n');
    assert.doesNotMatch(all, /\b429\b|[{}]|error/i, all);
    // the server says it as the router did, with its status
    const r = await fetch(s.base + '/api/v1/image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'a fox' }) });
    assert.equal(r.status, 429);
    assert.deepEqual(await r.json(), { error: 'refused', note: DAILY });
  } finally { s.stop(); d.refuse = null; }
});

test('a device paired for AI only: the same images, and the greeting names that Own 1, never "privately on this computer"', { timeout: 90000 }, async () => {
  const s = await start({ NEXY_OWN1_GUEST_ON: "Buri's Own 1", NEXY_LLM_URL: d.url, NEXY_SHARED_IMAGES_URL: d.url });
  try {
    const { page } = await open(b, s.base);
    const hello = await page.locator('#emptyState.home .t').innerText();
    assert.match(hello, /using Buri's Own 1\./, hello);
    assert.doesNotMatch(hello, /privately on this computer|as a guest|work with your apps/, hello);
    d.images = [];
    await say(page, 'an image of a cosy cabin in a snowy forest');
    await page.getByText(/^Done\. It is .*made on Buri's Own 1/).waitFor({ timeout: 30000 });
    assert.equal(d.images.length, 1);
  } finally { s.stop(); }
});

test('a guest with no image door: an image ask never says "on this Mac"; off a shared Own 1 the computer\'s words as before', { timeout: 90000 }, async () => {
  const g = await start({ NEXY_OWN1_GUEST: '1', NEXY_OWN1_GUEST_ON: "John's Own 1", NEXY_LLM_URL: d.url });
  const plain = await start({ NEXY_LLM_URL: d.url });
  try {
    let { page } = await open(b, g.base);
    assert.doesNotMatch(await page.locator('html').getAttribute('data-apps'), /\bimages\b/);
    await say(page, 'make an image of a lighthouse');
    await page.getByText(/Making images isn't available from John's Own 1/).waitFor({ timeout: 15000 });
    assert.doesNotMatch((await replies(page)).join('\n'), /on this (Mac|PC)|Nexy Home/);
    ({ page } = await open(b, plain.base));
    assert.match(await page.locator('#emptyState.home .t').innerText(), /privately on this computer/);
    await say(page, 'make an image of a lighthouse');
    await page.getByText(/Making images is off/).waitFor({ timeout: 15000 });
    const r = await fetch(plain.base + '/api/v1/image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'a fox' }) });
    assert.equal(r.status, 404, 'no image door off a shared Own 1');
  } finally { g.stop(); plain.stop(); }
});
