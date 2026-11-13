// Astro 7's compiler writes (max-width: X) as (width <= X); Safari before 16.4 drops such rules,
// and nothing lowers @container back. The built output must hold no range syntax.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// only inside an @media/@container prelude, so JS bounds checks like `if (width <= 0)` never match
const RANGE = /@(?:media|container)[^{;]*\((?:(?:width|height)\s*[<>]|[^){]*[<>]=?\s*(?:width|height)\b)/;

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
  for (const s of ["@media (width <= 30rem)", "@media (width<=980px)", "@container s (height >= 40rem)", "@container (width>=20em)", "@media (20rem <= width <= 30rem)", "@media screen and (width < 40em)"]) assert.match(s, RANGE);
  for (const s of ["@media (max-width: 30rem)", "@container s (min-height: 2rem)", "if (width <= 0 || height <= 0 || idat.length === 0) return null;", "@media (max-width:1px){a{}}x=function(){if(width<=0)return}"]) assert.doesNotMatch(s, RANGE);
});

test("built output has no CSS range syntax", () => {
  assert.deepEqual(rangeHits("dist"), []);
});
