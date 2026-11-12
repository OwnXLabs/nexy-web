// Routines that run when an email or a file arrives: the agent's card says in plain words what
// starts it, what it does, that it can only read and how often it may run; it waits until the
// owner turns it on; the Routines list holds scheduled and triggered ones with a chip each, the
// last run and its result; hostile trigger text is shown as text. The agent is a stand-in.
// Run after `npm run build`: node --test tests/trigger-routines.cjs (SHOTS_DIR saves screenshots)
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const HOSTILE = 'mail from=<img/src=x/onerror=window.__pwned=1>';
const RUN_AT = 1893456000; // 2030-01-01 00:00 UTC
const job = (o) => ({ bot: 'nexy', schedule: '', enabled: true, next_run_at: null, last_run_at: null, last_status: null, status: 'active', origin: null, tz: 'Asia/Manila', trigger: null, ...o });
const JOBS = () => [
  job({ id: 21, name: 'Acme invoices', trigger: 'mail from=billing@acme.example', prompt: 'Summarise the invoice and the amount due.', status: 'pending', origin: 'an event trigger made in chat' }),
  job({ id: 22, name: '<b>Odd</b>', trigger: HOSTILE, prompt: 'Read it <script>window.__pwned=2</script>', status: 'pending', origin: 'an event trigger made in chat, read_page https://shop.example/x' }),
  job({ id: 23, name: 'Calendar', trigger: 'calendar title=<i>x</i>', prompt: 'Tell me.', last_run_at: RUN_AT, last_status: 'error: model failed' }),
  job({ id: 24, name: 'Morning sales', schedule: '30 7 * * 1-5', prompt: 'Sum yesterday\'s sales.', next_run_at: RUN_AT + 86400, last_run_at: RUN_AT, last_status: 'ok' }),
  job({ id: 25, name: 'Invoices folder', trigger: 'file folder="Invoices 2026"', prompt: 'Read the new invoice and tell me the total.', last_run_at: RUN_AT, last_status: 'ok' }),
];
const RESULT = 'Invoice 4471 from Acme: $1,200 due 30 Nov.\n<img src=x onerror="window.__pwned=3">';

function agent() {
  const seen = [];
  let jobs = JOBS();
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, path: req.url, body: body ? JSON.parse(body) : null });
      res.setHeader('content-type', 'application/json');
      const m = /^\/api\/jobs\/(\d+)(?:\/(confirm|discard|pause|resume))?$/.exec(req.url);
      if (m && req.method === 'DELETE') { jobs = jobs.filter((j) => j.id !== Number(m[1])); return res.end('{"deleted":1}'); }
      // as the engine: pending ones are refused; resuming counts the next run from now
      if (m && (m[2] === 'pause' || m[2] === 'resume') && req.method === 'POST') {
        const id = Number(m[1]), j = jobs.find((x) => x.id === id);
        if (!j) { res.statusCode = 404; return res.end('{"error":"no routine with that id"}'); }
        if (j.status === 'pending') { res.statusCode = 409; return res.end('{"error":"this routine is waiting for confirmation: confirm or discard it"}'); }
        const on = m[2] === 'resume', next = on && !j.trigger ? RUN_AT + 2 * 86400 : null;
        jobs = jobs.map((x) => (x.id === id ? { ...x, enabled: on, next_run_at: next } : x));
        return res.end(JSON.stringify({ job: { id, enabled: on, next_run_at: next } }));
      }
      if (m && m[2] && req.method === 'POST') {
        const id = Number(m[1]);
        if (!jobs.some((j) => j.id === id && j.status === 'pending')) { res.statusCode = 404; return res.end('{"error":"no pending routine with that id"}'); }
        if (m[2] === 'confirm') { jobs = jobs.map((j) => (j.id === id ? { ...j, status: 'active' } : j)); return res.end(JSON.stringify({ job: { id, status: 'active', tz: 'Asia/Manila', next_run_at: null } })); }
        jobs = jobs.filter((j) => j.id !== id); return res.end('{"deleted":1}');
      }
      if (req.url === '/api/jobs') return res.end(JSON.stringify({ jobs }));
      if (req.url.startsWith('/api/sessions?')) return res.end(JSON.stringify({ data: [
        { id: `event-25-${RUN_AT}`, source: 'event', title: 'Invoices folder: on an event', started_at: RUN_AT, message_count: 2 },
        { id: 'nexy-other', source: 'api', title: 'Invoices folder', started_at: RUN_AT + 9, message_count: 2 },
      ] }));
      if (req.url.startsWith(`/api/sessions/event-25-${RUN_AT}/messages`)) return res.end(JSON.stringify({ data: [{ role: 'user', content: 'Read the new invoice' }, { role: 'assistant', content: RESULT }] }));
      if (req.url.startsWith('/api/sessions')) return res.end('{"data":[]}');
      if (req.url.startsWith('/v1/chat/completions')) {
        const said = body ? JSON.parse(body).messages.at(-1).content : '';
        const content = /invoice email/i.test(said) ? 'I set that up. It is waiting for you to turn it on in Routines.' : 'ok';
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
      }
      res.end('{}');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-trigger-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, NEXY_EVAL: '', HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try { await fetch(base + '/api/v1/health'); return { p, base, data, log: () => log }; }
    catch (e) { if (e?.cause?.code !== 'ECONNREFUSED') throw e; await new Promise((r) => setTimeout(r, 150)); }
  }
  p.kill(); throw new Error('server did not start\n' + log);
}

