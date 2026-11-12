// The model dies mid-answer (Ollama killed): the words already shown stay up, with Continue,
// and continuing works (QA 2026-11-12: the words vanished and a raw error took their place).
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/model-dies.cjs
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

// a long guide in sections: shown on the right, its first paragraph in the chat
const GUIDE = ['Here is a practical guide to running a carinderia.\n\n', '## Menu\n\n',
  ...Array.from({ length: 30 }, (_, i) => `- Dish ${i}: rice and ulam, cooked fresh each morning.\n`), '\n## Suppliers\n\n',
  ...Array.from({ length: 12 }, (_, i) => `- Supplier${i} at the public market, early. \n`)];

// the first answer stops dead after some words; the second is whole
function model(first = [...Array.from({ length: 30 }, (_, i) => `word${i} `), '**Cut mid-bold ']) {
  let n = 0;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const b = JSON.parse(body || '{}');
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: 'Stock list' }, finish_reason: 'stop' }] })); }
      const isFirst = ++n === 1;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.on('error', () => {});
      const words = isFirst ? first : ['The whole answer, second time.'];
      for (const w of words) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w }, finish_reason: null }] })}\n\n`); await sleep(isFirst && first === GUIDE ? 5 : 30); }
      if (isFirst) return res.destroy();
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

test('the model dies mid-answer: what arrived stays, with Continue', { timeout: 120000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const m = await model();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-model-dies-'));
  const s = await start(20000 + Math.floor(Math.random() * 20000), data, m.url);
  const b = await chromium.launch();
  try {
    const page = await b.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    await page.locator('#input').fill('List what a corner shop should keep in stock.');
    await page.locator('#input').press('Enter');
    const again = page.getByRole('button', { name: 'Continue?' });
    const t0 = Date.now();
    await again.waitFor({ timeout: 60000 });
    assert(Date.now() - t0 < 15000, 'no long wait before it says so');
    const bubble = await page.locator('#thread .msg.ai .bub').last().innerText();
    assert.match(bubble, /word20\b/, 'the words already shown are still there');
    assert.match(bubble, /stopped before it finished/);
    assert.doesNotMatch(bubble, /\*\*/, 'no stray bold marker at the cut');
    assert.doesNotMatch(bubble, /Thinking/);
    await again.click();
    await page.getByText('The whole answer, second time.').waitFor({ timeout: 20000 });
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.p.kill(); m.srv.close(); fs.rmSync(data, { recursive: true, force: true }); }
});

// QA 0.2.8: a long guide shown on the right, cut by the model dying, said so late and seemed to lose
// its words. The notice comes at once; the guide so far is on the right, its start in the chat.
test('a long guide cut off: the notice at once, the words so far on the right, Continue', { timeout: 120000 }, async () => {
  const m = await model(GUIDE);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-model-dies-'));
  const s = await start(20000 + Math.floor(Math.random() * 20000), data, m.url);
  const b = await chromium.launch();
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    await page.locator('#input').fill('Write a 600-word guide to running a carinderia in Davao.');
    await page.locator('#input').press('Enter');
    const again = page.getByRole('button', { name: 'Continue?' });
    const t0 = Date.now();
    await again.waitFor({ timeout: 60000 });
    assert(Date.now() - t0 < 15000, 'no long wait before it says so');
    const bubble = await page.locator('#thread .msg.ai .bub').last().innerText();
    assert.match(bubble, /practical guide to running a carinderia/, 'its start stays in the chat');
    assert.match(bubble, /stopped before it finished/);
    const pane = await page.locator('.doc').last().innerText();
    assert.match(pane, /Supplier1[01]\b/, 'the words so far are on the right');
    await again.click();
    await page.getByText('The whole answer, second time.').waitFor({ timeout: 20000 });
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.p.kill(); m.srv.close(); fs.rmSync(data, { recursive: true, force: true }); }
});
