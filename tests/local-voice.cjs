// Talking to Nexy on a computer without an Own1, in the browser, with stand-ins for the recogniser,
// the system voices, the model download and the agent: the first talk fetches the speech model,
// the recording goes to this computer's speech service as a WAV, the words are sent, and the reply
// is spoken. Without the speech tools the mic stays hidden; on an Own1 voice still goes to Own Voice.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/local-voice.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const STANDINS = path.join(__dirname, 'standins');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODEL = Buffer.alloc(2_000_000, 'stand-in speech model ');
const REPLY = 'Sunny and 24 degrees.';

function serve(handler) {
  const srv = http.createServer(handler);
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}
// the model download, slow enough that progress shows
const modelHost = () => serve(async (_q, res) => {
  res.writeHead(200, { 'content-length': MODEL.length });
  for (let i = 0; i < MODEL.length; i += 65536) { res.write(MODEL.subarray(i, i + 65536)); await sleep(40); }
  res.end();
});
// the agent: one short answer to anything
const agent = (asked) => serve((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (!req.url.startsWith('/v1/chat/completions')) { res.setHeader('content-type', 'application/json'); return res.end('{"data":[]}'); }
    const b = JSON.parse(body || '{}'); asked.push(b.messages?.at(-1)?.content ?? '');
    if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: REPLY }, finish_reason: 'stop' }] })); }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: REPLY }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
});

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-voice-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, data }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}
const browser = () => chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

test('speech on this computer: model fetched once, words transcribed and sent, reply spoken', async () => {
  const asked = [], m = await modelHost(), a = await agent(asked);
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-voice-log-')), 'log');
  const s = await start({
    NEXY_STUDIOS: 'off', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: a.url, NEXY_AGENT_KEY: 'k', NEXY_LLM_URL: a.url,
    NEXY_WHISPER_BIN: path.join(STANDINS, 'whisper-cli'), NEXY_SAY_BIN: path.join(STANDINS, 'say'), STANDIN_LOG: log,
    NEXY_VOICE_MODEL_URL: m.url + '/model.bin', NEXY_VOICE_MODEL_SHA256: crypto.createHash('sha256').update(MODEL).digest('hex'), NEXY_VOICE_MODEL_BYTES: String(MODEL.length),
  });
  const b = await browser();
  try {
    const page = await b.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const calls = []; page.on('request', (r) => { if (/\/api\/(v1\/voice|apps\/voice\/api)\/(status|prepare|voices|stt|tts)$/.test(new URL(r.url()).pathname)) calls.push(`${r.method()} ${new URL(r.url()).pathname} ${r.headers()['content-type'] ?? ''}`.trim()); });
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('html').getAttribute('data-voice'), 'local');
    assert.equal(await page.locator('#micBtn').isVisible(), true, 'the mic shows when speech is here');

    await page.locator('#waveBtn').click();
    await page.locator('#vmState', { hasText: /Getting speech ready on this computer, once: \d+ of 2 MB/ }).waitFor({ timeout: 10000 });
    await page.locator('#vmState', { hasText: 'Listening' }).waitFor({ timeout: 20000 });
    assert.ok(fs.existsSync(path.join(s.data, 'voice', 'ggml-base.en-q8_0.bin')), 'model kept in the data folder');
    await sleep(1200);
    await page.locator('#vmTap').click();
    await page.locator('#vmYou', { hasText: 'What is the weather like today?' }).waitFor({ timeout: 15000 });
    await page.waitForFunction((t) => document.querySelector('#vmNexy')?.textContent === t, REPLY, { timeout: 15000 });
    await page.locator('#vmState', { hasText: 'Listening' }).waitFor({ timeout: 15000 });
    assert.ok(asked.some((q) => q.includes('What is the weather like today?')), 'the words reached the agent');
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
    const bytes = Number(lines.find((l) => l.startsWith('stt '))?.split(' ')[1]);
    assert.ok(bytes > 16000, `a real recording went to speech recognition (${bytes} bytes of WAV)`);
    assert.ok(lines.includes(`tts default: ${REPLY}`), lines.join('\n'));
    await page.locator('#vmClose').click();

    await page.locator('#profileBtn').click();
    await page.locator('#settingsBtn').click();
    await page.locator('#ovSet [data-sec="nexy"]').click();
    await page.locator('#ovSet select[data-sel="voice"]').waitFor({ timeout: 5000 });
    assert.deepEqual(await page.locator('#ovSet select[data-sel="voice"] option').allTextContents(), ["This computer's voice", 'Samantha', 'Eddy, English (UK)']);
    assert.doesNotMatch(await page.locator('#ovSet').innerText(), /Own ?(Voice|1)/);
    await page.locator('#ovSet select[data-sel="voice"]').selectOption('Samantha');
    await page.locator('#ovSet [data-act="testVoice"]').click();
    for (let i = 0; i < 50 && !fs.readFileSync(log, 'utf8').includes('tts Samantha: Hi, I am Nexy.'); i++) await sleep(100);
    assert.match(fs.readFileSync(log, 'utf8'), /tts Samantha: Hi, I am Nexy\./);

    assert.deepEqual([...new Set(calls)].sort(), [
      'GET /api/v1/voice/status', 'GET /api/v1/voice/voices', 'POST /api/v1/voice/prepare application/json',
      'POST /api/v1/voice/stt audio/wav', 'POST /api/v1/voice/tts application/json',
    ]);
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.p.kill(); m.srv.close(); a.srv.close(); }
});

