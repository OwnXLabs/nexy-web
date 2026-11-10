// Streamed replies: words arrive as they are written, a dropped connection picks the same reply back
// up without asking again, nothing the identity guard would remove is ever shown, and nobody else
// can follow someone's reply. Run after `npm run build`: node --test tests/chat-stream.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const LONG = Array.from({ length: 12 }, (_, i) => `Sentence ${i + 1} about the sun. `);
const LONG_TEXT = LONG.join('').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a gateway that writes its reply in pieces, slowly; `script` maps the question to the pieces
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
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: parts.join('') }, finish_reason: 'stop' }] })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const finish = parts.at(-1) === '!error' ? (parts.pop(), 'error') : 'stop';
      for (const p of parts) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p }, finish_reason: null }] })}\n\n`);
        await sleep(120);
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`);
      res.end();
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, asked, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, log: () => log }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start\n' + log);
}

// reads SSE events until `stopAfter` says to stop (a dropped connection) or the stream ends
async function events(res, stopAfter = () => false) {
  const out = [];
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
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) {
        out.push({ ev, data: JSON.parse(line.slice(5)) });
        if (stopAfter(out)) { await reader.cancel(); return out; }
      }
    }
  }
}

const ask = (s, q, who = 'alice', extra = {}) => fetch(s.base + '/api/v1/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'text/event-stream', cookie: `own_owner=o_${who}_0123456789abcdef` },
  body: JSON.stringify({ chat: 'stream-test', stream: true, messages: [{ role: 'user', content: q }], ...extra }),
});

