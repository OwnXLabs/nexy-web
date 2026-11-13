// A file attached on a computer without Own Docs is read in the page and reaches the model with the
// question (QA 0.2.13: the upload went to Own Docs, the chip said "memo.txt: unknown app" and the
// model saw nothing). Images are refused plainly. On an Own1 the upload still goes to Own Docs.
// The model is a stand-in that records what it was sent.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/local-attach.cjs
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
  const sent = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      sent.push(b);
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: 'Memo' }, finish_reason: 'stop' }] })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Revenue was 4,210 dollars.' }, finish_reason: null }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, sent, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-attach-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_ENGINE: 'local', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

let m, b;
test.before(async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  m = await model();
  b = await chromium.launch();
});
test.after(async () => { await b?.close(); m?.srv.close(); });

const lastBubble = (page) => page.locator('#thread .msg.ai .bub').last();

test('text, Markdown, CSV and PDF are read here and sent to the model; an image is refused plainly', { timeout: 120000 }, async () => {
  const s = await start({ NEXY_STUDIOS: 'off', NEXY_LLM_URL: m.url });
  try {
    // a real PDF, as Chromium prints one (compressed, Identity-H fonts with ToUnicode maps)
    const maker = await b.newPage();
    await maker.setContent('<h1>Quarterly memo</h1><p>The café on Pier Street signs the lease on 3 December.</p>');
    const pdf = await maker.pdf();
    await maker.close();

    const page = await b.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const appCalls = []; page.on('request', (r) => { if (r.url().includes('/api/apps/docs')) appCalls.push(r.url()); });
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    await page.locator('#filePick').setInputFiles([
      { name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('Weekly report: revenue was 4,210 dollars.') },
      { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\n\n- Dana owns the follow-up') },
      { name: 'sales.csv', mimeType: 'text/csv', buffer: Buffer.from('month,amount\nOct,1200\nNov,3010\n') },
      { name: 'memo.pdf', mimeType: 'application/pdf', buffer: pdf },
    ]);
    await page.getByText('Read memo.txt, notes.md, sales.csv, memo.pdf on this computer.').waitFor({ timeout: 15000 });
    await page.locator('#filePick').setInputFiles([{ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') }]);
    await page.getByText("photo.png: images can't be read here yet").waitFor({ timeout: 15000 });

    await page.locator('#input').fill('What was the revenue in the memo?');
    await page.locator('#input').press('Enter');
    await lastBubble(page).getByText('Revenue was 4,210 dollars.').waitFor({ timeout: 20000 });
    const asked = m.sent.filter((x) => x.stream).at(-1);
    const system = asked.messages[0].content;
    assert.match(system, /The user HAS attached 4 file\(s\)/);
    assert.match(system, /<<<FILE memo\.txt>>>\nWeekly report: revenue was 4,210 dollars\.\n<<<END memo\.txt>>>/);
    assert.match(system, /<<<FILE notes\.md>>>\n# Notes\n\n- Dana owns the follow-up/);
    assert.match(system, /<<<FILE sales\.csv>>>\nmonth,amount/);
    assert.match(system, /<<<FILE memo\.pdf>>>\nQuarterly memo\nThe café on Pier Street signs the lease on 3 December\./);
    assert.doesNotMatch(system, /photo\.png/);
    const said = await page.locator('#thread').innerText();
    assert.doesNotMatch(said, /unknown app|Own Docs/i, said);
    assert.deepEqual(appCalls, [], 'nothing sent to a studio this computer lacks');
    assert.deepEqual(errors, []);
    await page.close();
  } finally { s.p.kill(); }
});

test('on an Own1 an attached file still goes to Own Docs', { timeout: 60000 }, async () => {
  const s = await start({ NEXY_LLM_URL: m.url });
  try {
    const page = await b.newPage();
    const uploads = [];
    await page.route('**/api/apps/docs/api/v1/documents?*', (r) => { uploads.push(r.request().url()); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [{ filename: 'memo.txt', docId: 7 }] }) }); });
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    await page.locator('#filePick').setInputFiles([{ name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
    await page.getByText('memo.txt is in Own Docs', { exact: false }).waitFor({ timeout: 15000 });
    assert.equal(uploads.length, 1);
    await page.close();
  } finally { s.p.kill(); }
});
