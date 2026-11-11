// The engine picker: an owner's choice routes their chats to that engine, keys reach only their
// engine, unknown engines are refused, and the choice survives a restart. Two stand-in gateways
// record what they receive. Run after `npm run build`: node --test tests/engine-picker.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'dist', 'server', 'entry.mjs');

function gateway(name) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ path: req.url, auth: req.headers.authorization || '' });
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/v1/chat/completions')) {
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `answer from ${name}` }, finish_reason: 'stop' }] }));
      } else if (req.url.startsWith('/api/sessions')) res.end(JSON.stringify({ data: [] }));
      else res.end('{}');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, log: () => log }; } catch { await new Promise((r) => setTimeout(r, 150)); } }
  p.kill(); throw new Error('server did not start\n' + log);
}

test('owners pick an engine and their chats go to it', { timeout: 60000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const a = await gateway('A'), b = await gateway('B');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-picker-'));
  const keyFile = path.join(data, 'b.key'); fs.writeFileSync(keyFile, 'secret-b\n');
  const env = {
    NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_ENGINE: 'gateway',
    NEXY_AGENT_URL: a.url, NEXY_AGENT_KEY: 'secret-a',
    NEXY_ENGINES: 'nexy-engine,bogus id,missing', NEXY_ENGINE_NEXY_ENGINE_URL: b.url, NEXY_ENGINE_NEXY_ENGINE_KEY_FILE: keyFile,
  };
  let s = await start(env);
  try {
    const jar = { c: '' };
    const req = async (p, init = {}) => {
      const r = await fetch(s.base + p, { ...init, headers: { 'content-type': 'application/json', ...(jar.c ? { cookie: jar.c } : {}), ...(init.headers || {}) } });
      const set = r.headers.get('set-cookie'); if (set) jar.c = set.split(';')[0];
      return r;
    };
    const list = await (await req('/api/v1/engines')).json();
    assert.deepEqual(list.engines.map((e) => e.id), ['hermes', 'nexy-engine'], 'only configured engines are listed');
    assert.equal(list.selected, 'hermes', 'the deploy-time agent is the default');

    const chat = async (text) => {
      const r = await req('/api/v1/chat', { method: 'POST', body: JSON.stringify({ chat: 'picker-test', messages: [{ role: 'user', content: text }] }) });
      return r.text();
    };
    const first = await chat('first question');
    assert.match(first, /answer from A/);
    assert.match(first, /"via":"gateway"/, 'the default engine reports as before');

    assert.equal((await req('/api/v1/engines', { method: 'POST', body: JSON.stringify({ id: 'nope' }) })).status, 400, 'unknown engines are refused');
    assert.equal((await req('/api/v1/engines', { method: 'POST', body: JSON.stringify({ id: 'nexy-engine' }) })).status, 200);
    const second = await chat('second question');
    assert.match(second, /answer from B/);
    assert.match(second, /"via":"nexy-engine"/, 'a picked engine says which one answered');
    const toB = b.seen.filter((x) => x.path.startsWith('/v1/chat'));
    assert(toB.length && toB.every((x) => x.auth === 'Bearer secret-b'), 'engine B gets its own key from the key file');
    assert(a.seen.every((x) => !x.auth.includes('secret-b')), 'engine A never sees B\'s key');

    // another owner (no cookie) still gets the default
    const other = await (await fetch(s.base + '/api/v1/engines')).json();
    assert.equal(other.selected, 'hermes');

    // the choice survives a restart
    s.p.kill(); await new Promise((r) => s.p.on('exit', r));
    s = await start(env);
    const again = await (await req('/api/v1/engines')).json();
    assert.equal(again.selected, 'nexy-engine');
    assert.equal((fs.statSync(path.join(data, 'engines.json')).mode & 0o777), 0o600, 'choices are private to the service user');
  } finally {
    s.p.kill(); a.srv.close(); b.srv.close();
  }
});
