// An untouched "New chat" does not stay in the chat list once the owner goes to another chat
// (QA 2026-11-12: empty New chats piled up). One that has a message stays. The model is a stand-in.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/empty-new-chat.cjs
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

function model() {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: 'Shop hours' }, finish_reason: 'stop' }] })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Open at seven, done.' }, finish_reason: null }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(llm) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-newchat-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'local', NEXY_LLM_URL: llm }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

test('an untouched New chat leaves the list when another chat is opened', { timeout: 90000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const m = await model();
  const s = await start(m.url);
  const b = await chromium.launch();
  try {
    const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    const ask = async (text) => {
      await page.locator('#input').fill(text);
      await page.locator('#input').press('Enter');
      await page.getByText('Open at seven, done.').last().waitFor({ timeout: 20000 });
    };
    await ask('When should my shop open?');
    const rows = page.locator('button.chat[data-chat]');
    const first = await rows.first().getAttribute('data-chat');
    const empties = () => page.locator('button.chat[data-chat]', { hasText: /^New chat$/ }).count();

    for (let i = 0; i < 3; i++) {
      await page.locator('#newChat').click();
      assert.equal(await empties(), 1, 'the open New chat is listed');
      await page.locator(`button.chat[data-chat="${first}"]`).click();
      await page.getByText('Open at seven, done.').first().waitFor({ timeout: 10000 });
      assert.equal(await empties(), 0, `left untouched, it is gone from the list (round ${i + 1})`);
    }

    // one that was used stays
    await page.locator('#newChat').click();
    await ask('And on Sundays?');
    await page.locator(`button.chat[data-chat="${first}"]`).click();
    await page.getByText('When should my shop open?').waitFor({ timeout: 10000 });
    assert.equal(await rows.count(), 2, 'both chats with messages are listed');
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.p.kill(); m.srv.close(); }
});
