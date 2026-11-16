// Clicks every visible button in Nexy, one at a time, on a chat with a built page open.
// A button passes when the click changes the page, makes a request, downloads or opens
// something, and throws nothing. All app/model calls are simulated.
// PLAYWRIGHT_MODULE=/path/to/playwright NEXY_BASE=http://127.0.0.1:4388 node tests/buttons.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.NEXY_BASE || 'http://127.0.0.1:4388';
const output = { id: 'site-1', kind: 'html', title: 'Bakery website', source: '<html><head></head><body><h1>Fresh bread</h1></body></html>' };
const chat = { id: 'cbuttons', title: 'Bakery', pid: '_', ts: Date.now(), outputs: [output], activeOutput: output.id,
  html: '<div class="msg m me"><div class="bub">Build a bakery site</div></div><div class="msg m ai"><div class="bub">Done</div></div>',
  history: [{ role: 'user', content: 'Build a bakery site' }, { role: 'assistant', content: 'Done' }] };
// never clicked: they end the session or leave the page
const SKIP = /sign out|log out|delete|remove/i;

(async () => {
  // a fake microphone, so voice mode opens instead of saying the mic is unavailable
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const failures = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true, hasTouch: true, permissions: ['microphone'] });
    // each click starts from a first visit: a Get started step done by an earlier click
    // (Try it now, Got it) no longer offers Later
    await ctx.addInitScript(() => { try { localStorage.removeItem('nexy.getStarted.v1'); } catch (e) { console.warn('get started not reset', e); } });
    // the controls a person can press right now: on screen and not under a sheet, drawer or dialog
    await ctx.addInitScript(() => {
      const name = (b) => (b.getAttribute('aria-label') || b.title || b.textContent).trim().replace(/\s+/g, ' ').slice(0, 40);
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
        .filter((b) => b.checkVisibility() && !b.disabled && !b.closest('iframe') && reachable(b)).map((el) => ({ el, label: name(el) }));
    });
    const page = await ctx.newPage();
    let requests = 0, popups = 0, downloads = 0;
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('download', () => downloads++);
    ctx.on('page', (p) => { popups++; p.close().catch(() => {}); });
    await page.route('**/api/**', async (route) => {
      requests++;
      const req = route.request(), u = new URL(req.url()), path = u.pathname;
      let body = {};
      if (path === '/api/v1/chats') body = req.method() === 'POST' ? { ok: true } : u.searchParams.has('id') ? { chat } : { chats: [{ id: chat.id, title: chat.title, pid: '_', ts: chat.ts }], examples: [] };
      else if (path === '/api/v1/publish') body = { enabled: true, servesBuild: true, publications: [] };
      else if (path === '/api/v1/revise') body = { html: req.postDataJSON().html, say: 'Changed it.', applied: 1, missed: 0 };
      else if (path === '/api/v1/chat') body = { choices: [{ message: { content: 'ok' } }] };
      else if (path.endsWith('/projects')) body = { projects: [] };
      else if (path.endsWith('/runs')) body = { runs: [] };
      else if (path === '/api/v1/feed' || path.includes('connections')) body = { items: [], connections: [] };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    const open = async () => {
      await page.goto(BASE + '/?eval=1');
      await page.waitForSelector(`[data-chat="${chat.id}"]`);
      await page.$eval(`[data-chat="${chat.id}"]`, (b) => b.click());
      await page.waitForFunction(() => document.querySelector('#cvTabs')?.textContent.includes('Bakery website') || innerWidth < 800, null, { timeout: 15000 });
      // the work pane slides and widens after it opens; buttons it hides when narrow come and go meanwhile
      await page.evaluate(() => new Promise((ok) => {
        let last = '', same = 0;
        const tick = () => {
          const r = document.querySelector('.canvas')?.getBoundingClientRect(), now = r ? `${r.left},${r.width}` : '';
          same = now === last ? same + 1 : 0; last = now;
          if (same >= 6) ok(); else setTimeout(tick, 50);
        };
        tick();
      }));
      await page.waitForTimeout(300);
    };
    // every visible, enabled control, addressed by its path so it survives a reload
    // `fresh`: a control new since the click, or one that took the place of a control still on the page
    const visible = () => page.evaluate(() => {
      const before = window.__before ?? new Map();
      return window.__controls().map((c, i, all) => {
        const sel = `${c.label}#${all.slice(0, i).filter((o) => o.label === c.label).length}`, was = before.get(sel);
        return { label: c.label, sel, fresh: !was || (was !== c.el && was.isConnected && ![...before.values()].includes(c.el)) };
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
    let tried, width;
    const press = async (chain) => {
      const t = chain.at(-1), name = `${width}px: ${chain.map((c) => c.label || c.sel).join(' → ')}`;
      if (SKIP.test(t.label) || tried.has(chain.map((c) => c.sel).join('|'))) return null;
      tried.add(chain.map((c) => c.sel).join('|'));
      await open();
      for (const c of chain.slice(0, -1)) { const ok = await (await find(c.sel)).click({ timeout: 3000 }).then(() => true, (e) => { failures.push(`${name}: could not open ${c.label}, ${e.message.split("\n").find((l) => /intercepts/.test(l))?.trim() || e.message.split("\n")[0]}`); return false; }); if (!ok) return null; await page.waitForTimeout(500); }
      const el = await find(t.sel);
      if (!(await el.isVisible().catch(() => false))) { failures.push(`${name}: not visible`); return null; }
      const r0 = requests, p0 = popups, d0 = downloads, e0 = errors.length;
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
      const did = (await page.evaluate(() => window.__m)) > 0 || requests > r0 || popups > p0 || downloads > d0;
      if (errors.length > e0) failures.push(`${name}: threw ${errors.slice(e0).join('; ')}`);
      else if (!did) failures.push(`${name}: nothing happened`);
      else { passed++; console.log(`PASS ${name}`); }
      return (await visible()).filter((v) => v.fresh);
    };
    let passed = 0;
    for (width of [1600, 390]) {
      tried = new Set();
      await page.setViewportSize({ width, height: width > 800 ? 1000 : 844 });
      console.log(`-- ${width}px`);
      await open();
      // a button cut off by the panel it sits in, while that panel is on screen, can never be pressed
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
      for (const l of cut) failures.push(`${width}px: ${l} is cut off`);
      if (width < 800) {
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (sideways > 1) failures.push(`${width}px: page scrolls sideways by ${sideways}px`);
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
        for (const l of small) failures.push(`${width}px: ${l} is too small to tap`);
      }
      for (const t of await visible()) {
        const revealed = await press([t]);
        // one level down: menus and dialogs a button opens
        for (const r of revealed || []) await press([t, r]);
      }
    }
    const targets = { length: passed + failures.length };
    console.log(`${targets.length} buttons, ${failures.length} failing`);
  } finally { await browser.close(); }
  if (failures.length) { console.error(failures.map((f) => 'FAIL ' + f).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
