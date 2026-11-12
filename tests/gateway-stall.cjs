// An agent gateway that hangs, and a question that never reaches the server. Each turn leaves a
// start line and an end line with its result in the log, also when the person leaves first. A
// question whose request gets no answer is sent again and joins its reply, so the person gets an
// answer, never "went silent", and the model is asked once. Gateways and the network are stand-ins.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/gateway-stall.cjs
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
const OWNER = 'own_owner=o_alice_0123456789abcdef';

// `mode(n, q)` for the n-th chat request: 'silent' accepts and never answers, 'headers' sends the
// stream's headers and nothing more, a number waits that long before answering, else it answers
function gateway(mode) {
  const asked = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      if (!req.url.startsWith('/v1/chat/completions')) { res.setHeader('content-type', 'application/json'); return res.end('{"data":[]}'); }
      const b = JSON.parse(body || '{}');
      const q = b.messages?.at(-1)?.content ?? '';
      asked.push(q);
      const m = mode(asked.length, q);
      if (m === 'silent') return;
      if (m === 'headers') return res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (typeof m === 'number') await sleep(m);
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: 'The agent answered.' }, finish_reason: 'stop' }] })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'The agent answered.' }, finish_reason: null }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  srv.closeAll = () => { srv.closeAllConnections?.(); srv.close(); };
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, asked, url: `http://127.0.0.1:${srv.address().port}` })));
}
const model = () => gateway(() => 'answer');

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-gwstall-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_ENGINE: 'gateway', NEXY_AGENT_KEY: 'k', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, port, log: () => log }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start\n' + log);
}
// the server's turn lines, by turn
function turns(log) {
  const out = new Map();
  for (const l of log.split('\n')) {
    if (!l.startsWith('{')) continue;
    let j; try { j = JSON.parse(l); } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
    if (j.endpoint !== 'chat' || !j.turn) continue;
    if (!out.has(j.turn)) out.set(j.turn, []);
    out.get(j.turn).push(j.result);
  }
  return out;
}
const ENDS = new Set(['answered', 'fallback', 'stopped', 'timeout-notice', 'failed']);

const ask = (base, q, extra = {}) => fetch(base + '/api/v1/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'text/event-stream', cookie: OWNER },
  body: JSON.stringify({ chat: 'stall-test', stream: true, messages: [{ role: 'user', content: q }], ...extra }),
});
// SSE events with when each arrived; `stopAfter` cuts the connection
async function events(res, stopAfter = () => false) {
  const t0 = Date.now(), out = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', ev = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return out;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const ms = Date.now() - t0;
      if (line.startsWith(': ping')) out.push({ ev: 'ping', ms });
      else if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) out.push({ ev, ms, data: JSON.parse(line.slice(5)) });
      if (stopAfter(out)) { await reader.cancel(); return out; }
    }
  }
}
const waitFor = async (ok, ms, what) => {
  for (const end = Date.now() + ms; !ok();) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(100); }
};

// An HTTP proxy in front of the server that loses the first chat question: 'swallow' never passes
// it on, 'hold' passes it on but never passes the answer back. Everything else goes through.
function lossyProxy(target, how) {
  let chats = 0;
  const srv = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/chat' && ++chats === 1 && how === 'swallow') return;
    const up = http.request({ host: '127.0.0.1', port: target, method: req.method, path: req.url, headers: req.headers }, (r) => {
      if (req.method === 'POST' && req.url === '/api/v1/chat' && chats === 1 && how === 'hold') { r.resume(); return; }
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', (e) => { if (!res.headersSent) res.writeHead(502); res.end(String(e.message)); });
    req.pipe(up);
  });
  srv.closeAll = () => { srv.closeAllConnections?.(); srv.close(); };
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, chats: () => chats, url: `http://127.0.0.1:${srv.address().port}` })));
}

