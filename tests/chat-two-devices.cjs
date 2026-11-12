// Two devices on one chat: a phone left open on an older copy must never save it over
// turns the Mac added since (QA 2026-11-12: New chat on the phone erased the Mac's answer).
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/chat-two-devices.cjs
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

// answers each question with its own marker
function model() {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: 'Shop plan' }, finish_reason: 'stop' }] })); }
      const q = [...b.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      const tag = (q.match(/\b(ONE|TWO|THREE|FOUR)\b/) ?? ['NONE'])[0];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `Answer ${tag} done.` }, finish_reason: null }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(port, data, llm) {
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'local', NEXY_LLM_URL: llm }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

// the saved chat, as on disk
function saved(data) {
  const root = path.join(data, 'chats');
  for (const o of fs.readdirSync(root)) for (const f of fs.readdirSync(path.join(root, o)))
    if (f.endsWith('.json')) return JSON.parse(fs.readFileSync(path.join(root, o, f), 'utf8'));
  return null;
}
async function ask(page, text, tag) {
  await page.locator('#input').fill(text);
  await page.locator('#input').press('Enter');
  await page.getByText(`Answer ${tag} done.`).waitFor({ timeout: 20000 });
}
const until = async (f, what) => { for (let i = 0; i < 60; i++) { if (f()) return; await sleep(150); } assert.fail(what); };

test('a phone on an older copy never saves over the Mac\'s newer turns', { timeout: 120000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const m = await model();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-two-devices-'));
  const s = await start(20000 + Math.floor(Math.random() * 20000), data, m.url);
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext();
    const errors = [];
    const mac = await ctx.newPage(); mac.on('pageerror', (e) => errors.push(e.message));
    await mac.goto(s.base + '/');
    await mac.locator('#input').waitFor({ timeout: 20000 });
    await ask(mac, 'Plan ONE for the shop', 'ONE');
    await until(() => /Answer ONE/.test(JSON.stringify(saved(data)?.history ?? [])), 'the first turn is saved');

    // the phone opens the chat, then sits there
    const phone = await ctx.newPage(); phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(s.base + '/');
    await phone.getByText('Answer ONE done.').waitFor({ timeout: 20000 });

    // the Mac carries on
    await ask(mac, 'Plan TWO for the shop', 'TWO');
    await until(() => /Answer TWO/.test(JSON.stringify(saved(data)?.history ?? [])), 'the second turn is saved');

    // the phone leaves the chat: it changed nothing, so it saves nothing
    await phone.locator('#newChat').click();
    await sleep(1500);
    assert.match(JSON.stringify(saved(data).history), /Answer TWO/, 'the Mac\'s turn is still there after New chat on the phone');

    // the Mac adds another turn; the phone reopens the chat from its list and sees it
    const first = saved(data).id;
    await ask(mac, 'Plan FOUR for the shop', 'FOUR');
    await until(() => /Answer FOUR/.test(JSON.stringify(saved(data)?.history ?? [])), 'the fourth turn is saved');
    await phone.locator(`[data-chat="${first}"]`).first().click();
    await phone.getByText('Answer FOUR done.').waitFor({ timeout: 15000 });

    // the phone, still on its old copy, asks something: refused, and it offers the newer copy
    const old = await ctx.newPage(); old.on('pageerror', (e) => errors.push(e.message));
    await old.goto(s.base + '/');
    await old.getByText('Answer FOUR done.').waitFor({ timeout: 20000 });
    await ask(mac, 'Plan THREE for the shop', 'THREE');
    await until(() => /Answer THREE/.test(JSON.stringify(saved(data)?.history ?? [])), 'the third turn is saved');
    await old.locator('#input').fill('Plan ONE again');
    await old.locator('#input').press('Enter');
    await old.getByText('This chat changed on another device.').waitFor({ timeout: 20000 });
    assert.match(JSON.stringify(saved(data).history), /Answer THREE/, 'the stale copy did not overwrite the Mac\'s turn');
    await old.getByRole('button', { name: 'Show latest' }).click();
    await old.getByText('Answer THREE done.').waitFor({ timeout: 20000 });

    // a chat started on the Mac shows on the phone when the phone comes back on screen
    await mac.locator('#newChat').click();
    await ask(mac, 'Plan THREE for the market stall', 'THREE');
    await until(() => fs.readdirSync(path.join(data, 'chats', fs.readdirSync(path.join(data, 'chats'))[0])).filter((f) => f.endsWith('.json')).length === 2, 'the second chat is saved');
    await sleep(5200);
    const count = () => old.evaluate(() => (document.body.innerText.match(/Shop plan/g) ?? []).length);
    const before = await count();
    await old.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    for (let i = 0; i < 40 && (await count()) === before; i++) await sleep(150);
    assert.equal(await count(), before + 1, 'the new chat is in the phone\'s list');
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.p.kill(); m.srv.close(); fs.rmSync(data, { recursive: true, force: true }); }
});
