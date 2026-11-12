// Routine times are the owner's: the device's time zone goes with chat turns, new routines and
// Confirm; an agent without zones gets the UTC schedule instead; the Routines view shows times on
// the device's clock. The agents are stand-ins.
// Run after `npm run build`: node --test tests/routine-tz.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const MANILA_8AM = 1794528000; // Fri 13 Nov 2026 00:00 UTC

// zones: whether the agent keeps a zone per routine (and says so back)
function agent(zones) {
  const seen = [];
  let next = 20;
  let jobs = [
    { id: 7, name: 'Morning sales', schedule: 'daily 08:00', tz: 'Asia/Manila', prompt: 'Check my sales.', enabled: true, next_run_at: MANILA_8AM, last_run_at: null, last_status: null, status: 'active', origin: null },
    { id: 8, name: 'Manila weather', schedule: 'daily 08:00', tz: 'UTC', prompt: 'Search for the current weather in Manila, Philippines. Summarize the temperature, conditions, and any alerts.', enabled: true, next_run_at: null, last_run_at: null, last_status: null, status: 'pending', origin: 'earlier in this chat' },
  ];
  if (!zones) jobs = jobs.map(({ tz, ...j }) => j);
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = body ? JSON.parse(body) : null;
      seen.push({ method: req.method, path: req.url, body: b });
      res.setHeader('content-type', 'application/json');
      const m = /^\/api\/jobs\/(\d+)\/confirm$/.exec(req.url);
      if (m && req.method === 'POST') {
        const tz = zones ? (b?.tz ?? 'UTC') : undefined;
        return res.end(JSON.stringify({ job: { id: Number(m[1]), status: 'active', next_run_at: MANILA_8AM, ...(tz ? { tz } : {}) } }));
      }
      if (req.url === '/api/jobs' && req.method === 'POST') {
        const id = next++;
        const tz = zones ? (b.tz ?? 'UTC') : undefined;
        return res.end(JSON.stringify({ job: { id, name: b.name, schedule: b.schedule, next_run_at: MANILA_8AM, ...(tz ? { tz } : {}) } }));
      }
      if (req.method === 'DELETE' && req.url.startsWith('/api/jobs/')) return res.end('{"deleted":1}');
      if (req.url === '/api/jobs') return res.end(JSON.stringify({ jobs }));
      if (req.url.startsWith('/api/sessions')) return res.end('{"data":[]}');
      if (req.url.startsWith('/v1/chat/completions')) return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }));
      res.end('{}');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-tz-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, NEXY_EVAL: '', HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { await fetch(base + '/api/v1/health'); return { p, base, data, log: () => log }; }
    catch (e) { if (e?.cause?.code !== 'ECONNREFUSED') throw e; await new Promise((r) => setTimeout(r, 150)); }
  }
  p.kill(); throw new Error('server did not start\n' + log);
}