test('a hanging gateway and a lost question', { concurrency: true }, async (t) => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');

  await Promise.all([
    t.test('every turn logs its start and its end with a result, through a gateway that is silent until its third request', { timeout: 120000 }, async () => {
      const gw = await gateway((n) => (n <= 2 ? 'silent' : 'answer'));
      const llm = await model();
      const s = await start({ NEXY_AGENT_URL: gw.url, NEXY_LLM_URL: llm.url, NEXY_AGENT_BUDGET_MS: '6000' });
      try {
        for (const q of ['first after the restart', 'second after the restart', 'third after the restart']) {
          const all = await events(await ask(s.base, q));
          const done = all.find((e) => e.ev === 'done').data;
          assert.equal(done.status, 200, `${q}: answered`);
          assert.equal(done.body.choices[0].message.content, 'The agent answered.', `${q}: an answer`);
          assert.equal(done.body.fallback, q.startsWith('third') ? undefined : true, `${q}: the silent gateway gave way to the model alone`);
        }
        await sleep(200);
        const lines = [...turns(s.log()).values()];
        assert.equal(lines.length, 3, `one id per turn: ${JSON.stringify(lines)}`);
        for (const l of lines) {
          assert.equal(l[0], 'started', `a turn starts with a line: ${JSON.stringify(l)}`);
          assert(ENDS.has(l.at(-1)), `a turn ends with a result: ${JSON.stringify(l)}`);
        }
        assert.deepEqual(lines.map((l) => l.at(-1)), ['fallback', 'fallback', 'answered']);
        assert(lines[0].includes('engine-failed'), 'the gateway that went silent is named in the log');
      } catch (e) { console.log(s.log()); throw e; } finally { s.p.kill(); gw.srv.closeAll(); llm.srv.closeAll(); }
    }),

    t.test('a gateway that sends headers and then nothing, or answers its first byte late: pings keep the stream open, each turn ends logged', { timeout: 120000 }, async () => {
      const gw = await gateway((n, q) => (q.includes('headers') ? 'headers' : q.includes('late') ? 25000 : 'answer'));
      const llm = await model();
      const s = await start({ NEXY_AGENT_URL: gw.url, NEXY_LLM_URL: llm.url, NEXY_AGENT_BUDGET_MS: '45000' });
      try {
        const [hung, late] = await Promise.all([events(await ask(s.base, 'headers only')), events(await ask(s.base, 'answers late'))]);
        for (const [all, what] of [[hung, 'headers only'], [late, 'late first byte']]) {
          assert.equal(all[0].ev, 'turn', `${what}: the turn's id comes first`);
          assert(all[0].ms < 2000, `${what}: at once (${all[0].ms} ms)`);
          const quiet = all.slice(1).reduce((m, e, i) => Math.max(m, e.ms - all[i].ms), 0);
          assert(quiet < 20000, `${what}: never 40 s without a byte (longest gap ${quiet} ms)`);
        }
        assert.equal(hung.find((e) => e.ev === 'done').data.body.fallback, true, 'the hung gateway gave way to the model alone');
        assert.equal(late.find((e) => e.ev === 'done').data.body.choices[0].message.content, 'The agent answered.');
        await sleep(200);
        const ends = [...turns(s.log()).values()].map((l) => [l[0], l.at(-1)]);
        assert.deepEqual(ends.sort(), [['started', 'answered'], ['started', 'fallback']]);
      } catch (e) { console.log(s.log()); throw e; } finally { s.p.kill(); gw.srv.closeAll(); llm.srv.closeAll(); }
    }),

    t.test('a person who leaves a hung turn is logged at once, and the turn still ends logged', { timeout: 60000 }, async () => {
      const gw = await gateway(() => 'silent');
      const llm = await model();
      const s = await start({ NEXY_AGENT_URL: gw.url, NEXY_LLM_URL: llm.url, NEXY_AGENT_BUDGET_MS: '8000' });
      try {
        await events(await ask(s.base, 'leave me'), (o) => o.some((e) => e.ev === 'turn'));
        await waitFor(() => [...turns(s.log()).values()].some((l) => l.includes('client-left')), 5000, 'the client-left line');
        await waitFor(() => [...turns(s.log()).values()].some((l) => l.at(-1) === 'fallback'), 20000, 'the end of the turn');
        const [l] = [...turns(s.log()).values()];
        assert.deepEqual([l[0], l[1]], ['started', 'client-left'], JSON.stringify(l));
      } catch (e) { console.log(s.log()); throw e; } finally { s.p.kill(); gw.srv.closeAll(); llm.srv.closeAll(); }
    }),

    t.test('the same question sent again joins its reply: the model is asked once', { timeout: 60000 }, async () => {
      const gw = await gateway(() => 3000);
      const llm = await model();
      const s = await start({ NEXY_AGENT_URL: gw.url, NEXY_LLM_URL: llm.url });
      try {
        const [a, b] = await Promise.all([
          events(await ask(s.base, 'once please', { turnKey: 'q-same-question-1' })),
          sleep(300).then(async () => events(await ask(s.base, 'once please', { turnKey: 'q-same-question-1' }))),
        ]);
        assert.equal(a.find((e) => e.ev === 'turn').data.id, b.find((e) => e.ev === 'turn').data.id, 'one turn');
        for (const x of [a, b]) assert.equal(x.find((e) => e.ev === 'done').data.body.choices[0].message.content, 'The agent answered.');
        assert.equal(gw.asked.length, 1, 'the model was asked once');
        // someone else's request with that key starts its own
        const other = await fetch(s.base + '/api/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream', cookie: 'own_owner=o_mallory_0123456789abcdef' }, body: JSON.stringify({ chat: 'x', stream: true, turnKey: 'q-same-question-1', messages: [{ role: 'user', content: 'mine' }] }) });
        const mine = await events(other);
        assert.notEqual(mine.find((e) => e.ev === 'turn').data.id, a.find((e) => e.ev === 'turn').data.id, 'another person never joins it');
        assert(turns(s.log()).size >= 2);
        assert(s.log().includes('"result":"asked-again"'), 'the second request is logged as the same question');
      } catch (e) { console.log(s.log()); throw e; } finally { s.p.kill(); gw.srv.closeAll(); llm.srv.closeAll(); }
    }),

    ...['swallow', 'hold'].map((how) => t.test(`in the browser, a question whose first request is ${how === 'swallow' ? 'lost on its way' : 'answered into a void'}: sent again, answered, model asked once`, { timeout: 120000 }, async () => {
      const gw = await gateway(() => 'answer');
      const llm = await model();
      const s = await start({ NEXY_AGENT_URL: gw.url, NEXY_LLM_URL: llm.url, NEXY_BOX_FEATURES: 'open', NEXY_STUDIOS: 'off' });
      const px = await lossyProxy(s.port, how);
      const b = await chromium.launch();
      try {
        const page = await b.newPage();
        const errors = []; page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(px.url + '/');
        await page.locator('#input').waitFor({ timeout: 20000 });
        await page.locator('#input').fill('Hello there, after a restart');
        await page.locator('#input').press('Enter');
        await page.getByText('The agent answered.').waitFor({ timeout: 70000 });
        const bubble = await page.locator('.m.ai').last().innerText();
        assert.doesNotMatch(bubble, /went silent|isn't answering|did not answer/i);
        assert.equal(px.chats(), 2, 'the question was sent a second time');
        assert.equal(gw.asked.filter((q) => q === 'Hello there, after a restart').length, 1, 'the model was asked once');
        assert.deepEqual(errors, []);
      } catch (e) { console.log(s.log()); throw e; } finally { await b.close(); px.srv.closeAll(); s.p.kill(); gw.srv.closeAll(); llm.srv.closeAll(); }
    })),
  ]);
});
