// Every Settings section opens, and each control in it does what it says: the name and switches
// are kept, Remove and Disconnect send JSON and say so, Telegram connects with what was typed,
// Export downloads the listing, the feedback buttons ask Nexy, themes, transparency, text size and
// the background apply, About shows the version. All app calls are simulated.
// PLAYWRIGHT_MODULE=... NEXY_BASE=http://127.0.0.1:4389 node tests/settings-sections.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const BASE = process.env.NEXY_BASE || 'http://127.0.0.1:4389';
const SECTIONS = { general: 'General', nexy: 'Nexy', team: 'Team', connections: 'Connections', permissions: 'Permissions', cloud: 'Nexy Cloud',
  data: 'Your data', security: 'Security and privacy', appearance: 'Appearance', workspaces: 'Workspaces', about: 'About' };
// a 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const check = (name, ok, got) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${JSON.stringify(got)}`}`); };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept());
    const state = { google: { configured: true, source: 'owner', clientIdEnd: 'ab12' }, telegram: { enabled: true, connected: true, bot: 'nexy_test_bot', users: '1234' } };
    const sent = [];
    await page.route('**/api/**', async (route) => {
      const req = route.request(), u = new URL(req.url()), p = u.pathname, m = req.method();
      if (m !== 'GET') sent.push({ m, p: p + u.search, ct: (await req.allHeaders())['content-type'] ?? '', body: req.postData() ?? '' });
      let body = {};
      if (p === '/api/v1/chats') body = m === 'POST' ? { ok: true } : u.searchParams.has('id') ? { chat: { id: 'c1', title: 'Bakery', pid: '_', ts: 1, html: '', history: [] } } : { chats: [{ id: 'c1', title: 'Bakery', pid: '_', ts: 1 }], examples: [] };
      else if (p === '/api/v1/about') body = { version: '9.8.7', update: { state: 'current' } };
      else if (p === '/api/v1/model') body = { ready: true };
      else if (p === '/api/v1/feedback') body = m === 'GET' ? { entries: [{ at: Date.now(), signal: 'up', prompt: 'Build a bakery site' }] } : { ok: true };
      else if (p === '/api/v1/chat') body = { choices: [{ message: { content: 'ok' } }] };
      else if (p === '/api/v1/connections/telegram') {
        if (m === 'DELETE') state.telegram = { enabled: true, connected: false };
        if (m === 'POST') state.telegram = { enabled: true, connected: true, bot: 'new_bot', users: '42' };
        body = m === 'GET' ? state.telegram : { ok: true, bot: state.telegram.bot };
      } else if (p === '/api/apps/hub/connectors/google') {
        if (m === 'DELETE') state.google = { configured: false };
        body = m === 'GET' ? state.google : { ok: true };
      } else if (p === '/api/apps/hub/registry/catalog') body = { entries: [{ id: 'gmail', label: 'Gmail', transport: 'http', enabled: true, auth: { type: 'oauth', credentialStored: false } }] };
      else if (p === '/api/apps/hub/registry/grants/nexy') body = { entries: [] };
      else if (p.endsWith('/projects')) body = { projects: [] };
      else if (p.endsWith('/runs')) body = { runs: [] };
      else if (p.endsWith('/voices')) body = { voices: [{ id: 'en_US-amy-medium', name: 'amy' }] };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    // the toast's words, once it shows new ones
    const toast = () => page.waitForFunction(() => document.querySelector('#toast')?.textContent.trim(), null, { timeout: 4000 })
      .then((h) => h.jsonValue()).catch(() => '');
    const clearToast = () => page.$eval('#toast', (t) => { t.textContent = ''; });
    const open = async (sec) => {
      await page.evaluate(() => document.querySelector('#ovSet')?.classList.contains('open') || document.querySelector('#settingsBtn').click());
      await page.$eval(`#setNav [data-sec="${sec}"]`, (b) => b.click());
      await page.waitForFunction((t) => document.querySelector('#setBody h3')?.textContent === t, SECTIONS[sec], { timeout: 5000 }).catch(() => {});
    };
    const load = async () => { await page.goto(BASE + '/?eval=1'); await page.waitForSelector('#settingsBtn', { state: 'attached' }); };
    await load();

    for (const [sec, title] of Object.entries(SECTIONS)) {
      await open(sec);
      check(`${title} opens`, (await page.$eval('#setBody h3', (h) => h.textContent).catch(() => '')) === title, sec);
    }

    // General: the name and Notifications are kept
    await open('general');
    await page.fill('#setBody [data-txt="name"]', 'Robin');
    await page.$eval('#setBody [data-txt="name"]', (i) => i.dispatchEvent(new Event('change')));
    check('your name shows in the sidebar', (await page.$eval('.user .n', (n) => n.textContent)) === 'Robin', await page.$eval('.user .n', (n) => n.textContent));
    const notif = () => page.$eval('#setBody [data-sw="notif"]', (b) => b.getAttribute('aria-checked'));
    const n0 = await notif();
    await page.click('#setBody [data-sw="notif"]');
    await page.waitForFunction((n0) => document.querySelector('#setBody [data-sw="notif"]')?.getAttribute('aria-checked') !== n0, n0);
    await load(); await open('general');
    check('the name and Notifications are kept after a reload', (await page.$eval('#setBody [data-txt="name"]', (i) => i.value)) === 'Robin' && (await notif()) !== n0, await notif());

    // Nexy: Speak replies aloud and Hold space to talk
    await open('nexy');
    for (const k of ['speakAlways', 'wakeKey']) {
      const sel = `#setBody [data-sw="${k}"]`;
      if (!(await page.$(sel))) { check(`${k} is offered with Own Voice`, false, 'missing'); continue; }
      const before = await page.$eval(sel, (b) => b.getAttribute('aria-checked'));
      await page.click(sel);
      await page.waitForFunction(([s, b]) => document.querySelector(s)?.getAttribute('aria-checked') !== b, [sel, before]);
      check(`${k} switches and is saved`, JSON.parse(await page.evaluate(() => localStorage.getItem('nexy.settings.v1')))[k] === (before !== 'true'), before);
    }

    // Connections: Remove the Google client and Disconnect Telegram send JSON and say so
    await open('connections');
    sent.length = 0; await clearToast();
    await page.click('#setBody [data-act="gclientoff"]');
    const removed = await toast();
    const del = sent.find((s) => s.m === 'DELETE' && s.p.startsWith('/api/apps/hub/connectors/google'));
    check('Remove the Google client sends DELETE as JSON', del?.ct === 'application/json' && /as=nexy/.test(del.p), del);
    check('…and says it was removed', removed === 'Google OAuth client removed', removed);
    await page.waitForSelector('#setBody [data-act="gclient"]', { timeout: 5000 }).catch(() => {});
    check('…and offers to choose a client file again', !!(await page.$('#setBody [data-act="gclient"]')), 'no Choose button');
    sent.length = 0; await clearToast();
    await page.click('#setBody [data-act="tgoff"]');
    const tgOff = await toast();
    check('Disconnect Telegram sends DELETE as JSON and says so', sent.some((s) => s.m === 'DELETE' && s.p === '/api/v1/connections/telegram' && s.ct === 'application/json') && tgOff === 'Telegram disconnected', { sent, tgOff });
    await page.waitForSelector('#tgToken', { timeout: 5000 }).catch(() => {});
    await page.fill('#tgToken', '123:abc'); await page.fill('#tgUsers', '42');
    sent.length = 0; await clearToast();
    await page.click('#setBody [data-act="tgon"]');
    const tgOn = await toast();
    const post = sent.find((s) => s.m === 'POST' && s.p === '/api/v1/connections/telegram');
    check('Connect Telegram sends the token and user ID typed', post?.ct === 'application/json' && JSON.parse(post.body).token === '123:abc' && JSON.parse(post.body).users === '42', post);
    check('…and names the bot', /@new_bot/.test(tgOn), tgOn);

    // Your data: Export everything downloads the listing
    await open('data');
    await page.waitForSelector('#setBody [data-dexp="all"]');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('#setBody [data-dexp="all"]')]);
    const file = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    check('Export everything downloads nexy-everything.json listing the chats', dl.suggestedFilename() === 'nexy-everything.json' && file.items.some((i) => i.category === 'Chats' && i.count === 1), { name: dl.suggestedFilename(), items: file.items?.map((i) => i.category) });

    // Security: the feedback buttons close Settings and answer in the chat from this machine's log
    for (const [act, said] of [['feedback', '1 item'], ['clearfb', 'Cleared.']]) {
      await open('security');
      sent.length = 0;
      await page.click(`#setBody [data-act="${act}"]`);
      await page.waitForFunction((s) => document.querySelector('#thread')?.textContent.includes(s), said, { timeout: 5000 }).catch(() => {});
      const thread = await page.$eval('#thread', (t) => t.textContent);
      check(`${act === 'feedback' ? 'Show' : 'Clear'} my feedback closes Settings and answers "${said}…"`, !(await page.$eval('#ovSet', (o) => o.classList.contains('open'))) && thread.includes(said), thread.slice(-200));
    }
    check('Clear my feedback sends DELETE as JSON', sent.some((s) => s.m === 'DELETE' && s.p === '/api/v1/feedback' && s.ct === 'application/json'), sent);

    // Appearance: themes, transparency, text size, background
    await open('appearance');
    for (const id of ['standard', 'cyberpunk', 'win95', 'lcars', 'topgun', 'default']) {
      await page.click(`#setBody [data-theme="${id}"]`);
      await page.waitForFunction((id) => document.body.dataset.theme === (id === 'default' ? '' : id), id, { timeout: 3000 }).catch(() => {});
      check(`theme ${id} applies`, (await page.evaluate(() => document.body.dataset.theme)) === (id === 'default' ? '' : id), await page.evaluate(() => document.body.dataset.theme));
    }
    await page.click('#setBody [data-sw="reduce"]');
    check('Reduce transparency applies', await page.evaluate(() => document.body.classList.contains('reduce')), 'no class');
    await page.selectOption('#setBody [data-sel="size"]', 'large');
    check('Text size applies', (await page.evaluate(() => document.body.dataset.size)) === 'large', await page.evaluate(() => document.body.dataset.size));
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.click('#setBody [data-act="bg"]')]);
    await chooser.setFiles({ name: 'bg.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.body.classList.contains('ownbg'), null, { timeout: 5000 }).catch(() => {});
    check('Upload sets your own background', await page.evaluate(() => document.body.classList.contains('ownbg') && /data:image\/png/.test(document.querySelector('.wp')?.style.backgroundImage ?? '')), 'not set');
    await page.click('#setBody [data-act="bgreset"]');
    check('Reset clears it', await page.evaluate(() => !document.body.classList.contains('ownbg')), 'still set');

    // About: the version from the server
    await open('about');
    check('About shows the version', (await page.$eval('#setBody', (b) => b.textContent)).includes('Nexy 9.8.7'), await page.$eval('#setBody', (b) => b.textContent.slice(0, 200)));
    check('nothing threw', errors.length === 0, errors);
  } catch (e) {
    check('ran to the end', false, String(e).split('\n')[0]);
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} settings checks pass`);
  process.exit(failed ? 1 : 0);
})();