const stop = (a, g) => { a?.p.kill(); g?.srv.close(); if (a) fs.rmSync(a.data, { recursive: true, force: true }); };
const call = (app, method, body) => fetch(app.base + '/api/v1/routines', { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const NEW = { name: 'Sales', schedule: '0 8 * * *', utcSchedule: '0 0 * * *', prompt: 'Check my sales.' };

let gw, app;
test.before(async () => { gw = await agent(true); app = await start({ NEXY_AGENT_URL: gw.url, NEXY_AGENT_KEY: 'test-key' }); });
test.after(() => stop(app, gw));

test('a new routine and Confirm carry the owner\'s zone to the agent', async () => {
  const r = await call(app, 'POST', { ...NEW, tz: 'Asia/Manila' });
  assert.equal(r.status, 200);
  const { routine } = await r.json();
  assert.equal(routine.tz, 'Asia/Manila');
  assert.equal(routine.schedule, '0 8 * * *', 'the local schedule stays');
  const made = gw.seen.filter((s) => s.method === 'POST' && s.path === '/api/jobs');
  assert.equal(made.length, 1);
  assert.equal(made[0].body.tz, 'Asia/Manila');
  assert.equal(made[0].body.schedule, '0 8 * * *');
  const c = await call(app, 'PATCH', { id: '8', action: 'confirm', tz: 'Asia/Manila' });
  assert.equal(c.status, 200);
  assert.equal((await c.json()).routine.tz, 'Asia/Manila');
  assert.deepEqual(gw.seen.find((s) => s.path === '/api/jobs/8/confirm').body, { tz: 'Asia/Manila' });
  const list = (await (await call(app, 'GET')).json()).routines;
  assert.deepEqual(list.map((x) => x.tz), ['Asia/Manila', 'UTC']);
});

test('an unknown zone is refused before it reaches the agent', async () => {
  const before = gw.seen.length;
  for (const tz of ['Mars/Olympus', '+08:00', 'x'.repeat(80)]) {
    const r = await call(app, 'POST', { ...NEW, tz });
    assert.equal(r.status, 400, tz);
    assert.match((await r.json()).error, /time zone/);
  }
  assert.equal((await call(app, 'PATCH', { id: '8', action: 'confirm', tz: 'Mars/Olympus' })).status, 400);
  assert.equal(gw.seen.length, before);
});

test('chat turns carry the zone; an unknown one is dropped, not sent', async () => {
  const chat = async (tz) => {
    const before = gw.seen.length;
    const r = await fetch(app.base + '/api/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'what is a good name for a bakery' }], chat: 'c1', ...(tz ? { tz } : {}) }) });
    assert.equal(r.status, 200, await r.text());
    return gw.seen.slice(before).find((s) => s.path.startsWith('/v1/chat/completions')).body;
  };
  assert.equal((await chat('Asia/Manila')).tz, 'Asia/Manila');
  assert.equal((await chat('Mars/Olympus')).tz, undefined);
  assert.equal((await chat()).tz, undefined);
});

test('an agent without zones gets the UTC schedule instead', async () => {
  const g = await agent(false);
  const a = await start({ NEXY_AGENT_URL: g.url, NEXY_AGENT_KEY: 'test-key' });
  try {
    const r = await call(a, 'POST', { ...NEW, tz: 'Asia/Manila' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).routine.schedule, '0 0 * * *');
    const steps = g.seen.filter((s) => s.path.startsWith('/api/jobs')).map((s) => `${s.method} ${s.path} ${s.body?.schedule ?? ''} ${s.body?.tz ?? ''}`.trim());
    assert.deepEqual(steps, ['POST /api/jobs 0 8 * * * Asia/Manila', 'DELETE /api/jobs/20', 'POST /api/jobs 0 0 * * *']);
    // without the UTC form there is nothing correct to save
    const { utcSchedule, ...bare } = NEW;
    assert.equal((await call(a, 'POST', { ...bare, tz: 'Asia/Manila' })).status, 502);
    assert.equal(g.seen.filter((s) => s.method === 'DELETE').length, 2, 'the misread routine is removed');
  } finally { stop(a, g); }
});

test('the Routines view shows times on the device\'s clock', async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const g = await agent(true);
  const a = await start({ NEXY_AGENT_URL: g.url, NEXY_AGENT_KEY: 'test-key' });
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Manila' });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(a.base + '/');
    await p.waitForSelector('#input');
    await p.fill('#input', 'show my routines'); await p.press('#input', 'Enter');
    const live = p.locator('.block', { hasText: 'Morning sales' });
    await live.waitFor();
    assert.match(await live.textContent(), /every day at 8:00 am · next Fri 13 Nov, 8:00 am · not run yet/);
    const card = p.locator('.block', { hasText: 'Waiting for you: Manila weather' });
    await card.waitFor();
    const text = await card.textContent();
    assert.match(text, /every day at 8:00 am/);
    assert.doesNotMatch(text, /UTC/);
    // the label keeps one line beside a long value
    const label = card.locator('.row', { hasText: 'What it will run' }).locator('span').nth(1);
    const one = await card.locator('.row', { hasText: 'Came from' }).locator('span').nth(1).boundingBox();
    const box = await label.boundingBox();
    assert.ok(box.height <= one.height + 1, `"What it will run" wraps: ${box.height}px tall, one line is ${one.height}px`);
    if (process.env.SHOTS_DIR) await card.screenshot({ path: path.join(process.env.SHOTS_DIR, 'routine-tz-pending.png') });
    await card.locator('button', { hasText: 'Confirm' }).click();
    await p.locator('#thread .m.ai', { hasText: 'Confirmed Manila weather' }).waitFor();
    assert.match(await p.locator('#thread .m.ai', { hasText: 'Confirmed Manila weather' }).textContent(), /First run Fri 13 Nov, 8:00 am\./);
    assert.deepEqual(g.seen.find((s) => s.path === '/api/jobs/8/confirm').body, { tz: 'Asia/Manila' });
    // a routine said in chat: the device's 8 am, with the UTC form for agents without zones
    await p.fill('#input', 'Every day at 8am, check my sales'); await p.press('#input', 'Enter');
    await p.locator('.block', { hasText: 'Routine: check my sales' }).waitFor();
    const made = g.seen.find((s) => s.method === 'POST' && s.path === '/api/jobs');
    assert.deepEqual([made.body.schedule, made.body.tz], ['0 8 * * *', 'Asia/Manila']);
    assert.match(await p.locator('.block', { hasText: 'Routine: check my sales' }).textContent(), /Next runFri 13 Nov, 8:00 am/);
    let turn;
    for (let i = 0; i < 100 && !turn; i++) {
      turn = g.seen.find((s) => s.path.startsWith('/v1/chat/completions'));
      if (!turn) await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(turn, 'the first run went to the agent');
    assert.equal(turn.body.tz, 'Asia/Manila', 'chat turns from the page carry the zone');
    assert.deepEqual(errs, []);
  } finally {
    await b.close(); stop(a, g);
  }
});
