// Runs against a local Nexy dev server; all app/model calls are simulated.
// PLAYWRIGHT_MODULE=/path/to/playwright NEXY_BASE=http://127.0.0.1:4388 node tests/conversation-isolation.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const BASE = process.env.NEXY_BASE || 'http://127.0.0.1:4388';
const saved = new Map();
const chat = (id, title, output) => ({ id, title, pid: '_', ts: Date.now(), html: `<div class="msg m me"><div class="bub">${title}</div></div><div class="msg m ai"><div class="bub">Saved response</div></div>`, history: [{role:'user',content:title},{role:'assistant',content:'Saved response'}], ...(output ? { outputs:[output], activeOutput:output.id } : {}) });
saved.set('ctestapple',chat('ctestapple','Apple conversation',{id:'apple-output',kind:'html',title:'Apple website',source:'<h1>Apples only</h1>'}));
saved.set('ctestbanana',chat('ctestbanana','Banana conversation',{id:'banana-output',kind:'game',title:'Banana game',source:'<h1>Bananas only</h1>'}));
saved.set('ctestlegacy',chat('ctestlegacy','Older conversation'));
let releaseBuild = false, failBuild = false, builds = 0, lastChatContext = {};
const revised = [];
(async () => {
 const browser = await chromium.launch();
 try {
  const page = await browser.newPage({viewport:{width:1600,height:1000}});
  if(process.env.NEXY_CLIENT_BUNDLE) await page.route('**/_astro/*.js',route=>route.fulfill({contentType:'text/javascript',path:process.env.NEXY_CLIENT_BUNDLE}));
  const errors=[]; page.on('pageerror', e=>errors.push(String(e)));
  await page.route('**/api/**', async route => {
   const req=route.request(), u=new URL(req.url()), path=u.pathname;
   let body={};
   if(path==='/api/v1/chats') {
    if(req.method()==='POST'){ const c=req.postDataJSON(); saved.set(c.id,{...c,ts:Date.now()}); body={ok:true}; }
    else if(u.searchParams.has('id')) body={chat:saved.get(u.searchParams.get('id'))};
    else body={chats:[...saved.values()].map(({html,history,outputs,...c})=>c),examples:[]};
   } else if(path==='/api/v1/feed') body={items:[{app:'build',appLabel:'Own Build',kind:'html',id:'unrelated',title:'Unrelated machine-wide website',ts:Date.now(),href:'/unrelated'}]};
   else if(path==='/api/apps/startup/api/pm/projects') body={projects:[]};
   else if(path==='/api/apps/build/api/director/runs') body={runs:[]};
   else if(path==='/api/apps/build/api/build') {
    if(req.method()==='POST'){builds++;body={buildId:'pending-apple'};}
    else body=failBuild ? {status:'error',elapsedSeconds:1,error:'Apple build intentionally failed'} : releaseBuild ? {status:'done',runId:'apple-background-result',elapsedSeconds:4,artifact:{title:'Apple background build',html:'<html><body><h1>Apple background result</h1></body></html>'}} : {status:'running',elapsedSeconds:1,step:'Building apple'};
   } else if(path==='/api/v1/publish') { body={enabled:true,servesBuild:true,publications:[]};
   } else if(path==='/api/v1/revise') {
    const b=req.postDataJSON(); revised.push(b);
    body={html:b.html.replace('</body>','<style data-nexy-edit>body{background:#111}</style></body>'),say:'Darker background',applied:1,missed:0};
   } else if(path==='/api/v1/chat') {
    const m=req.postDataJSON().messages; lastChatContext=req.postDataJSON().context||{};
    if(req.postDataJSON().private) { await route.fulfill({contentType:"application/json",body:JSON.stringify({choices:[{message:{content:"```html\n<h1>PRIVATEOUTPUT</h1>\n```"}}]})}); return; }
    body={choices:[{message:{content:`Reply for ${m.at(-1).content}`}}]};
   } else if(path==='/api/v1/title') body={title:null};
   // the model is in, and this machine builds sites itself rather than across devices
   else if(path==='/api/v1/model') body={ready:true};
   else if(path==='/api/v1/swarm') { await route.fulfill({status:404,contentType:'application/json',body:'{}'}); return; }
   else if(path.includes('connections')) body={items:[],connections:[]};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  const pick=async id=>{await page.click(`[data-chat="${id}"]`); await page.waitForTimeout(120);};
  const panel=()=>page.evaluate(()=>({files:document.querySelector('#fgrid').textContent,apps:document.querySelector('#agrid').textContent,tabs:document.querySelector('#cvTabs').textContent,thread:document.querySelector('#thread').textContent}));
  const wait=fn=>page.waitForFunction(fn,null,{timeout:15000});
  await page.goto(BASE+'/?eval=1');
  await wait(()=>document.querySelector('[data-chat="ctestapple"]'));
  await pick('ctestapple');
  await wait(()=>document.querySelector('#fgrid').textContent.includes('Apple website'));
  let p=await panel(); assert.match(p.apps,/Apple website/); assert.doesNotMatch(JSON.stringify(p),/Unrelated machine/);
  console.log('PASS selected chat scopes files, apps and output tabs');
  await pick('ctestbanana'); p=await panel(); assert.match(p.files,/Banana game/); assert.match(p.apps,/Banana game/); assert.doesNotMatch(p.files+p.apps+p.tabs,/Apple/);
  await pick('ctestlegacy'); p=await panel(); assert.doesNotMatch(p.files+p.apps+p.tabs,/Apple|Banana|Unrelated/);
  console.log('PASS legacy chat never inherits global app history');
  await pick('ctestapple');
  await page.fill('#input','Build me a website about apples'); await page.press('#input','Enter');
  await wait(()=>document.querySelector('#cvTitle').textContent.includes('Building'));
  await pick('ctestbanana');
  await page.fill('#input','hello banana'); await page.press('#input','Enter');
  await wait(()=>document.querySelector('#thread').textContent.includes('Reply for hello banana'));
  await pick('ctestlegacy');
  releaseBuild=true;
  for(let n=0;n<300 && !saved.get('ctestbanana').history.some(t=>t.content==='Reply for hello banana');n++) await new Promise(r=>setTimeout(r,50));
  assert(saved.get('ctestbanana').history.some(t=>t.content==='Reply for hello banana'));
  // the question no longer waits behind the build, so wait for the build itself
  for(let n=0;n<600 && !/Done/.test(saved.get('ctestapple').html||'');n++) await new Promise(r=>setTimeout(r,50));
  p=await panel(); assert.doesNotMatch(p.thread+p.files+p.apps+p.tabs,/Apple background|Building apple|Done —/);
  assert.doesNotMatch(p.thread,/hello banana/);
  assert.match(saved.get('ctestapple').html,/Done/);
  assert(saved.get('ctestapple').outputs.some(o=>o.title==='Apple background build'));
  assert(!saved.get('ctestbanana').outputs.some(o=>/Apple/.test(o.title)));
  console.log('PASS background build completes and saves in its originating conversation');
  assert(saved.get('ctestbanana').history.some(t=>t.content==='hello banana'));
  assert(!saved.get('ctestapple').history.some(t=>t.content==='hello banana'));
  console.log('PASS a question during a build keeps its own conversation and model history');
  await pick('ctestapple'); p=await panel(); assert.match(p.thread,/Done/); assert.match(p.files,/Apple background build/); assert.match(p.tabs,/Apple background build/);
  await page.reload(); await wait(()=>document.querySelector('[data-chat="ctestapple"]')); await pick('ctestapple');
  await wait(()=>document.querySelector('#fgrid').textContent.includes('Apple background build'));
  p=await panel(); assert.match(p.tabs,/Apple background build/); assert.doesNotMatch(p.files+p.apps+p.tabs,/Banana|Unrelated/);
  console.log('PASS saved outputs and preview tabs restore after page reload');
  await pick('ctestbanana'); p=await panel(); assert.match(p.thread,/Reply for hello banana/); assert.doesNotMatch(p.files+p.apps+p.tabs,/Apple/);
  await pick('ctestapple');
  await page.click('#newChat');
  p=await panel(); assert.doesNotMatch(p.files+p.apps+p.tabs,/Apple|Banana/); assert.doesNotMatch(p.thread,/Saved response|Done/);
  console.log('PASS New chat starts with empty transcript, lists and preview tabs');
  // a change to the page open on the right edits it in place instead of rebuilding
  await pick('ctestapple');
  await wait(()=>[...document.querySelectorAll('#cvBody iframe')].some(f=>f.srcdoc.includes('Apple background result')));
  const buildsBefore=builds;
  await page.fill('#input','make the background darker'); await page.press('#input','Enter');
  await wait(()=>[...document.querySelectorAll('#cvBody iframe')].some(f=>f.srcdoc.includes('data-nexy-edit')));
  assert.equal(builds,buildsBefore); assert.equal(revised.length,1); assert.match(revised[0].instruction,/background darker/);
  p=await panel(); assert.match(p.thread,/Done — Darker background\./);
  console.log('PASS a change to the open page edits it in place instead of rebuilding');
  const [dl]=await Promise.all([page.waitForEvent('download'), page.click('#cvDownload')]);
  assert.match(dl.suggestedFilename(),/\.html$/); assert.match(require('node:fs').readFileSync(await dl.path(),'utf8'),/data-nexy-edit/);
  console.log('PASS Download saves the page as edited, as a file');
  await page.click('#cvShare');
  await wait(()=>/not included/.test(document.querySelector('#deployBody')?.textContent||''));
  await page.click('#ovShare [data-close]');
  console.log('PASS Share says an edited page publishes as Own Build made it on the demo');
  await page.fill('#input','what does the page say?'); await page.press('#input','Enter');
  await wait(()=>document.querySelector('#thread').textContent.includes('Reply for what does the page say?'));
  assert.match(String(lastChatContext.open?.text),/Apple background result/);
  console.log('PASS a question about the open page sends the page text to the model');
  await page.fill('#input','undo'); await page.press('#input','Enter');
  await wait(()=>[...document.querySelectorAll('#cvBody iframe')].some(f=>f.srcdoc.includes('Apple background result') && !f.srcdoc.includes('data-nexy-edit')));
  console.log('PASS undo puts the page back');
  await pick('ctestapple'); releaseBuild=false;
  await page.fill('#input','Build me a website about red apples'); await page.press('#input','Enter');
  await wait(()=>document.querySelector('#cvTitle').textContent.includes('Building'));
  await pick('ctestbanana'); failBuild=true;
  for(let n=0;n<300 && !saved.get('ctestapple').html.includes('Apple build intentionally failed');n++) await new Promise(r=>setTimeout(r,50));
  assert.match(saved.get('ctestapple').html,/Apple build intentionally failed/);
  p=await panel(); assert.doesNotMatch(p.thread+p.tabs,/intentionally failed/);
  console.log('PASS background generation failures stay in the originating conversation');
  await page.fill('#input','prepare my tax return'); await page.press('#input','Enter');
  await wait(()=>[...document.querySelectorAll('#cvBody iframe')].some(f=>f.srcdoc.includes('PRIVATEOUTPUT')));
  page.on('dialog',d=>d.accept());
  await page.click('#newChat');
  await pick('ctestbanana');
  p=await panel(); assert.doesNotMatch(p.tabs+p.thread,/PRIVATEOUTPUT/);
  assert(!JSON.stringify([...saved.values()]).includes('PRIVATEOUTPUT'));
  console.log('PASS ultra-private outputs are neither persisted nor retained after ending the session');
  assert.equal(builds,2); assert.deepEqual(errors,[]);
  console.log('PASS switching back retains transcript; no browser errors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
