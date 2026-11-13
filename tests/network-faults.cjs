// A streamed reply on a bad network: the real page in a browser talks to the real server through a
// fault proxy that adds latency, drops connections, stalls them and takes the box offline. Each case
// checks what the person sees, and that the model was asked once.
// Run after `npm run build`: PLAYWRIGHT_MODULE=/path/to/playwright node --test tests/network-faults.cjs
// (CASES=2,4b for some). About 2.5 minutes.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const PARTS = Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} about the sun. `);
const ANSWER = PARTS.join('').trim();
const LOST = /reply was lost.*Send it again/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a gateway that writes its reply slowly; a number in the parts is a silent pause
function gateway(script) {
  const asked = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      if (!req.url.startsWith('/v1/chat/completions')) { res.setHeader('content-type', 'application/json'); return res.end('{"data":[]}'); }
      const b = JSON.parse(body || '{}');
      const q = b.messages?.at(-1)?.content ?? '';
      asked.push(q);
      const parts = script(q);
      const text = parts.filter((p) => typeof p === 'string');
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: text.join('') }, finish_reason: 'stop' }] })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const p of parts) {
        if (typeof p === 'number') { await sleep(p); continue; }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p }, finish_reason: null }] })}\n\n`);
        await sleep(150);
      }
      res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, asked, url: `http://127.0.0.1:${srv.address().port}` })));
}

// a TCP proxy between the browser and the server that can misbehave on purpose
function faultProxy(target) {
  const conns = new Set();
  const requests = [];
  let server, port, latency = 0;
  const kill = (c) => { conns.delete(c); c.client.resetAndDestroy?.() ?? c.client.destroy(); c.up.destroy(); };
  const onConn = (client) => {
    const up = net.connect(target, '127.0.0.1');
    const c = { client, up, stream: false, held: null, black: false };
    conns.add(c);
    const pipe = (from, to, fromClient) => {
      let due = 0;
      const deliver = (d) => {
        if (c.black || to.destroyed) return;
        if (c.held) return c.held.push([to, d]);
        d === null ? to.end() : to.write(d);
      };
      const later = (d) => {
        if (!latency) return deliver(d);
        due = Math.max(Date.now() + latency, due);
        setTimeout(() => deliver(d), due - Date.now());
      };
      from.on('data', (d) => {
        if (fromClient) {
          const m = /^([A-Z]+) (\S+) HTTP/.exec(d.toString('latin1', 0, 300));
          if (m) { requests.push(`${m[1]} ${m[2]}`); c.stream = /^\/api\/v1\/chat(-turn)?(\?|$)/.test(m[2]); }
        }
        later(d);
      });
      from.on('end', () => later(null));
      // a black-holed connection stays open and silent, whatever the server does
      from.on('error', () => { if (!c.black) kill(c); });
      from.on('close', () => { if (c.black) return; if (!latency) kill(c); else setTimeout(() => kill(c), latency + 50); });
    };
    pipe(client, up, true);
    pipe(up, client, false);
  };
  const streams = () => [...conns].filter((c) => c.stream);
  const p = {
    requests,
    get url() { return `http://127.0.0.1:${port}`; },
    resumes: () => requests.filter((r) => r.startsWith('GET /api/v1/chat-turn')).length,
    online: () => new Promise((r) => { server = net.createServer(onConn); server.listen(port ?? 0, '127.0.0.1', () => { port = server.address().port; r(); }); }),
    offline: () => { server.close(); for (const c of [...conns]) kill(c); },
    latency: (ms) => { latency = ms; },
    drop: () => { const s = streams(); for (const c of s) kill(c); return s.length; },
    stall: (ms) => {
      for (const c of streams()) {
        c.held = [];
        setTimeout(() => { const h = c.held; c.held = null; for (const [to, d] of h) if (!to.destroyed) d === null ? to.end() : to.write(d); }, ms);
      }
    },
    blackhole: () => { for (const c of streams()) c.black = true; },
    close: () => { server.close(); for (const c of [...conns]) kill(c); },
  };
  return p.online().then(() => p);
}

