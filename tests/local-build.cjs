// Building on a computer without an Own1: a website request goes to the engine's builder, is
// checked (brief names in it, no network, no errors when it runs) and opens in the canvas. A
// failed check gets one more try; two failures end in a plain sentence, never a page. On an
// Own1 the same request still goes to Own Build. The model is a stand-in. Run after `npm run build`:
//   PLAYWRIGHT_MODULE=<path to playwright> node --test tests/local-build.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const KEY = 'stand-in-key';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = (title, body, script = '') =>
  `<!doctype html><html><head><title>${title}</title><style>body{font-family:sans-serif}</style></head><body>${body}<script>${script}</script></body></html>`;

const FLOWERS = page('Petal &amp; Stem', '<h1>Petal &amp; Stem</h1><p>Fresh flowers and bouquets, arranged by hand every morning.</p>');
const BAKERY = page('Crumb &amp; Co', '<h1>Crumb &amp; Co</h1><p>Sourdough bread and pastries from our bakery oven.</p>');
const GENERIC = page('Nexus', '<h1>Trusted by forward-thinking teams</h1><p>CTO, Nexus Dynamics</p>');
const THROWS = page('Todo', '<h1>Todo</h1><input id="t"><ul></ul>', 'document.querySelector("#missing").addEventListener("click", function(){})');
const CALLS_OUT = page('Pricing', '<h1>Pricing</h1><p>Basic $9, Pro $29, Team $79</p>', 'fetch("https://example.com/prices.json").then(function(){}, function(){})');

// the builder pack as the engine serves it: one write_file call recorded in the session
function engine(pick) {
  const asked = [], sessions = new Map();
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const authed = req.headers.authorization === `Bearer ${KEY}`;
      res.setHeader('content-type', 'application/json');
      if (req.url === '/health') return res.end(JSON.stringify(authed ? { ok: true, bots: ['nexy', 'builder'] } : { ok: true }));
      if (!authed) { res.statusCode = 401; return res.end('{"error":"missing or wrong key"}'); }
      const m = /^\/p\/builder\/api\/sessions\/([^/]+)\/messages/.exec(req.url);
      if (m) {
        const html = sessions.get(decodeURIComponent(m[1]));
        const data = html == null ? [] : [{ role: 'tool', tool_name: 'write_file', content: JSON.stringify({ args: { path: 'index.html', content: html }, result: 'wrote index.html' }) }];
        return res.end(JSON.stringify({ data }));
      }
      if (req.url === '/p/builder/v1/chat/completions') {
        const prompt = JSON.parse(body).messages.at(-1).content;
        asked.push(prompt);
        sessions.set(req.headers['x-session-id'], pick(prompt));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        await sleep(300);
        res.write(': tool write_file\n\n');
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'I built it.' }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
        return res.end();
      }
      // chat and titles
      res.end(JSON.stringify({ choices: [{ message: { content: 'Website' }, finish_reason: 'stop' }] }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, asked, url: `http://127.0.0.1:${srv.address().port}` })));
}

