// Nexy stays engine-neutral: people never see which agent runs underneath (Hermes, IronClaw,
// OpenClaw, or our own later), and swapping it is one setting. Run after `npm run build`:
// node --test tests/engine-neutral.cjs
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
