// Whole-box features (memory across chats, routines, the engine pick, speech on this computer) show
// only where the server allows them for this visitor (src/lib/box.ts). With NEXY_BOX_FEATURES unset,
// as on a public demo, no button leads to a refusal and a routine ask gets a plain sentence; with
// NEXY_BOX_FEATURES=open they show and work. The agent and the second engine are stand-ins.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/box-features.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const STANDINS = path.join(__dirname, 'standins');
const BOX_API = /\/api\/v1\/(?:routines|memory|engines|voice\/)/;
const ROUTINES_ELSEWHERE = /Routines need your own Nexy/;
const REMIND = 'remind me every day at 8 to count the stock';

// an agent with memory and routines; it records each chat turn it gets
function agent() {
  const turns = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/api/jobs')) return res.end(JSON.stringify({ jobs: [] }));
      if (req.url.startsWith('/api/sessions')) return res.end('{"data":[]}');
      if (req.url.startsWith('/v1/chat/completions')) {
        const said = [...JSON.parse(body).messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        turns.push(said);
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `Agent heard: ${said}` }, finish_reason: 'stop' }] }));
      }
      res.end('{}');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, turns, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-box-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, NEXY_EVAL: '', NEXY_BOX_FEATURES: '', HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { await fetch(base + '/api/v1/health'); return { p, base, data, log: () => log }; }
    catch (e) { if (e?.cause?.code !== 'ECONNREFUSED') throw e; await new Promise((r) => setTimeout(r, 150)); }
  }
  p.kill(); throw new Error('server did not start\n' + log);
}

// a computer with speech, two engines and an agent: every box feature would have something to show
const computer = (g, box) => ({
  NEXY_BOX_FEATURES: box, NEXY_STUDIOS: 'off', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: g.url, NEXY_AGENT_KEY: 'k',
  NEXY_ENGINES: 'nexy-engine', NEXY_ENGINE_NEXY_ENGINE_URL: g.url,
  NEXY_WHISPER_BIN: path.join(STANDINS, 'whisper-cli'), NEXY_SAY_BIN: path.join(STANDINS, 'say'),
});

