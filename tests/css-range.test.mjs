// Astro 7's compiler writes (max-width: X) as (width <= X); Safari before 16.4 drops such rules,
// and nothing lowers @container back. The built output must hold no range syntax.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RANGE = /\((?:width|height)\s*[<>]=?\s*[^)]*\)/;

function* files(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(css|js|mjs|html)$/.test(n)) yield p;
  }
}

export function rangeHits(dir) {
  const hits = [];
  for (const f of files(dir)) {
    const m = readFileSync(f, "utf8").match(RANGE);
    if (m) hits.push(`${f}: ${m[0]}`);
  }
  return hits;
}

test("the pattern catches spaced and unspaced range syntax", () => {
  for (const s of ["(width <= 30rem)", "(width<=30rem)", "(height > 10px)", "(width >= 40em)"]) assert.match(s, RANGE);
  assert.doesNotMatch("(max-width: 30rem)", RANGE);
});

test("built output has no CSS range syntax", () => {
  assert.deepEqual(rangeHits("dist"), []);
});
