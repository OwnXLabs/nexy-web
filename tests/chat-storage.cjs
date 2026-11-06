const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { buildSync } = require('esbuild');
const dir = mkdtempSync(join(tmpdir(),'nexy-chat-test-'));
process.env.NEXY_DATA_DIR=dir;
const code=buildSync({entryPoints:[resolve(__dirname,'../src/lib/chats.ts')],bundle:true,platform:'node',format:'cjs',write:false,define:{'import.meta.glob':'emptyExamples'}}).outputFiles[0].text;
const m={exports:{}};new Function('require','module','exports','emptyExamples',code)(require,m,m.exports,()=>({}));
const { clean,put,get,list }=m.exports;
after(()=>rmSync(dir,{recursive:true,force:true}));
const raw={id:'ctestapple',pid:'_',title:'Apple',html:'<div>Apple transcript</div>',history:[{role:'user',content:'Build apples'}],outputs:[{id:'build:apple',kind:'html',title:'Apple site',source:'<h1>Apple</h1>',href:'/api/apps/build/api/director/runs/apple/preview'}],activeOutput:'build:apple'};
test('conversation output data and preview selection survive real disk storage',async()=>{
 const c=clean(raw);assert(c);await put('owner-a',c);
 assert.deepEqual(await get('owner-a',raw.id),JSON.parse(JSON.stringify(c)));
 assert.equal((await get('owner-a',raw.id)).outputs[0].source,'<h1>Apple</h1>');
 assert.equal(await get('owner-b',raw.id),null);
 assert.equal((await list('owner-a'))[0].outputs,undefined);
});
test('old transcripts remain readable with no invented output associations',()=>{
 const {outputs,activeOutput,...old}=raw;const c=clean(old);
 assert.deepEqual(c.outputs,[]);assert.equal(c.html,old.html);
});
test('output URLs exclude executable and off-site schemes',()=>{
 for(const href of ['javascript:alert(1)','//evil.example','https://evil.example','data:text/html,bad'])
  assert.equal(clean({...raw,outputs:[{...raw.outputs[0],href}]}).outputs[0].href,undefined);
});
test('oversized output collections are rejected instead of losing data silently',()=>{
 assert.equal(clean({...raw,outputs:[{...raw.outputs[0],source:'x'.repeat(8_000_001)}]}),null);
});
