// Long answers: the model on this computer may write up to 4096 tokens, and a reply that still
// stops at the limit says "Answer cut short. Continue?" instead of ending mid-sentence. Continue
// picks up from the reply. The model is a stand-in.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/long-answers.cjs
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

// stops at the length limit for "guide", finishes anything else
function model() {
  const asked = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const b = JSON.parse(body || '{}');
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: 'Guide' }, finish_reason: 'stop' }] })); }
      asked.push(b);
      const q = b.messages.at(-1).content;
      const [text, finish] = /guide/i.test(q) ? ['Step one: count the shelves. Step two: works harder for', 'length'] : ['you, and that is the end of the guide.', 'stop'];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, asked, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(llm) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-long-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'local', NEXY_LLM_URL: llm }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

test('a reply at the length limit says so and continues on request', { timeout: 90000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const m = await model();
  const s = await start(m.url);
  const b = await chromium.launch();
  try {
    const page = await b.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    await page.locator('#input').fill('Tell me how to run my shop, as a guide');
    await page.locator('#input').press('Enter');
    await page.getByText('Answer cut short.').waitFor({ timeout: 20000 });
    assert.equal(m.asked[0].max_tokens, 4096, 'room for a long answer');

    await page.getByRole('button', { name: 'Continue?' }).click();
    await page.getByText('that is the end of the guide').waitFor({ timeout: 20000 });
    const sent = m.asked.at(-1).messages;
    assert.match(sent.at(-1).content, /^Continue/, 'Continue asks the model to go on');
    assert.match(sent.at(-2).content, /works harder for/, 'from the reply that was cut');
    assert.equal(await page.getByText('Answer cut short.').count(), 1, 'a finished reply is not marked');
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.p.kill(); m.srv.close(); }
});