let gw, app;
test.before(async () => { gw = await agent(); app = await start({ NEXY_AGENT_URL: gw.url, NEXY_AGENT_KEY: 'test-key' }); });
test.after(() => { app?.p.kill(); gw?.srv.close(); if (app) fs.rmSync(app.data, { recursive: true, force: true }); });
const shot = (loc, name) => (process.env.SHOTS_DIR ? loc.screenshot({ path: path.join(process.env.SHOTS_DIR, name) }) : null);

test('the list carries each trigger, and an event run\'s result', async () => {
  const { routines } = await (await fetch(app.base + '/api/v1/routines')).json();
  const by = (id) => routines.find((x) => x.id === String(id));
  assert.equal(by(21).trigger, 'mail from=billing@acme.example');
  assert.equal(by(21).pending, true);
  assert.equal(by(24).trigger, null, 'a scheduled routine has no trigger');
  assert.match(by(25).lastResult, /Invoice 4471 from Acme/, 'the event run\'s reply, from its event-25-… session');
  assert.equal(by(23).lastResult, undefined, 'no run of its own: another chat titled alike is not its result');
});

test('pause and resume reach the agent; a waiting routine cannot be resumed', async () => {
  const patch = (b) => fetch(app.base + '/api/v1/routines', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  let r = await patch({ id: '24', action: 'pause' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual((await r.json()).routine, { id: '24', enabled: false, nextRunAt: null });
  let { routines } = await (await fetch(app.base + '/api/v1/routines')).json();
  assert.equal(routines.find((x) => x.id === '24').enabled, false);
  r = await patch({ id: '24', action: 'resume' });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).routine, { id: '24', enabled: true, nextRunAt: new Date((RUN_AT + 2 * 86400) * 1000).toISOString() });
  r = await patch({ id: '21', action: 'resume' });
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /409.*waiting for confirmation/);
  ({ routines } = await (await fetch(app.base + '/api/v1/routines')).json());
  assert.equal(routines.find((x) => x.id === '21').pending, true, 'still waiting');
  assert.equal((await patch({ id: '24', action: 'enable' })).status, 400);
  assert.equal((await patch({ action: 'pause' })).status, 400);
});