// Own Build on an Own1: starts a build and finishes it at once
function ownBuild() {
  const calls = [];
  const srv = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST' && req.url.startsWith('/api/build')) return res.end('{"buildId":"b1"}');
    if (req.url.startsWith('/api/build?id=b1')) return res.end(JSON.stringify({ status: 'done', elapsedSeconds: 3, runId: 'r1', artifact: { html: FLOWERS, title: 'Petal & Stem' } }));
    res.end('{"runs":[],"projects":[]}');
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, calls, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-build-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

async function ask(pg, text) {
  await pg.locator('#input').fill(text);
  await pg.locator('#input').press('Enter');
}

const canvasFrame = (pg) => pg.frameLocator('#cvBody iframe').first();

test('a computer builds with the engine: checked, shown in the canvas, one retry, then a plain no', async () => {
  const e = await engine((prompt) => {
    if (/Petal & Stem/.test(prompt)) return FLOWERS;
    if (/Crumb & Co/.test(prompt)) return /did not pass a check/.test(prompt) ? BAKERY : GENERIC;
    if (/todo/i.test(prompt)) return THROWS;
    return CALLS_OUT;
  });
  const s = await start({ NEXY_STUDIOS: 'off', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: e.url, NEXY_AGENT_KEY: KEY, NEXY_LLM_URL: e.url });
  const b = await chromium.launch();
  try {
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = []; pg.on('pageerror', (x) => errors.push(x.message));
    const studio = []; pg.on('request', (r) => { if (/\/api\/apps\/build\/api\/build/.test(r.url())) studio.push(r.url()); });
    await pg.goto(s.base + '/');
    await pg.locator('#input').waitFor({ timeout: 20000 });
    assert.match(await pg.locator('html').getAttribute('data-apps'), /\bbuilder\b/);
    // examples it can build are offered; a project board needs Own Startup, which isn't here
    await pg.locator('#exList [data-ex]').first().waitFor({ timeout: 10000 });
    const ex = await pg.locator('#exList').innerText();
    assert.match(ex, /Website: ice cream parlour/);
    assert.doesNotMatch(ex, /Project board|Launch plan/);

    // a brief with a name: built, checked, in the canvas
    await ask(pg, 'build me a website for a flower shop called Petal & Stem');
    await pg.getByText(/Done\. It is on the right/).waitFor({ timeout: 30000 });
    await canvasFrame(pg).getByRole('heading', { name: 'Petal & Stem' }).waitFor({ timeout: 10000 });
    assert.match(e.asked[0], /Petal & Stem/);
    assert.match(e.asked[0], /Save it as index\.html/);
    assert.equal(e.asked.length, 1);

    // a page that leaves out the name is never shown; the second try is told why
    await ask(pg, 'make a website for my bakery called Crumb & Co');
    await pg.getByText(/Done\. It is on the right/).nth(1).waitFor({ timeout: 30000 });
    await canvasFrame(pg).getByRole('heading', { name: 'Crumb & Co' }).waitFor({ timeout: 10000 });
    assert.equal(e.asked.length, 3);
    assert.match(e.asked[2], /left out the name "Crumb & Co"/);
    assert.equal(await pg.getByText('Trusted by forward-thinking teams').count(), 0);

    // a page that throws when it runs: two tries, then a plain sentence and no page
    await ask(pg, 'build me a todo app');
    await pg.getByText('I could not build that well enough to show you').waitFor({ timeout: 40000 });
    assert.equal(e.asked.length, 5);
    assert.match(e.asked[4], /throws an error when it runs/);
    await pg.getByText('What went wrong').last().click();
    assert.match(await pg.locator('details code').last().innerText(), /throws an error/);

    // a page that reaches for the network when it runs is refused the same way
    await ask(pg, 'build me a pricing page with three plans');
    await pg.getByText('I could not build that well enough to show you').nth(1).waitFor({ timeout: 40000 });
    assert.equal(e.asked.length, 7);
    assert.match(e.asked[6], /outside the page/);

    assert.deepEqual(studio, [], 'no Own Build studio on this computer');
    // the broken page's own error, thrown inside the unseen check frame, is the only one
    assert.deepEqual(errors.filter((x) => !/reading 'addEventListener'/.test(x)), []);
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});

test('a computer whose engine has no builder still says building is not here', async () => {
  const e = await engine(() => FLOWERS);
  // the wrong key: the engine does not list its packs
  const s = await start({ NEXY_STUDIOS: 'off', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: e.url, NEXY_AGENT_KEY: 'wrong', NEXY_LLM_URL: e.url });
  const b = await chromium.launch();
  try {
    const pg = await b.newPage();
    await pg.goto(s.base + '/');
    await pg.locator('#input').waitFor({ timeout: 20000 });
    assert.doesNotMatch(await pg.locator('html').getAttribute('data-apps'), /\bbuilder\b/);
    await ask(pg, 'build me a website for a ping pong ball business');
    await pg.getByText("Building websites and apps isn't in Nexy on this computer yet").waitFor({ timeout: 15000 });
    assert.equal(e.asked.length, 0);
    const r = await fetch(s.base + '/api/v1/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"brief":"a site"}' });
    assert.equal(r.status, 404);
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});

test('an Own1 still builds with Own Build', async () => {
  const e = await engine(() => FLOWERS);
  const ob = await ownBuild();
  const s = await start({ NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: e.url, NEXY_AGENT_KEY: KEY, NEXY_LLM_URL: e.url, NEXY_BUILD_URL: ob.url });
  const b = await chromium.launch();
  try {
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const local = []; pg.on('request', (r) => { if (r.url().includes('/api/v1/build')) local.push(r.url()); });
    await pg.goto(s.base + '/');
    await pg.locator('#input').waitFor({ timeout: 20000 });
    assert.equal(await pg.locator('html').getAttribute('data-place'), 'own1');
    assert.doesNotMatch(await pg.locator('html').getAttribute('data-apps'), /\bbuilder\b/);
    await ask(pg, 'build me a website for a flower shop called Petal & Stem');
    await pg.getByText(/Done — it is on the right/).waitFor({ timeout: 30000 });
    assert.ok(ob.calls.some((c) => c.startsWith('POST /api/build')), ob.calls.join(', '));
    assert.deepEqual(local, []);
    assert.equal(e.asked.length, 0, 'the engine builder is not used on an Own1');
    const r = await fetch(s.base + '/api/v1/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"brief":"a site"}' });
    assert.equal(r.status, 404);
  } finally { await b.close(); s.p.kill(); e.srv.close(); ob.srv.close(); }
});
