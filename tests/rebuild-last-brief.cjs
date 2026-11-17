// "build again" after a build that failed its run check: Nexy reruns the original brief, the
// same kind, and tells the builder the error; it never builds a page called "again".
// The failure goes in Nexy's turn log with the brief's length, never its text.
// Own Build and the engine's builder are stand-ins. Run after `npm run build`:
//   PLAYWRIGHT_MODULE=<path to playwright> node --test tests/rebuild-last-brief.cjs
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
const BRIEF = 'Build a simple landing website for a game developer called Pixel Forge';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = (body, script = '') => `<!doctype html><html><head><title>Pixel Forge</title><style>body{font-family:sans-serif;margin:0 auto;max-width:720px}</style></head><body>${body}<script>${script}</script></body></html>`;
const BROKEN = page('<h1>Pixel Forge</h1><p>Indie games made with care, from our small studio by the sea.</p><a href="#games">Our games</a>', 'var games;\ndocument.title = games.length;');
// a website is shown only with real words on it (200 characters or more)
const FIXED = page('<h1>Pixel Forge</h1><p>Indie games made with care, from our small studio by the sea.</p><p>We are three people who make small, kind games for phones and computers, and we answer every message ourselves. Our newest game comes out in the spring.</p><a href="#games">Our games</a>');

const EXCERPT_ERROR = "Uncaught TypeError: Cannot read properties of undefined (reading 'length') (line 214: `const n = obstacles.length;`)";
// Own Build: the first build throws when it runs (or, with firstError, fails its own run check), the rebuild does not
function ownBuild(firstError) {
  const posts = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url.startsWith('/api/build')) { posts.push(JSON.parse(body)); return res.end(JSON.stringify({ buildId: `b${posts.length}` })); }
      const m = /^\/api\/build\?id=b(\d+)/.exec(req.url);
      if (m && m[1] === '1' && firstError) return res.end(JSON.stringify({ status: 'error', elapsedSeconds: 3, error: firstError }));
      if (m) return res.end(JSON.stringify({ status: 'done', elapsedSeconds: 3, runId: `r${m[1]}`, artifact: { html: m[1] === '1' ? BROKEN : FIXED, title: 'Pixel Forge' } }));
      res.end('{"runs":[],"projects":[]}');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, posts, url: `http://127.0.0.1:${srv.address().port}` })));
}

// the engine with its builder pack: every page it writes throws until it is told the error
function engine() {
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
        sessions.set(req.headers['x-session-id'], asked.length > 2 ? FIXED : BROKEN);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        await sleep(200);
        res.write(': tool write_file\n\n');
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'I built it.' }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
        return res.end();
      }
      res.end(JSON.stringify({ choices: [{ message: { content: 'Website' }, finish_reason: 'stop' }] }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, asked, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-rebuild-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = { text: '' };
  p.stdout.on('data', (c) => { out.text += c; });
  p.stderr.on('data', () => {});
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, out, data }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

async function ask(pg, text) {
  await pg.locator('#input').fill(text);
  await pg.locator('#input').press('Enter');
}
const lines = (out) => out.text.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
const failures = (out) => lines(out).filter((l) => l.endpoint === 'build' && l.result === 'build-failed');
function savedChats(dir) {
  const all = [];
  const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, n.name); if (n.isDirectory()) walk(f); else if (n.name.endsWith('.json')) all.push(JSON.parse(fs.readFileSync(f, 'utf8'))); } };
  walk(path.join(dir, 'chats'));
  return all;
}
async function waitFor(fn, ms = 10000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) { const v = fn(); if (v) return v; }
  return fn();
}

test('an Own1: build again reruns the brief with the run-check error, never "again"', async () => {
  const e = await engine();
  const ob = await ownBuild();
  const s = await start({ NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: e.url, NEXY_AGENT_KEY: KEY, NEXY_LLM_URL: e.url, NEXY_BUILD_URL: ob.url });
  const b = await chromium.launch();
  try {
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
    await pg.goto(s.base + '/');
    await pg.locator('#input').waitFor({ timeout: 20000 });
    assert.equal(await pg.locator('html').getAttribute('data-place'), 'own1');

    await ask(pg, BRIEF);
    await pg.getByText(/throws when it runs/).waitFor({ timeout: 30000 });
    assert.match(await pg.getByText(/throws when it runs/).innerText(), /reading 'length'/);
    assert.equal(ob.posts.length, 1);

    // the failure is in the turn log: id, kind, brief length, the error and its line; no brief text
    const [f] = await waitFor(() => failures(s.out).length && failures(s.out));
    assert.ok(f, 'a build-failed line');
    assert.equal(f.build, 'build:r1');
    assert.equal(f.kind, 'web_app');
    assert.equal(f.builder, 'own-build');
    assert.equal(f.briefChars, BRIEF.length);
    assert.ok(f.ms > 0);
    assert.match(f.error, /Cannot read properties of undefined \(reading 'length'\)/);
    assert.match(f.where, /^line \d+:\d+$/);
    assert.doesNotMatch(s.out.text, /Pixel Forge|game developer/, 'the brief never reaches the log');

    // the brief, its kind and the error are kept with the chat
    const saved = await waitFor(() => savedChats(s.data).find((c) => c.lastBuild?.outcome === 'failed'));
    assert.ok(saved, 'the failed build saved with the chat');
    assert.equal(saved.lastBuild.brief, BRIEF);
    assert.equal(saved.lastBuild.deliverable, 'web_app');
    assert.equal(saved.lastBuild.id, 'build:r1');
    assert.match(saved.lastBuild.error, /reading 'length'/);

    await ask(pg, 'build again');
    await pg.getByText('Building it again, and fixing the error it hit').waitFor({ timeout: 15000 });
    await pg.getByText(/and it runs\. Built on this machine/).waitFor({ timeout: 30000 });
    assert.equal(ob.posts.length, 2);
    const again = ob.posts[1];
    assert.equal(again.kind, 'web_app');
    assert.notEqual(again.title, 'again');
    assert.equal(again.title, ob.posts[0].title);
    assert.ok(again.description.startsWith(BRIEF), again.description);
    assert.match(again.description, /The previous build failed its run check with: .*Cannot read properties of undefined \(reading 'length'\) \(line \d+:\d+\)\. Fix that\./);

    // a new chat with nothing built: asked what to build, nothing started
    await pg.locator('#newChat').click();
    await pg.locator('#input').waitFor({ timeout: 20000 });
    await ask(pg, 'build again');
    await pg.getByText('What should I build?').waitFor({ timeout: 15000 });
    await sleep(500);
    assert.equal(ob.posts.length, 2);
  } finally { await b.close(); s.p.kill(); e.srv.close(); ob.srv.close(); }
});