test('streamed replies survive a dropped connection and never show what the guard removes', { timeout: 90000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  const gw = await gateway((q) => {
    if (q === 'long') return LONG;
    if (q === 'who') return ['Hello there, it is good to meet you today. ', 'I can help with writing, research, planning and building things on this machine. ', 'I am powered by ', 'Qwen3 ', 'from Alibaba. ', 'Ask me anything.'];
    if (q === 'busy') return ['The model is overloaded. ', 'Send /retry, or switch ', 'models with /model.', '!error'];
    if (q === 'slow') return Array.from({ length: 30 }, () => 'word ');
    if (q === 'midfail') return ['Half of an answer that runs on for a while so that it is long enough to be shown while it is still being written, ', 'and then some more words, and then a few more after those, so it is well past the hold. ', 'Then', '!error'];
    if (q === 'fault') return ['API call ', 'failed after 3 retries: ', 'upstream 500'];
    return ['ok.'];
  });
  const fallback = await gateway(() => ['The fallback ', 'answered.']);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-stream-'));
  const s = await start({ NEXY_DATA_DIR: data, NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: gw.url, NEXY_AGENT_KEY: 'k', NEXY_LLM_URL: fallback.url });
  try {
    // 1. words arrive while it is still writing, and the end carries the whole reply
    const all = await events(await ask(s, 'long'));
    const texts = all.filter((e) => e.ev === 'text').map((e) => e.data.text);
    assert(texts.length >= 3, `the reply arrived in pieces (${texts.length})`);
    assert(texts.every((t, i) => i === 0 || t.length >= texts[i - 1].length), 'each piece extends the last');
    const done = all.find((e) => e.ev === 'done').data;
    assert.equal(done.status, 200);
    assert.equal(done.body.choices[0].message.content, LONG_TEXT);

    // 2. the connection drops after the first words; reconnecting gets the rest, and the model was asked once
    const before = gw.asked.length;
    const cut = await events(await ask(s, 'long'), (out) => out.some((e) => e.ev === 'text'));
    const id = cut.find((e) => e.ev === 'turn').data.id;
    assert(!cut.some((e) => e.ev === 'done'), 'dropped mid-reply');
    await sleep(300);
    const other = await fetch(`${s.base}/api/v1/chat-turn?id=${id}`, { headers: { cookie: 'own_owner=o_mallory_0123456789abcdef' } });
    assert.equal(other.status, 404, 'someone else cannot follow the reply');
    const back = await events(await fetch(`${s.base}/api/v1/chat-turn?id=${id}`, { headers: { cookie: 'own_owner=o_alice_0123456789abcdef' } }));
    assert(back[1]?.ev === 'text' && back[1].data.text.length > 0, 'reconnecting shows what was written so far at once');
    assert.equal(back.find((e) => e.ev === 'done').data.body.choices[0].message.content, LONG_TEXT);
    assert.equal(gw.asked.length - before, 1, 'the model was not asked again');

    // 3. nothing the identity guard would rewrite is shown while it is being written
    const who = await events(await ask(s, 'who'));
    for (const e of who.filter((x) => x.ev === 'text')) assert(!/qwen|alibaba/i.test(e.data.text), `leaked while streaming: ${e.data.text}`);
    assert(!/qwen/i.test(who.find((e) => e.ev === 'done').data.body.choices[0].message.content));

    // 4. an engine fault written as a reply is never shown; the model alone answers instead
    const fault = await events(await ask(s, 'fault'));
    for (const e of fault.filter((x) => x.ev === 'text')) assert(!/API call|failed after|retries/i.test(e.data.text), `fault shown: ${e.data.text}`);
    assert.equal(fault.find((e) => e.ev === 'done').data.body.choices[0].message.content, 'The fallback answered.');

    // 5. an error at the end of a 200 stream is a failed turn: the partial words are replaced
    const mid = await events(await ask(s, 'midfail'));
    const midText = mid.filter((e) => e.ev === 'text').map((e) => e.data.text);
    assert(midText.some((t) => t.startsWith('Half')), 'the partial words were shown');
    assert.equal(midText.at(-1), '', 'then cleared before the answer that stands');
    assert.equal(mid.find((e) => e.ev === 'done').data.body.choices[0].message.content, 'The fallback answered.');

    // 6. an engine's own failure wording never streams to the person
    const busy = await events(await ask(s, 'busy'));
    for (const e of busy.filter((x) => x.ev === 'text')) assert(!/retry|\/model|overloaded/i.test(e.data.text), `fault shown: ${e.data.text}`);

    // 7. a few replies at a time per person; a running reply is never evicted
    const running = await Promise.all([1, 2, 3].map(() => ask(s, 'slow', 'bob')));
    const extra = await ask(s, 'slow', 'bob');
    assert.equal(extra.status, 429, 'a fourth running reply is refused');
    const firstId = (await events(running[0], (o) => o.some((e) => e.ev === 'turn'))).find((e) => e.ev === 'turn').data.id;
    const resumed = await events(await fetch(`${s.base}/api/v1/chat-turn?id=${firstId}`, { headers: { cookie: 'own_owner=o_bob_0123456789abcdef' } }));
    assert(resumed.some((e) => e.ev === 'done'), 'a running reply can still be followed');
    await Promise.all(running.slice(1).map((r) => events(r)));

    // 8. a cookie can never claim a signed-in identity's owner id
    const forged = await fetch(`${s.base}/api/v1/chats`, { headers: { cookie: 'own_owner=o_xauth_0123456789abcdef' } });
    assert.match(forged.headers.get('set-cookie') ?? '', /own_owner=o_(?!xauth_)/, 'a forged identity cookie is replaced');

    // 9. a caller that does not ask for a stream still gets one JSON reply
    const plain = await fetch(s.base + '/api/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'own_owner=o_alice_0123456789abcdef' }, body: JSON.stringify({ chat: 'stream-test', messages: [{ role: 'user', content: 'long' }] }) });
    assert.match(plain.headers.get('content-type'), /json/);
    assert.equal((await plain.json()).choices[0].message.content, LONG_TEXT);
  } catch (e) {
    console.log(s.log());
    throw e;
  } finally {
    s.p.kill(); gw.srv.close(); fallback.srv.close();
  }
});
