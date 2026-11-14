// One engine per chat. A chat keeps the engine it started on after the owner's pick changes; a turn
// naming another engine is refused; Continue shares a chat with another engine only as a new,
// linked chat (or starts an empty one); ultra-private chats are never shared; a fact question asks
// Hermes and OpenClaw to search first; the turn line names the engine and its tools. Labels show
// only where there is a choice of engines. Stand-in gateways only.
// Run after `npm run build`: node --test tests/per-chat-engine.cjs
// SHOTS_DIR=<dir> also saves screenshots of the label, the Continue sheet and Settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { openclawStandin } = require('./standins/openclaw.cjs');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'oc-perchat-token';
const SEARCH_FIRST = 'Search the web before answering and cite your sources.';
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : '';

// A Hermes-style gateway, or Nexy Engine (`meta`: what it reports beside its reply). Records each
// chat body; its session record lists the tools in `tools`, as Hermes writes them.
function gateway(name, { meta = null, tools = [] } = {}) {
  const chats = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/v1/chat/completions')) {
        const body = JSON.parse(raw);
        chats.push(body);
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `answer from ${name}` }, finish_reason: 'stop' }], ...(meta ? { nexy: meta } : {}) }));
      }
      if (/^\/api\/sessions\/nexy-[^/]+\/messages/.test(req.url))
        return res.end(JSON.stringify({ data: tools.map((t) => ({ role: 'tool', tool_name: t, timestamp: Date.now() / 1000 + 1 })) }));
      if (req.url.startsWith('/api/sessions')) return res.end(JSON.stringify({ data: [] }));
      if (req.url.startsWith('/api/jobs')) return res.end(JSON.stringify({ jobs: [] }));
      res.end('{}');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, chats, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, NEXY_EVAL: '', HOST: '127.0.0.1', PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, log: () => log }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start\n' + log);
}

// three engines: Hermes (the deploy-time agent), Nexy Engine and OpenClaw
async function threeEngines(extra = {}) {
  const hermes = await gateway('hermes', { tools: ['web_search'] });
  const nexy = await gateway('nexy-engine', { meta: { steps: 2, tools: ['web_search', 'read_page'], mode: 'native' } });
  const oc = await openclawStandin({ token: TOKEN });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-perchat-'));
  const keyFile = path.join(data, 'openclaw.key'); fs.writeFileSync(keyFile, TOKEN + '\n', { mode: 0o600 });
  const s = await start({
    NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_SCREEN: 'none',
    NEXY_AGENT_URL: hermes.url, NEXY_AGENT_KEY: 'hermes-key',
    NEXY_ENGINES: 'nexy-engine,openclaw', NEXY_ENGINE_NEXY_ENGINE_URL: nexy.url, NEXY_ENGINE_NEXY_ENGINE_KEY: 'nexy-key',
    NEXY_ENGINE_OPENCLAW_URL: oc.url, NEXY_ENGINE_OPENCLAW_KEY_FILE: keyFile, ...extra,
  });
  const close = () => { s.p.kill(); hermes.srv.close(); nexy.srv.close(); oc.close(); fs.rmSync(data, { recursive: true, force: true }); };
  return { s, hermes, nexy, oc, data, close };
}

function client(base) {
  const jar = { c: '' };
  return async (p, body, method = body ? 'POST' : 'GET') => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(jar.c ? { cookie: jar.c } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const set = r.headers.get('set-cookie'); if (set) jar.c = set.split(';')[0];
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, json, text };
  };
}
const turnLines = (log) => log.split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((x) => x && x.endpoint === 'chat');

