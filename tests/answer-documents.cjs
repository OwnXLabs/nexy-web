// A long answer goes into a document in the pane. Continue on a cut one grows that document
// under the question's name (QA 2026-11-12: the pane was titled "continue from where you stop"),
// and the note pointing at it fits the layout: "on the right" beside the chat, a button that
// opens it on a phone, where the pane covers the chat. The model is a stand-in.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/answer-documents.cjs
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
const steps = Array.from({ length: 16 }, (_, i) => `## Step ${i + 1}\n\nCount the shelves, write the stock book and keep the credit book apart from it, every evening.`).join('\n\n');
const GUIDE = `# Shop guide\n\n${steps}\n\n## Last step\n\nThe one that works harder for`;
const PLAN = `# Shop plan\n\n${steps}\n\nThat is the whole plan.`;

// "guide" stops at the length limit, Continue finishes it, "plan" is whole at once
function model() {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: 'Shop guide' }, finish_reason: 'stop' }] })); }
      const q = b.messages.at(-1).content;
      const [text, finish] = /^Continue/.test(q) ? ['you, and that is the end of the guide.', 'stop'] : /guide/i.test(q) ? [GUIDE, 'length'] : [PLAN, 'stop'];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(llm) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-docs-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_STUDIOS: 'off', NEXY_ENGINE: 'local', NEXY_LLM_URL: llm }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

let m, s, b;
test.before(async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  m = await model();
  s = await start(m.url);
  b = await chromium.launch();
});
test.after(async () => { await b?.close(); s?.p.kill(); m?.srv.close(); });

async function ask(page, text) {
  await page.locator('#input').fill(text);
  await page.locator('#input').press('Enter');
}

test('Continue grows the same document, named for the question', { timeout: 90000 }, async () => {
  const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(s.base + '/');
  await page.locator('#input').waitFor({ timeout: 20000 });
  await ask(page, 'Write me a guide to running my shop');
  await page.getByText('Answer cut short.').waitFor({ timeout: 20000 });
  await page.locator('#cvBody').getByText('Step 16').waitFor({ timeout: 10000 });
  const before = await page.locator('#cvTitle').textContent();
  assert.match(before, /guide/i, before);

  await page.getByRole('button', { name: 'Continue?' }).click();
  await page.locator('#cvBody').getByText('that is the end of the guide').waitFor({ timeout: 20000 });
  assert.equal(await page.locator('#cvTitle').textContent(), before, 'the continued answer keeps the question\'s title');
  assert.doesNotMatch(await page.locator('#cvTabs').innerText(), /continue/i);
  assert.equal(await page.locator('#cvTabs .cvtab').count(), 1, 'one document, not a second one');
  const doc = await page.locator('#cvBody').innerText();
  assert.match(doc, /Step 1\b[\s\S]*works harder for[\s\S]*that is the end of the guide/, 'the start and the rest, in order');
  assert.deepEqual(errors, []);
  await page.close();
});

test('the note says "on the right" beside the chat, and is a button on a phone', { timeout: 90000 }, async () => {
  const wide = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await wide.goto(s.base + '/');
  await wide.locator('#input').waitFor({ timeout: 20000 });
  await ask(wide, 'Write me a plan for my shop');
  await wide.locator('#cvBody').getByText('That is the whole plan').waitFor({ timeout: 20000 });
  const note = wide.locator('#thread .msg.ai .bub').last();
  assert.match(await note.innerText(), /The full answer is on the right\./);
  assert.equal(await note.locator('[data-open-work]').isVisible(), false);
  await wide.close();

  const phone = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = []; phone.on('pageerror', (e) => errors.push(e.message));
  await phone.goto(s.base + '/');
  await phone.locator('#input').waitFor({ timeout: 20000 });
  await ask(phone, 'Write me a plan for my shop');
  await phone.locator('#cvBody').getByText('That is the whole plan').waitFor({ timeout: 20000 });
  await phone.locator('#mChat').click();
  await phone.waitForFunction(() => !document.body.classList.contains('canvas-open'));
  const bub = phone.locator('#thread .msg.ai .bub').last();
  const said = await bub.innerText();
  assert.doesNotMatch(said, /on the right/, said);
  assert.match(said, /The full answer is in the work view\./, said);
  await bub.locator('[data-open-work]').tap();
  await phone.waitForFunction(() => document.body.classList.contains('canvas-open'));
  assert(await phone.locator('#cvBody').getByText('That is the whole plan').isVisible(), 'the button brings the answer back');
  assert.deepEqual(errors, []);
  await phone.close();
});