async function start(port, env) {
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, log: () => log }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start\n' + log);
}
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

describe('a streamed reply on a bad network', () => {
  // CASES=2,4b runs just those
  const only = process.env.CASES?.split(',');
  const it = (name, opts, fn) => test(name, { ...opts, skip: !!only && !only.includes(name.split('.')[0]) }, fn);

  let gw, fallback, proxy, server, port, env, browser;

  before(async () => {
    assert(fs.existsSync(ENTRY), 'build first: npm run build');
    gw = await gateway((q) => (q.includes('think') ? [...PARTS.slice(0, 15), 50_000, ...PARTS.slice(15)] : PARTS));
    fallback = await gateway(() => ['The fallback answered.']);
    port = await freePort();
    // the browser reaches the server through the fault proxy, on another loopback port
    env = { NEXY_HOSTS: '127.0.0.1', NEXY_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-faults-')), NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: gw.url, NEXY_AGENT_KEY: 'k', NEXY_LLM_URL: fallback.url };
    server = await start(port, env);
    proxy = await faultProxy(port);
    browser = await chromium.launch();
  });

  after(async () => {
    await browser?.close();
    proxy?.close();
    server?.p.kill();
    gw?.srv.close(); fallback?.srv.close();
  });

  // what the person sees in the last reply: its words and the status line under them
  async function open() {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.__seen = [];
      setInterval(() => {
        const b = [...document.querySelectorAll('.msg.ai .bub')].at(-1);
        if (!b) return;
        const c = b.cloneNode(true); c.querySelector('.wait')?.remove();
        const v = { t: Date.now(), text: c.textContent.replace(/\s+/g, ' ').trim(), status: b.querySelector('.wait')?.textContent.trim() ?? '' };
        const last = window.__seen.at(-1);
        if (!last || last.text !== v.text || last.status !== v.status) window.__seen.push(v);
      }, 40);
    });
    await page.goto(proxy.url + '/');
    await page.waitForSelector('#input');
    return { page, close: () => ctx.close() };
  }
  const seen = (page) => page.evaluate(() => window.__seen);
  const now = async (page) => (await seen(page)).at(-1) ?? { text: '', status: '' };
  async function until(page, ok, ms, what) {
    const end = Date.now() + ms;
    for (;;) {
      const v = await now(page);
      if (ok(v)) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}; the person sees: ${JSON.stringify(v)}`);
      await sleep(100);
    }
  }
  async function ask(page, q) {
    await page.fill('#input', q);
    await page.press('#input', 'Enter');
  }
  const firstWords = (page) => until(page, (v) => v.text.startsWith('Sentence 1'), 20_000, 'the first words');
  const finished = (page, ms = 60_000) => until(page, (v) => v.text === ANSWER || /did not answer/.test(v.text), ms, 'the reply to finish');
  const askedOnce = (q) => assert.equal(gw.asked.filter((x) => x === q).length, 1, 'the model was asked once');

  it('1. 300 ms latency each way: words arrive progressively, answer complete', { timeout: 90_000 }, async () => {
    const { page, close } = await open();
    try {
      proxy.latency(300);
      const q = 'Tell me about the sun, slowly';
      await ask(page, q);
      assert.equal((await finished(page)).text, ANSWER);
      const words = (await seen(page)).map((v) => v.text).filter((t) => t.startsWith('Sentence'));
      const lengths = [...new Set(words.map((t) => t.length))];
      assert(lengths.length >= 4, `the reply arrived in pieces (${lengths.length})`);
      assert(words.every((t) => ANSWER.startsWith(t.replace(/\s*$/, ''))), 'every piece is the start of the answer');
      askedOnce(q);
    } finally { proxy.latency(0); await close(); }
  });

  it('2. connection dropped mid-reply: same reply resumes, asked once', { timeout: 90_000 }, async () => {
    const { page, close } = await open();
    try {
      const q = 'Tell me about the sun, then lose the line';
      const before = proxy.resumes();
      await ask(page, q);
      await firstWords(page);
      assert(proxy.drop() > 0, 'a stream connection was dropped');
      assert.equal((await finished(page)).text, ANSWER);
      assert(proxy.resumes() > before, 'the page reconnected to the same reply');
      assert((await seen(page)).some((v) => /connection dropped/i.test(v.status)), 'the person was told it is reconnecting');
      askedOnce(q);
    } finally { await close(); }
  });

  it('3. box offline for 8 s mid-reply, then back: reply completes', { timeout: 90_000 }, async () => {
    const { page, close } = await open();
    try {
      const q = 'Tell me about the sun while the box naps';
      await ask(page, q);
      await firstWords(page);
      proxy.offline();
      await sleep(8000);
      assert.notEqual((await now(page)).text, ANSWER, 'nothing arrives while the box is offline');
      await proxy.online();
      assert.equal((await finished(page, 40_000)).text, ANSWER);
      askedOnce(q);
    } finally { await close(); }
  });

  it('4a. 20 s stall with no bytes, then traffic resumes: reply completes', { timeout: 90_000 }, async () => {
    const { page, close } = await open();
    try {
      const q = 'Tell me about the sun through a stall';
      await ask(page, q);
      const mid = await firstWords(page);
      proxy.stall(20_000);
      await sleep(19_000);
      const during = await now(page);
      assert(during.text.startsWith(mid.text.slice(0, 20)) && !/did not answer/.test(during.text), 'the words stay up during the stall');
      assert.equal((await finished(page, 40_000)).text, ANSWER);
      askedOnce(q);
    } finally { await close(); }
  });

  it('4b. the connection goes silent for good: the page reconnects on its own', { timeout: 120_000 }, async () => {
    const { page, close } = await open();
    try {
      const q = 'Tell me about the sun into a black hole';
      const before = proxy.resumes();
      await ask(page, q);
      await firstWords(page);
      proxy.blackhole();
      assert.equal((await finished(page, 75_000)).text, ANSWER);
      assert(proxy.resumes() > before, 'the page reconnected');
      askedOnce(q);
    } finally { await close(); }
  });

  it('4c. the model goes quiet for 50 s: the 15 s ping keeps the stream open', { timeout: 120_000 }, async () => {
    const { page, close } = await open();
    try {
      const q = 'Tell me about the sun, and think hard';
      const before = proxy.resumes();
      await ask(page, q);
      await firstWords(page);
      assert.equal((await finished(page, 90_000)).text, ANSWER);
      assert.equal(proxy.resumes(), before, 'no reconnect was needed');
      askedOnce(q);
    } finally { await close(); }
  });

  it('5. server restarted mid-reply: the person is told to send it again', { timeout: 90_000 }, async () => {
    const { page, close } = await open();
    try {
      await ask(page, 'Tell me about the sun before the restart');
      await firstWords(page);
      server.p.kill('SIGKILL');
      await new Promise((r) => server.p.once('exit', r));
      server = await start(port, env);
      const v = await until(page, (x) => LOST.test(x.text), 40_000, 'the lost-reply message');
      assert(!v.status, 'no spinner left behind');
    } finally { await close(); }
  });

  it('6. two quick drops in a row: one request to the model, answer complete', { timeout: 90_000 }, async () => {
    const { page, close } = await open();
    try {
      const q = 'Tell me about the sun twice interrupted';
      const before = proxy.resumes();
      await ask(page, q);
      await firstWords(page);
      assert(proxy.drop() > 0);
      const end = Date.now() + 15_000;
      while (proxy.resumes() === before && Date.now() < end) await sleep(20);
      await sleep(100);
      assert(proxy.drop() > 0, 'the reconnection was dropped too');
      assert.equal((await finished(page)).text, ANSWER);
      assert(proxy.resumes() >= before + 2, 'the page reconnected twice');
      askedOnce(q);
    } finally { await close(); }
  });
});