test('the speech service refuses what it should', async () => {
  const s = await start({ NEXY_STUDIOS: 'off', NEXY_WHISPER_BIN: path.join(STANDINS, 'whisper-cli'), NEXY_SAY_BIN: path.join(STANDINS, 'say'), NEXY_VOICE_MODEL_URL: 'http://127.0.0.1:9/none' });
  try {
    // the desktop app's launcher is the gate in front; here the box guard alone
    const o = { origin: s.base };
    const stt = await fetch(s.base + '/api/v1/voice/stt', { method: 'POST', headers: { ...o, 'content-type': 'audio/wav' }, body: 'x' });
    assert.equal(stt.status, 503, 'no model yet: getting ready, not a crash');
    assert.equal((await fetch(s.base + '/api/v1/voice/tts', { method: 'POST', headers: { ...o, 'content-type': 'application/json' }, body: '{"text":""}' })).status, 400);
    assert.equal((await fetch(s.base + '/api/v1/voice/nope')).status, 404);
  } finally { s.p.kill(); }
  const closed = await start({ NEXY_STUDIOS: 'off', NEXY_BOX_FEATURES: '', NEXY_WHISPER_BIN: path.join(STANDINS, 'whisper-cli'), NEXY_SAY_BIN: path.join(STANDINS, 'say') });
  try { assert.equal((await fetch(closed.base + '/api/v1/voice/status')).status, 403, 'not for a stranger'); }
  finally { closed.p.kill(); }
});

test('without the speech tools the mic stays hidden and the service is absent', async () => {
  const s = await start({ NEXY_STUDIOS: 'off', NEXY_WHISPER_BIN: path.join(STANDINS, 'missing'), NEXY_SAY_BIN: path.join(STANDINS, 'say') });
  const b = await browser();
  try {
    const page = await b.newPage();
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('html').getAttribute('data-voice'), null);
    assert.equal(await page.locator('#micBtn').isVisible(), false);
    await page.locator('#waveBtn').click();
    await page.getByText("Talking to Nexy isn't in Nexy on this computer yet").first().waitFor({ timeout: 5000 });
    assert.equal((await fetch(s.base + '/api/v1/voice/status')).status, 404);
  } finally { await b.close(); s.p.kill(); }
});

test('on an Own1, voice still goes to Own Voice even with speech tools present', async () => {
  const s = await start({ NEXY_WHISPER_BIN: path.join(STANDINS, 'whisper-cli'), NEXY_SAY_BIN: path.join(STANDINS, 'say') });
  const b = await browser();
  try {
    const page = await b.newPage();
    const calls = []; page.on('request', (r) => { if (/\/api\/(v1\/voice|apps\/voice\/api)\/(status|prepare|voices|stt|tts)$/.test(new URL(r.url()).pathname)) calls.push(new URL(r.url()).pathname); });
    await page.route('**/api/apps/voice/api/voices', (r) => r.fulfill({ json: { voices: [{ id: 'en_US-amy-medium', name: 'en_US-amy-medium' }] } }));
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('html').getAttribute('data-voice'), null);
    await page.locator('#profileBtn').click();
    await page.locator('#settingsBtn').click();
    await page.locator('#ovSet [data-sec="nexy"]').click();
    await page.locator('#ovSet select[data-sel="voice"]').waitFor({ timeout: 5000 });
    assert.deepEqual(await page.locator('#ovSet select[data-sel="voice"] option').allTextContents(), ['amy medium']);
    assert.deepEqual(calls, ['/api/apps/voice/api/voices']);
    assert.equal((await fetch(s.base + '/api/v1/voice/status')).status, 404, 'no local service on an Own1');
  } finally { await b.close(); s.p.kill(); }
});
