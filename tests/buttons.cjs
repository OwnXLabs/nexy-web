// Clicks every visible button in Nexy, one at a time, and one level under each. A button passes
// when the click changes the page, makes a request, downloads, opens a file picker, a dialog or a
// window, and throws nothing. All app/model calls are simulated.
// Where it starts: a chat with a built page open, the home screen, and each Settings section; on
// an Own1 (the served build), on a computer and on Nexy Cloud, each with beta off and on.
// Every change the browser sends must name a content type no form can send: behind the box's TLS
// proxy the server refuses any other with 403, and so does this sweep.
// PLAYWRIGHT_MODULE=/path/to/playwright NEXY_BASE=http://127.0.0.1:4389 node tests/buttons.cjs
//   PLACES='Own1,computer beta' only those places; WIDTHS=1600 one width; SWEEP_PARALLEL=3 places at once
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const BASE = process.env.NEXY_BASE || 'http://127.0.0.1:4389';
const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const output = { id: 'site-1', kind: 'html', title: 'Bakery website', source: '<html><head></head><body><h1>Fresh bread</h1></body></html>' };
const chat = { id: 'cbuttons', title: 'Bakery', pid: '_', ts: Date.now(), outputs: [output], activeOutput: output.id,
  html: '<div class="msg m me"><div class="bub">Build a bakery site</div></div><div class="msg m ai"><div class="bub">Done</div></div>',
  history: [{ role: 'user', content: 'Build a bakery site' }, { role: 'assistant', content: 'Done' }] };
