// The work pane's Open button shows only when the click opens that exact item, never an app's home.
// A chat document goes to Own Docs once, then opens as ?doc=<id>, and only when Own Docs says it
// can ("doc-link" in its health). Own Docs, the model and the Docs page are stand-ins.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/open-in.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
// a named Own1, as the owner reaches it: its Docs app is https://docs.<that name>/
const HOST = 'my.owner.test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEAD_END = /cannot jump|not yet|yet —|nowhere to hand|do not take an? .*id|no app on this machine owns/i;
const steps = Array.from({ length: 16 }, (_, i) => `## Step ${i + 1}\n\nCount the shelves, write the stock book and keep the credit book apart from it, every evening.`).join('\n\n');
const RESEARCH = `# Research about ownx.co\n\n${steps}\n\nThat is the whole report.`;

// Own Docs as it answers: health (503 still carries features), upload deduped by content,
// an ingest error as 200 with no docId, indexing that is ready after one look
function ownDocs() {
  const s = { features: ['doc-link'], uploads: [], fail: false, byBody: new Map(), looks: new Map(), next: 40 };
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  s.srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (u.pathname === '/api/v1/health') return json(res, 503, { ok: false, database: 'ready', embedding: 'loading', ...(s.features ? { features: s.features } : {}) });
      if (u.pathname === '/api/v1/documents' && req.method === 'POST') {
        if (!body) return json(res, 400, { error: 'empty body' });
        const filename = u.searchParams.get('filename');
        s.uploads.push({ filename, body, type: req.headers['content-type'], query: u.search });
        if (s.fail) return json(res, 200, { accepted: [{ filename, error: 'the embedding model is not loaded' }] });
        const had = s.byBody.get(body);
        const docId = had ?? s.next++;
        s.byBody.set(body, docId);
        return json(res, 200, { accepted: [{ filename, docId, alreadyIndexed: had !== undefined }] });
      }
      if (u.pathname === '/api/v1/document') {
        const id = Number(u.searchParams.get('id'));
        const n = (s.looks.get(id) ?? 0) + 1; s.looks.set(id, n);
        return json(res, 200, { doc: { id, status: n > 1 ? 'ready' : 'embedding' }, text: 'held text', chunks: 1 });
      }
      if (u.pathname === '/api/v1/documents') return json(res, 200, { docs: [], jobs: [] });
      json(res, 404, { error: 'not here' });
    });
  });
  return new Promise((r) => s.srv.listen(0, '127.0.0.1', () => { s.url = `http://127.0.0.1:${s.srv.address().port}`; r(s); }));
}

function model() {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: 'Research' }, finish_reason: 'stop' }] })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: RESEARCH }, finish_reason: null }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-openin-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_ENGINE: 'local', NEXY_HOSTS: HOST, ...env }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/api/v1/health`); return { p, base: `http://${HOST}:${port}` }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

// one saved chat with every kind of output the pane restores; `open` is what the button must do
const OUTPUTS = [
  { o: { id: 'build:site', kind: 'html', title: 'Bakery site', source: '<html><body><h1>Fresh bread</h1></body></html>' }, open: 'Open in a new tab' },
  { o: { id: 'game:snake', kind: 'game', title: 'Snake', source: '<html><body><canvas></canvas></body></html>' }, open: 'Open in a new tab' },
  { o: { id: 'qiki:run', kind: 'html', title: 'Preview page', href: '/api/apps/build/api/director/runs/abc/preview' }, open: 'Open in a new tab' },
  { o: { id: 'images:cat', kind: 'image', title: 'Cat picture', href: '/api/apps/images/api/history/cat.png' }, open: null },
  { o: { id: 'beat:loop', kind: 'audio', title: 'Drum loop', href: '/api/apps/beat/api/history/loop.wav' }, open: null },
  { o: { id: 'startup:plan', kind: 'plan', title: 'Launch plan', markup: '<div class="doc"><p>Week one</p></div>' }, open: null },
  { o: { id: 'sheet:sales', kind: 'table', title: 'Sales sheet', source: 'month,amount\nOct,1200' }, open: null },
  { o: { id: 'text:note', kind: 'text', title: 'A note', markup: '<p>Note</p>' }, open: null },
  { o: { id: 'code:script', kind: 'code', title: 'script.py', markup: '<pre>print(1)</pre>' }, open: null },
  { o: { id: 'flow:steps', kind: 'diagram', title: 'Steps flow', markup: '<p>flow</p>' }, open: null },
  { o: { id: 'doc:memo', kind: 'doc', title: 'memo.md', source: '# Memo\n\nThe lease is signed.' }, open: 'Open in Docs', doc: true },
  { o: { id: 'docs:held', kind: 'doc', title: 'contract.pdf', href: '/api/apps/docs/api/v1/document?id=5' }, open: 'Open in Docs', doc: true },
  { o: { id: 'doc:old', kind: 'doc', title: 'old-notes.md', markup: '<div class="doc"><p>Saved before Markdown was kept</p></div>' }, open: null },
];
const CHAT = { id: 'copenin', pid: '_', title: 'Everything made', outputs: OUTPUTS.map((x) => x.o), activeOutput: OUTPUTS[0].o.id,
  html: '<div class="msg m me"><div class="bub">Make things</div></div><div class="msg m ai"><div class="bub">Done</div></div>',
  history: [{ role: 'user', content: 'Make things' }, { role: 'assistant', content: 'Done' }] };

