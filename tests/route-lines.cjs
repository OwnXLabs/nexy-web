// Nexy Cloud's model network in the chat: while a reply waits, the line under it says where it is
// being answered, from the engine's own route events (never guessed in the page): first "Finding the
// best computer for this…", then the computer that took the call, and after the answer "Answered on
// John's Own 1." where it ran there. The first answer carries the one-time notice, and a person who
// switches the Own 1 off has no Own 1 model asked for. Stand-in engine; no model.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/route-lines.cjs
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
const LINES = {
  own1: "Answering on John's Own 1…",
  boost: 'Answering with cloud boost…',
  local: 'Answering on Nexy Cloud…',
  own1busy: "John's Own 1 is busy, answering on Nexy Cloud…",
};
const AFTER = { own1: "Answered on John's Own 1.", boost: 'Answered with cloud boost.' };

// an engine that says where it answers ("via <route>" in the question) a moment before it writes
function engine() {
  const asked = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      res.setHeader('content-type', 'application/json');
      if (!req.url.startsWith('/v1/chat/completions')) return res.end('{"data":[]}');
      const b = JSON.parse(body || '{}');
      const q = String(b.messages?.at(-1)?.content ?? '');
      const via = /via (\w+)/.exec(q)?.[1];
      if (!b.stream || !via) return res.end(JSON.stringify({ choices: [{ message: { content: 'A title' }, finish_reason: 'stop' }] }));
      asked.push(b);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      await sleep(1200);
      res.write(`: route ${via}\n\n`);
      await sleep(1500);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `done ${via}` }, finish_reason: null }] })}\n\n`);
      const on = via === 'own1busy' ? 'local' : via;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], nexy: { tools: [], answered_on: on } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, asked, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-route-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_INSECURE_TRUST_ON_TCP: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, log: () => log }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start\n' + log);
}

test('each route has its line while the reply waits, then the answer line', { timeout: 120000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const e = await engine();
  const s = await start({
    NEXY_PLACE: 'cloud', NEXY_STUDIOS: 'off', NEXY_TRUST_GATE_USER: '1', NEXY_ENGINES: 'nexy-engine', NEXY_DEFAULT_ENGINE: 'nexy-engine',
    NEXY_ENGINE_NEXY_ENGINE_URL: e.url, NEXY_ENGINE_NEXY_ENGINE_KEY: 'k', NEXY_LLM_URL: e.url, NEXY_NETWORK_MODEL: 'qwen3-1.7b',
  });
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ extraHTTPHeaders: { 'x-nexy-user': 't01' } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (x) => errors.push(x.message));
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    // every status line the page shows, as it shows it
    await page.evaluate(() => {
      window.__lines = [];
      setInterval(() => document.querySelectorAll('#thread .wait .wl').forEach((el) => {
        const t = el.textContent; if (t && window.__lines.at(-1) !== t) window.__lines.push(t);
      }), 50);
    });
    let n = 0;
    for (const via of ['own1', 'boost', 'local', 'own1busy']) {
      await page.evaluate(() => { window.__lines = []; });
      await page.locator('#input').fill(`Tell me something via ${via}`);
      await page.locator('#input').press('Enter');
      await page.getByText(`done ${via}`).waitFor({ timeout: 20000 });
      n++;
      const lines = await page.evaluate(() => window.__lines);
      assert(lines.includes('Finding the best computer for this…'), `${via}: ${JSON.stringify(lines)}`);
      assert(lines.includes(LINES[via]), `${via}: ${JSON.stringify(lines)}`);
      assert(lines.indexOf('Finding the best computer for this…') < lines.indexOf(LINES[via]), `${via}: in order`);
      for (const [other, line] of Object.entries(LINES)) if (other !== via) assert(!lines.includes(line), `${via}: never ${line}`);
      const reply = page.locator('.m.ai').last();
      const after = await reply.locator('[data-answered-on]').allInnerTexts();
      assert.deepEqual(after, AFTER[via] ? [AFTER[via]] : [], `${via}: the line after the answer`);
      assert.equal(e.asked.at(-1).upstream_model, 'qwen3-1.7b+own1', 'Own 1 first by default, no boost without payment');
    }
    assert.equal(n, 4);
    // the one-time notice: with the first answer only
    const notices = await page.locator('[data-network-notice]').allInnerTexts();
    assert.deepEqual(notices, ["Your messages are answered on a computer in John's home: best effort for performance, no privacy guarantees."]);
    assert.equal(await page.locator('.m.ai').first().locator('[data-network-notice]').count(), 1);
    // switched off in Settings: the engine's own model, the local one
    const r = await page.request.post(s.base + '/api/v1/own1', { data: { on: false } });
    assert.equal(r.status(), 200);
    await page.locator('#input').fill('Tell me something via local');
    await page.locator('#input').press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.m.ai').length >= 5 && /done local/.test(document.querySelectorAll('.m.ai')[4].textContent));
    assert.equal('upstream_model' in e.asked.at(-1), false, 'switched off: no Own 1 asked for');
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});
