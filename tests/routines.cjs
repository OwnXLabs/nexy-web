// A new routine runs once straight away, and "run it now" reruns it (it used to answer "attach a file").
// All app/model calls are simulated. Serve a build, then:
// PLAYWRIGHT_MODULE=/path/to/playwright NEXY_BASE=http://127.0.0.1:4389 node tests/routines.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.NEXY_BASE || 'http://127.0.0.1:4389';
const assert = require('node:assert/strict');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1400,height:900}});const errs=[];p.on('pageerror',e=>errs.push(String(e)));
const asked=[];
await p.route('**/api/v1/chat',r=>{const m=r.request().postDataJSON().messages;asked.push(m.at(-1).content);r.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'BRIEF: three coffee stories'}}]})});});
await p.route('**/api/v1/routines',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({routine:{id:'r1',nextRunAt:'2026-10-25T23:00:00Z'}})}));
await p.goto(BASE + '/?eval=1');await p.waitForTimeout(1500);
const ai=()=>p.evaluate(()=>[...document.querySelectorAll('#thread .m.ai .bub')].map(e=>e.textContent.trim().slice(0,300)));
await p.fill('#input','Every weekday at 7am, give me a morning brief of coffee news');await p.press('#input','Enter');await p.waitForTimeout(4000);
let a=await ai();console.log('after setting:',JSON.stringify(a));
assert(a.some(t=>/Here is the first one now/.test(t)),'says it runs the first one');
assert(a.some(t=>/BRIEF: three coffee stories/.test(t)),'first run result is in the chat');
assert(asked.at(-1).includes('give me a morning brief of coffee news'),'the routine task ran as a turn');
assert.match(asked.at(-1),/already set for every weekday at 07:00\. It exists: do not create/,'the turn is told the routine is already set');
const n=asked.length;
await p.fill('#input','Run it now');await p.press('#input','Enter');await p.waitForTimeout(3000);
a=await ai();assert.equal(asked.length,n+1,'run it now ran the routine');assert(asked.at(-1).includes('give me a morning brief of coffee news'));assert.match(asked.at(-1),/do not create/);
assert(!a.some(t=>/attach/i.test(t)),'no request for a file');
console.log('PASS first run on setup; "run it now" reruns it; errors:',errs);await b.close();})().catch(e=>{console.log('FAIL',e.message);process.exit(1);});
