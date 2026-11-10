// Asking for a website in chat on an Own 1 that can build across devices: the pieces show up with
// where each ran, then the finished page. A fake Own 1 job route stands in for the box and devices.
// Run after `npm run build`: PLAYWRIGHT_MODULE=<path to playwright> node --test tests/swarm-browser.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ENTRY = path.join(__dirname, '..', 'dist', 'server', 'entry.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PLAN = { title: 'Ice cream shop', style: { bg: '#fff7f0', fg: '#222222', accent: '#e85d75', font: 'Georgia, serif' },
  sections: [{ id: 'hero', title: 'Hero', brief: 'welcome' }, { id: 'menu', title: 'Menu', brief: 'flavours' }],
  images: [{ id: 'strawberry', prompt: 'strawberry ice cream, photo', section: 'menu' }] };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function fakeBox() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const b = body ? JSON.parse(body) : {};
      seen.push({ url: req.url, route: b.route, auth: req.headers['x-internal'] });
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/v1/workers')) return res.end(JSON.stringify({ devices: [{ address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'Nexy on Gaming PC', caps: ['chat:q', 'image:sd'], online: true }] }));
      await sleep(300);
      const ranOn = b.route === 'device:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' ? 'device:Nexy on Gaming PC' : 'box';
      res.setHeader('x-ran-on', ranOn);
      if (req.url.endsWith('/v1/images/generations')) return res.end(JSON.stringify({ data: [{ b64_json: PNG }] }));
      const sys = b.messages?.[0]?.content ?? '';
      if (sys.includes('You plan')) return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(PLAN) } }] }));
      const id = (sys.match(/<section id="([a-z-]+)">/) || [])[1] || 'x';
      const imgs = [...sys.matchAll(/data-img="([a-z-]+)"/g)].map((m) => `<img data-img="${m[1]}" alt="">`).join('');
      res.end(JSON.stringify({ choices: [{ message: { content: `<section id="${id}"><h2>${id} built</h2>${imgs}<script>alert(1)</script></section>` } }] }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}/infer` })));
}

async function start(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = spawn(process.execPath, [ENTRY], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(base + '/api/v1/health'); return { p, base, log: () => log }; } catch { await sleep(150); } }
  p.kill(); throw new Error('server did not start\n' + log);
}

test('a website request builds across devices and shows the page', async () => {
  const box = await fakeBox();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-swarm-'));
  const s = await start({ NEXY_DATA_DIR: data, NEXY_INFER_URL: box.url, NEXY_INFER_AUTH: 'X-Internal: t0k', NEXY_TRUST_XNODE_AUTH: '1' });
  const b = await chromium.launch();
  try {
    const page = await (await b.newContext({ extraHTTPHeaders: { 'xnode-auth-user': 'ethereum:0xowner' } })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(s.base + '/');
    const input = page.locator('#input');
    await input.waitFor({ timeout: 20000 });
    await input.fill('Build me a website for an ice cream shop');
    await input.press('Enter');
    await page.locator('.swarm .sw-list li').first().waitFor({ timeout: 20000 });
    const frame = page.locator('.swarm iframe.sw-page');
    await frame.waitFor({ timeout: 30000 });
    assert.equal(await frame.getAttribute('sandbox'), '', 'the page runs with no scripts');
    const rows = await page.locator('.swarm .sw-list li').allTextContents();
    assert.ok(rows.some((r) => /Gaming PC/.test(r)), rows.join(' | '));
    assert.ok(rows.some((r) => /your Own 1/.test(r)), rows.join(' | '));
    assert.match(await page.locator('.swarm .sw-foot').textContent(), /Made on/);
    const html = await (await page.request.get(await frame.getAttribute('src').then((u) => s.base + u))).text();
    assert.match(html, /hero built/);
    assert.doesNotMatch(html, /<script/);
    assert.ok(box.seen.every((x) => x.auth === 't0k'), 'every call carries the internal identity');
    assert.ok(box.seen.some((x) => x.route === 'device:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'));
    assert.deepEqual(errors, []);
  } finally { await b.close(); s.p.kill(); box.srv.close(); }
});
