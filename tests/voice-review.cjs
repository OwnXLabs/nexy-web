// Hold to talk, check, then send, in Chromium (a fake microphone playing a spoken WAV) and WebKit (a
// stand-in microphone): words appear in the message box while the key is held; on letting go they stay
// there, focused and editable, and nothing is sent until Send. Redo and Esc discard and listen again;
// a quick tap is ignored; an empty transcript says so; on a phone the mic is held and the buttons are
// touch-sized. The recogniser and the agent are stand-ins; no audio leaves this machine.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/voice-review.cjs
// VOICE_SHOTS=<dir> keeps screenshots of the held and the review state.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const STANDINS = path.join(__dirname, 'standins');
const SAID = 'What is the weather like today?';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-voice-review-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// a spoken WAV for Chromium's fake microphone: the computer's own voice, 16 kHz mono; a tone elsewhere
function micWav() {
  const out = path.join(tmp, 'mic.wav');
  try {
    execFileSync('say', ['-o', path.join(tmp, 'mic.aiff'), SAID]);
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', path.join(tmp, 'mic.aiff'), out]);
    return out;
  } catch (e) {
    console.warn('no say/afconvert here, a tone stands in:', e.message);
  }
  const n = 16000 * 4, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), 44 + i * 2);
  fs.writeFileSync(out, b);
  return out;
}

const agent = (asked) => new Promise((r) => {
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (!req.url.startsWith('/v1/chat/completions')) { res.setHeader('content-type', 'application/json'); return res.end('{"data":[]}'); }
      const b = JSON.parse(body || '{}'); asked.push(b.messages?.at(-1)?.content ?? '');
      const reply = 'Sunny.';
      if (!b.stream) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: reply }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
});

async function start(agentUrl) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(tmp, 'data-'));
  fs.mkdirSync(path.join(data, 'voice'));
  fs.writeFileSync(path.join(data, 'voice', 'ggml-base.en-q8_0.bin'), 'stand-in speech model'); // speech is ready
  const p = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', NEXY_STUDIOS: 'off',
      NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: agentUrl, NEXY_AGENT_KEY: 'k', NEXY_LLM_URL: agentUrl,
      NEXY_WHISPER_BIN: path.join(STANDINS, 'whisper-cli'), NEXY_SAY_BIN: path.join(STANDINS, 'say'), STANDIN_GROW: '1', STANDIN_TEXT: SAID },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

// WebKit has no fake microphone: a tone through Web Audio stands in for getUserMedia
const STANDIN_MIC = () => {
  let ac = null;
  // started inside the user's key or touch, as a page's own audio must be
  const wake = () => { ac ??= new AudioContext(); ac.resume().catch((e) => console.warn('stand-in mic did not start', e)); };
  addEventListener('keydown', wake, true);
  addEventListener('pointerdown', wake, true);
  // on the prototype: WebKit can hand out a fresh navigator.mediaDevices later
  MediaDevices.prototype.getUserMedia = async () => {
    wake();
    const o = ac.createOscillator(), d = ac.createMediaStreamDestination();
    o.frequency.value = 220; o.connect(d); o.start();
    return d.stream;
  };
};

