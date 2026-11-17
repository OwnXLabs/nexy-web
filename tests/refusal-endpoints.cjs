// The app's router refuses in plain words ({error:{message}}): offline or busy 503, daily limit 429,
// code expired or revoked 403. Chart research, social drafts and rewrites, and building on a computer
// say that sentence with its status, never the JSON, and do not ask again. Other failures are as before.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/refusal-endpoints.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const KEY = 'stand-in-key';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (srv) => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(`http://127.0.0.1:${srv.address().port}`)));
const REFUSALS = [
  [503, 'The shared Own 1 is offline right now. Try again in a few minutes.'],
  [429, "You have used today's messages on this shared Own 1. They reset at midnight."],
  [403, 'This guest code has expired or was revoked. Ask the owner for a new one.'],
];
const routerSaid = (code, say) => JSON.stringify({ error: { message: say, type: 'router' } });
const RAW = /model server|answered \d{3}|\{"|\\"|router/;

// the model server as the app's router passes it on; `refuse` is [code, sentence] or null
async function router() {
  const s = { refuse: null, asked: 0 };
  const srv = http.createServer(async (req, res) => {
    for await (const _ of req);
    if (!req.url.endsWith('/chat/completions')) { res.writeHead(404).end('{}'); return; }
    s.asked++;
    res.setHeader('content-type', 'application/json');
    if (s.refuse) { res.statusCode = s.refuse[0]; return res.end(routerSaid(...s.refuse)); }
    res.end(JSON.stringify({ choices: [{ message: { content: 'Fresh sourdough every morning at the corner bakery.' }, finish_reason: 'stop' }] }));
  });
  s.url = await listen(srv);
  s.close = () => srv.close();
  return s;
}

// Nexy Engine with the builder pack: a refused turn ends with finish_reason "error" and nexy.error
// "model server <code>: <json>", cut at 200 characters of the body as the engine does
async function nexyEngine() {
  const s = { refuse: null, asked: 0, built: 0 };
  const srv = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') return res.end(JSON.stringify({ ok: true, bots: ['nexy', 'builder'] }));
    const error = s.refuse && `model server ${s.refuse[0]}: ${routerSaid(...s.refuse).slice(0, 200)}`;
    if (req.url === '/p/builder/v1/chat/completions') {
      s.built++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`);
      return res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'error' }], nexy: { error } })}\n\ndata: [DONE]\n\n`);
    }
    if (/\/api\/sessions\//.test(req.url)) return res.end('{"data":[]}');
    if (req.url === '/v1/chat/completions') {
      s.asked++;
      if (s.refuse && JSON.parse(raw || '{}').stream !== true)
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'error' }], nexy: { error } }));
      return res.end(JSON.stringify({ choices: [{ message: { content: 'Website' }, finish_reason: 'stop' }] }));
    }
    res.end('{}');
  });
  s.url = await listen(srv);
  s.close = () => srv.close();
  return s;
}

// web search with one result, so a chart asks the model
async function searx() {
  const srv = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/status')) return res.end('{"state":"ready"}');
    res.end(JSON.stringify({ results: [{ title: 'Bread', url: 'https://a.example/bread', content: 'Bakeries sold 120 loaves in 2024 and 150 in 2025.' }] }));
  });
  const url = await listen(srv);
  return { url, close: () => srv.close() };
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-refusal-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data,
    NEXY_BOX_FEATURES: 'open', OWN_BUSY_TRIES: '3', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  p.stdout.on('data', (c) => { log += c; }); p.stderr.on('data', (c) => { log += c; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { await fetch(base + '/api/v1/health'); return { base, log: () => log, stop: () => { p.kill(); fs.rmSync(data, { recursive: true, force: true }); } }; }
    catch { await sleep(150); }
  }
  p.kill(); throw new Error('server did not start');
}

// one owner across calls: social drafts are kept per owner, named by the cookie the first answer sets
const jar = new Map();
const post = async (base, route, body) => {
  const r = await fetch(base + route, { method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(jar.has(base) ? { cookie: jar.get(base) } : {}) } });
  const set = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  if (set && !jar.has(base)) jar.set(base, set);
  return { status: r.status, body: await r.json() };
};
const chart = (base) => post(base, '/api/v1/research', { question: 'how many loaves did bakeries sell in 2024 and 2025' });
const draft = (base) => post(base, '/api/v1/social/draft', { brief: 'our sourdough', networks: ['x'], perNetwork: 1 });
const rewrite = (base) => post(base, '/api/v1/social/rewrite', { network: 'x', instruction: 'make it shorter' });