test('a chat keeps its engine, a mismatched turn is refused, Continue makes a linked or empty chat, ultra-private is never shared', { timeout: 60000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const { s, hermes, nexy, oc, close } = await threeEngines();
  const req = client(s.base);
  const ask = (chat, content, extra = {}) => req('/api/v1/chat', { chat, messages: [{ role: 'user', content }], ...extra });
  const ocChats = () => oc.seen.filter((x) => x.path === '/v1/chat/completions');
  try {
    // a chat saved under the default (Hermes) takes Hermes on its first save
    const saved = await req('/api/v1/chats', { id: 'cfixed001', pid: '_', title: 'Harbour', html: '<div class="msg m me"><div class="bub">first question</div></div>', history: [{ role: 'user', content: 'first question' }, { role: 'assistant', content: 'first answer' }], base: 0 });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.engine, 'hermes', 'a new chat records the engine in effect');

    // the owner picks OpenClaw: that chat stays on Hermes, a new one starts on OpenClaw
    assert.equal((await req('/api/v1/engines', { id: 'openclaw' })).status, 200);
    let r = await ask('cfixed001', 'second question');
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.choices[0].message.content, /answer from hermes/, 'the chat stays with the engine it started on');
    assert.equal(r.json.engine, 'hermes');
    assert.equal(ocChats().length, 0, 'OpenClaw saw nothing of that chat');
    r = await ask('cnewchat01', 'a new chat');
    assert.match(r.json.choices[0].message.content, /answer from openclaw/, 'a new chat uses the new pick');

    // a save naming another engine does not move the chat
    const ts = (await req('/api/v1/chats?id=cfixed001')).json.chat.ts;
    await req('/api/v1/chats', { id: 'cfixed001', pid: '_', title: 'Harbour', html: '<div class="msg m me"><div class="bub">first question</div></div>', history: [{ role: 'user', content: 'first question' }], engine: 'openclaw', base: ts });
    assert.equal((await req('/api/v1/chats?id=cfixed001')).json.chat.engine, 'hermes', 'the saved engine never changes');

    // a turn naming another engine is refused, and reaches no engine
    const before = { h: hermes.chats.length, n: nexy.chats.length, o: ocChats().length };
    r = await ask('cfixed001', 'sneak it over', { engine: 'openclaw' });
    assert.equal(r.status, 409, 'a mismatched engine is refused');
    assert.match(r.json.error, /This chat is with Hermes/);
    assert.match(r.json.error, /Continue with OpenClaw/);
    assert.equal((await ask('cfixed001', 'and again', { engine: 'nexy-engine' })).status, 409);
    assert.equal((await ask('cother001', 'unknown engine', { engine: 'bogus' })).status, 400, 'an engine not on this machine is refused');
    assert.deepEqual({ h: hermes.chats.length, n: nexy.chats.length, o: ocChats().length }, before, 'no engine saw the refused turns');
    assert.equal((await ask('cfixed001', 'named right', { engine: 'hermes' })).status, 200, 'its own engine is fine');

    // Continue -> Share: a new chat on OpenClaw with the transcript, linked to the original
    const shared = await req('/api/v1/chat-continue', { from: 'cfixed001', engine: 'openclaw' });
    assert.equal(shared.status, 200, shared.text);
    const c = shared.json.chat;
    assert.notEqual(c.id, 'cfixed001');
    assert.equal(c.engine, 'openclaw');
    assert.deepEqual(c.from, { id: 'cfixed001', title: 'Harbour' });
    assert.deepEqual(c.history.map((t) => t.content), ['first question'], 'the transcript so far');
    const got = (await req(`/api/v1/chats?id=${c.id}`)).json.chat;
    assert.match(got.html, /Continued from “Harbour” with Hermes/);
    assert.match(got.html, /first question/);
    assert.equal((await req('/api/v1/chats?id=cfixed001')).json.chat.engine, 'hermes', 'the original keeps its engine');
    const n = ocChats().length;
    r = await req('/api/v1/chat', { chat: c.id, engine: 'openclaw', messages: [...c.history, { role: 'user', content: 'carry on' }] });
    assert.match(r.json.choices[0].message.content, /answer from openclaw to carry on/);
    assert.equal(ocChats().length, n + 1);
    assert(ocChats().at(-1).body.messages.some((m) => m.content === 'first question'), 'OpenClaw gets the shared transcript');
    assert.equal((await req('/api/v1/chat', { chat: c.id, engine: 'hermes', messages: [{ role: 'user', content: 'back' }] })).status, 409, 'the continued chat is fixed too');
    assert.equal((await req('/api/v1/chat-continue', { from: 'cfixed001', engine: 'hermes' })).status, 400, 'not onto its own engine');
    assert.equal((await req('/api/v1/chat-continue', { from: 'cmissing01', engine: 'openclaw' })).status, 404);

    // ultra-private: never shared, and nothing is made
    const count = (await req('/api/v1/chats')).json.chats.length;
    r = await req('/api/v1/chat-continue', { from: 'cfixed001', engine: 'openclaw', private: true });
    assert.equal(r.status, 403, 'an ultra-private chat is refused');
    assert.match(r.json.error, /ultra-private/);
    assert.equal((await req('/api/v1/chats')).json.chats.length, count, 'no chat was made');
  } finally { close(); }
});

