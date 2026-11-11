// Eval mode (a shared test engine and shared files) only when the server was started for it.
// node --experimental-strip-types --test tests/eval-gate.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

const { wantsEval } = await import("../src/lib/eval.ts");

test("a request alone cannot turn eval mode on", () => {
  delete process.env.NEXY_EVAL;
  assert.equal(wantsEval(true), false);
  process.env.NEXY_EVAL = "0";
  assert.equal(wantsEval(true), false);
});

test("a server started for evals honours the request, and only when asked", () => {
  process.env.NEXY_EVAL = "1";
  assert.equal(wantsEval(true), true);
  assert.equal(wantsEval(false), false);
  delete process.env.NEXY_EVAL;
});