let docs, m, s, b;
test.before(async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  docs = await ownDocs();
  m = await model();
  s = await start({ NEXY_DOCS_URL: docs.url, NEXY_LLM_URL: m.url });
  b = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`] });
});
test.after(async () => { await b?.close(); s?.p.kill(); m?.srv.close(); docs?.srv.close(); });

// a browser whose new tabs are recorded; the Docs app is a stand-in page
async function session() {
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  const tabs = [];
  await ctx.route(/^https:\/\/docs\.my\.owner\.test\//, (r) => r.fulfill({ contentType: 'text/html', body: '<title>Docs</title><p>Own Docs</p>' }));
  ctx.on('page', (p) => {
    const t = { page: p, urls: [] }; tabs.push(t);
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) t.urls.push(f.url()); });
  });
  await ctx.addInitScript(() => { window.__toasts = []; addEventListener('nexy:toast', (e) => window.__toasts.push(String(e.detail))); });
  const page = await ctx.newPage();
  tabs.length = 0;
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(s.base + '/');
  await page.locator('#input').waitFor({ timeout: 20000 });
  return { ctx, page, tabs, errors };
}
const said = async (page) => [await page.locator('body').innerText(), ...(await page.evaluate(() => window.__toasts))].join('\n');
const urlsOf = (tabs) => tabs.flatMap((t) => [t.page.url(), ...t.urls]);

async function openSaved(page) {
  const r = await page.evaluate((c) => fetch('/api/v1/chats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) }).then((x) => x.status), CHAT);
  assert.ok(r === 200 || r === 409, `chat saved (${r})`);
  await page.reload();
  await page.locator(`[data-chat="${CHAT.id}"]`).first().click();
  await page.locator('#cvTabs .cvtab').nth(OUTPUTS.length - 1).waitFor({ timeout: 15000 });
}
// the tab shows the plain name: "old-notes.md" is "old notes"
const plain = (n) => /^[\w-]+\.(html?|md|csv|png|mmd)$/i.test(n) ? n.replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ') : n;
async function pick(page, title) {
  await page.locator('#cvTabs .cvtab', { hasText: plain(title) }).first().click({ timeout: 4000 });
  await page.waitForFunction((t) => document.querySelector('#cvTitle')?.textContent === t, plain(title), { timeout: 5000 });
  await page.waitForTimeout(150);
}
const openBtn = (page) => page.locator('#cvOpenApp');
async function askForDoc(page, q) {
  await page.locator('#input').fill(q);
  await page.locator('#input').press('Enter');
  await page.locator('#cvBody').getByText('Step 16').waitFor({ timeout: 30000 })
    .catch(async (e) => { throw new Error(`${e.message.split('\n')[0]}\n${(await page.locator('#thread').innerText()).slice(-600)}`); });
}

test('each kind: the Open button shows only when it opens that item, and opens it', { timeout: 150000 }, async () => {
  docs.features = ['doc-link'];
  const { ctx, page, tabs, errors } = await session();
  try {
    await openSaved(page);
    for (const x of OUTPUTS) {
      await pick(page, x.o.title);
      const shown = await openBtn(page).isVisible();
      if (!x.open) { assert.equal(shown, false, `${x.o.kind} "${x.o.title}": no Open button, nothing opens that exact item`); continue; }
      assert.equal(shown, true, `${x.o.kind} "${x.o.title}": Open shows`);
      assert.equal((await openBtn(page).innerText()).trim(), x.open);
      const before = tabs.length, up = docs.uploads.length;
      await openBtn(page).click();
      const landed = () => urlsOf(tabs.slice(before)).some((u) => x.doc ? /\?doc=/.test(u) : u !== 'about:blank');
      for (let i = 0; i < 60 && !landed(); i++) await sleep(250);
      assert.equal(tabs.length, before + 1, `${x.o.title}: one new tab`);
      const urls = urlsOf(tabs.slice(before));
      if (x.o.id === 'docs:held') { assert.ok(urls.some((u) => /^https:\/\/docs\.my\.owner\.test\/\?doc=5$/.test(u)), urls.join(' ')); assert.equal(docs.uploads.length, up, 'a file already in Own Docs is not uploaded again'); }
      else if (x.doc) assert.ok(urls.some((u) => /^https:\/\/docs\.my\.owner\.test\/\?doc=\d+$/.test(u)), `${urls.join(' ')} ${JSON.stringify(docs.uploads)} ${await said(page).then((t) => t.slice(-300))}`);
      else if (x.o.href) assert.ok(urls.some((u) => u.endsWith(x.o.href)), urls.join(' '));
      else assert.ok(urls.some((u) => u.startsWith('blob:')), urls.join(' '));
    }
    const memo = docs.uploads.filter((u) => u.filename === 'memo.md');
    assert.equal(memo.length, 1);
    assert.equal(memo[0].body, '# Memo\n\nThe lease is signed.', 'the Markdown itself, kept with the saved chat');
    assert.doesNotMatch(await said(page), DEAD_END);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('Own Docs without doc-link: no Open in Docs, Download still saves the .md', { timeout: 90000 }, async () => {
  docs.features = undefined;
  const { ctx, page, errors } = await session();
  try {
    await openSaved(page);
    for (const t of ['memo.md', 'contract.pdf']) {
      await pick(page, t);
      await page.waitForTimeout(400);
      assert.equal(await openBtn(page).isVisible(), false, `${t}: hidden until Own Docs can open one document`);
    }
    await pick(page, 'memo.md');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#cvDownload').click()]);
    assert.match(dl.suggestedFilename(), /^memo\.md$/);
    assert.equal(fs.readFileSync(await dl.path(), 'utf8'), '# Memo\n\nThe lease is signed.');
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); docs.features = ['doc-link']; }
});

test('a document written in chat: Open in Docs uploads it once and opens ?doc=<id>', { timeout: 120000 }, async () => {
  docs.features = ['doc-link'];
  const { ctx, page, tabs, errors } = await session();
  try {
    await askForDoc(page, 'Write a research report about ownx.co');
    await openBtn(page).waitFor({ state: 'visible', timeout: 5000 });
    assert.equal((await openBtn(page).innerText()).trim(), 'Open in Docs');
    const title = (await page.locator('#cvTitle').textContent()).trim();
    const up = docs.uploads.length;
    // two quick clicks, then a third once the first has opened
    await openBtn(page).click(); await openBtn(page).click();
    for (let i = 0; i < 60 && !urlsOf(tabs).filter((u) => /\?doc=/.test(u)).length; i++) await sleep(250);
    await openBtn(page).click();
    for (let i = 0; i < 60 && urlsOf(tabs).filter((u) => /\?doc=/.test(u)).length < 3; i++) await sleep(250);
    const mine = docs.uploads.slice(up);
    assert.equal(mine.length, 1, 'uploaded once for three clicks');
    assert.match(mine[0].filename, /\.md$/);
    assert.equal(plain(mine[0].filename), title, 'named for the document on the right');
    assert.equal(mine[0].body, RESEARCH);
    assert.equal(mine[0].type, 'text/markdown');
    assert.doesNotMatch(mine[0].query, /ephemeral/);
    const opened = urlsOf(tabs).filter((u) => /\?doc=/.test(u));
    assert.ok(opened.length >= 3 && opened.every((u) => /^https:\/\/docs\.my\.owner\.test\/\?doc=\d+$/.test(u)), opened.join(' '));
    const id = Number(/doc=(\d+)/.exec(opened[0])[1]);
    assert.ok(docs.looks.get(id) >= 2, 'waited for indexing before opening');
    assert.doesNotMatch(await said(page), DEAD_END);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('an upload Own Docs refuses: said plainly, no tab left open, the document stays', { timeout: 120000 }, async () => {
  docs.features = ['doc-link']; docs.fail = true;
  const { ctx, page, tabs, errors } = await session();
  try {
    await askForDoc(page, 'Write a research report about ownx.co please');
    await openBtn(page).click();
    await page.waitForFunction(() => window.__toasts.some((t) => /could not be put in Own Docs/.test(t)), null, { timeout: 15000 });
    const msg = (await page.evaluate(() => window.__toasts)).find((t) => /Own Docs/.test(t));
    assert.match(msg, /the embedding model is not loaded\. It is still here\.$/);
    await sleep(300);
    assert.ok(tabs.every((t) => t.page.isClosed()), 'the blank tab is closed');
    assert.ok(await page.locator('#cvBody').getByText('Step 16').isVisible());
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); docs.fail = false; }
});

test('every visible work-pane button: none leads to a "cannot" or "not yet" message', { timeout: 300000 }, async () => {
  docs.features = ['doc-link'];
  const { ctx, page, errors } = await session();
  try {
    // after each click the pane is brought back; a fresh load only when a modal or picker stays in the way
    const back = async (title) => {
      if (await page.locator('#ovShare.open').count()) await page.keyboard.press('Escape');
      await pick(page, title).catch(async () => { await openSaved(page); await pick(page, title); });
    };
    await openSaved(page);
    for (const x of OUTPUTS) {
      await back(x.o.title);
      const ids = await page.$$eval('.cvhead .acts button', (bs) => bs.filter((b) => b.checkVisibility() && b.id && !/cvClose|cvMax/.test(b.id)).map((b) => b.id));
      for (const [i, id] of ids.entries()) {
        if (i) await back(x.o.title);
        await page.evaluate(() => { window.__toasts = []; });
        await page.locator(`#${id}`).click({ timeout: 3000 });
        await page.waitForTimeout(500);
        assert.doesNotMatch(await said(page), DEAD_END, `${x.o.title}: ${id}`);
      }
    }
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('no dead-end wording left in the client', () => {
  const dir = path.join(__dirname, '..', 'src', 'client');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(t, /cannot jump|do not take an artifact id|nowhere to hand it|Use the button above/, f);
  }
});
