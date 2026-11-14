// Nexy's own code stays engine-neutral: the page and the API never name an agent engine, and
// swapping one is one setting. Replies are neutral on Nexy Engine, which speaks as Nexy; Hermes and
// OpenClaw speak as themselves and may name themselves (tests/engine-identity.cjs runs it).
// Run after `npm run build`: node --test tests/engine-neutral.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ENGINES = /\b(hermes|ironclaw|openclaw|nous ?research)\b/i;
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});

test('nothing sent to the browser names an agent engine', () => {
  const dist = path.join(ROOT, 'dist', 'client');
  assert(fs.existsSync(dist), 'build first: npm run build');
  const hits = walk(dist).filter((f) => /\.(js|css|html|json|svg)$/.test(f)).filter((f) => ENGINES.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(hits.map((f) => path.relative(ROOT, f)), []);
});

test('only the engine layer imports an engine adapter', () => {
  const src = path.join(ROOT, 'src');
  const hits = walk(src).filter((f) => /\.(ts|astro)$/.test(f) && !f.includes(`${path.sep}lib${path.sep}engine${path.sep}`))
    .filter((f) => /from\s+["'][^"']*engine\/(hermes|local)["']/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(hits.map((f) => path.relative(ROOT, f)), []);
});

test('API code never puts an engine name in a string a person can read', () => {
  const api = path.join(ROOT, 'src', 'pages', 'api');
  const lib = path.join(ROOT, 'src', 'lib');
  const hits = [...walk(api), ...walk(lib)].filter((f) => f.endsWith('.ts') && !f.includes(`${path.sep}engine${path.sep}`))
    .flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i, line })))
    // string literals only, comments and identifiers aside
    .filter(({ line }) => !/^\s*(\/\/|\*)/.test(line) && /["'`][^"'`]*\b(hermes|ironclaw|openclaw)\b[^"'`]*["'`]/i.test(line))
    .map(({ f, i }) => `${path.relative(ROOT, f)}:${i + 1}`);
  assert.deepEqual(hits, []);
});

test('only Hermes (in each of its modes) and OpenClaw speak as themselves; Nexy Engine stays neutral', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'engine', 'registry.ts'), 'utf8');
  const m = /const OWN_IDENTITY = \/(.+)\/;/.exec(src);
  assert(m, 'the registry names the engines that speak as themselves');
  const own = new RegExp(m[1]);
  for (const id of ['hermes', 'hermes-think', 'openclaw']) assert(own.test(id), `${id} may name itself`);
  for (const id of ['nexy-engine', 'ironclaw', 'zeroclaw', 'local', 'gateway']) assert(!own.test(id), `${id} speaks as Nexy`);
  // chat.ts decides by the flag, never by an engine's id
  const chat = fs.readFileSync(path.join(ROOT, 'src', 'pages', 'api', 'v1', 'chat.ts'), 'utf8');
  assert.match(chat, /\.ownIdentity\b/);
  assert.doesNotMatch(chat.replace(/^\s*\/\/.*$/gm, ''), /\b(hermes|openclaw|nexy-engine)\b/i);
});