const ENGINES = [
  ['chromium', () => chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${micWav()}`, '--autoplay-policy=no-user-gesture-required'] })],
  ['webkit', () => webkit.launch()],
];

const val = (page) => page.locator('#input').inputValue();
const shot = async (page, name) => { if (process.env.VOICE_SHOTS) { fs.mkdirSync(process.env.VOICE_SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.VOICE_SHOTS, name) }); } };
const blur = (page) => page.evaluate(() => (document.activeElement)?.blur());

for (const [name, launch] of ENGINES) {
  test(`${name}: hold to talk, words while held, check on letting go, Send, Redo, Esc, quick tap, nothing heard`, async () => {
    const asked = [], a = await agent(asked), s = await start(a.url), b = await launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
      if (name === 'webkit') await ctx.addInitScript(STANDIN_MIC);
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message)); if (process.env.VOICE_DEBUG) page.on('console', (m) => console.log('[page]', m.text()));
      const stt = []; page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname === '/api/v1/voice/stt') stt.push({ live: u.search === '?live=1', at: Date.now() }); });
      await page.goto(s.base + '/');
      await page.locator('#input').waitFor({ timeout: 20000 });
      assert.equal(await page.locator('html').getAttribute('data-voice'), 'local');
      await blur(page);

      // held: the words so far appear and grow; nothing can be sent yet
      await page.keyboard.down('Space');
      await page.locator('#voice.open').waitFor({ timeout: 10000 });
      await page.waitForFunction(() => document.querySelector('#input').value.length > 0, null, { timeout: 8000 });
      const first = await val(page);
      await page.waitForFunction((n) => document.querySelector('#input').value.length > n, first.length, { timeout: 8000 });
      const later = await val(page);
      assert.ok(later.startsWith(first.split(' ')[0]), `${first} → ${later}`);
      assert.equal(await page.locator('#sendBtn').isDisabled(), true, 'Send is off while held');
      assert.equal(await page.locator('#vreview').isVisible(), false);
      await page.keyboard.press('Enter'); // the box has no focus, but Enter must not send while held anyway
      await shot(page, `${name}-held.png`);
      const liveWhileHeld = stt.filter((x) => x.live).length;
      assert.ok(liveWhileHeld >= 2, `the words were read again while held (${liveWhileHeld} reads)`);
      await sleep(1200);
      await page.keyboard.up('Space');

      // let go: the final words wait in the box, focused, cursor at the end; nothing sent
      await page.locator('#vreview').waitFor({ state: 'visible', timeout: 10000 });
      const releasedAt = Date.now();
      assert.equal(await val(page), SAID);
      assert.equal(await page.locator('#voice').isVisible(), false);
      assert.deepEqual(await page.evaluate(() => { const i = document.querySelector('#input'); return [document.activeElement === i, i.selectionStart === i.value.length, i.readOnly]; }), [true, true, false]);
      assert.equal(await page.locator('#vreview').getByRole('button', { name: /^Send/ }).count(), 1, 'Send is a labelled button');
      assert.match(await page.locator('#vredo').getAttribute('aria-label'), /Redo/);
      await shot(page, `${name}-review.png`);
      await sleep(1500);
      assert.deepEqual(asked, [], 'nothing is sent without Send');
      assert.equal(stt.filter((x) => x.live && x.at > releasedAt).length, 0, 'no live reads after letting go');

      // typing edits it; Enter sends it, as any typed message
      await page.keyboard.type(' In Manila.');
      await page.keyboard.press('Enter');
      for (let i = 0; i < 100 && !asked.length; i++) await sleep(100);
      assert.ok(asked[0]?.includes(`${SAID} In Manila.`), JSON.stringify(asked));
      assert.equal(await page.locator('#vreview').isVisible(), false);

      // Redo (the button) discards and listens again; Esc while listening puts the box back, sends nothing
      await blur(page);
      await page.keyboard.down('Space'); await sleep(1500); await page.keyboard.up('Space');
      await page.locator('#vreview').waitFor({ state: 'visible', timeout: 10000 });
      await page.locator('#vredo').click();
      await page.locator('#voice.open').waitFor({ timeout: 5000 });
      assert.equal(await page.locator('#vreview').isVisible(), false);
      await page.keyboard.press('Escape');
      await page.locator('#voice').waitFor({ state: 'hidden', timeout: 5000 });
      assert.equal(await val(page), '');

      // Esc on the words also discards and listens again; letting go of a tap-started recording: Space
      await page.keyboard.down('Space'); await sleep(1500); await page.keyboard.up('Space');
      await page.locator('#vreview').waitFor({ state: 'visible', timeout: 10000 });
      await page.keyboard.press('Escape');
      await page.locator('#voice.open').waitFor({ timeout: 5000 });
      assert.equal(await val(page), '', 'the words are discarded');
      await sleep(1500);
      await page.keyboard.press('Space');
      await page.locator('#vreview').waitFor({ state: 'visible', timeout: 10000 });
      assert.ok((await val(page)).length > 0);
      await page.locator('#vredo').click();
      await page.keyboard.press('Escape');
      await page.locator('#voice').waitFor({ state: 'hidden', timeout: 5000 });

      // a quick tap of Space is ignored
      const before = stt.length;
      await page.keyboard.down('Space'); await sleep(120); await page.keyboard.up('Space');
      await sleep(1500);
      assert.equal(await page.locator('#vreview').isVisible(), false);
      assert.equal(await page.locator('#voice').isVisible(), false);
      assert.equal(await val(page), '');
      assert.equal(stt.filter((x) => !x.live).length, stt.slice(0, before).filter((x) => !x.live).length, 'a quick tap is not transcribed');

      // nothing heard: said plainly, the box stays as it was
      await page.route('**/api/v1/voice/stt', (r) => r.fulfill({ json: { text: '' } }));
      await page.keyboard.down('Space'); await sleep(1500); await page.keyboard.up('Space');
      await page.getByText("Didn't catch that. Hold to try again.").first().waitFor({ timeout: 8000 });
      assert.equal(await page.locator('#vreview').isVisible(), false);
      assert.equal(await val(page), '');
      await page.unroute('**/api/v1/voice/stt');

      assert.equal(asked.filter((q) => !q.includes('Assistant:')).length, 1, 'only the one message the user sent: ' + JSON.stringify(asked));
      assert.deepEqual(errors, []);
    } finally { await b.close(); s.p.kill(); a.srv.close(); }
  });

  test(`${name} phone: hold the mic, touch-sized Send and Redo, Send sends`, async () => {
    const asked = [], a = await agent(asked), s = await start(a.url), b = await launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ...(name === 'chromium' ? { isMobile: true } : {}) });
      if (name === 'webkit') await ctx.addInitScript(STANDIN_MIC);
      const page = await ctx.newPage();
      await page.goto(s.base + '/');
      await page.locator('#input').waitFor({ timeout: 20000 });
      const mic = page.locator('#micBtn');
      await mic.waitFor({ state: 'visible', timeout: 5000 });
      const mb = await mic.boundingBox();
      await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
      await page.mouse.down();
      await page.waitForFunction(() => document.querySelector('#input').value.length > 0, null, { timeout: 8000 });
      await shot(page, `${name}-phone-held.png`);
      await sleep(1500);
      await page.mouse.up();
      await page.locator('#vreview').waitFor({ state: 'visible', timeout: 10000 });
      assert.equal(await val(page), SAID);
      await shot(page, `${name}-phone-review.png`);
      if (await page.evaluate(() => matchMedia('(pointer:coarse)').matches)) {
        for (const id of ['#vsend', '#vredo']) assert.ok((await page.locator(id).boundingBox()).height >= 44, `${id} is touch-sized`);
      }
      await sleep(1000);
      assert.deepEqual(asked, []);
      await page.locator('#vsend').click();
      for (let i = 0; i < 100 && !asked.length; i++) await sleep(100);
      assert.ok(asked[0]?.includes(SAID), JSON.stringify(asked));
      assert.equal(await page.locator('#vreview').isVisible(), false);
    } finally { await b.close(); s.p.kill(); a.srv.close(); }
  });
}