// never clicked: it would end the visit
const SKIP = /sign out|log out/i;
const SECTIONS = ['general', 'nexy', 'team', 'connections', 'permissions', 'cloud', 'data', 'security', 'appearance', 'workspaces', 'about'];
// a form can send these, so behind the proxy they are refused (see tests/delete-sends-json.cjs)
const FORM = /^(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)/i;
// a short silent WAV: Test the voice plays what Own Voice sends
const WAV = (() => {
  const b = Buffer.alloc(44 + 800);
  b.write('RIFF', 0); b.writeUInt32LE(36 + 800, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(800, 40);
  return b;
})();

// Connections in two states, so every card's buttons show somewhere: connected (Pause, Resume,
// Disconnect, Remove the Google client, Telegram Disconnect) and not (Connect, Choose the client file)
const HUB = {
  connected: {
    catalog: [
      { id: 'gmail', label: 'Gmail', transport: 'http', enabled: true, auth: { type: 'app_password', credentialStored: true } },
      { id: 'drive', label: 'Google Drive', transport: 'http', enabled: true, scopes: ['drive.readonly'], auth: { type: 'oauth', credentialStored: true } },
      { id: 'notion', label: 'Notion', transport: 'http', enabled: true, auth: { type: 'oauth', credentialStored: false } },
    ],
    grants: ['gmail'],
    google: { configured: true, source: 'owner', clientIdEnd: 'ab12' },
    telegram: { enabled: true, connected: true, bot: 'nexy_test_bot', users: '1234' },
  },
  fresh: {
    catalog: [
      { id: 'gmail', label: 'Gmail', transport: 'http', enabled: true, auth: { type: 'app_password', credentialStored: false } },
      { id: 'drive', label: 'Google Drive', transport: 'http', enabled: true, auth: { type: 'oauth', credentialStored: false } },
    ],
    grants: [],
    google: { configured: false },
    telegram: { enabled: true, connected: false },
  },
};

// where Nexy runs; the first is the served build, the others are started here
const PLACES = [
  { name: 'Own1', base: BASE, hub: 'connected' },
  { name: 'Own1 beta', env: { NEXY_BETA: '1' }, hub: 'fresh' },
  { name: 'computer', env: { NEXY_STUDIOS: 'off' }, hub: 'fresh' },
  { name: 'computer beta', env: { NEXY_STUDIOS: 'off', NEXY_BETA: '1' }, hub: 'connected' },
  { name: 'Nexy Cloud', env: { NEXY_PLACE: 'cloud', NEXY_STUDIOS: 'off' }, hub: 'fresh' },
  { name: 'Nexy Cloud beta', env: { NEXY_PLACE: 'cloud', NEXY_STUDIOS: 'off', NEXY_BETA: '1' }, hub: 'connected' },
].filter((p) => !process.env.PLACES || process.env.PLACES.split(',').some((n) => p.name.toLowerCase() === n.trim().toLowerCase()));

const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
async function serve(env) {
  const port = await freePort(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-buttons-'));
  fs.mkdirSync(path.join(dir, 'screen'));
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), NEXY_DATA_DIR: path.join(dir, 'data'), NEXY_SCREEN_DIR: path.join(dir, 'screen'), NEXY_BOX_FEATURES: 'open', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { if (await fetch(base + '/api/v1/health').then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 250)); }
  return { base, stop: () => { p.kill(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

(async () => {
  // a fake microphone, so voice mode opens instead of saying the mic is unavailable
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const failures = [], perPlace = {}, labels = new Set();
  // each failure is said as it happens, so a run stopped early still shows what it found
  failures.push = (...f) => { f.forEach((x) => console.log(`FAIL ${x}`)); return Array.prototype.push.apply(failures, f); };
  // what was pressed, by width and what the control is: one the same in two places or two views is pressed once
  const pressedKeys = new Set();
  let passed = 0;
  const servers = [];
  try {
    // the served build first, then the other places a few at a time, each in its own browser context
    const run = async (place) => {
      const srv = place.base ? { base: place.base, stop() {} } : await serve(place.env);
      servers.push(srv);
      perPlace[place.name] = 0;
      await sweepPlace(place, srv.base);
    };
    for (const place of PLACES.filter((p) => p.base)) await run(place);
    const rest = PLACES.filter((p) => !p.base);
    await Promise.all(Array.from({ length: Number(process.env.SWEEP_PARALLEL ?? 3) }, async () => { while (rest.length) await run(rest.shift()); }));
  } finally {
    await browser.close();
    for (const s of servers) s.stop();
  }

  async function sweepPlace(place, base) {
    const hub = HUB[place.hub];
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, hasTouch: true, permissions: ['microphone'] });
    // each click starts from a first visit: a Get started step done by an earlier click (Try it
    // now, Got it) no longer offers Later; a theme or switch an earlier click set is back to its default
    await ctx.addInitScript(() => { try { localStorage.removeItem('nexy.getStarted.v1'); localStorage.removeItem('nexy.settings.v1'); } catch (e) { console.warn('first visit not reset', e); } });
    // the controls a person can press right now: on screen and not under a sheet, drawer or dialog
    await ctx.addInitScript(() => {
      const name = (b) => (b.getAttribute('aria-label') || b.title || b.textContent).trim().replace(/\s+/g, ' ').slice(0, 40);
      // what tells two controls with one label apart, in any place: its id or what it does
      const what = (b) => b.id || ['act', 'sec', 'sw', 'rsw', 'theme', 'dexp', 'tab', 'n'].map((k) => b.dataset[k]).filter(Boolean).join(':');
      const hits = (b, r) => {
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (!r.width || !r.height || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
        const hit = document.elementFromPoint(x, y);
        return !!hit && b.contains(hit);
      };
      // scrolled out of its list: reachable when the list itself is
      const reachable = (b) => {
        if (hits(b, b.getBoundingClientRect())) return true;
        for (let a = b.parentElement; a && a !== document.body; a = a.parentElement) {
          const st = getComputedStyle(a);
          if (!/auto|scroll/.test(st.overflowY + st.overflowX) || (a.scrollHeight <= a.clientHeight && a.scrollWidth <= a.clientWidth)) continue;
          const r = b.getBoundingClientRect(), c = a.getBoundingClientRect();
          return (r.bottom > c.bottom || r.top < c.top || r.right > c.right || r.left < c.left) && hits(a, c);
        }
        return false;
      };
      window.__controls = () => [...document.querySelectorAll('button, [role=button]')]
        .filter((b) => b.checkVisibility() && !b.disabled && !b.closest('iframe') && reachable(b)).map((el) => ({ el, label: name(el), what: what(el) }));
    });
    const page = await ctx.newPage();
    let requests = 0, popups = 0, downloads = 0, choosers = 0, dialogs = 0, refused = [];
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('download', () => downloads++);
    page.on('filechooser', () => choosers++);
    // confirm() before a delete or a disconnect: say yes, so what follows is checked too
    page.on('dialog', (d) => { dialogs++; d.accept().catch(() => {}); });
    ctx.on('page', (p) => { popups++; p.close().catch(() => {}); });
    await page.route('**/api/**', async (route) => {
      requests++;
      const req = route.request(), u = new URL(req.url()), p = u.pathname, m = req.method();
      if (m !== 'GET' && m !== 'HEAD') {
        const ct = (await req.allHeaders())['content-type'] ?? '';
        if (!ct || FORM.test(ct)) { refused.push(`${m} ${p} with ${ct || 'no content type'}`); return route.fulfill({ status: 403, contentType: 'text/plain', body: 'Cross-site POST form submissions are forbidden' }); }
      }
      let body = {};
      if (p === '/api/v1/chats') body = m === 'POST' ? { ok: true } : u.searchParams.has('id') ? { chat } : { chats: [{ id: chat.id, title: chat.title, pid: '_', ts: chat.ts }], examples: [] };
      else if (p === '/api/v1/publish') body = { enabled: true, servesBuild: true, publications: [] };
      else if (p === '/api/v1/revise') body = { html: req.postDataJSON().html, say: 'Changed it.', applied: 1, missed: 0 };
      else if (p === '/api/v1/chat') body = { choices: [{ message: { content: 'ok' } }] };
      else if (p === '/api/v1/about') body = { version: '0.0.0-test', update: { state: 'current' } };
      else if (p === '/api/v1/connections/telegram') body = m === 'GET' ? hub.telegram : { ok: true, bot: 'nexy_test_bot' };
      else if (p === '/api/apps/hub/registry/catalog') body = { entries: hub.catalog };
      else if (p === '/api/apps/hub/registry/grants/nexy') body = { entries: hub.grants };
      else if (p === '/api/apps/hub/connectors/google') body = m === 'GET' ? hub.google : { ok: true };
      else if (p.endsWith('/voices')) body = { voices: [{ id: 'en_US-amy-medium', name: 'amy' }] };
      else if (p.endsWith('/tts')) return route.fulfill({ contentType: 'audio/wav', body: WAV });
      else if (p.endsWith('/projects')) body = { projects: [] };
      else if (p.endsWith('/runs')) body = { runs: [] };
      else if (p === '/api/v1/feed' || p.includes('connections')) body = { items: [], connections: [] };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    // the work pane slides and widens after it opens; buttons it hides when narrow come and go meanwhile
    const settle = () => page.evaluate(() => new Promise((ok) => {
      let last = '', same = 0;
      const tick = () => {
        const r = document.querySelector('.canvas')?.getBoundingClientRect(), now = r ? `${r.left},${r.width}` : '';
        same = now === last ? same + 1 : 0; last = now;
        if (same >= 6) ok(); else setTimeout(tick, 50);
      };
      tick();
    }));
    // where each sweep starts
    const SCENES = {
      chat: async () => {
        await page.goto(base + '/?eval=1');
        await page.waitForSelector(`[data-chat="${chat.id}"]`);
        await page.$eval(`[data-chat="${chat.id}"]`, (b) => b.click());
        await page.waitForFunction(() => document.querySelector('#cvTabs')?.textContent.includes('Bakery website') || innerWidth < 800, null, { timeout: 15000 });
        await settle();
        await page.waitForTimeout(300);
      },
      home: async () => {
        await page.goto(base + '/?eval=1');
        await page.waitForSelector(`[data-chat="${chat.id}"]`, { state: 'attached' });
        await page.waitForTimeout(500);
      },
      // reaching Settings by hand is the chat sweep's (profile, then Settings); here it starts open
      ...Object.fromEntries(SECTIONS.map((sec) => [`settings ${sec}`, async () => {
        await page.goto(base + '/?eval=1');
        await page.waitForSelector('#settingsBtn', { state: 'attached' });
        await page.$eval('#settingsBtn', (b) => b.click());
        await page.waitForSelector(`#setNav [data-sec="${sec}"]`, { state: 'attached' });
        await page.$eval(`#setNav [data-sec="${sec}"]`, (b) => b.click());
        await page.waitForFunction((sec) => document.querySelector(`#setNav [data-sec="${sec}"]`)?.classList.contains('active') && document.querySelector('#setBody h3'), sec);
        await page.waitForTimeout(300);
      }])),
    };
    // every visible, enabled control, addressed by its path so it survives a reload
    // `fresh`: a control new since the click, or one that took the place of a control still on the page
    const visible = () => page.evaluate(() => {
      const before = window.__before ?? new Map();
      return window.__controls().map((c, i, all) => {
        const sel = `${c.label}#${all.slice(0, i).filter((o) => o.label === c.label).length}`, was = before.get(sel);
        return { label: c.label, sel, key: `${c.label}[${c.what}]`, fresh: !was || (was !== c.el && was.isConnected && ![...before.values()].includes(c.el)) };
      });
    });
    // the nth visible button with this label, tagged so Playwright can click it
    const find = async (sel) => {
      const i = sel.lastIndexOf('#'), label = sel.slice(0, i), n = Number(sel.slice(i + 1));
      await page.evaluate(([label, n]) => {
        document.querySelectorAll('[data-sweep]').forEach((e) => e.removeAttribute('data-sweep'));
        window.__controls().filter((c) => c.label === label)[n]?.el.setAttribute('data-sweep', '1');
      }, [label, n]);
      return page.locator('[data-sweep="1"]');
    };
    let tried, width, scene;
    const press = async (chain) => {
      const t = chain.at(-1), name = `${place.name}, ${width}px, ${scene}: ${chain.map((c) => c.label || c.sel).join(' → ')}`;
      const once = `${width}|${chain.map((c) => c.key).join('|')}`;
      if (SKIP.test(t.label) || tried.has(chain.map((c) => c.sel).join('|'))) return null;
      tried.add(chain.map((c) => c.sel).join('|'));
      // pressed already, in another place or view: what it reveals there was swept too
      // a control a click brings back (closing a dialog shows the page again), pressed on its own already
      if (pressedKeys.has(once) || (chain.length > 1 && pressedKeys.has(`${width}|${t.key}`))) return null;
      await SCENES[scene]();
      for (const c of chain.slice(0, -1)) { const ok = await (await find(c.sel)).click({ timeout: 3000 }).then(() => true, (e) => { failures.push(`${name}: could not open ${c.label}, ${e.message.split("\n").find((l) => /intercepts/.test(l))?.trim() || e.message.split("\n")[0]}`); return false; }); if (!ok) return null; await page.waitForTimeout(500); }
      const el = await find(t.sel);
      if (!(await el.isVisible().catch(() => false))) { failures.push(`${name}: not visible`); return null; }
      const r0 = requests, p0 = popups, d0 = downloads, c0 = choosers, g0 = dialogs, e0 = errors.length;
      refused = [];
      await page.evaluate(() => { window.__before = new Map(); window.__controls().forEach((c, i, all) => window.__before.set(`${c.label}#${all.slice(0, i).filter((o) => o.label === c.label).length}`, c.el)); });
      await page.evaluate(() => { window.__m = 0; new MutationObserver((l) => { window.__m += l.length; }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); });
      const clicked = await el.click({ timeout: 3000 }).then(() => true, (e) => { failures.push(`${name}: click failed, ${e.message.split('\n')[0]}`); return false; });
      if (!clicked) return null;
      await page.waitForTimeout(400);
      // what the click starts may take a moment more (the microphone): wait for the page to go quiet, up to 2 s
      await page.evaluate(() => new Promise((ok) => {
        let last = window.__m, quiet = 0;
        const t = setInterval(() => { quiet = window.__m === last ? quiet + 1 : 0; last = window.__m; if (quiet >= 3) { clearInterval(t); ok(); } }, 100);
        setTimeout(() => { clearInterval(t); ok(); }, 2000);
      }));
      const did = (await page.evaluate(() => window.__m)) > 0 || requests > r0 || popups > p0 || downloads > d0 || choosers > c0 || dialogs > g0;
      pressedKeys.add(once);
      if (errors.length > e0) failures.push(`${name}: threw ${errors.slice(e0).join('; ')}`);
      else if (refused.length) failures.push(`${name}: refused behind the proxy, ${refused.join('; ')}`);
      else if (!did) failures.push(`${name}: nothing happened`);
      else { passed++; perPlace[place.name]++; labels.add(t.key); console.log(`PASS ${name}`); }
      return (await visible()).filter((v) => v.fresh);
    };
    // the served build at desktop and phone width; the other places at desktop width
    const widths = (process.env.WIDTHS ?? (place.base ? '1600,390' : '1600')).split(',').map(Number);
    for (width of widths) {
      await page.setViewportSize({ width, height: width > 800 ? 1000 : 844 });
      console.log(`-- ${place.name}, ${width}px`);
      // on a phone, the chat: home and Settings are the same controls, swept at desktop width
      for (scene of Object.keys(SCENES).filter((s) => width >= 800 || s === 'chat')) {
        tried = new Set();
        await SCENES[scene]();
        if (scene === 'chat') await layoutChecks(page, width, `${place.name}, ${width}px`, failures);
        for (const t of await visible()) {
          const revealed = await press([t]);
          // one level down: menus and dialogs a button opens
          for (const r of revealed || []) await press([t, r]);
        }
      }
    }
    await ctx.close();
  }

  console.log(`${passed + failures.length} presses, ${failures.length} failing; ${labels.size} different controls; pressed per place: ${Object.entries(perPlace).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (failures.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });

// a button cut off by its panel, sideways scroll on a phone, and targets too small to tap
async function layoutChecks(page, width, where, failures) {
  const cut = await page.evaluate(() => [...document.querySelectorAll('button, [role=button]')].filter((b) => b.checkVisibility() && !b.disabled && !b.closest('iframe')).filter((b) => {
    const r = b.getBoundingClientRect();
    for (let a = b.parentElement; a && a !== document.body; a = a.parentElement) {
      const st = getComputedStyle(a);
      if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
      if (/auto|scroll/.test(st.overflowX + st.overflowY)) return false; // scrolls into view
      const c = a.getBoundingClientRect();
      if (r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1) continue;
      return c.width > 0 && c.height > 0 && c.right > 0 && c.left < innerWidth && c.bottom > 0 && c.top < innerHeight;
    }
    return false;
  }).map((b) => (b.getAttribute('aria-label') || b.title || b.textContent).trim().slice(0, 40)));
  for (const l of cut) failures.push(`${where}: ${l} is cut off`);
  if (width >= 800) return;
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (sideways > 1) failures.push(`${where}: page scrolls sideways by ${sideways}px`);
  // a touch 12px off centre in any direction must still land on the button (WCAG 2.2: 24px)
  const small = await page.evaluate(() => [...document.querySelectorAll('button, [role=button]')].filter((b) => b.checkVisibility() && !b.disabled).filter((b) => {
    const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    // covered right now (a full-screen sheet over it on a phone): reachable once it closes
    if (!b.contains(document.elementFromPoint(cx, cy))) return false;
    for (let a = b.parentElement; a && a !== document.body; a = a.parentElement) {
      if (!/auto|scroll|hidden/.test(getComputedStyle(a).overflowX)) continue;
      const c = a.getBoundingClientRect(); if (r.left < c.left - 1 || r.right > c.right + 1) return false; break;
    }
    return [[0, -12], [0, 12], [-12, 0], [12, 0]].some(([dx, dy]) => { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false; const hit = document.elementFromPoint(x, y); return !hit || !b.contains(hit); });
  }).map((b) => (b.getAttribute('aria-label') || b.title || b.textContent).trim().slice(0, 40)));
  for (const l of small) failures.push(`${where}: ${l} is too small to tap`);
}
