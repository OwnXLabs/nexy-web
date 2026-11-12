// One request, one routine (QA 0.2.8): "Every weekday at 7:30 am, remind me to …" set the routine
// from the owner's words, then its first run went to the agent as a plain "remind me to …", which
// the agent took for a new routine and made again at 8:00 every day. The stand-in agent does what
// that model did: it makes a routine of its own unless the turn says one is already set.
// Run after `npm run build`: node --test tests/one-routine.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const NEXT = 1794529800; // Fri 13 Nov 2026 07:30 Manila

function agent() {
  const jobs = [], turns = [];
  let next = 1;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = body ? JSON.parse(body) : null;
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/jobs' && req.method === 'POST') {
        const job = { id: next++, name: b.name, schedule: b.schedule, tz: b.tz, prompt: b.prompt, enabled: true, next_run_at: NEXT, status: 'active', origin: null };
        jobs.push(job);
        return res.end(JSON.stringify({ job }));
      }
      if (req.url === '/api/jobs') return res.end(JSON.stringify({ jobs }));
      if (req.url.startsWith('/api/sessions')) return res.end('{"data":[]}');
      if (req.url.startsWith('/v1/chat/completions')) {
        const said = [...b.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        turns.push(said);
        let reply;
        if (/already set/i.test(said) && /do not create/i.test(said)) {
          const when = /already set for ([^.]+)\./.exec(said)?.[1] ?? '?';
          reply = `Reminder: count the rice and canned goods stock. This runs ${when}.`;
        } else {
          // what the model did with its routine tool when told nothing
          jobs.push({ id: next++, name: 'count stock', schedule: 'daily 08:00', tz: b.tz, prompt: 'count the rice and canned goods stock', enabled: true, next_run_at: NEXT + 1800, status: 'active', origin: null });
          reply = "I've set up a daily routine to remind you to count the rice and canned goods stock at 8:00 AM.";
        }
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] }));
      }
      res.end('{}');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, jobs, turns, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-one-routine-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, NEXY_EVAL: '', HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { await fetch(base + '/api/v1/health'); return { p, base, data, log: () => log }; }
    catch (e) { if (e?.cause?.code !== 'ECONNREFUSED') throw e; await new Promise((r) => setTimeout(r, 150)); }
  }
  p.kill(); throw new Error('server did not start\n' + log);
}

test('a weekday reminder said in chat makes one routine, at the asked time, and the reply says that time', { timeout: 120000 }, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const g = await agent();
  const a = await start({ NEXY_AGENT_URL: g.url, NEXY_AGENT_KEY: 'test-key' });
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Manila' });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(a.base + '/');
    await p.waitForSelector('#input');
    await p.fill('#input', 'Every weekday at 7:30 am, remind me to count the rice and canned goods stock.');
    await p.press('#input', 'Enter');
    await p.locator('.block', { hasText: 'Routine: count the rice and canned goods stock.' }).waitFor();
    // the first run: the agent's answer arrives
    await p.locator('#thread .msg.ai', { hasText: /Reminder:|I've set up/ }).waitFor({ timeout: 60000 });
    assert.deepEqual(g.jobs.map((j) => [j.schedule, j.tz]), [['30 7 * * 1-5', 'Asia/Manila']], 'one routine, weekdays at 7:30');
    assert.equal(g.turns.length, 1);
    assert.match(g.turns[0], /remind me to count the rice and canned goods stock/, 'the first run still does the task');
    const thread = await p.locator('#thread').innerText();
    assert.match(thread, /every weekday at 07:30/);
    assert.doesNotMatch(thread, /8:00|08:00|daily routine/i, 'nothing says another time');

    // "run it now" afterwards is one more run, not one more routine
    await p.fill('#input', 'run it now'); await p.press('#input', 'Enter');
    for (let i = 0; i < 100 && g.turns.length < 2; i++) await new Promise((r) => setTimeout(r, 200));
    await p.locator('#thread .msg.ai', { hasText: 'Reminder:' }).nth(1).waitFor({ timeout: 30000 });
    assert.equal(g.jobs.length, 1, 'run it now made a routine');
    assert.deepEqual(errs, []);
  } finally {
    await b.close(); a.p.kill(); g.srv.close(); fs.rmSync(a.data, { recursive: true, force: true });
  }
});
