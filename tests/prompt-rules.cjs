// What the model is told on every chat turn: when a search or tool fails it says so and fills
// nothing in, and it never claims to have said something the conversation doesn't hold. Checked
// on the system message a stand-in model receives, for a normal and an ultra-private chat.
// Run after `npm run build`: node --test tests/prompt-rules.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function model() {
  const systems = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      systems.push(String(b.messages?.find((m) => m.role === 'system')?.content ?? ''));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'I cannot check that right now.' }, finish_reason: 'stop' }] }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, systems, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-prompt-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_ENGINE: 'local', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

const ask = (s, extra) => fetch(s.base + '/api/v1/chat', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'search is not working' }, { role: 'assistant', content: 'Sorry.' }, { role: 'user', content: 'what were the steps you gave me?' }], ...extra }),
});

test('every chat turn tells the model not to fill a failed search and not to invent its own past', { timeout: 60000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const m = await model();
  const s = await start({ NEXY_LLM_URL: m.url, NEXY_STUDIOS: 'off' });
  try {
    for (const extra of [{}, { private: true }]) {
      const r = await ask(s, extra);
      assert.equal(r.status, 200);
      const sys = m.systems.at(-1);
      assert.match(sys, /search or tool fails, say plainly you can't check/i, 'a failed search is said plainly');
      assert.match(sys, /Never invent facts,\s+steps, sources or news/i, 'nothing made up to fill the gap');
      assert.match(sys, /Never say you said something earlier unless it is\s+in this conversation/i, 'no invented past');
      assert.match(sys, /assistant on this computer/, 'a computer without an Own1 is not called one');
      assert(sys.length < 6000, `short enough for a small model (${sys.length} chars)`);
    }
  } finally { s.p.kill(); m.srv.close(); }
});
