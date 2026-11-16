// What this computer's model can do (NEXY_CAPS from the desktop app's capability file) decides what
// Nexy runs. A build on a chat-only model shows one plain card and never reaches the builder; a build
// it can only do simply says so first; a page with no background of its own is readable; a build that
// does not work (no words, a blank or still game) is never called done, and a bare small app says it came out thin. The model is a stand-in. Run after `npm run build`:
//   PLAYWRIGHT_MODULE=<path to playwright> node --test tests/capability-gating.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const KEY = 'stand-in-key';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// no background or colour of its own, as the tester's lakes page had
const PAD = '<style>/* a page that sets only its font and spacing, never a background or a text colour */ h1{font-size:2em} p{line-height:1.4}</style>';
const page = (title, body, script = '') => `<!doctype html><html><head><title>${title}</title>${PAD}</head><body>${body}<script>${script}</script></body></html>`;
const LAKES = page('Fishing in Lithuanian Lakes', '<h1>Fishing in Lithuanian Lakes</h1><p>Lithuania has more than 2,800 lakes. Pike, perch and bream bite from spring to autumn.</p><p>Most lakes need a simple permit, bought online or at a post office. Boats can be hired at the larger lakes, and many have small wooden piers.</p>');
const THIN = page('Lakes', '<h1>Fishing lakes</h1>');
const BLANK_GAME = page('Snake', '<h1>Snake</h1><canvas id="c" width="300" height="200"></canvas>', 'addEventListener("keydown", function () {});');

const tasks = (o) => JSON.stringify({ model: 'koiiLlama:latest', tier: 'cpu', tested: false, class: 'chat-only', cloud: null,
  tasks: { chat: 'allow', research: 'allow', summarise: 'allow', routine: 'block', build_site: 'block', build_game: 'block', diagram: 'block', edit_page: 'block', ...o } });
const CHAT_ONLY = tasks({});
const WARN = tasks({ build_site: 'warn', build_game: 'warn' });
const FULL = tasks({ routine: 'allow', build_site: 'allow', build_game: 'allow', diagram: 'allow', edit_page: 'allow' });

