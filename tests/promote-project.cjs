// A conversation can become a Project: "Make it a project" in the chat's menu sends what the person
// asked for to the planner, the plan appears in that chat, and the chat is linked to the project.
// A chat already in a project does not offer it.
// PLAYWRIGHT_MODULE=... NEXY_BASE=http://127.0.0.1:4389 node tests/promote-project.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const BASE = process.env.NEXY_BASE || 'http://127.0.0.1:4389';

const loose = { id: 'cbakery', title: 'Bakery site', pid: '_', ts: Date.now(),
  html: '<div class="msg m me"><div class="bub">Build a website for my bakery</div></div><div class="msg m ai"><div class="bub">Done, it is on the right.</div></div>',
  history: [{ role: 'user', content: 'Build a website for my bakery' }, { role: 'assistant', content: 'Done, it is on the right.' }, { role: 'user', content: 'now publish it on my own domain' }, { role: 'assistant', content: 'I can do that.' }] };
const inProject = { id: 'cplanned', title: 'Launch plan', pid: 'p0', ts: Date.now() - 1000, projectId: 'p0',
  html: '<div class="msg m me"><div class="bub">plan my launch</div></div>', history: [{ role: 'user', content: 'plan my launch' }] };
const project = { id: 'p1', title: 'Bakery site', objective: '', goals: [{ title: 'Go live', milestones: [{ title: 'Site', tasks: [{ id: 't1', title: 'Build the site', status: 'todo' }, { id: 't2', title: 'Publish it on the domain', status: 'todo' }] }] }] };

(async () => {
  const browser = await chromium.launch();
  let objective = null;
  const results = [];
  const check = (name, ok, got) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${JSON.stringify(got)}`}`); };
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.route('**/api/**', async (route) => {
      const req = route.request(), u = new URL(req.url());
      if (u.pathname.startsWith('/api/v1/private')) return route.continue();
      let body = { items: [], projects: [], runs: [], connections: [] };
      if (u.pathname === '/api/v1/chats') {
        const id = u.searchParams.get('id');
        body = id ? { chat: id === loose.id ? loose : inProject } : req.method() === 'POST' ? { ok: true } : { chats: [loose, inProject].map(({ id, title, pid, ts }) => ({ id, title, pid, ts })), examples: [] };
      } else if (u.pathname === '/api/apps/startup/api/pm/projects' && req.method() === 'POST') {
        objective = JSON.parse(req.postData() || '{}').objective;
        body = { project };
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(BASE + '/?eval=1');
    await page.waitForSelector(`[data-chat="${loose.id}"]`);

    // a chat already in a project: no offer
    await page.$eval(`[data-chat="${inProject.id}"] .dots`, (d) => d.click()).catch(() => {});
    await page.waitForTimeout(300);
    check('a chat already in a project does not offer "Make it a project"', (await page.locator('text=Make it a project').count()) === 0, 'offered');
    await page.keyboard.press('Escape'); await page.mouse.click(5, 5); await page.waitForTimeout(200);

    // the loose chat: offered, and it becomes a project
    await page.$eval(`[data-chat="${loose.id}"] .dots`, (d) => d.click());
    await page.waitForSelector('text=Make it a project', { timeout: 5000 });
    await page.locator('text=Make it a project').first().click();
    await page.waitForFunction(() => document.querySelector('#thread')?.textContent.includes('Build the site'), null, { timeout: 15000 }).catch(() => {});
    check('the planner gets what the person asked for, first and latest', typeof objective === 'string' && /website for my bakery/.test(objective) && /publish it on my own domain/.test(objective), objective);
    const thread = await page.$eval('#thread', (t) => t.textContent);
    check('the chat says it was made a project', thread.includes('Make this a project'), thread.slice(0, 200));
    check("the project's plan appears in the chat", thread.includes('Build the site') && thread.includes('Publish it on the domain'), thread.slice(-300));
    const side = await page.$eval('#projList', (p) => p.textContent);
    check('the project is listed in the sidebar', /Bakery site/.test(side), side.slice(0, 200));
  } catch (e) {
    check('ran to the end', false, String(e).split('\n')[0]);
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} promote-project checks pass`);
  process.exit(failed ? 1 : 0);
})();