test('a fact question asks Hermes and OpenClaw to search first, never Nexy Engine; the turn line names the engine and its tools', { timeout: 60000 }, async () => {
  const { s, hermes, nexy, oc, close } = await threeEngines();
  const req = client(s.base);
  const lastSystem = (chats) => chats.at(-1).messages.find((m) => m.role === 'system').content;
  try {
    const fact = 'what is the latest news on the harbour bridge';
    for (const [engine, chats] of [['hermes', () => hermes.chats], ['nexy-engine', () => nexy.chats], ['openclaw', () => oc.seen.filter((x) => x.path === '/v1/chat/completions').map((x) => x.body)]]) {
      const r = await req('/api/v1/chat', { chat: `cfact${engine.replace(/-/g, '')}`, engine, messages: [{ role: 'user', content: fact }] });
      assert.equal(r.status, 200, r.text);
      const system = lastSystem(chats());
      if (engine === 'nexy-engine') assert(!system.includes(SEARCH_FIRST), 'Nexy Engine keeps its own behaviour');
      else assert(system.includes(SEARCH_FIRST), `${engine} is told to search first`);
      assert(!/You are Nexy, the assistant/.test(system.split(SEARCH_FIRST)[1] ?? ''), 'one line only, not the persona again');
    }
    await req('/api/v1/chat', { chat: 'cplainhermes', engine: 'hermes', messages: [{ role: 'user', content: 'write me a haiku about tea' }] });
    assert(!lastSystem(hermes.chats).includes(SEARCH_FIRST), 'no search line on a turn that is not a fact question');

    await sleep(200);
    const lines = turnLines(s.log()).filter((x) => x.result === 'answered');
    const of = (engine) => lines.find((x) => x.engine === engine);
    assert.deepEqual(of('nexy-engine')?.tools, ['web_search', 'read_page'], 'Nexy Engine\'s own tool report');
    assert.deepEqual(of('hermes')?.tools, ['web_search'], 'Hermes\' tools from its session record');
    assert.equal(of('openclaw')?.tools, 'unknown', 'OpenClaw does not say: unknown');
    for (const l of [of('nexy-engine'), of('hermes'), of('openclaw')]) {
      assert.equal(l.sources, 'unknown');
      assert.equal(typeof l.cited, 'number');
      assert.equal(l.searchAsked ?? false, l.engine !== 'nexy-engine');
    }
    assert(turnLines(s.log()).filter((x) => x.result === 'started').every((x) => typeof x.engine === 'string'), 'the start line names the engine too');
  } finally { close(); }
});

