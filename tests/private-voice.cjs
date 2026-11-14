// An ultra-private chat on a computer has no speech: this computer's speech writes the recording and
// the reply to temporary files, and the chat promises nothing is written to disk. Entering one hides
// the mic, Talk with Nexy and the voice tip, speaks no reply and makes no /api/v1/voice call; a
// recording under way when the chat turns private on its own is dropped, never sent; ending it
// brings speech back.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/private-voice.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const STANDINS = path.join(__dirname, 'standins');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPLY = 'Here is what I can tell you.';
const HEARD = 'What is the weather like today?'; // the stand-in recogniser's words

function serve(handler) {
  const srv = http.createServer(handler);
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}
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
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-privvoice-'));
  fs.mkdirSync(path.join(data, 'voice'));
  fs.writeFileSync(path.join(data, 'voice', 'ggml-base.en-q8_0.bin'), 'stand-in speech model'); // speech is ready
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, data }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

async function setup() {
  const asked = [];
  const a = await agent(asked);
  const s = await start({
    NEXY_STUDIOS: 'off', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: a.url, NEXY_AGENT_KEY: 'k', NEXY_LLM_URL: a.url,
    NEXY_WHISPER_BIN: path.join(STANDINS, 'whisper-cli'), NEXY_SAY_BIN: path.join(STANDINS, 'say'),
  });
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const page = await b.newPage();
  // replies are spoken aloud: the setting a private chat must not follow
  await page.addInitScript(() => localStorage.setItem('nexy.settings.v1', JSON.stringify({ speakAlways: true })));
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); if (process.env.VOICE_DEBUG) page.on('console', (m) => console.log('[page]', m.text()));
  // every speech request, and whether the chat was private when it left
  const calls = [];
  page.on('request', async (r) => {
    const p = new URL(r.url()).pathname;
    if (/^\/api\/v1\/voice\//.test(p)) calls.push(p);
  });
  await page.exposeFunction('__speech', (p, priv) => calls.push(`${p}${priv ? ' (private)' : ''}`));
  await page.addInitScript(() => {
    const f = window.fetch;
    window.fetch = (u, ...rest) => {
      const p = new URL(String(u instanceof Request ? u.url : u), location.href).pathname;
      if (p.startsWith('/api/v1/voice/') && document.documentElement.hasAttribute('data-private')) window.__speech(p, true);
      return f(u, ...rest);
    };
  });
  await page.goto(s.base + '/');
  await page.locator('#input').waitFor({ timeout: 20000 });
  assert.equal(await page.locator('html').getAttribute('data-voice'), 'local');
  const close = async () => { await b.close(); s.p.kill(); a.srv.close(); };
  return { page, calls, asked, errors, close };
}

const shown = async (page) => ({
  mic: await page.locator('#micBtn').isVisible(),
  talk: await page.locator('#waveBtn').isVisible(),
  tip: await page.locator('#gs [data-g="voice"]').count(),
});
const reply = (page, n) => page.waitForFunction((n) => document.querySelectorAll('#thread .m.ai .bub, #thread .msg.ai .bub').length >= n && [...document.querySelectorAll('#thread .bub')].pop().textContent.includes('Here is what'), n, { timeout: 20000 });

test('an ultra-private chat hides speech, speaks no reply and calls no speech; ending it brings speech back', async () => {
  const { page, calls, errors, close } = await setup();
  try {
    assert.deepEqual(await shown(page), { mic: true, talk: true, tip: 1 }, 'speech is offered in a normal chat');
    await page.locator('#privBtn').click();
    await page.locator('[data-testid="nexy-private-banner"]').waitFor({ state: 'visible', timeout: 5000 });
    assert.deepEqual(await shown(page), { mic: false, talk: false, tip: 0 }, 'no mic, Talk with Nexy or voice tip in a private chat');
    calls.length = 0;

    // Space no longer listens
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.down('Space'); await sleep(700); await page.keyboard.up('Space');
    assert.equal(await page.locator('#voice.open').count(), 0, 'Space does not start a recording');

    // the reply is not spoken, though Speak replies aloud is on
    await page.locator('#input').fill('Give me three ideas for a team lunch');
    await page.locator('#input').press('Enter');
    await reply(page, 1);
    await sleep(1500);
    assert.deepEqual(calls, [], 'no speech request from a private chat');

    // ending it brings speech back, and replies are spoken again
    await page.locator('#privBtn').click();
    await page.locator('[data-testid="nexy-private-banner"]').waitFor({ state: 'hidden', timeout: 5000 });
    assert.deepEqual(await shown(page), { mic: true, talk: true, tip: 1 }, 'speech is back after the private session');
    await page.locator('#input').fill('Give me three ideas for a team lunch');
    await page.locator('#input').press('Enter');
    await reply(page, 1);
    for (let i = 0; i < 50 && !calls.includes('/api/v1/voice/tts'); i++) await sleep(100);
    assert.ok(calls.includes('/api/v1/voice/tts'), `a normal chat speaks its reply: ${calls.join(', ')}`);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a recording under way when the chat turns private on its own is dropped, never sent', async () => {
  const { page, calls, asked, errors, close } = await setup();
  try {
    await page.locator('#micBtn').click(); // a quick tap: listens until tapped again
    await page.locator('#voice.open').waitFor({ timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('#input').value.length > 0, null, { timeout: 10000 }); // live words arrive
    // the canvas dock sends while the mic listens; tax paperwork switches the chat to ultra-private
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('nexy:send', { detail: 'Can you help me file my tax return this year?' })));
    await page.locator('[data-testid="nexy-private-banner"]').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#voice').waitFor({ state: 'hidden', timeout: 5000 });
    assert.equal(await page.locator('#vreview').isVisible(), false, 'no words to check and send');
    assert.equal(await page.locator('#input').inputValue(), '', 'the words heard are dropped from the message box');
    assert.deepEqual(await shown(page), { mic: false, talk: false, tip: 0 });
    await reply(page, 1);
    await sleep(2000);
    assert.deepEqual(calls.filter((c) => c.endsWith('(private)')), [], 'no speech request once the chat is private');
    assert.ok(!calls.includes('/api/v1/voice/tts'), 'the private reply is not spoken');
    assert.ok(asked.every((q) => !q.includes(HEARD)), `the recording was not sent: ${JSON.stringify(asked)}`);
    assert.equal(await page.locator('#input').inputValue(), '', 'nothing came back into the message box');

    await page.locator('#privBtn').click();
    await page.locator('[data-testid="nexy-private-banner"]').waitFor({ state: 'hidden', timeout: 5000 });
    assert.deepEqual(await shown(page), { mic: true, talk: true, tip: 1 }, 'speech is back after the private session');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
