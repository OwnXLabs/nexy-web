// The name of the document an answer goes into: what it is about, cut on a word, without the
// words of the request (QA 2026-11-12: "write a detailed 1500 word g").
// node --experimental-strip-types --test tests/doc-title.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { slugOf } from "../src/client/doc-title.ts";

test("a document title is cut on a word and drops the request's own words", () => {
  const cases: [string, string, number?][] = [
    ["write a detailed 1500 word guide to a household budget for a family of four", "guide-to-a-household-budget"],
    ["Can you please write me a short, simple guide to starting a bakery", "guide-to-starting-a-bakery"],
    ["write a 2,000-word essay on the history of Rome", "essay-on-the-history-of-rome"],
    ["Explain photosynthesis", "explain-photosynthesis"],
    ["a business plan for a cafe", "business-plan-for-a-cafe"],
    // the shorter name a continued answer gets, never ending on "to" or "a"
    ["write a detailed 1500 word guide to a household budget", "guide", 18],
    ["a business plan for a cafe", "business-plan", 18],
    // nothing usable, or one word longer than the room
    ["???", "answer"],
    ["Supercalifragilisticexpialidociousness", "supercalifragilisticexpialid"],
  ];
  for (const [q, want, max] of cases) {
    const got = slugOf(q, max);
    assert.equal(got, want, q);
    assert.ok(got.length <= (max ?? 28), `${got} fits`);
  }
});