test('in the browser: the label, Continue with Share and Start fresh, the pick for new chats only, no Continue while ultra-private', { timeout: 150000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  // the model on this machine, which answers ultra-private chats
  const plain = await gateway('the plain model');
  const { s, hermes, nexy, oc, close } = await threeEngines({ NEXY_LLM_URL: plain.url });
  const browser = await chromium.launch();
  const ocChats = () => oc.seen.filter((x) => x.path === '/v1/chat/completions');
  const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name) }); } };
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const chip = page.locator('#hdrEngine');
    const settings = async () => {
      if (!(await page.locator('#ovSet.open').count())) { await page.locator('#profileBtn').click(); await page.locator('#settingsBtn').click(); }
      await page.locator('#ovSet [data-sec="nexy"]').click();
      await page.locator('#ovSet select[data-engine]').waitFor();
    };
    const say = async (text, from) => {
      const n = await page.locator('#thread .m.ai .bub').count();
      await page.fill('#input', text);
      await page.press('#input', 'Enter');
      await page.waitForFunction(([n, from]) => { const b = [...document.querySelectorAll('#thread .m.ai .bub')]; return b.length > n && b.at(-1).textContent.includes(`answer from ${from}`); }, [n, from], { timeout: 30000 });
    };
    const continueTo = async (label) => {
      await chip.click();
      await page.locator('#ctx.open .ci2', { hasText: `Continue with ${label}…` }).click();
      await page.locator('#ovContinue.open').waitFor();
    };
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });

    await say('what is two plus two', 'hermes');
    await page.waitForFunction(() => document.querySelector('#hdrEngine')?.textContent === 'Hermes' && !document.querySelector('#hdrEngine').hidden);
    assert.equal(await page.locator('#thread .m.ai .macts [data-engine="hermes"]').innerText(), 'Hermes', 'the answer\'s meta line names its engine');
    await page.locator('#thread .m.ai').last().hover();
    await shot(page, 'label-desktop.png');

    // Settings: the pick is for new chats; the open chat stays with Hermes
    await settings();
    assert.match(await page.locator('#ovSet .srow', { has: page.locator('select[data-engine]') }).innerText(), /Applies to new chats; each chat stays with the engine it started on\./);
    await page.locator('#ovSet select[data-engine]').selectOption('openclaw');
    await page.waitForFunction(() => document.querySelector('#ovSet select[data-engine]')?.value === 'openclaw');
    await shot(page, 'settings-desktop.png');
    await page.locator('#ovSet [data-close]').click();
    assert.equal(await chip.innerText(), 'Hermes', 'changing the pick does not move this chat');
    const before = ocChats().length;
    await say('and three plus three', 'hermes');
    assert.equal(ocChats().length, before, 'the open chat still goes to Hermes');

    // Continue -> Share: the sheet asks, then a new linked chat on OpenClaw with the transcript
    await continueTo('OpenClaw');
    const sheetText = await page.locator('#ovContinue .modal').innerText();
    assert.match(sheetText, /Share this conversation with OpenClaw\? It keeps its own copy and memory, which Nexy can't delete\./);
    assert.match(sheetText, /Start fresh/);
    await shot(page, 'continue-sheet-desktop.png');
    const original = await page.evaluate(() => document.querySelector('#chatList .chat.active')?.dataset.chat);
    await page.locator('#ctShare').click();
    await page.waitForFunction((id) => { const a = document.querySelector('#chatList .chat.active')?.dataset.chat; return a && a !== id && /Continued from/.test(document.querySelector('#thread')?.textContent || ''); }, original, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('#hdrEngine')?.textContent === 'OpenClaw');
    assert.match(await page.locator('#thread').innerText(), /what is two plus two/, 'the transcript came along');
    await say('carry on', 'openclaw');
    assert(ocChats().at(-1).body.messages.some((m) => m.content === 'what is two plus two'), 'OpenClaw got the transcript it was shared');
    await shot(page, 'continued-chat-desktop.png');

    // back in the original: still Hermes
    await page.locator(`#chatList [data-chat="${original}"]`).click();
    await page.waitForFunction(() => document.querySelector('#hdrEngine')?.textContent === 'Hermes');

    // Continue -> Start fresh: an empty chat on Nexy Engine
    await continueTo('Nexy Engine');
    await page.locator('#ctFresh').click();
    await page.waitForFunction(() => document.querySelector('#hdrEngine')?.textContent === 'Nexy Engine' && !document.querySelector('#thread .msg'));
    const nBefore = nexy.chats.length;
    await say('hello there', 'nexy-engine');
    assert.equal(nexy.chats.length, nBefore + 1);
    assert.deepEqual(nexy.chats.at(-1).messages.filter((m) => m.role !== 'system').map((m) => m.content), ['hello there'], 'nothing from the other chat');

    // a New chat starts on the pick
    await page.locator('#newChat').click();
    await page.waitForFunction(() => document.querySelector('#hdrEngine')?.textContent === 'OpenClaw');

    // ultra-private: answered on this machine, no label, no Continue in the chat's menu
    await page.locator('#privBtn').click();
    await page.locator('[data-testid="nexy-private-banner"]').waitFor({ state: 'visible', timeout: 5000 });
    await say('a private question', 'the plain model');
    assert(await chip.isHidden(), 'no engine label while ultra-private');
    assert.equal(await page.locator('#thread [data-engine]').count(), 0, 'no label on a private answer');
    await page.locator('#chatList .chat.active .dots').click();
    await page.locator('#ctx.open').waitFor();
    assert.equal(await page.locator('#ctx.open .ci2', { hasText: 'Continue with' }).count(), 0, 'no Continue while ultra-private');
    await page.keyboard.press('Escape');
    await page.locator('#privBtn').click();

    // phone width
    if (SHOTS) {
      // the original chat again
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate((id) => document.querySelector(`#chatList [data-chat="${id}"]`).click(), original);
      await page.waitForFunction(() => document.querySelector('#hdrEngine')?.textContent === 'Hermes' && !document.querySelector('#hdrEngine').hidden);
      await page.locator('#thread .m.ai .macts').last().scrollIntoViewIfNeeded();
      await page.locator('#thread .m.ai').last().hover();
      await shot(page, 'label-phone.png');
      await chip.click();
      await page.locator('#ctx.open .ci2', { hasText: 'Continue with' }).first().click();
      await page.locator('#ovContinue.open').waitFor();
      await shot(page, 'continue-sheet-phone.png');
      await page.locator('#ctNo').click();
      // the profile menu is in the drawer on a phone
      await page.evaluate(() => document.querySelector('#settingsBtn').click());
      await settings();
      await shot(page, 'settings-phone.png');
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); close(); plain.srv.close(); }
});

test('one engine (the desktop app): no label, no Continue, nothing new', { timeout: 90000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const engine = await gateway('nexy-engine', { meta: { tools: [] } });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-perchat-one-'));
  const s = await start({ NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_SCREEN: 'none', NEXY_STUDIOS: 'off', NEXY_AGENT_URL: engine.url, NEXY_AGENT_NAME: 'nexy-engine' });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    await page.fill('#input', 'what is two plus two');
    await page.press('#input', 'Enter');
    await page.waitForFunction(() => /answer from nexy-engine/.test(document.querySelector('#thread')?.textContent || ''), null, { timeout: 30000 });
    await sleep(300);
    assert(await page.locator('#hdrEngine').isHidden(), 'no engine label');
    assert.equal(await page.locator('#thread [data-engine]').count(), 0, 'no label on the answer');
    await page.locator('#chatList .chat.active .dots').click();
    await page.locator('#ctx.open').waitFor();
    assert.equal(await page.locator('#ctx.open .ci2', { hasText: /Continue with|Use .* for this chat/ }).count(), 0, 'no Continue');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); s.p.kill(); engine.srv.close(); fs.rmSync(data, { recursive: true, force: true }); }
});
