// A chat survives Nexy being killed mid-answer: the question is saved before the answer starts,
// what had arrived is saved as it streams, and after a restart the chat comes back marked
// interrupted, with "Ask again" that sends the question once. The model is a stand-in.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/interrupted-chat.cjs
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
const QUESTION = 'Write a detailed guide to keeping a small shop inventory organised.';

// streams slowly the first time (long enough to be killed mid-answer), at once after that
function model() {
  const asked = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const b = JSON.parse(body || '{}');
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: 'Shop inventory' }, finish_reason: 'stop' }] })); }
      asked.push(b.messages);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const slow = asked.length === 1;
      const words = slow ? Array.from({ length: 400 }, (_, i) => `step${i} `) : ['Here is the guide again, in full.'];
      res.on('error', () => {});
      for (const w of words) {
        if (res.destroyed) return;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w }, finish_reason: null }] })}\n\n`);
        if (slow) await sleep(100);
      }
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, asked, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(port, data, llm) {
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'local', NEXY_LLM_URL: llm }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

test('killed mid-answer: the question and what arrived come back, and Ask again sends it once', { timeout: 120000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const m = await model();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-interrupted-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  let s = await start(port, data, m.url);
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext();
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    await page.locator('#input').fill(QUESTION);
    await page.locator('#input').press('Enter');
    // some of the answer has arrived and been on screen long enough to be saved
    await page.waitForFunction(() => /step40\b/.test(document.querySelector('#thread .msg.ai .bub')?.textContent ?? ''), null, { timeout: 30000 });
    await sleep(500);
    s.p.kill('SIGKILL');
    await page.close();

    s = await start(port, data, m.url);
    const back = await ctx.newPage();
    back.on('pageerror', (e) => errors.push(e.message));
    await back.goto(s.base + '/');
    await back.getByText('Nexy closed before this answer finished.').waitFor({ timeout: 20000 });
    const thread = await back.locator('#thread').innerText();
    assert(thread.includes(QUESTION), 'the question is back');
    assert.match(thread, /step1\b/, 'what had arrived is back');
    assert.doesNotMatch(thread, /Thinking|left\b/, 'no status or countdown saved with it');
    assert.match(await back.locator('.rail, #side, body').first().innerText(), /Write a detailed guide|Shop inventory/, 'the chat is in the list');

    const again = back.getByRole('button', { name: 'Ask again' });
    assert.equal(await again.isEnabled(), true, 'Ask again works on the restored chat');
    await again.click();
    await back.getByText('Here is the guide again, in full.').waitFor({ timeout: 20000 });
    const sent = m.asked.at(-1).filter((x) => x.role !== 'system');
    assert.equal(sent.filter((x) => x.role === 'user' && x.content === QUESTION).length, 1, 'the question went to the model once');
    for (let i = 1; i < sent.length; i++) assert(!(sent[i].role === 'user' && sent[i - 1].role === 'user'), 'no two questions in a row');
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.p.kill(); m.srv.close(); }
});