let m, sx;
test.before(async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  m = await router(); sx = await searx();
});
test.after(() => { m?.close(); sx?.close(); });

test('the model alone refused: chart research and social drafts and rewrites say the sentence with its status, asked once, the raw text only in the log', { timeout: 90000 }, async () => {
  const s = await start({ NEXY_LLM_URL: m.url, NEXY_SEARXNG_URL: sx.url });
  try {
    m.refuse = null;
    assert.equal((await draft(s.base)).status, 200, 'a draft to rewrite');
    for (const [code, say] of REFUSALS) {
      m.refuse = [code, say];
      for (const [name, call, said] of [['research', chart, (b) => b.note], ['draft', draft, (b) => b.error], ['rewrite', rewrite, (b) => b.error]]) {
        m.asked = 0;
        const r = await call(s.base);
        assert.equal(r.status, code, `${name} ${code}`);
        assert.equal(said(r.body), say, `${name} ${code}`);
        if (name === 'research') assert.equal(r.body.error, 'refused');
        assert.deepEqual(Object.keys(r.body).sort(), name === 'research' ? ['error', 'note'] : ['error'], `${name} ${code}: only the sentence`);
        assert.equal(m.asked, 1, `${name} ${code}: asked once`);
      }
    }
    assert.match(s.log(), /\[nexy\] research: model server 429: \{"error"/, 'the raw text in the log');
    assert.match(s.log(), /\[nexy\] social rewrite: the model answered 403: \{"error"/);
  } finally { s.stop(); m.refuse = null; }
});

test('Nexy Engine refused by its model server: social drafts and rewrites say the sentence; a build on this computer ends in it with no second try', { timeout: 90000 }, async () => {
  const e = await nexyEngine();
  const s = await start({ NEXY_STUDIOS: 'off', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: e.url, NEXY_AGENT_KEY: KEY, NEXY_LLM_URL: m.url });
  const b = await chromium.launch();
  try {
    assert.equal((await draft(s.base)).status, 200, 'a draft to rewrite');
    for (const [code, say] of REFUSALS) {
      e.refuse = [code, say];
      for (const call of [draft, rewrite]) {
        const r = await call(s.base);
        assert.equal(r.status, code, `${call.name} ${code}: ${JSON.stringify(r.body)}`); assert.deepEqual(r.body, { error: say });
      }
      // the build's own stream: the sentence and a mark not to try again
      const { body } = await post(s.base, '/api/v1/build', { brief: 'a website for a bakery called Crumb & Co' });
      const events = (await (await fetch(`${s.base}/api/v1/build?id=${body.id}`, { headers: { cookie: jar.get(s.base) } })).text()).split('\n\n')
        .filter((x) => x.startsWith('data: ')).map((x) => JSON.parse(x.slice(6)));
      const end = events.at(-1);
      assert.deepEqual({ type: end.type, error: end.error, refused: end.refused }, { type: 'failed', error: say, refused: code });
    }

    // in the page: the sentence is the reply, built once, not twice
    e.refuse = REFUSALS[1]; e.built = 0;
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = []; pg.on('pageerror', (x) => errors.push(x.message));
    await pg.goto(s.base + '/');
    await pg.locator('#input').waitFor({ timeout: 20000 });
    await pg.locator('#input').fill('build me a website for a flower shop called Petal & Stem');
    await pg.locator('#input').press('Enter');
    await pg.waitForFunction((say) => [...document.querySelectorAll('#thread .msg.ai .bub')].some((x) => x.innerText.startsWith(say)), REFUSALS[1][1], { timeout: 30000 });
    await sleep(1000);
    assert.equal(e.built, 1, 'no second try after a refusal');
    assert.doesNotMatch(await pg.locator('#thread').innerText(), RAW);
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.stop(); e.close(); }
});

test('a failure that is not the router\'s refusal is as before', { timeout: 60000 }, async () => {
  const s = await start({ NEXY_LLM_URL: m.url, NEXY_SEARXNG_URL: sx.url });
  try {
    for (const say of ['CUDA out of memory', 'your Own1 answered 503']) {
      m.refuse = [say === 'CUDA out of memory' ? 500 : 503, say];
      const r = await draft(s.base);
      assert.equal(r.status, 502);
      assert.match(r.body.error, /^the model on this machine did not write the posts: the model answered 50\d: /);
      const c = await chart(s.base);
      assert.equal(c.status, 502);
      assert.notEqual(c.body.error, 'refused');
    }
  } finally { s.stop(); m.refuse = null; }
});
