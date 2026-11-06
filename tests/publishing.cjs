// Real Nexy API handlers + disk-backed chats + the private Python publisher.
// Local HTTP fixture stands in for Own Build; nothing is published on Own1.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { buildSync } = require('esbuild');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexy-publish-'));
const who = 'o_testing_0123456789abcdef';
process.env.NEXY_DATA_DIR = temp;
const publisherPath = process.env.NEXY_PUBLISHER_SCRIPT || path.resolve(__dirname, '../publisher.py');
const code = buildSync({ entryPoints: [path.resolve(__dirname, '../src/pages/api/v1/publish.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, define: { 'import.meta.glob': 'emptyExamples' } }).outputFiles[0].text;
const m = { exports: {} }; new Function('require', 'module', 'exports', 'emptyExamples', code)(require, m, m.exports, () => ({}));
const api = m.exports;
fs.mkdirSync(path.join(temp, 'chats', who), { recursive: true });
const chat = (id, run, kind='html') => fs.writeFileSync(path.join(temp,'chats',who,id+'.json'), JSON.stringify({id,outputs:[{id:'build:'+run,kind,title:run,...(run==='apple'?{source:'<h1>apple edited snapshot</h1>'}:{})}]}));
chat('ctestapple', 'apple'); chat('ctestbanana', 'banana'); chat('ctestaudio', 'audio','audio');
let python, server, port;
const listen = (s) => new Promise(r => s.listen(0, '127.0.0.1', () => r(s.address().port)));
async function startPublisher(script=publisherPath) {
  python = spawn('python3', [script], { env: {...process.env, PORT:String(port), SITES_DIR:temp, SITES_URL:'https://sites.example.test', OWN_BUILD_URL:`http://127.0.0.1:${server.address().port}`}, stdio:['ignore','ignore','pipe'] });
  let stderr='';python.stderr.on('data',b=>stderr+=b);
  for (let i=0;i<400;i++) { try { const r=await fetch(process.env.NEXY_PUBLISHER_URL+'/publish/api/status?run=apple',{headers:{'x-nexy-owner':who}}); if(r.ok) return; } catch {} await new Promise(r=>setTimeout(r,30)); }
  throw new Error('publisher did not start: '+stderr);
}
async function stopPublisher() { const p=python; python=undefined; if(p) {p.kill(); await new Promise(r=>p.once('exit',r));} }
async function request(method, chatId, output, body, cookie=who, origin='http://nexy.test', sessionCookie='') {
  const url = new URL('http://nexy.test/api/v1/publish');
  if(chatId) {url.searchParams.set('chat',chatId);url.searchParams.set('output',output);}
  const ctx = { url, cookies:{get:()=>({value:cookie}),set:()=>{}}, request:new Request(url, {method,headers:{origin,cookie:sessionCookie,'content-type':'application/json'},...(body ? {body:JSON.stringify(body)} : {})}) };
  const r = await api[method](ctx); return {status:r.status,...await r.json()};
}
after(async()=>{await stopPublisher(); if(server) await new Promise(r=>server.close(r)); fs.rmSync(temp,{recursive:true,force:true});});
test('conversation publishing uses real publisher storage and preserves other builds', async()=>{
  server=http.createServer((req,res)=>{if(req.url==='/session'){res.statusCode=req.headers.cookie==='active=1'?204:401;return res.end();}res.setHeader('content-type','text/html');res.end('<!doctype html><h1>'+req.url.split('/')[4]+'</h1>');});
  await listen(server);
  const reservation=http.createServer(); port=await listen(reservation); await new Promise(r=>reservation.close(r));
  process.env.NEXY_PUBLISHER_URL=`http://127.0.0.1:${port}`;
  await startPublisher();
  process.env.NEXY_PUBLISH_SESSION_URL=`http://127.0.0.1:${server.address().port}/session`;
  assert.equal((await request('GET','ctestapple','build:apple')).status,401);
  assert.equal((await request('GET','ctestapple','build:apple',null,who,'http://nexy.test','active=1')).status,200);
  delete process.env.NEXY_PUBLISH_SESSION_URL;
  const write=(chat,run,action,name)=>request('POST',null,null,{chat,output:'build:'+run,action,name});
  assert.deepEqual((await request('GET','ctestapple','build:apple')).publications,[]);
  assert.equal((await write('ctestapple','banana','publish')).status,404);
  assert.equal((await request('GET','ctestapple','build:apple',null,'o_stranger_abcdef0123456789')).status,404);
  assert.equal((await write('ctestaudio','audio','publish')).status,400);
  assert.equal((await request('POST',null,null,{chat:'ctestapple',output:'build:apple',action:'publish'},who,'https://other.test')).status,403);
  assert.equal((await write('ctestapple','apple','publish','../bad')).status,400);
  const a=await write('ctestapple','apple','publish','apple-site');
  assert.equal(a.status,200);assert.equal(a.publications[0].url,'https://sites.example.test/apple-site');
  assert.match(fs.readFileSync(path.join(temp,'apple-site.html'),'utf8'),/apple edited snapshot/);
  assert.equal((await write('ctestbanana','banana','publish','apple-site')).status,409);
  const b=await write('ctestbanana','banana','publish','banana-site'); assert.equal(b.status,200);
  assert.equal((await write('ctestapple','apple','publish','different-name')).publications.length,1);
  assert(!fs.existsSync(path.join(temp,'different-name.html')));
  await stopPublisher();await startPublisher();
  assert.equal((await request('GET','ctestapple','build:apple')).publications[0].name,'apple-site');
  const wrong=await fetch(process.env.NEXY_PUBLISHER_URL+'/publish/api/unpublish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'banana-site',run:'apple'})});
  assert.equal(wrong.status,409);
  assert.deepEqual((await write('ctestapple','apple','unpublish')).publications,[]);
  assert(!fs.existsSync(path.join(temp,'apple-site.html')));
  assert(fs.existsSync(path.join(temp,'banana-site.html')));
  assert.equal((await request('GET','ctestbanana','build:banana')).publications[0].name,'banana-site');
  const standalone=await fetch(process.env.NEXY_PUBLISHER_URL+'/publish/api/unpublish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'banana-site'})});
  assert.equal(standalone.status,200);
  assert.deepEqual((await request('GET','ctestbanana','build:banana')).publications,[]);
  await stopPublisher();await startPublisher(path.resolve(__dirname,'../deploy/demo-publisher.py'));
  process.env.NEXY_PUBLISH_ORIGIN='https://nexy.test';
  assert.equal((await write('ctestapple','apple','publish','demo-apple')).status,403);
  const deployed=await request('POST',null,null,{chat:'ctestapple',output:'build:apple',action:'publish',name:'demo-apple'},who,'https://nexy.test');
  assert.equal(deployed.status,200);assert.equal(deployed.publications[0].name,'demo-apple');
  delete process.env.NEXY_PUBLISH_ORIGIN;
  const url=process.env.NEXY_PUBLISHER_URL;
  assert.equal((await fetch(url+'/publish/api/status?run=apple')).status,403);
  const other='o_stranger_abcdef0123456789';
  assert.deepEqual((await (await fetch(url+'/publish/api/status?run=apple',{headers:{'x-nexy-owner':other}})).json()).publications,[]);
  const denied=await fetch(url+'/publish/api/unpublish',{method:'POST',headers:{'content-type':'application/json','x-nexy-owner':other},body:JSON.stringify({name:'demo-apple',run:'apple'})});
  assert.equal(denied.status,404);assert(fs.existsSync(path.join(temp,'demo-apple.html')));
  assert.deepEqual((await write('ctestapple','apple','unpublish')).publications,[]);
  assert(!fs.existsSync(path.join(temp,'demo-apple.html')));
  delete process.env.NEXY_PUBLISHER_URL;
  assert.equal((await request('GET','ctestapple','build:apple')).enabled,false);
});
