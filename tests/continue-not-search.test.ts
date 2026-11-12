// "Continue" after a cut answer carries the answer on; it is never taken as a yes to a search the
// answer mentioned (QA 2026-11-12: it waited 200 s, then said a search had run long).
import { test } from "node:test";
import assert from "node:assert/strict";
import { wantsResearch } from "../src/lib/agent-turn.ts";

const guide = [{ role: "assistant", content: "Here is a guide with current prices from online suppliers…" }];

test("Continue is not a search, whatever the last answer said", () => {
  assert.equal(wantsResearch("Continue from where you stopped.", guide), false);
  assert.equal(wantsResearch("continue", guide), false);
});

test("a short yes to an offered search still searches", () => {
  assert.equal(wantsResearch("yes please", [{ role: "assistant", content: "Want me to search the web for current prices?" }]), true);
});
