// Every request from the browser that changes something says what it sends. Behind the box's TLS
// proxy the server sees http while the browser's Origin is https, so the framework's cross-site
// form check refuses a POST, PUT, PATCH or DELETE whose content type is missing or one a plain
// form can send (form-urlencoded, multipart, text/plain) with 403. Calls through a helper that
// sets the header (call, api) pass.
// node --test tests/delete-sends-json.cjs   (NEXY_BASE=<served build> also checks the 403 itself)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLIENT = path.join(__dirname, '..', 'src', 'client');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : /\.(ts|js)$/.test(p) ? [p] : [];
});

// the text of a call's arguments, brackets balanced, from its opening "("
function argsAt(src, i) {
  let depth = 0, quote = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c) && --depth === 0) return src.slice(i, j + 1);
  }
  return src.slice(i);
}

const FORM = /^(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)/i;
// a content type not taken from a literal, each checked by hand
const REVIEWED = {
  'shell.ts': ['"content-type": blob.type'], // the recording: new Blob(..., { type: r.mimeType || "audio/webm" }) or a WAV
};
const BEACON_REVIEWED = { 'private.ts': 'beaconBody(): a Blob typed application/json' };

/** Every problem in one source file: "file:line why". */
function problems(rel, src) {
  const bad = [];
  const at = (i) => `${rel}:${src.slice(0, i).split('\n').length}`;
  for (const m of src.matchAll(/\b(fetch|f|speechFetch|sendBeacon)\(/g)) {
    const a = argsAt(src, m.index + m[0].length - 1);
    if (m[1] === 'sendBeacon') {
      const body = a.slice(1, -1).split(/,(.*)/s)[1]?.trim() ?? '';
      const typed = /^new Blob\([\s\S]*type:\s*"([^"]+)"/.exec(body);
      if (typed ? FORM.test(typed[1]) : !BEACON_REVIEWED[rel]) bad.push(`${at(m.index)} beacon body is not a Blob with a JSON type`);
      continue;
    }
    const method = /method:\s*([^,}\n]+)/.exec(a)?.[1].trim();
    const spread = /\.\.\.init\b/.test(a);
    // a GET (no method, or a literal GET) changes nothing and is never checked
    if (!spread && (!method || method === '"GET"')) continue;
    if (/body:\s*new (FormData|URLSearchParams)\b/.test(a)) { bad.push(`${at(m.index)} body is a form`); continue; }
    const ct = /"?content-type"?\s*:\s*("([^"]*)"|[^,}\n]+)/i.exec(a);
    if (!ct) { bad.push(`${at(m.index)} ${method ?? '...init'} with no content type`); continue; }
    if (ct[2] !== undefined) { if (FORM.test(ct[2]) || !ct[2]) bad.push(`${at(m.index)} content type ${ct[2] || '(empty)'} is one a form can send`); continue; }
    if (!(REVIEWED[rel] ?? []).some((r) => ct[0].trim().startsWith(r))) bad.push(`${at(m.index)} content type ${ct[1].trim()} not reviewed`);
  }
  return bad;
}

test('every POST, PUT, PATCH and DELETE from the browser names a content type no form can send', () => {
  const bad = walk(CLIENT).flatMap((file) => problems(path.relative(CLIENT, file), fs.readFileSync(file, 'utf8')));
  assert.deepEqual(bad, [], `answers 403 behind the proxy: ${bad.join('; ')}`);
});

test('the check catches each way to get it wrong (it is not passing vacuously)', () => {
  const cases = {
    'a delete with no headers': 'fetch(`/api/v1/chats?id=${id}`, { method: "DELETE" })',
    'a put across lines': 'fetch(url, {\n  method: "PUT",\n  body: "{}",\n})',
    'a post as text/plain': 'fetch(url, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" })',
    'a form body': 'fetch(url, { method: "POST", body: new FormData(f) })',
    'a wrapper that drops the type': 'fetch(path, { ...init })',
    'an injected fetch': 'f(as("/x"), { method: "DELETE" })',
    'a string beacon': 'navigator.sendBeacon("/api/v1/screen", JSON.stringify({ release: true }))',
  };
  for (const [name, sample] of Object.entries(cases)) assert.equal(problems('sample.ts', sample).length, 1, name);
  const fine = 'fetch(url, { method: "DELETE", headers: { "content-type": "application/json" } }); fetch("/api/v1/chats"); '
    + 'navigator.sendBeacon(u, new Blob(["{}"], { type: "application/json" }))';
  assert.deepEqual(problems('sample.ts', fine), []);
});

// the premise, against the served build: the server sees http, the browser's Origin is https
test('the served build refuses an untyped delete from another origin and takes a JSON one', { skip: !process.env.NEXY_BASE && 'set NEXY_BASE to a served build' }, async () => {
  const url = `${process.env.NEXY_BASE}/api/v1/feedback`, origin = 'https://own1.example';
  const untyped = await fetch(url, { method: 'DELETE', headers: { origin } });
  assert.equal(untyped.status, 403, 'an untyped DELETE from the proxy origin is refused');
  const typed = await fetch(url, { method: 'DELETE', headers: { origin, 'content-type': 'application/json' } });
  assert.notEqual(typed.status, 403, 'the same DELETE as JSON passes the check');
});
