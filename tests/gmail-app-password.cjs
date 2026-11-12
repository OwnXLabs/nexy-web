// Settings > Connections > Gmail (app password), in WebKit, against a stand-in connector hub: the
// three steps, a password field that is not remembered, the password sent once to the hub and
// kept nowhere in the browser, Gmail's refusal in plain words, then Pause, Resume and Disconnect
// with the note to remove it in the Google account too.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/gmail-app-password.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOWN = 'abcd wxyz efgh mnop';

// the hub's registry, as nexy-connect answers it
function hub() {
  const st = { stored: false, granted: false, posts: [] };
  const entry = () => ({ id: 'gmail-imap', label: 'Gmail (app password)', transport: 'http', enabled: true, egress: ['imap.gmail.com:993'], auth: { type: 'app_password', credentialStored: st.stored } });
  const srv = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/registry/catalog') return send(200, { entries: [entry()] });
    if (p === '/registry/catalog/gmail-imap') return send(200, entry());
    if (p === '/registry/grants/nexy') return send(200, { app: 'nexy', entries: st.granted ? ['gmail-imap'] : [] });
    if (p === '/registry/grants/nexy/gmail-imap') { st.granted = req.method === 'POST'; return send(200, { app: 'nexy', entries: st.granted ? ['gmail-imap'] : [] }); }
    if (p === '/registry/app-password/gmail-imap') {
      if (req.method === 'DELETE') { st.stored = false; return send(200, { id: 'gmail-imap', credentialStored: false, revokeAt: 'https://myaccount.google.com/apppasswords' }); }
      const b = JSON.parse(raw);
      st.posts.push({ as: u.searchParams.get('as'), ...b });
      if (b.password !== SHOWN) return send(400, { error: "Gmail didn't accept that app password. Check the address and the 16 characters, or create a new one at https://myaccount.google.com/apppasswords.", connected: false });
      st.stored = true; st.granted = true;
      return send(200, { entry: 'gmail-imap', connected: true });
    }
    if (p === '/connectors/google') return send(404, { error: 'no such route' });
    send(404, { error: `no such route ${p}` });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ st, base: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-gmail-ap-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

test('Gmail (app password): steps, connect, refusal, pause, resume, disconnect; the password kept nowhere here', { timeout: 120000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const h = await hub();
  const s = await start({ NEXY_STUDIOS: 'off', NEXY_HUB_URL: h.base, NEXY_AGENT_URL: 'http://127.0.0.1:9', NEXY_AGENT_KEY: 'k' });
  const b = await webkit.launch();
  try {
    const page = await b.newPage();
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    await page.locator('#profileBtn').click();
    await page.locator('#settingsBtn').click();
    await page.locator('#ovSet [data-sec="connections"]').click();
    const card = page.locator('#ovSet .srow', { hasText: 'Gmail (app password)' });
    await card.waitFor({ timeout: 10000 });
    const steps = await card.innerText();
    assert.match(steps, /1\. Turn on 2-Step Verification[^]*2\. Create an app password at myaccount\.google\.com\/apppasswords[^]*3\. Paste it here/);
    assert.equal(await card.locator('a[href="https://myaccount.google.com/apppasswords"]').count(), 1);
    const pass = card.locator('#apPass');
    assert.equal(await pass.getAttribute('type'), 'password');
    assert.equal(await pass.getAttribute('autocomplete'), 'off');
    assert.equal(await card.locator('#apEmail').getAttribute('autocomplete'), 'off');

    // a wrong one: Gmail's answer in plain words, nothing connected
    await card.locator('#apEmail').fill('owner@example.com');
    await pass.fill('zzzz zzzz zzzz zzzz');
    await card.locator('[data-act="apon"]').click();
    // it stays on the card until the field is edited (QA 2026-11-12: a toast, gone in 3 s)
    const note = card.locator('#apNote');
    await note.filter({ hasText: "Gmail didn't accept that app password" }).waitFor({ timeout: 10000 });
    assert.equal(await note.getAttribute('role'), 'alert');
    await sleep(4500);
    assert.match(await note.innerText(), /^Gmail didn't accept that app password/, 'still there after the toast would have gone');
    await pass.fill('zzzz zzzz zzzz zzz');
    assert.equal(await note.isVisible(), false, 'cleared when the owner edits the password');

    await pass.fill(SHOWN);
    await card.locator('[data-act="apon"]').click();
    const row = page.locator('#ovSet .srow', { hasText: 'Gmail (app password)' });
    await row.locator('.connected').waitFor({ timeout: 10000 });
    assert.deepEqual(h.st.posts.at(-1), { as: 'nexy', email: 'owner@example.com', password: SHOWN }, 'sent once, straight to the hub');
    assert.equal(h.st.posts.length, 2);
    const kept = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie, document.documentElement.outerHTML]));
    for (const form of [SHOWN, 'abcdwxyzefghmnop', 'zzzz zzzz']) assert(!kept.includes(form), `the browser keeps no copy (${form})`);

    await row.locator('[data-act="pause"]').click();
    await page.locator('#ovSet .srow', { hasText: 'Gmail (app password)' }).locator('.paused').waitFor({ timeout: 10000 });
    assert.equal(h.st.granted, false);
    await page.locator('#ovSet .srow', { hasText: 'Gmail (app password)' }).locator('[data-act="resume"]').click();
    await page.locator('#ovSet .srow', { hasText: 'Gmail (app password)' }).locator('.connected').waitFor({ timeout: 10000 });
    assert.equal(h.st.granted, true);

    await page.locator('#ovSet .srow', { hasText: 'Gmail (app password)' }).locator('[data-act="apoff"]').click();
    await page.locator('#toast', { hasText: 'myaccount.google.com/apppasswords' }).waitFor({ timeout: 10000 });
    assert.match(dialogs.at(-1) ?? '', /Also remove it in your Google account at myaccount\.google\.com\/apppasswords/);
    assert.equal(h.st.stored, false);
    await page.locator('#ovSet .srow', { hasText: 'Gmail (app password)' }).locator('#apPass').waitFor({ timeout: 10000 });
  } finally { await b.close(); s.p.kill(); h.close(); }
});
