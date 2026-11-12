// A new routine runs once straight away, and "run it now" reruns it (it used to answer "attach a file").
// Both are the agent's own run of the routine (PATCH action "run"), never a chat turn about it.
// All app/model calls are simulated. Serve a build, then:
// PLAYWRIGHT_MODULE=/path/to/playwright NEXY_BASE=http://127.0.0.1:4389 node tests/routines.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.NEXY_BASE || 'http://127.0.0.1:4389';
const assert = require('node:assert/strict');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1400,height:900}});const errs=[];p.on('pageerror',e=>errs.push(String(e)));
const asked=[];
await p.route('**/api/v1/chat',r=>{const m=r.request().postDataJSON().messages;asked.push(m.at(-1).content);r.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'BRIEF: three coffee stories'}}]})});});
const ran=[];
await p.route('**/api/v1/routines',r=>{const q=r.request();if(q.method()==='PATCH'){const b=q.postDataJSON();ran.push(b);return r.fulfill({contentType:'application/json',body:JSON.stringify({run:{id:b.id,reply:'**BRIEF:** three coffee stories'}})});}
r.fulfill({contentType:'application/json',body:JSON.stringify({routine:{id:'r1',nextRunAt:'2026-10-25T23:00:00Z'}})});});
await p.goto(BASE + '/?eval=1');await p.waitForTimeout(1500);
const ai=()=>p.evaluate(()=>[...document.querySelectorAll('#thread .m.ai .bub')].map(e=>e.textContent.trim().slice(0,300)));
await p.fill('#input','Every weekday at 7am, give me a morning brief of coffee news');await p.press('#input','Enter');await p.waitForTimeout(4000);
let a=await ai();console.log('after setting:',JSON.stringify(a));
assert(a.some(t=>/Here is the first one now/.test(t)),'says it runs the first one');
assert(a.some(t=>/BRIEF: three coffee stories/.test(t)),'first run result is in the chat');
assert(!a.some(t=>/\*\*/.test(t)),'its markdown is drawn, not shown raw');
assert.deepEqual(ran,[{id:'r1',action:'run'}],'the routine itself ran once');
assert.equal(asked.length,0,'no chat turn about the routine');
await p.fill('#input','Run it now');await p.press('#input','Enter');await p.waitForTimeout(3000);
a=await ai();assert.equal(ran.length,2,'run it now ran the routine');assert.equal(asked.length,0,'run it now was not a chat turn');
assert(!a.some(t=>/attach/i.test(t)),'no request for a file');
console.log('PASS first run on setup; "run it now" reruns it; errors:',errs);await b.close();})().catch(e=>{console.log('FAIL',e.message);process.exit(1);});