test('an Own1: Own Build\'s code excerpt goes to the rebuild, never to the chat or the log', async () => {
  const e = await engine();
  const ob = await ownBuild(EXCERPT_ERROR);
  const s = await start({ NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: e.url, NEXY_AGENT_KEY: KEY, NEXY_LLM_URL: e.url, NEXY_BUILD_URL: ob.url });
  const b = await chromium.launch();
  try {
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
    await pg.goto(s.base + '/');
    await pg.locator('#input').waitFor({ timeout: 20000 });
    await ask(pg, BRIEF);
    await pg.getByText('What went wrong').waitFor({ timeout: 30000 });
    await pg.getByText('What went wrong').click();
    const shown = await pg.locator('#thread').innerText();
    assert.match(shown, /reading 'length'\) \(line 214\)/);
    assert.doesNotMatch(shown, /obstacles|const n/, 'no code in the chat');

    const [f] = await waitFor(() => failures(s.out).length && failures(s.out));
    assert.equal(f.where, 'line 214');
    assert.doesNotMatch(s.out.text, /obstacles|const n|Pixel Forge|game developer/, 'no code or brief in the log');

    await ask(pg, 'build again');
    await pg.getByText('Building it again, and fixing the error it hit').waitFor({ timeout: 15000 });
    await pg.getByText(/and it runs\. Built on this machine/).waitFor({ timeout: 30000 });
    assert.equal(ob.posts.length, 2);
    assert.ok(ob.posts[1].description.startsWith(BRIEF));
    assert.ok(ob.posts[1].description.includes(`The previous build failed its run check with: ${EXCERPT_ERROR}. Fix that.`), ob.posts[1].description);
    assert.doesNotMatch(await pg.locator('#thread').innerText(), /obstacles|const n/);
  } finally { await b.close(); s.p.kill(); e.srv.close(); ob.srv.close(); }
});

test('a computer: build again after two failed checks reruns the brief and tells the engine the error', async () => {
  const e = await engine();
  const s = await start({ NEXY_STUDIOS: 'off', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: e.url, NEXY_AGENT_KEY: KEY, NEXY_LLM_URL: e.url });
  const b = await chromium.launch();
  try {
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
    await pg.goto(s.base + '/');
    await pg.locator('#input').waitFor({ timeout: 20000 });
    assert.match(await pg.locator('html').getAttribute('data-apps'), /\bbuilder\b/);

    await ask(pg, BRIEF);
    await pg.getByText('I could not build that well enough to show you').waitFor({ timeout: 40000 });
    assert.equal(e.asked.length, 2);
    const logged = await waitFor(() => failures(s.out).length >= 2 && failures(s.out));
    assert.equal(logged.length, 2);
    for (const f of logged) {
      assert.equal(f.builder, 'engine');
      assert.equal(f.briefChars, BRIEF.length);
      assert.match(f.error, /reading 'length'/);
      assert.match(f.where, /^line \d+:\d+$/);
    }
    assert.doesNotMatch(s.out.text, /Pixel Forge|game developer/);

    await ask(pg, 'that didn\'t work, try again');
    await pg.getByText('Building it again on this computer, and fixing the error it hit').waitFor({ timeout: 15000 });
    await pg.getByText(/Done\. It is on the right/).waitFor({ timeout: 40000 });
    assert.equal(e.asked.length, 3);
    assert.match(e.asked[2], /Pixel Forge/);
    assert.match(e.asked[2], /game developer/);
    assert.match(e.asked[2], /Cannot read properties of undefined \(reading 'length'\)/);
    assert.doesNotMatch(e.asked[2], /^\s*again\b/i);
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});
