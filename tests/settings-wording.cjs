// Settings says only what is true on this machine, in WebKit (Safari and the Mac app's view):
// no engine name unless there is a real choice of engines, web search described only where there
// is one, and the Settings panel is not see-through over the chat.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/settings-wording.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEAD = 'http://127.0.0.1:9';

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-settings-'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: data, NEXY_BOX_FEATURES: 'open', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start');
}

// the text of each Settings section, read in WebKit
async function sections(env, names) {
  const s = await start(env);
  const b = await webkit.launch();
  try {
    const page = await b.newPage();
    await page.goto(s.base + '/');
    await page.locator('#input').waitFor({ timeout: 20000 });
    await page.locator('#profileBtn').click();
    await page.locator('#settingsBtn').click();
    const out = {};
    for (const sec of names) {
      await page.locator(`#ovSet [data-sec="${sec}"]`).click();
      await sleep(400);
      out[sec] = await page.locator('#ovSet').innerText();
    }
    out.panelAlpha = await page.locator('#ovSet .modal').evaluate((el) => Number((/rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor)?.[1].split(',')[3] ?? '1')));
    return out;
  } finally { await b.close(); s.p.kill(); }
}

test('a computer without an Own1: no engine name, no search it lacks, a panel that hides the chat', { timeout: 90000 }, async () => {
  assert(fs.existsSync(ENTRY), 'build first: npm run build');
  // the Mac app: one engine behind the gateway, no web search configured
  const t = await sections({ NEXY_STUDIOS: 'off', NEXY_ENGINE: 'gateway', NEXY_AGENT_URL: DEAD, NEXY_AGENT_KEY: 'k' }, ['nexy', 'security', 'cloud']);
  assert.doesNotMatch(t.nexy, /Agent engine|Hermes|Nous Research/i, 'one engine: nothing to pick, no name');
  assert.doesNotMatch(t.security, /own search/i, 'no search that does not exist');
  assert.match(t.security, /Web search\s+There is no web search on this computer yet[^]*?Not set up/);
  assert.match(t.cloud, /Nexy Cloud/, 'the same name the app uses');
  assert.doesNotMatch(t.cloud + t.nexy, /OwnX ?Cloud/);
  assert(t.panelAlpha >= 0.95, `the panel is near-opaque in WebKit (alpha ${t.panelAlpha})`);

  // with web search configured on the computer, the privacy line describes it
  const withSearch = await sections({ NEXY_STUDIOS: 'off', NEXY_SEARXNG_URL: DEAD }, ['security']);
  assert.match(withSearch.security, /own search; the query is the only thing that leaves/);
});

test('a real choice of engines is the one place their names show', { timeout: 60000 }, async () => {
  const t = await sections({ NEXY_AGENT_URL: DEAD, NEXY_AGENT_KEY: 'k', NEXY_ENGINES: 'nexy-engine', NEXY_ENGINE_NEXY_ENGINE_URL: DEAD }, ['nexy', 'security']);
  assert.match(t.nexy, /Agent engine/);
  assert.match(t.security, /own search/, 'an Own1 has its own search');
});