// the engine: its builder writes the page the brief picks; chat gets a short answer
function engine(pick) {
  const asked = [], chats = [], edits = [], sessions = new Map();
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const authed = req.headers.authorization === `Bearer ${KEY}`;
      res.setHeader('content-type', 'application/json');
      if (req.url === '/health') return res.end(JSON.stringify(authed ? { ok: true, bots: ['nexy', 'builder'] } : { ok: true }));
      // the model itself (NEXY_LLM_URL) takes no key. A page edit, answered as Ollama does: it ignores chat_template_kwargs and thinks until the
      // budget runs out unless reasoning_effort is "none"; then, like a small model, it claims the
      // hours and adds only a style
      if (/You change an existing single-file HTML page/.test(body)) {
        const b = JSON.parse(body), change = b.messages.at(-1).content.split('The change: ').pop();
        edits.push(b);
        if (b.reasoning_effort !== 'none') return res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '', reasoning: 'Let me think. '.repeat(400) } }] }));
        const plan = /hours/.test(change)
          ? { edits: [], css: 'body{background:#0b1a3a !important} section#hours{padding:24px}', say: 'Changed the background and added the opening hours section.' }
          : { edits: [], css: 'body{background:#0b1a3a !important;color:#f5efe6 !important}', say: 'Made the background dark navy.' };
        return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(plan) } }] }));
      }
      if (!authed) { res.statusCode = 401; return res.end('{"error":"missing or wrong key"}'); }
      const m = /^\/p\/builder\/api\/sessions\/([^/]+)\/messages/.exec(req.url);
      if (m) {
        const html = sessions.get(decodeURIComponent(m[1]));
        const data = html == null ? [] : [{ role: 'tool', tool_name: 'write_file', content: JSON.stringify({ args: { path: 'index.html', content: html }, result: 'wrote index.html' }) }];
        return res.end(JSON.stringify({ data }));
      }
      if (req.url === '/p/builder/v1/chat/completions') {
        const prompt = JSON.parse(body).messages.at(-1).content;
        asked.push(prompt);
        sessions.set(req.headers['x-session-id'], pick(prompt));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        await sleep(200);
        res.write(': tool write_file\n\n');
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'I built it.' }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
        return res.end();
      }
      chats.push(req.url);
      if (/stream/.test(body) && JSON.parse(body).stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Pike and perch, mostly.' }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
        return res.end();
      }
      res.end(JSON.stringify({ choices: [{ message: { content: 'Pike and perch, mostly.' }, finish_reason: 'stop' }] }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, asked, chats, edits, url: `http://127.0.0.1:${srv.address().port}` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-caps-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

async function ask(pg, text) {
  await pg.locator('#input').fill(text);
  await pg.locator('#input').press('Enter');
}

const local = (e, caps) => start({ NEXY_STUDIOS: 'off', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: e.url, NEXY_AGENT_KEY: KEY, NEXY_LLM_URL: e.url, NEXY_CAPS: caps });
const APP = 'window.nexyApp = { own1: "https://nexy-shortcut.invalid/setup/own1", guest: "https://nexy-shortcut.invalid/setup/guest" };';

// WCAG contrast of the page's text on its own background; a transparent one shows the app's dark background
function contrast(fg, bg) {
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
async function readability(pg, heading) {
  await pg.frameLocator('#cvBody iframe').first().getByRole('heading', { name: heading }).waitFor({ timeout: 15000 });
  const frame = await (await pg.locator('#cvBody iframe').first().elementHandle()).contentFrame();
  const s = await frame.evaluate(() => {
    const rgba = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    let bg = [0, 0, 0, 0];
    for (const el of [document.body, document.documentElement]) { const c = rgba(getComputedStyle(el).backgroundColor); if (c.length === 4 ? c[3] > 0 : c.length === 3) { bg = c; break; } }
    return { fg: rgba(getComputedStyle(document.querySelector('p') || document.querySelector('h1')).color), bg };
  });
  // nothing opaque: the frame shows the app's own background, #07060d
  const bg = s.bg.length === 4 && s.bg[3] === 0 ? [7, 6, 13] : s.bg.slice(0, 3);
  return contrast(s.fg.slice(0, 3), bg);
}

test('a chat-only model: a build shows one card and never reaches the builder; chat still works', async () => {
  const e = await engine(() => LAKES);
  const s = await local(e, CHAT_ONLY);
  const b = await chromium.launch();
  try {
    // in the app: Use my Own 1 and Use a community code open the app's own setup
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
    await pg.addInitScript(APP);
    const builds = []; pg.on('request', (r) => { if (r.method() === 'POST' && /\/api\/v1\/build|\/api\/apps\/build/.test(r.url())) builds.push(r.url()); });
    const opened = [];
    // the app cancels these navigations; a 204 keeps the page where it is, as the app does
    await pg.route('https://nexy-shortcut.invalid/**', (r) => { opened.push(r.request().url()); r.fulfill({ status: 204 }); });
    await pg.goto(s.base + '/');
    await pg.locator('#input').waitFor({ timeout: 20000 });
    await ask(pg, 'Build me a website for fishing in Lithuanian lakes');
    const card = pg.locator('[data-gate="build_site"]');
    await card.waitFor({ timeout: 15000 });
    assert.match(await card.innerText(), /Building websites and games needs a bigger AI than this computer can run\./);
    assert.deepEqual(await card.locator('button').allInnerTexts(), ['Use a community code', 'Use my Own 1']);
    assert.equal(await pg.getByText(/Done\. It is on the right/).count(), 0);
    await card.getByRole('button', { name: 'Use my Own 1' }).click();
    await card.getByRole('button', { name: 'Use a community code' }).click();
    await sleep(300);
    assert.deepEqual(opened, ['https://nexy-shortcut.invalid/setup/own1', 'https://nexy-shortcut.invalid/setup/guest']);
    // a game too
    await ask(pg, 'make me a flappy bird game');
    await pg.locator('[data-gate="build_game"]').waitFor({ timeout: 15000 });
    assert.deepEqual(builds, [], 'no build call');
    assert.equal(e.asked.length, 0, 'the builder never ran');
    // chat is what it can do
    await ask(pg, 'what fish live in Lithuanian lakes?');
    await pg.getByText('Pike and perch, mostly.').waitFor({ timeout: 20000 });
    // the server refuses a build that gets past the page
    const r = await fetch(s.base + '/api/v1/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"brief":"a site about lakes"}' });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /needs a bigger AI/);

    // a phone's browser has no app to open a setup in: the card has no buttons at all
    const phone = await b.newPage({ viewport: { width: 390, height: 844 } });
    await phone.goto(s.base + '/');
    await phone.locator('#input').waitFor({ timeout: 20000 });
    await ask(phone, 'build me a landing page for my bakery');
    const pc = phone.locator('[data-gate="build_site"]');
    await pc.waitFor({ timeout: 15000 });
    assert.equal(await pc.locator('button').count(), 0, 'no dead buttons');
    assert.match(await pc.innerText(), /connect one in the Nexy app/);
    if (process.env.SHOTS) {
      await pg.locator('[data-gate="build_site"]').scrollIntoViewIfNeeded();
      await pg.screenshot({ path: path.join(process.env.SHOTS, 'block-card-desktop.png') });
      await phone.screenshot({ path: path.join(process.env.SHOTS, 'block-card-phone.png') });
    }
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});

test('a model that can only build simply says so first, then builds', async () => {
  const e = await engine(() => LAKES);
  const s = await local(e, WARN);
  const b = await chromium.launch();
  try {
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
    await pg.goto(s.base + '/');
    await pg.locator('#input').waitFor({ timeout: 20000 });
    await ask(pg, 'Build me a website for fishing in Lithuanian lakes');
    const note = pg.getByText('This computer’s AI can only make simple versions of this.');
    await note.waitFor({ timeout: 15000 });
    await pg.getByText(/Done\. It is on the right/).waitFor({ timeout: 30000 });
    assert.equal(e.asked.length, 1);
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});

test('a page with no background of its own is readable in the work pane', async () => {
  const e = await engine(() => LAKES);
  const s = await local(e, FULL);
  const b = await chromium.launch();
  try {
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
    await pg.goto(s.base + '/');
    await pg.locator('#input').waitFor({ timeout: 20000 });
    await ask(pg, 'Build me a website for fishing in Lithuanian lakes');
    await pg.getByText(/Done\. It is on the right/).waitFor({ timeout: 30000 });
    const c = await readability(pg, 'Fishing in Lithuanian Lakes');
    assert.ok(c >= 7, `the unstyled page reads at ${c.toFixed(2)}:1`);
    if (process.env.SHOTS) await pg.screenshot({ path: path.join(process.env.SHOTS, 'preview-unstyled-page.png') });
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});

// what a tester saw: a black screen with one button that does nothing
const BLACK_GAME = page('Street Fighter', '<style>body{background:#000;margin:0}</style><button>Start</button><canvas id="c" width="800" height="500"></canvas>',
  'var x = document.getElementById("c").getContext("2d"); x.fillStyle = "#000"; x.fillRect(0, 0, 800, 500);');
// a game that plays: a loop redraws the arena and a player the arrow keys move
const PLAYS = page('Street Fighter', '<style>body{background:#000;margin:0}</style><canvas id="c" width="800" height="500"></canvas>',
  'var c = document.getElementById("c"), x = c.getContext("2d"), p = 100, t = 0, keys = {};' +
  'addEventListener("keydown", function (e) { keys[e.key] = true; }); addEventListener("keyup", function (e) { keys[e.key] = false; });' +
  'function loop() { t++; if (keys.ArrowRight) p += 6; if (keys.ArrowLeft) p -= 6;' +
  ' x.fillStyle = "#123"; x.fillRect(0, 0, 800, 500); x.fillStyle = "#2a5"; x.fillRect(0, 420, 800, 80);' +
  ' x.fillStyle = "#e33"; x.fillRect(p, 300 + Math.sin(t / 5) * 4, 60, 120); x.fillStyle = "#39f"; x.fillRect(600, 300, 60, 120);' +
  ' x.fillStyle = "#fd0"; x.fillRect(20, 20, 300, 24); x.fillRect(480, 20, 300, 24); requestAnimationFrame(loop); } loop();');
const TIMER = page('Timer', '<h1>Timer</h1>');

test('a build that does not work is never called done: a website with no words, a blank game, a black screen; a small app that shows little says it came out thin', async () => {
  const e = await engine((prompt) => /timer/i.test(prompt) ? TIMER : /street fighter/i.test(prompt) ? (/that plays/.test(prompt) ? PLAYS : BLACK_GAME) : /snake/i.test(prompt) ? BLANK_GAME : THIN);
  const s = await local(e, FULL);
  const b = await chromium.launch();
  try {
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
    await pg.goto(s.base + '/');
    await pg.locator('#input').waitFor({ timeout: 20000 });
    const broken = pg.getByText(/^It did not come out working/);
    await ask(pg, 'build me a website about fishing lakes');
    await broken.waitFor({ timeout: 40000 });
    assert.match(await broken.innerText(), /the website has almost no words on it/);
    // the second try is told what was wrong
    assert.equal(e.asked.length, 2);
    assert.match(e.asked[1], /almost no words on it: \d+ characters/);
    await broken.locator('[data-retry]').waitFor();
    await ask(pg, 'build me a snake game');
    await broken.nth(1).waitFor({ timeout: 40000 });
    assert.match(await broken.nth(1).innerText(), /the game opens on a blank screen/);
    await ask(pg, 'make a street fighter game');
    await broken.nth(2).waitFor({ timeout: 50000 });
    assert.match(await broken.nth(2).innerText(), /the game (?:opens on a blank screen|shows almost nothing to play)/);
    assert.equal(await pg.getByText(/Done\. It is on the right/).count(), 0);
    for (let i = 0; i < 3; i++) assert.equal(await broken.nth(i).locator('[data-retry]').count(), 1);
    // a game that draws, moves and answers the keys is done
    await ask(pg, 'make a street fighter game that plays');
    await pg.getByText(/Done\. It is on the right/).waitFor({ timeout: 40000 });
    // a small app is a heading and a few controls; with only a heading it says it came out thin
    await ask(pg, 'build me a timer app');
    await pg.getByText('It ran, but came out very thin. This computer’s AI is too small for this.').waitFor({ timeout: 30000 });
    assert.equal(await pg.getByText(/Done\. It is on the right/).count(), 1);
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});

test('changing a built page: thinking is off, and a change that did not land is said plainly, never "Done"', async () => {
  const e = await engine(() => LAKES);
  const s = await local(e, FULL);
  const b = await chromium.launch();
  try {
    const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
    await pg.goto(s.base + '/');
    await pg.locator('#input').waitFor({ timeout: 20000 });
    await ask(pg, 'Build me a website for fishing in Lithuanian lakes');
    await pg.getByText(/Done\. It is on the right/).waitFor({ timeout: 30000 });
    await ask(pg, 'Make the background dark navy and add a section with our opening hours: Monday to Friday, 7am to 6pm.');
    const part = pg.getByText(/^Only part of that worked/);
    await part.waitFor({ timeout: 30000 });
    assert.match(await part.innerText(), /7am, 6pm, Monday and Friday did not make it onto the page/);
    assert.equal(e.edits.length, 1);
    assert.equal(e.edits[0].reasoning_effort, 'none');
    assert.equal(await pg.getByText(/^Done — /).count(), 0);
    // a change of look only: done
    await ask(pg, 'make the background dark navy');
    await pg.getByText(/^Done — Made the background dark navy\./).waitFor({ timeout: 30000 });
  } finally { await b.close(); s.p.kill(); e.srv.close(); }
});