// a visitor's page: every box API call and every refusal it meets
async function visit(b, base) {
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const calls = [], refused = [], errs = [];
  page.on('response', (r) => {
    if (BOX_API.test(r.url())) calls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`);
    if (r.status() === 403) refused.push(`${r.request().method()} ${r.url()}`);
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  // chat replies still streaming: a reply is read only once its stream has ended
  let streaming = 0;
  const chatReq = (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/chat';
  page.on('request', (r) => { if (chatReq(r)) streaming++; });
  for (const ev of ['requestfinished', 'requestfailed']) page.on(ev, (r) => { if (chatReq(r)) streaming--; });
  await page.goto(base + '/');
  await page.locator('#input').waitFor({ timeout: 20000 });
  const replies = () => page.locator('#thread .msg.ai .bub');
  const ask = async (text) => {
    const n = await replies().count();
    await page.fill('#input', text);
    await page.press('#input', 'Enter');
    await page.waitForFunction((k) => {
      const all = document.querySelectorAll('#thread .msg.ai .bub');
      return all.length > k && all[all.length - 1].textContent.trim() !== '';
    }, n, { timeout: 30000 });
    // the stream has ended and the words have stopped changing
    let last = '', same = 0;
    for (const t0 = Date.now(); same < 3; await page.waitForTimeout(200)) {
      if (Date.now() - t0 > 30000) throw new Error(`the reply never settled: ${last}`);
      const now = (await replies().last().innerText()).trim();
      same = !streaming && now === last && !(await page.locator('#typing').count()) ? same + 1 : 0;
      last = now;
    }
    return last;
  };
  const settings = async (sec) => {
    if (!(await page.locator('#ovSet.open').count())) { await page.locator('#profileBtn').click(); await page.locator('#settingsBtn').click(); }
    await page.locator(`#ovSet [data-sec="${sec}"]`).click();
    await page.waitForTimeout(500);
    return page.locator('#ovSet').innerText();
  };
  const closeSettings = () => page.keyboard.press('Escape');
  return { page, calls, refused, errs, ask, settings, closeSettings };
}

test('box features off: nothing that leads to a refusal, a routine ask said plainly', { timeout: 120000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const g = await agent();
  const s = await start(computer(g, ''));
  const b = await chromium.launch();
  try {
    // the server still refuses them: what the page must not lead to
    for (const p of ['/api/v1/routines', '/api/v1/memory', '/api/v1/engines', '/api/v1/voice/status']) assert.equal((await fetch(s.base + p)).status, 403, p);

    const v = await visit(b, s.base);
    const { page } = v;
    assert.equal(await page.locator('html').getAttribute('data-box'), null);
    assert.equal(await page.locator('html').getAttribute('data-engines'), null);
    assert.equal(await page.locator('#micBtn').isVisible(), false, 'no hold to talk');
    assert.equal(await page.locator('#waveBtn').isVisible(), false, 'no Talk with Nexy');
    assert.doesNotMatch(await page.locator('body').innerText(), /every morning/i, 'no routine starter on the home screen');

    // an ordinary chat still reaches the agent
    assert.match(await v.ask('What should I name my bakery?'), /Agent heard: What should I name my bakery\?/);
    // a routine ask said to the agent, and one the page reads itself: the same plain sentence
    assert.match(await v.ask(REMIND), ROUTINES_ELSEWHERE);
    assert(!g.turns.includes(REMIND), 'the routine ask never reached the agent');
    assert.match(await v.ask('Every weekday at 7am, give me a morning brief of coffee news'), ROUTINES_ELSEWHERE);
    assert.match(await v.ask('show my routines'), ROUTINES_ELSEWHERE);
    assert.match(await v.ask('what do you remember'), /what Nexy remembers across chats needs your own Nexy/);
    assert.doesNotMatch(await page.locator('#thread').innerText(), /That did not work|Only the owner|403/);

    const nexy = await v.settings('nexy');
    assert.doesNotMatch(nexy, /What Nexy remembers|Show routines|Agent engine|Test the voice/);
    assert.match(nexy, /Memory and routines\s*[^]*Need your own Nexy/);
    assert.equal(await page.locator('#ovSet [data-act="mem"], #ovSet [data-act="routines"], #ovSet [data-engine]').count(), 0);
    const security = await v.settings('security');
    assert.doesNotMatch(security, /Forget what Nexy remembers/);
    assert.equal(await page.locator('#ovSet [data-act="forget"]').count(), 0);

    assert.deepEqual(v.calls, [], 'no call to a box feature');
    assert.deepEqual(v.refused, [], 'no refusal anywhere');
    assert.deepEqual(v.errs, []);
  } finally { await b.close(); s.p.kill(); g.srv.close(); fs.rmSync(s.data, { recursive: true, force: true }); }
});

test('box features open: memory, routines, the engine pick and speech show and work', { timeout: 120000 }, async () => {
  const g = await agent();
  const s = await start(computer(g, 'open'));
  const b = await chromium.launch();
  try {
    const v = await visit(b, s.base);
    const { page } = v;
    assert.equal(await page.locator('html').getAttribute('data-box'), '1');
    assert.equal(await page.locator('#micBtn').isVisible(), true, 'hold to talk');
    assert.match(await page.locator('body').innerText(), /Give me a news brief every morning/);

    const nexy = await v.settings('nexy');
    assert.match(nexy, /Agent engine/);
    assert.match(nexy, /What Nexy remembers/);
    assert.match(nexy, /Show routines/);
    assert(await page.locator('#ovSet [data-sel="voice"] option').count() > 0, 'the voices came from this computer');
    await page.locator('#ovSet [data-engine]').selectOption('nexy-engine');
    await page.waitForResponse((r) => r.url().endsWith('/api/v1/engines') && r.request().method() === 'POST' && r.ok());
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#ovSet [data-engine]').inputValue(), 'nexy-engine', 'the pick holds');
    await page.locator('#ovSet [data-act="routines"]').click();
    await page.locator('#thread .msg.ai', { hasText: 'No routines yet' }).waitFor({ timeout: 20000 });
    assert.match(await v.ask('what do you remember'), /not keeping any conversations/);
    assert.match(await v.ask(REMIND), /Agent heard/, 'a routine ask goes to the agent');
    assert(g.turns.includes(REMIND));
    assert.match(await v.settings('security'), /Forget what Nexy remembers/);

    for (const c of ['GET /api/v1/engines 200', 'POST /api/v1/engines 200', 'GET /api/v1/routines 200', 'GET /api/v1/memory 200', 'GET /api/v1/voice/voices 200'])
      assert(v.calls.includes(c), `${c} in ${JSON.stringify(v.calls)}`);
    assert.deepEqual(v.refused, []);
    assert.deepEqual(v.errs, []);
  } finally { await b.close(); s.p.kill(); g.srv.close(); fs.rmSync(s.data, { recursive: true, force: true }); }
});

test('an Own1 with box features off, as a public demo: same', { timeout: 120000 }, async () => {
  const g = await agent();
  const s = await start({ NEXY_AGENT_URL: g.url, NEXY_AGENT_KEY: 'k', NEXY_ENGINES: 'nexy-engine', NEXY_ENGINE_NEXY_ENGINE_URL: g.url });
  const b = await chromium.launch();
  try {
    const v = await visit(b, s.base);
    assert.equal(await v.page.locator('html').getAttribute('data-place'), 'own1');
    assert.doesNotMatch(await v.page.locator('body').innerText(), /every morning/i);
    assert.match(await v.ask('Send me a summary on Telegram every morning'), ROUTINES_ELSEWHERE);
    assert.doesNotMatch(await v.settings('nexy'), /What Nexy remembers|Show routines|Agent engine/);
    assert.deepEqual(v.calls, []);
    assert.deepEqual(v.refused, []);
  } finally { await b.close(); s.p.kill(); g.srv.close(); fs.rmSync(s.data, { recursive: true, force: true }); }
});
