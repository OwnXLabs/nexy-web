const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const BASE=process.env.NEXY_BASE||'http://127.0.0.1:4393';
const saved=new Map();
for(const [fruit,id] of [['Apple','ctestapple'],['Banana','ctestbanana']]) {
 const run=fruit.toLowerCase();saved.set(id,{id,pid:'_',title:fruit+' conversation',ts:Date.now(),html:`<div class="msg m me"><div class="bub">${fruit} website</div></div>`,history:[{role:'user',content:fruit+' website'}],outputs:[{id:'build:'+run,kind:'html',title:fruit+' website',source:'<h1>'+fruit+'</h1>'}],activeOutput:'build:'+run});
}
let mutations=[],pubs=new Map(),pending,delay=false,failSave=false;
(async()=>{
 const browser=await chromium.launch();
 try {
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/api/**',async route=>{
   const req=route.request(),u=new URL(req.url());let body={};
   if(u.pathname==='/api/v1/chats') {
    if(req.method()==='POST') {if(failSave)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Intentional save failure'})});const c=req.postDataJSON();saved.set(c.id,c);body={ok:true};}
    else if(u.searchParams.has('id')) body={chat:saved.get(u.searchParams.get('id'))};
    else body={chats:[...saved.values()].map(({html,history,outputs,...c})=>c),examples:[]};
   } else if(u.pathname==='/api/v1/publish') {
    if(req.method()==='POST') {
     const b=req.postDataJSON();mutations.push(b);
     if(delay) await new Promise(r=>pending=r);
     pubs.set(b.output,b.action==='publish'?[{name:b.name||'automatic',url:'https://sites.example.test/'+(b.name||'automatic')}]:[]);
     body={enabled:true,publications:pubs.get(b.output)};
    } else body={enabled:true,publications:pubs.get(u.searchParams.get('output'))||[]};
   } else if(u.pathname==='/api/apps/startup/api/pm/projects') body={projects:[]};
   else if(u.pathname==='/api/v1/feed') body={items:[]};
   else if(u.pathname==='/api/v1/model') body={ready:true};
   else if(u.pathname==='/api/v1/chat') body={choices:[{message:{content:'You are welcome'}}]};
   else if(u.pathname==='/api/apps/build/api/director/runs') body={runs:[]};
   await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  const pick=async id=>{await page.click(`[data-chat="${id}"]`);try {await page.waitForFunction(id=>document.querySelector('#cvTitle')?.textContent.includes(id),id==='ctestapple'?'Apple':'Banana');} catch(e) { console.log(await page.locator('#cvTitle').textContent(),JSON.stringify([...saved.values()]));await page.screenshot({path:'/tmp/nexy-publish-failure.png'});throw e;} };
  const open=async()=>{await page.click('#cvShare');await page.waitForSelector('#deployToggle');};
  await page.goto(BASE+'/?eval=1');await page.waitForSelector('[data-chat="ctestapple"]');
  await pick('ctestapple');await open();
  assert.equal(await page.locator('#cvDeploy, #ovDeploy').count(),0);
  assert.equal(await page.getAttribute('#deployToggle','aria-checked'),'false');
  await page.fill('#deployName','a');await page.click('#deployToggle');
  await page.waitForFunction(()=>document.querySelector('#deployBody [role="alert"]').textContent.includes('2–41'));
  assert.equal(mutations.length,0);
  await page.fill('#deployName','apple-site');await page.click('#deployToggle');
  await page.waitForFunction(()=>document.querySelector('#deployToggle').getAttribute('aria-checked')==='true');
  assert.equal(mutations[0].chat,'ctestapple');assert.equal(mutations[0].output,'build:apple');
  assert.equal(await page.locator('#deployBody a').getAttribute('href'),'https://sites.example.test/apple-site');
  await page.screenshot({path:'/tmp/nexy-deploy-control.png'});
  await page.press('body','Escape');await pick('ctestbanana');await open();
  assert.equal(await page.getAttribute('#deployToggle','aria-checked'),'false');
  assert(!await page.locator('#deployBody').textContent().then(t=>t.includes('apple-site')));
  await page.press('body','Escape');await pick('ctestapple');await open();
  assert.equal(await page.getAttribute('#deployToggle','aria-checked'),'true');
  await page.click('#deployToggle');await page.waitForSelector('#deployName');
  assert.equal(mutations.at(-1).action,'unpublish');
  delay=true;await page.fill('#deployName','apple-again');await page.click('#deployToggle');
  await page.waitForFunction(()=>document.querySelector('#deployToggle').disabled);
  await page.press('body','Escape');await pick('ctestbanana');assert(!await page.locator('#ovShare').evaluate(e=>e.classList.contains('open')));
  await open();pending();delay=false;await page.waitForTimeout(150);
  assert.equal(await page.getAttribute('#deployToggle','aria-checked'),'false');
  assert(mutations.every(m=>m.chat==='ctestapple'&&m.output==='build:apple'));
  await page.press('body','Escape');await page.reload();await page.waitForSelector('[data-chat="ctestapple"]');
  await pick('ctestapple');await open();
  assert.equal(await page.getAttribute('#deployToggle','aria-checked'),'true');
  assert.equal(await page.locator('#deployBody a').getAttribute('href'),'https://sites.example.test/apple-again');
  // a chat only saves what changed: a new turn, whose save then fails
  await page.press('body','Escape');failSave=true;
  await page.fill('#input','thank you');await page.press('#input','Enter');
  await page.waitForFunction(()=>document.querySelector('#thread').textContent.includes('You are welcome'));
  await page.click('#cvShare');
  await page.waitForFunction(()=>document.querySelector('#deployBody [role="alert"]')?.textContent.includes('Intentional save failure'));
  assert.equal(await page.locator('#deployToggle').count(),0);
  failSave=false;await page.click('#deployRetry');await page.waitForSelector('#deployToggle');
  assert.equal(await page.getAttribute('#deployToggle','aria-checked'),'true');
  assert.deepEqual(errors,[]);
  console.log('PASS Share-only publishing, validation, correct conversation/output, link, unpublish, switch during publish, reload, save failure/retry, no JS errors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
