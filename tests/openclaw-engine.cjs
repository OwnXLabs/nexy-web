// OpenClaw as the third agent engine, in the browser: Settings lists Hermes, Nexy Engine and
// OpenClaw; the pick survives a reload; a chat is answered by OpenClaw (via=openclaw); memory and
// routine controls are not offered for it, and nothing asks it for sessions it does not have.
// A slow first turn shows that it is getting ready; a 500 after a restart is asked again once;
// a gateway that stays broken gives way to the plain model.
// Stand-in gateways only. Run after `npm run build`: node --test tests/openclaw-engine.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { openclawStandin } = require('./standins/openclaw.cjs');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'oc-browser-token-456';

// a Hermes-style gateway: chat, sessions and jobs
function gateway(name) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      seen.push(req.url);
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/v1/chat/completions')) res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `answer from ${name}` }, finish_reason: 'stop' }] }));
      else if (req.url.startsWith('/api/sessions')) res.end(JSON.stringify({ data: [] }));
      else if (req.url.startsWith('/api/jobs')) res.end(JSON.stringify({ jobs: [] }));
      else res.end('{}');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, log: () => log }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start\n' + log);
}

test('OpenClaw in Settings and in chat: listed, kept across a reload, answers, no memory controls, no session calls', { timeout: 150000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const hermes = await gateway('hermes'), nexy = await gateway('nexy-engine'), oc = await openclawStandin({ token: TOKEN });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-openclaw-'));
  const keyFile = path.join(data, 'openclaw.key'); fs.writeFileSync(keyFile, TOKEN + '\n', { mode: 0o600 });
  const s = await start({
    NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_SCREEN: 'none',
    NEXY_AGENT_URL: hermes.url, NEXY_AGENT_KEY: 'hermes-key',
    NEXY_ENGINES: 'nexy-engine,openclaw', NEXY_ENGINE_NEXY_ENGINE_URL: nexy.url, NEXY_ENGINE_NEXY_ENGINE_KEY: 'nexy-key',
    NEXY_ENGINE_OPENCLAW_URL: oc.url, NEXY_ENGINE_OPENCLAW_KEY_FILE: keyFile,
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const pageText = []; page.on('response', async (r) => { if (r.url().includes('/api/')) pageText.push(await r.text().catch(() => '')); });
    const settings = async (sec) => {
      if (!(await page.locator('#ovSet.open').count())) { await page.locator('#profileBtn').click(); await page.locator('#settingsBtn').click(); }
      await page.locator(`#ovSet [data-sec="${sec}"]`).click();
      await sleep(500);
    };
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    await settings('nexy');
    const engine = page.locator('#ovSet select[data-engine]');
    assert.deepEqual(await engine.locator('option').allInnerTexts(), ['Hermes', 'Nexy Engine', 'OpenClaw'], 'three engines');
    assert.equal(await engine.inputValue(), 'hermes');
    assert.equal(await page.locator('#ovSet [data-act="mem"]').count(), 1, 'Hermes keeps memory: offered');

    await engine.selectOption('openclaw');
    await page.waitForFunction(() => document.querySelector('#ovSet select[data-engine]')?.value === 'openclaw' && /keeps no memory/.test(document.querySelector('#setBody')?.textContent || ''));
    const nexyText = await page.locator('#setBody').innerText();
    assert.match(nexyText, /This engine keeps no memory Nexy can show/);
    assert.equal(await page.locator('#ovSet [data-act="mem"], #ovSet [data-act="routines"]').count(), 0, 'no memory or routine buttons for OpenClaw');
    await settings('security');
    assert.equal(await page.locator('#ovSet [data-act="forget"]').count(), 0, 'no Forget button for OpenClaw');

    // the pick survives a reload
    await page.reload();
    await page.locator('#input').waitFor({ timeout: 20000 });
    await settings('nexy');
    assert.equal(await page.locator('#ovSet select[data-engine]').inputValue(), 'openclaw', 'kept across a reload');
    assert.equal(await page.locator('#ovSet [data-act="mem"]').count(), 0);
    await page.locator('#ovSet [data-close]').click();

    // a chat goes to OpenClaw
    await page.fill('#input', 'what is two plus two');
    await page.press('#input', 'Enter');
    await page.waitForFunction(() => /answer from openclaw to what is two plus two/.test(document.querySelector('#thread')?.textContent || ''), null, { timeout: 30000 });
    const r = await page.evaluate(async () => (await fetch('/api/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: 'oc-chat-1', messages: [{ role: 'user', content: 'and three plus three' }] }) })).json());
    assert.equal(r.via, 'openclaw');
    assert.match(r.choices[0].message.content, /answer from openclaw to and three plus three/);
    assert.match(r.upstream, /OpenClaw/);
    assert.match(r.upstream, /memory is not kept by Nexy/, 'the upstream says Nexy keeps no memory for it');
    const chats = oc.seen.filter((x) => x.path === '/v1/chat/completions');
    assert(chats.length >= 2 && chats.every((x) => x.auth === `Bearer ${TOKEN}` && /^nexy-[A-Za-z0-9_-]+$/.test(x.session) && x.body.user === x.session && x.body.model === 'openclaw/default'));

    // asked in chat, memory is said to be not kept, never shown as a failure
    await page.fill('#input', 'what do you remember');
    await page.press('#input', 'Enter');
    await page.waitForFunction(() => /keeps no memory Nexy can show/.test(document.querySelector('#thread')?.textContent || ''), null, { timeout: 15000 });
    assert.doesNotMatch(await page.locator('#thread').innerText(), /did not work/);
    const mem = await page.evaluate(async () => { const x = await fetch('/api/v1/memory'); return { status: x.status, body: await x.json() }; });
    assert.equal(mem.status, 200);
    assert.equal(mem.body.available, false);

    assert(!oc.seen.some((x) => x.path.startsWith('/api/')), `nothing asked OpenClaw for sessions or jobs: ${oc.seen.map((x) => x.path).join(', ')}`);
    assert(!hermes.seen.some((x) => x.startsWith('/v1/chat')) && !nexy.seen.some((x) => x.startsWith('/v1/chat')), 'the other engines got no chat');
    assert(!pageText.some((t) => t.includes(TOKEN)), 'the token never reaches the browser');
    assert(!s.log().includes(TOKEN), 'the token is never logged');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); s.p.kill(); hermes.srv.close(); nexy.srv.close(); oc.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('a slow first turn says OpenClaw is getting ready, then answers; a restart\'s 500 is asked again; a broken gateway gives way to the plain model', { timeout: 150000 }, async () => {
  const oc = await openclawStandin({ token: TOKEN, delayMs: 5000 });
  const llm = await gateway('the plain model');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-openclaw-'));
  const keyFile = path.join(data, 'openclaw.key'); fs.writeFileSync(keyFile, TOKEN + '\n', { mode: 0o600 });
  // OpenClaw is the only agent here, so every chat goes to it
  const s = await start({
    NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_SCREEN: 'none', NEXY_LLM_URL: llm.url,
    NEXY_ENGINES: 'openclaw', NEXY_ENGINE_OPENCLAW_URL: oc.url, NEXY_ENGINE_OPENCLAW_KEY_FILE: keyFile,
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    const t0 = Date.now();
    await page.fill('#input', 'a slow question');
    await page.press('#input', 'Enter');
    const last = page.locator('#thread .msg.ai').last();
    await last.locator('.wait').waitFor({ timeout: 2000 });
    assert.doesNotMatch(await last.innerText(), /answer from openclaw/, 'still waiting');
    await page.waitForFunction(() => [...document.querySelectorAll('#thread .msg.ai .wait .wl')].some((w) => w.textContent === 'OpenClaw is getting ready\u2026'), null, { timeout: 5000 });
    assert(Date.now() - t0 < 5000, 'said before the reply came');
    await page.waitForFunction(() => /answer from openclaw to a slow question/.test(document.querySelector('#thread')?.textContent || ''), null, { timeout: 20000 });
    assert(Date.now() - t0 >= 5000, 'the reply came after the delay');
    assert.equal(await last.locator('.wait').count(), 0, 'the waiting line is gone once it answers');

    oc.state.fail500 = 1;
    const ask = (text) => page.evaluate(async (text) => (await fetch('/api/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: 'oc-chat-2', messages: [{ role: 'user', content: text }] }) })).json(), text);
    const before = oc.seen.length;
    const again = await ask('after a restart');
    assert.equal(again.via, 'openclaw');
    assert.match(again.choices[0].message.content, /answer from openclaw to after a restart/);
    assert.equal(oc.seen.length - before, 2, 'asked once more after the 500');

    oc.state.fail500 = 2;
    const fell = await ask('while it is broken');
    assert.equal(fell.fallback, true);
    assert.match(fell.choices[0].message.content, /answer from the plain model/);
    assert(llm.seen.some((p) => p.startsWith('/v1/chat')), 'the plain model answered');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); s.p.kill(); oc.close(); llm.srv.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
});
