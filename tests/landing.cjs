// The chat home (v23 design): greeting, three suggestions, Get started, the model download and
// the phone's first-visit note. On a computer without an Own1 it offers only what works there:
// no examples it can't make, no empty tabs, no Get started step that leads nowhere.
// Run after `npm run build`:
//   PLAYWRIGHT_MODULE=<path to playwright> node --test tests/landing.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-landing-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, data }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

const items = (page) => page.locator('#gs .gi').allInnerTexts();
const count = async (page, sel = '#gs .gh small') => (await page.locator(sel).innerText()).trim();

test('a computer without an Own1: only what works here', async () => {
  // no model behind it: the suggestion sent below is only checked for what the page does
  const s = await start({ NEXY_STUDIOS: 'off', NEXY_ENGINE: 'local', NEXY_LLM_URL: 'http://127.0.0.1:9' });
  const b = await chromium.launch();
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(s.base + '/');
    await page.locator('#emptyState.home').waitFor({ timeout: 20000 });

    const hello = await page.locator('#emptyState .t').innerText();
    assert.match(hello, /^Hi\. I write, plan and research with you, privately on this computer\. What should we start with\?$/);
    const chips = await page.locator('#emptyState .sugg .chip').allInnerTexts();
    assert.equal(chips.length, 3);
    assert.ok(!chips.some((c) => /landing page|Telegram/.test(c)), `no suggestion it can't do: ${chips}`);

    assert.deepEqual(await items(page), ['Ask your first thing', 'Get Nexy on your phone', 'Connect an app', 'Add more power']);
    assert.equal(await count(page), '0 of 3');

    for (const t of ['apps', 'activity']) assert.equal(await page.locator(`[data-tab="${t}"]`).isVisible(), false, `${t} tab hidden`);
    assert.equal(await page.locator('[data-tab="files"]').isVisible(), true);

    await page.locator('#exList [data-ex]').first().waitFor({ timeout: 10000 });
    const ex = await page.locator('#exList').innerText();
    assert.match(ex, /Drawing app/);
    assert.doesNotMatch(ex, /Website|Online store|Project board|Game|Image|Launch plan|Mario|Flappy|Diagram/);

    assert.equal((await page.locator('#privBtn').innerText()).trim(), 'Private');

    // a step for something not on this computer explains itself, and is done once read
    await page.locator('#gs [data-g="power"]').click();
    await page.locator('.gs-tip').getByText('coming in an update').waitFor();
    await page.locator('.gs-tip [data-do]').click();
    assert.equal(await count(page), '1 of 3');
    assert.equal(await page.locator('#gs [data-g="power"]').getAttribute('class'), 'gi ok');

    // Connect an app opens Connections, which says what can connect here
    await page.locator('#gs [data-g="apps"]').click();
    await page.locator('.gs-tip [data-do]').click();
    await page.locator('#ovSet.open [data-sec="connections"].active').waitFor();
    assert.doesNotMatch(await page.locator('#setBody').innerText(), /unknown app|Not answering/i);
    await page.keyboard.press('Escape');

    // Your data: chats are kept on this machine, and counted
    await page.locator('#profileBtn').click();
    await page.locator('#settingsBtn').click();
    await page.locator('#ovSet [data-sec="data"]').click();
    await page.locator('#setBody .drow').first().waitFor();
    const data = await page.locator('#setBody').innerText();
    assert.match(data, /Chats/);
    assert.doesNotMatch(data, /browser tab only|not stored on the machine/);
    await page.keyboard.press('Escape');

    // asking ticks the first step; the greeting gives way to the chat
    await page.locator('#emptyState .sugg .chip').nth(1).click();
    await page.locator('.msg.me').first().waitFor({ timeout: 10000 });
    assert.equal(await count(page), '2 of 3');
    assert.equal(await page.locator('#emptyState').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.p.kill(); }
});

test('while the model downloads: the greeting says so, the chip counts, then both go', async () => {
  const status = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-model-')), 'status.json');
  fs.writeFileSync(status, JSON.stringify({ model: 'Qwen3 4B', completed: 40, total: 100 }));
  const s = await start({ NEXY_STUDIOS: 'off', NEXY_MODEL_STATUS: status });
  const b = await chromium.launch();
  try {
    const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(s.base + '/');
    await page.locator('#dlchip').waitFor({ timeout: 20000 });
    assert.equal((await page.locator('#dlchip').innerText()).trim(), 'Downloading Qwen3 4B · 40%');
    assert.match(await page.locator('#emptyState .t').innerText(), /I’m still downloading Qwen3 4B, but you can give me a job now\.$/);
    fs.writeFileSync(status, JSON.stringify({ model: 'Qwen3 4B', completed: 100, total: 100 }));
    await page.locator('#dlchip').waitFor({ state: 'detached', timeout: 8000 });
    assert.match(await page.locator('#emptyState .t').innerText(), /What should we start with\?$/);
  } finally { await b.close(); s.p.kill(); }
});

test('an Own1: the design\'s five steps and suggestions; the phone gets the card and the note', async () => {
  const s = await start({});
  const b = await chromium.launch();
  try {
    const page = await b.newPage({ viewport: { width: 1060, height: 656 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(s.base + '/');
    await page.locator('#emptyState.home').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.rail').isVisible(), true, 'the rail stays at the design\'s 1060 px');
    assert.equal(await page.locator('#emptyState .t').innerText(),
      'Hi. I plan and build things, run a team of agents for you, and work with your apps. What should we start with?');
    assert.deepEqual(await page.locator('#emptyState .sugg .chip').allInnerTexts(),
      ['Build a landing page for my bakery', 'Research my top 5 competitors', 'Send me a summary on Telegram every morning']);
    assert.deepEqual(await items(page), ['Ask your first thing', 'Talk instead of typing', 'Get Nexy on your phone', 'Connect an app', 'Add more power']);
    assert.equal(await count(page), '0 of 5');
    assert.equal(await page.locator('[data-tab="apps"]').isVisible(), true);
    // the examples follow the studios' history checks, which nothing answers here
    await page.locator('#exList [data-ex]').first().waitFor({ timeout: 45000 });
    assert.match(await page.locator('#exList').innerText(), /Website: ice cream parlour/);

    const phone = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await phone.goto(s.base + '/');
    await phone.locator('.welcome-toast').getByText('All set. Approvals will come here.').waitFor({ timeout: 45000 });
    assert.equal(await phone.locator('#gsM .gs-m').isVisible(), true);
    assert.equal(await phone.locator('#gs').isVisible(), false);
    // Nexy open on the phone is the phone step done
    assert.equal(await count(phone, '#gsM .gh small'), '1 of 5');
    assert.ok(!(await phone.locator('#gsM .row button').allInnerTexts()).includes('Get Nexy on your phone'));
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.p.kill(); }
});
