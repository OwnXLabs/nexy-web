// How long an answer may take: an engine that keeps writing is alive, so a reply that streams for
// 150 s finishes (0.2.8 cut it at 90 s and told the person Nexy had closed). One that goes silent
// past the limit is stopped with what it wrote kept and an honest "taking too long … Continue?";
// one stopped at the length limit says "Answer cut short. Continue?". Engines are stand-ins.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/answer-budget.cjs
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

// an engine that writes `words` words, one every `gapMs`, then goes quiet for `silentMs` (if set)
// before finishing with `finish`
function engine({ words, gapMs, silentMs = 0, finish = 'stop' }) {
  const asked = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      if (!req.url.startsWith('/v1/chat/completions')) { res.setHeader('content-type', 'application/json'); return res.end('{"data":[]}'); }
      const b = JSON.parse(body || '{}');
      // a request that does not stream names the chat; only the answer is counted
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: 'Shop guide' }, finish_reason: 'stop' }] })); }
      asked.push(b);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (d) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(d)}\n\n`); };
      for (let i = 1; i <= words && !res.destroyed; i++) {
        send({ choices: [{ delta: { content: `word${i} ` }, finish_reason: null }] });
        await sleep(gapMs);
      }
      if (silentMs) await sleep(silentMs);
      send({ choices: [{ delta: { content: 'THE END.' }, finish_reason: null }] });
      send({ choices: [{ delta: {}, finish_reason: finish }] });
      if (!res.destroyed) res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, asked, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-budget-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_STUDIOS: 'off', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, log: () => log }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start\n' + log);
}

async function chat(s, q, run) {
  const b = await chromium.launch();
  try {
    const page = await b.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    await page.locator('#input').fill(q);
    await page.locator('#input').press('Enter');
    await run(page);
    assert.deepEqual(errors, []);
  } finally { await b.close(); }
}

// the three run side by side: the first takes 150 s by design
test('answer budget', { concurrency: true }, async (t) => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');

  await Promise.all([
    t.test('an agent writing steadily for 150 s finishes, under the default limits', { timeout: 220000 }, async () => {
      const e = await engine({ words: 150, gapMs: 1000 });
      const s = await start({ NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: e.url, NEXY_AGENT_KEY: 'k', NEXY_LLM_URL: e.url });
      try {
        await chat(s, 'Tell me how to run my shop, as a guide', async (page) => {
          await page.getByText('THE END.').waitFor({ timeout: 200000 });
          const bubble = await page.locator('.m.ai').last().innerText();
          assert.match(bubble, /word1 word2 .*word150 THE END\./s, 'the whole answer, from the agent');
          assert.doesNotMatch(bubble, /taking too long|closed before|stopped before it finished|did not answer/i);
          assert.equal(e.asked.length, 1, 'no second try on the model alone');
        });
      } finally { s.p.kill(); e.srv.close(); }
    }),

    t.test('an agent that goes silent past the limit is stopped, its words kept, and offered Continue', { timeout: 90000 }, async () => {
      const e = await engine({ words: 5, gapMs: 200, silentMs: 60000 });
      const s = await start({ NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: e.url, NEXY_AGENT_KEY: 'k', NEXY_LLM_URL: e.url, NEXY_AGENT_BUDGET_MS: '4000' });
      try {
        await chat(s, 'Tell me how to run my shop, as a guide', async (page) => {
          await page.getByText('That answer was taking too long, so I stopped it.').waitFor({ timeout: 40000 });
          const bubble = await page.locator('.m.ai').last().innerText();
          assert.match(bubble, /word1 word2 word3 word4 word5/, 'what it wrote is kept');
          assert.doesNotMatch(bubble, /THE END|closed before|stopped before it finished|did not answer/i);
          assert.equal(e.asked.length, 1, 'not thrown away for the model alone');
          await page.getByRole('button', { name: 'Continue?' }).click();
          await page.waitForFunction(() => document.querySelectorAll('.m.me').length === 2);
          assert.match(e.asked.at(-1).messages.at(-1).content, /^Continue/);
          assert.match(e.asked.at(-1).messages.at(-2).content, /word5/, 'continues from the words kept');
        });
      } finally { s.p.kill(); e.srv.close(); }
    }),

    t.test('an agent stopped at its length limit says the answer was cut short', { timeout: 60000 }, async () => {
      const e = await engine({ words: 3, gapMs: 50, finish: 'length' });
      const s = await start({ NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: e.url, NEXY_AGENT_KEY: 'k', NEXY_LLM_URL: e.url });
      try {
        await chat(s, 'Tell me how to run my shop, as a guide', async (page) => {
          await page.getByText('Answer cut short.').waitFor({ timeout: 20000 });
          await page.getByRole('button', { name: 'Continue?' }).waitFor();
          assert.doesNotMatch(await page.locator('.m.ai').last().innerText(), /taking too long/);
        });
      } finally { s.p.kill(); e.srv.close(); }
    }),
  ]);
});
