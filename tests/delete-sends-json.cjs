// Every delete from the browser says it is JSON. Behind the box's TLS proxy the server sees
// http while the browser's Origin is https, so the framework's cross-site form check refuses
// a request with no JSON content type: deleting a saved chat answered 403 and the chat stayed
// (2026-11-02). Calls through a helper that sets the header (call, api) pass.
// node --test tests/delete-sends-json.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLIENT = path.join(__dirname, '..', 'src', 'client');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
});

// a direct fetch, or an injected fetch named f, whose options say DELETE on the same line
const DIRECT = /\b(fetch|f)\([^\n]*\{[^\n]*method:\s*"DELETE"[^\n]*\}/g;

test('every direct DELETE from the browser sends content-type: application/json', () => {
  const bad = [];
  for (const file of walk(CLIENT)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(DIRECT)) {
      if (!/content-type"?\s*:\s*"application\/json"/i.test(m[0])) {
        const line = src.slice(0, m.index).split('\n').length;
        bad.push(`${path.relative(CLIENT, file)}:${line}`);
      }
    }
  }
  assert.deepEqual(bad, [], `DELETE without a JSON content type (answers 403 behind the proxy): ${bad.join(', ')}`);
});

test('the check catches a header-less delete (it is not passing vacuously)', () => {
  const sample = 'fetch(`/api/v1/chats?id=${id}`, { method: "DELETE" })';
  const m = [...sample.matchAll(DIRECT)];
  assert.equal(m.length, 1);
  assert.equal(/content-type"?\s*:\s*"application\/json"/i.test(m[0][0]), false);
});