test('the agent is told to make trigger routines, and that they only read', async () => {
  const before = gw.seen.length;
  const r = await fetch(app.base + '/api/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'When an invoice email arrives from Acme, summarise it' }], chat: 'c1' }) });
  assert.equal(r.status, 200, await r.text());
  const sent = gw.seen.slice(before).find((s) => s.path.startsWith('/v1/chat/completions'));
  assert.ok(sent, 'the request reached the agent, not a mail lookup');
  const sys = sent.body.messages.find((m) => m.role === 'system').content;
  assert.match(sys, /routine tool\s+takes a trigger, create the routine with a trigger instead of a schedule: mail from=<address>/);
  assert.match(sys, /file folder="<folder name>"/);
  assert.match(sys, /mail from=@<domain> is anyone at that domain/);
  assert.match(sys, /subject~<words> is a subject\s+containing those words/);
  assert.match(sys, /ask for its email domain \(such as\s+acme\.com\) or the address it mails from; never guess a domain/);
  assert.doesNotMatch(sys, /ask\s+for the address it mails from/, 'no longer insists on one address');
  assert.match(sys, /turn it on in Routines/);
  assert.match(sys, /cannot reply, send, write or delete/);
  assert.match(sys, /no trigger, say routines here run on a schedule only/, 'an agent without triggers is not told to invent one');
});

test('in the browser: card wording, escaping, waiting until turned on, list chips, results, delete', async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const g = await agent();
  const a = await start({ NEXY_AGENT_URL: g.url, NEXY_AGENT_KEY: 'test-key' });
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'Asia/Manila' });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(a.base + '/');
    await p.waitForSelector('#input');

    // the agent made it in chat: its card follows the reply
    await p.fill('#input', 'When an invoice email arrives from Acme, summarise it'); await p.press('#input', 'Enter');
    const card = p.locator('.block[data-routine="21"]').first();
    await card.waitFor({ timeout: 20000 });
    const text = (await card.textContent()).replace(/\s+/g, ' ');
    assert.match(text, /Waiting for you: Acme invoices/);
    assert.match(text, /When ?an email arrives from billing@acme\.example/);
    assert.match(text, /Does ?Summarise the invoice and the amount due\./);
    assert.match(text, /Can ?read only: it can't reply, send or delete anything/);
    assert.match(text, /Limit ?at most once every 5 minutes/);
    assert.doesNotMatch(text, /Came from/, 'a trigger made in chat waits by design; nothing outside to name');
    assert.deepEqual(await card.locator('button').allTextContents(), ['Discard', 'Turn on']);
    await shot(card, 'trigger-card.png');

    // hostile trigger, name and prompt: shown as text, nothing runs
    const odd = p.locator('.block[data-routine="22"]').first();
    await odd.waitFor();
    assert.equal(await odd.locator('img, script, b').count(), 0, 'no markup from the routine reaches the page');
    const oddText = await odd.textContent();
    assert.ok(oddText.includes('Waiting for you: <b>Odd</b>'));
    assert.ok(oddText.includes('an email arrives from <img/src=x/onerror=window.__pwned=1>'), oddText);
    assert.ok(oddText.includes('<script>window.__pwned=2</script>'));
    assert.match(oddText, /read only: it can't reply, send or delete anything/, 'the read-only line is on every trigger card');
    assert.match(oddText, /Came from.*a web page \(https:\/\/shop\.example\/x\)/);
    await shot(odd, 'trigger-card-hostile.png');

    // pending until turned on: nothing confirmed, and it is not in the live list
    assert.ok(!g.seen.some((s) => /\/confirm$/.test(s.path)), 'nothing confirmed by itself');
    await p.fill('#input', 'show my routines'); await p.press('#input', 'Enter');
    const list = p.locator('.block', { hasText: '3 on this machine' });
    await list.waitFor();
    assert.equal(await list.locator('.row[data-rid="21"]').count(), 0, 'a waiting routine is not listed as running');
    assert.ok(await p.locator('#thread .m.ai', { hasText: 'always waits for you to turn it on' }).count() > 0);
    await card.locator('button', { hasText: 'Turn on' }).click();
    await p.locator('#thread .m.ai', { hasText: 'Turned on Acme invoices' }).waitFor();
    assert.match(await p.locator('#thread .m.ai', { hasText: 'Turned on Acme invoices' }).textContent(),
      /It runs when an email arrives from billing@acme\.example, at most once every 5 minutes, and can only read\./);
    assert.ok(g.seen.some((s) => s.method === 'POST' && s.path === '/api/jobs/21/confirm'));
    assert.equal((await card.locator('.ba').textContent()).trim(), 'Turned on');

    // one list, scheduled and triggered, a chip each
    await p.fill('#input', 'show my routines'); await p.press('#input', 'Enter');
    const all = p.locator('.block', { hasText: '4 on this machine' });
    await all.waitFor();
    const rowText = async (id) => (await all.locator(`.row[data-rid="${id}"]`).textContent()).replace(/\s+/g, ' ');
    assert.equal(await all.locator('.row[data-rid="21"] .chip').textContent(), '⚡ Email from Acme');
    assert.equal(await all.locator('.row[data-rid="24"] .chip').textContent(), '🕖 Weekdays 7:30 am');
    assert.equal(await all.locator('.row[data-rid="25"] .chip').textContent(), '⚡ File in Invoices 2026');
    assert.equal(await all.locator('.row[data-rid="23"] .chip').textContent(), '⚡ Event from calendar');
    for (const id of [21, 23, 25]) assert.match(await rowText(id), /read only/, `trigger ${id} says it only reads`);
    assert.doesNotMatch(await rowText(24), /read only/);
    assert.match(await rowText(25), /last Tue 1 Jan, 8:00 am · done/);
    assert.match(await rowText(23), /last Tue 1 Jan, 8:00 am · did not finish/);
    assert.match(await rowText(24), /next Wed 2 Jan, 8:00 am · last Tue 1 Jan, 8:00 am · done/);
    assert.match(await rowText(21), /not run yet/);
    assert.equal(await all.locator('i').count(), 0, 'markup in a trigger stays text');

    // the event run's result opens under its row, as text
    await all.locator('.row[data-rid="25"] button', { hasText: 'See result' }).click();
    const res = all.locator('.why[data-result="25"]');
    await res.waitFor();
    assert.match(await res.textContent(), /Invoice 4471 from Acme: \$1,200 due 30 Nov\./);
    assert.equal(await res.locator('img').count(), 0);
    assert.ok(await p.locator('#thread .m.ai', { hasText: 'Latest from' }).count() > 0, 'the latest result is in the chat too');
    await shot(all, 'routines-list.png');
    await all.locator('.row[data-rid="25"] button', { hasText: 'Hide result' }).click();
    assert.equal(await res.count(), 0, 'Hide result closes it');

    // delete asks once more
    const del = all.locator('.row[data-rid="23"] button', { hasText: 'Delete' });
    await del.click();
    assert.ok(!g.seen.some((s) => s.method === 'DELETE'), 'the first click only asks');
    await all.locator('.row[data-rid="23"] button', { hasText: 'Yes, delete' }).click();
    await all.locator('.row[data-rid="23"]', { hasText: 'Deleted. It will not run again.' }).waitFor();
    assert.ok(g.seen.some((s) => s.method === 'DELETE' && s.path === '/api/jobs/23'));

    // Pause and Resume: the row says paused, with no next run, until resumed from now
    const pause = (id) => all.locator(`.row[data-rid="${id}"] [data-pause]`);
    assert.equal(await pause(24).textContent(), 'Pause');
    await pause(24).click();
    await all.locator('.row[data-rid="24"] [data-pause]', { hasText: 'Resume' }).waitFor();
    assert.ok(g.seen.some((s) => s.method === 'POST' && s.path === '/api/jobs/24/pause'));
    assert.match(await rowText(24), /paused/);
    assert.doesNotMatch(await rowText(24), /next /, 'a paused routine shows no next run');
    assert.equal(await all.locator('.row[data-rid="24"] .led.off').count(), 1);
    await pause(25).click();
    await all.locator('.row[data-rid="25"] [data-pause]', { hasText: 'Resume' }).waitFor();
    assert.match(await rowText(25), /paused · read only/, 'a trigger routine pauses too');
    await shot(all, 'routines-paused.png');
    await pause(24).click();
    await all.locator('.row[data-rid="24"] [data-pause]', { hasText: 'Pause' }).waitFor();
    assert.ok(g.seen.some((s) => s.method === 'POST' && s.path === '/api/jobs/24/resume'));
    assert.doesNotMatch(await rowText(24), /paused/);
    assert.match(await rowText(24), /next Thu 3 Jan, 8:00 am/, 'the next run the agent counted from now');
    assert.equal(await all.locator('.row[data-rid="24"] .led.ok').count(), 1);

    // a phone: the list fits, nothing runs off the side
    await p.setViewportSize({ width: 390, height: 844 });
    await all.scrollIntoViewIfNeeded();
    assert.ok(await all.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'the list fits a phone');
    await shot(all, 'routines-list-phone.png');
    await shot(card, 'trigger-card-phone.png');
    await p.setViewportSize({ width: 1400, height: 900 });

    // the saved chat, opened again: the hostile card still waits with working buttons; the list's
    // buttons work on the routines as they are now
    await p.waitForTimeout(1500);
    await p.reload();
    const again = p.locator('.block', { hasText: '4 on this machine' }).last();
    await again.waitFor({ timeout: 20000 });
    await p.waitForFunction(() => !document.querySelector('.row[data-rid="23"] [data-delete]'));
    await again.locator('.row[data-rid="25"] button', { hasText: 'See result' }).click();
    await again.locator('.why[data-result="25"]').waitFor();
    assert.match(await again.locator('.why[data-result="25"]').textContent(), /Invoice 4471 from Acme/);
    // the saved list shows each routine as it is now: 25 is still paused, 24 runs
    await again.locator('.row[data-rid="25"] [data-pause]', { hasText: 'Resume' }).waitFor();
    assert.match((await again.locator('.row[data-rid="25"]').textContent()), /paused/);
    assert.equal(await again.locator('.row[data-rid="24"] [data-pause]').textContent(), 'Pause');
    await again.locator('.row[data-rid="25"] [data-pause]').click();
    await again.locator('.row[data-rid="25"] [data-pause]', { hasText: 'Pause' }).waitFor();
    assert.ok(g.seen.some((s) => s.method === 'POST' && s.path === '/api/jobs/25/resume'));
    const odd2 = p.locator('.block[data-routine="22"]').first();
    await odd2.locator('button', { hasText: 'Discard' }).click();
    await p.waitForFunction(() => [...document.querySelectorAll('.block[data-routine="22"] .ba')].every((x) => x.textContent.trim().startsWith('Discarded')));
    assert.ok(g.seen.some((s) => s.method === 'POST' && s.path === '/api/jobs/22/discard'));

    assert.equal(await p.evaluate(() => window.__pwned), undefined, 'no hostile text ran');
    const words = (await p.locator('#thread').textContent()).toLowerCase();
    for (const w of ['engine', 'read_page', 'event-25', 'mail from=']) assert.ok(!words.includes(w), `the view says "${w}"`);
    assert.deepEqual(errs, []);
  } finally {
    await b.close(); a.p.kill(); g.srv.close(); fs.rmSync(a.data, { recursive: true, force: true });
  }
});
