// Chat in a browser without the APIs Android WebView 91 (the phone app) and Safari 15 lack: they
// are deleted before the page loads. A message must still reach the model and the answer show.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/old-engine.cjs
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

// what an old engine does not have
const OLD = () => {
  const gone = [
    [Array.prototype, ['at', 'findLast', 'findLastIndex', 'toSorted', 'toReversed', 'toSpliced', 'with', 'group', 'groupToMap']],
    [String.prototype, ['at', 'isWellFormed', 'toWellFormed']],
    [Object.getPrototypeOf(Int8Array.prototype), ['at', 'findLast', 'findLastIndex', 'toSorted', 'toReversed', 'with']],
    [Object, ['hasOwn', 'groupBy']],
    [Map, ['groupBy']],
    [AbortSignal, ['timeout', 'any']],
    [AbortSignal.prototype, ['throwIfAborted']],
    [Promise, ['withResolvers']],
    [Array, ['fromAsync']],
    [URL, ['canParse', 'parse']],
    [Set.prototype, ['union', 'intersection', 'difference', 'symmetricDifference', 'isSubsetOf', 'isSupersetOf', 'isDisjointFrom']],
    [globalThis, ['structuredClone', 'requestIdleCallback', 'Iterator']],
    [Crypto.prototype, ['randomUUID']],
  ];
  for (const [o, names] of gone) for (const n of names) { try { delete o[n]; } catch (e) { console.warn('could not remove', n, e); } }
  window.__old = gone.flatMap(([o, names]) => names.filter((n) => n in o));
};

// markdown, and HTML that must stay text
const REPLY = '### Hello from an old phone.\n\nSee [the site](https://example.com/a?b=1) <img src=x onerror="window.__xss=1">';
function model() {
  const asked = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      // a request that does not stream names the chat; only answers are counted
      if (b.stream) asked.push(b);
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: REPLY }, finish_reason: 'stop' }] })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: REPLY }, finish_reason: null }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, asked, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(llm) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-old-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'local', NEXY_LLM_URL: llm }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

test('a chat works without the APIs an old phone web view lacks', { timeout: 90000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const m = await model();
  const s = await start(m.url);
  const b = await chromium.launch();
  try {
    const page = await b.newPage({ viewport: { width: 390, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(OLD);
    await page.goto(s.base + '/');
    assert.deepEqual(await page.evaluate(() => window.__old), [], 'the newer APIs are gone');
    assert.equal(await page.evaluate(() => typeof [].at), 'undefined');
    await page.locator('#input').waitFor({ timeout: 20000 });
    await page.locator('#input').fill('Say hello');
    await page.locator('#input').press('Enter');
    await page.getByText('Hello from an old phone.').waitFor({ timeout: 20000 });
    assert.equal(m.asked.length, 1, 'the message reached the model');
    // the reply's markdown is rendered in the bubble, its HTML is not
    const bub = page.locator('.m.ai .bub').last();
    await bub.locator('h4', { hasText: 'Hello from an old phone.' }).waitFor();
    const a = bub.locator('a', { hasText: 'the site' });
    assert.equal(await a.getAttribute('href'), 'https://example.com/a?b=1');
    assert.equal(await a.getAttribute('target'), '_blank');
    assert.match(await a.getAttribute('rel'), /noopener/);
    assert.equal(await bub.locator('img').count(), 0);
    assert.match(await bub.innerText(), /<img src=x/);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    // a second message saves the chat with the first reply in it, then sends again
    await page.locator('#input').fill('Again');
    await page.locator('#input').press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.m.ai').length >= 2 && !document.querySelector('.msg[data-pending]'));
    assert.equal(m.asked.length, 2);
    assert.deepEqual(errors, [], 'nothing threw');
  } finally { await b.close(); s.p.kill(); m.srv.close(); }
});
