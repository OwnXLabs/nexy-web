// Research answers rest on searches that ran, through the real chat route with a stand-in Nexy
// Engine. A model that names a winner and a link without searching is caught: the link is taken
// out, "I searched the web" goes, and the answer says no search ran and offers to try again. A
// real search answer comes through as written. A search ask tells the engine to search first.
// With builds held back on this computer, a page written in chat is not offered.
// Run after `npm run build`: node --test tests/honest-research.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REAL = 'https://www.nobelprize.org/prizes/literature/2025/summary/';
const MADE_UP = 'https://www.nobelprize.org/murakami-2025-winner';

// What the stand-in does for a question: its reply, and the tool calls it records, as Nexy Engine
// writes them ({"args", "result"} under role "tool").
function script(q) {
  if (/invent/.test(q)) return { reply: `I searched the web. The 2025 Nobel Prize in Literature went to Haruki Murakami. Source: ${MADE_UP}`, calls: [] };
  if (/real/.test(q)) return {
    reply: `László Krasznahorkai won the 2025 Nobel Prize in Literature. Source: ${REAL}`,
    calls: [['web_search', { query: 'nobel prize literature 2025' }, `Nobel Prize in Literature 2025\n${REAL}\nLászló Krasznahorkai was awarded the prize.`]],
  };
  if (/empty/.test(q)) return { reply: 'It went to Jon Fosse.', calls: [['web_search', { query: 'nobel 2026' }, 'no results']] };
  if (/snake/.test(q)) return { reply: 'I made index.html with a snake game. Open it in your browser.', calls: [['write_file', { path: 'index.html', content: '<canvas></canvas>' }, 'wrote index.html']] };
  return { reply: 'A mortgage is a loan secured on a home.', calls: [] };
}

function engine() {
  const chats = [], record = new Map();
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/v1/chat/completions')) {
        const body = JSON.parse(raw);
        chats.push({ body, session: req.headers['x-hermes-session-id'] });
        const { reply, calls } = script(body.messages.at(-1).content);
        record.set(req.headers['x-hermes-session-id'], calls.map(([name, args, result]) =>
          ({ role: 'tool', tool_name: name, content: JSON.stringify({ args, result }), timestamp: Math.floor(Date.now() / 1000) })));
        const nexy = { steps: 1, tools: calls.map((c) => c[0]), mode: 'native' };
        if (!body.stream) return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }], nexy }));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const w of reply.match(/\S+\s*/g)) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w }, finish_reason: null }] })}\n\n`); await sleep(5); }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], nexy })}\n\ndata: [DONE]\n\n`);
        return res.end();
      }
      const m = /^\/api\/sessions\/([^/]+)\/messages/.exec(req.url);
      if (m) return res.end(JSON.stringify({ data: record.get(decodeURIComponent(m[1])) ?? [] }));
      if (req.url.startsWith('/api/sessions')) return res.end(JSON.stringify({ data: [] }));
      if (req.url.startsWith('/api/jobs')) return res.end(JSON.stringify({ jobs: [] }));
      res.end('{}');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, chats, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, NEXY_EVAL: '', HOST: '127.0.0.1', PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, log: () => log }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start\n' + log);
}

const ask = async (s, content, extra = {}) => {
  const r = await fetch(s.base + '/api/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat: `c${Math.random().toString(36).slice(2, 10)}`, messages: [{ role: 'user', content }], ...extra }) });
  const text = await r.text();
  if (!extra.stream) return { status: r.status, body: JSON.parse(text) };
  const done = text.split('\n\n').find((e) => e.startsWith('event: done'));
  return JSON.parse(done.slice(done.indexOf('data: ') + 6));
};
const reply = (r) => r.body.choices[0].message.content;
const turns = (log) => log.split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((x) => x && x.endpoint === 'chat' && x.result === 'answered');

async function setup(env = {}) {
  const gw = await engine();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-honest-'));
  const s = await start({ NEXY_DATA_DIR: data, NEXY_SCREEN: 'none', NEXY_AGENT_URL: gw.url, NEXY_AGENT_KEY: 'k', NEXY_AGENT_NAME: 'nexy-engine', ...env });
  return { gw, s, close: () => { s.p.kill(); gw.srv.close(); fs.rmSync(data, { recursive: true, force: true }); } };
}

test('an answer with no search behind it is not passed off as researched', { timeout: 60000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const { gw, s, close } = await setup();
  try {
    const ASK = 'Who won the 2025 Nobel Prize in Literature? Search the web and give the link to your source. (invent)';
    for (const stream of [false, true]) {
      const r = await ask(s, ASK, { stream });
      assert.equal(r.status, 200);
      const text = reply(r);
      assert.doesNotMatch(text, /murakami-2025-winner/, 'the made-up link is out');
      assert.doesNotMatch(text, /I searched the web/, 'the claim of a search is out');
      assert.match(text, /^I didn't search the web for this, so this is not checked against any source/);
      assert.match(text, /Want me to try the search again\?/);
      assert.match(text, /took out a link that did not come from a search/);
      assert.equal(r.body.grounded, false);
    }
    assert.equal(gw.chats.at(-1).body.research, true, 'a search ask tells the engine to search first');

    const real = await ask(s, 'Who won the 2025 Nobel Prize in Literature? Search the web and give the link. (real)', { stream: true });
    assert.equal(reply(real), `László Krasznahorkai won the 2025 Nobel Prize in Literature. Source: ${REAL}`, 'a real search answer comes through as written');
    assert.equal(real.body.grounded, true);

    const empty = await ask(s, 'Search the web for who won the 2026 prize (empty)');
    assert.match(reply(empty), /^The web search found nothing for this/);

    const plain = await ask(s, 'explain how a mortgage works');
    assert.equal(reply(plain), 'A mortgage is a loan secured on a home.', 'a plain answer is left alone');
    assert.equal(gw.chats.at(-1).body.research, undefined, 'and no search is asked for');

    const lines = turns(s.log());
    assert.ok(lines.some((l) => l.linksRemoved === 1 && l.searched === false && l.unsearchedNote === true), 'the turn line says what was taken out');
    assert.ok(lines.some((l) => l.searched === true && l.searchFound === true && l.linksRemoved === 0));
    assert.ok(!s.log().includes('murakami'), 'the turn line holds no reply text');
  } finally { close(); }
});

test('with builds held back on this computer, the chat is told, and a page it writes anyway is not offered', { timeout: 60000 }, async () => {
  const caps = JSON.stringify({ model: 'llama3.2:3b', tier: 'cpu', tested: true, class: 'tiny', tasks: { chat: 'allow', build_site: 'block', build_game: 'block' } });
  const { gw, s, close } = await setup({ NEXY_STUDIOS: 'off', NEXY_CAPS: caps });
  try {
    const r = await ask(s, 'can you do a snake thing for me');
    assert.equal(reply(r), 'Building websites and games needs a bigger AI than this computer can run.');
    assert.match(gw.chats.at(-1).body.messages[0].content, /Never write HTML, CSS or JavaScript files/);
    assert.ok(turns(s.log()).some((l) => l.wroteBlockedBuild === true));
    // without NEXY_CAPS nothing is said or held back
  } finally { close(); }
  const open = await setup();
  try {
    const r = await ask(open.s, 'can you do a snake thing for me');
    assert.match(reply(r), /index\.html/);
    assert.doesNotMatch(open.gw.chats.at(-1).body.messages[0].content, /Never write HTML/);
  } finally { open.close(); }
});
