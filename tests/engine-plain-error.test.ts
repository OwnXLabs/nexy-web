// An engine's own failure never reaches the screen as a status code or its raw words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engineFailure } from "../src/lib/engine/plain-error.ts";

test("a missing engine route is said plainly, with no code", () => {
  const { error } = engineFailure(new Error("agent gateway 404: not found"), "routines");
  assert.doesNotMatch(error, /\d{3}|gateway|not found/i);
  assert.match(error, /can't do that yet/);
});

test("any other engine failure is said plainly", () => {
  const { error } = engineFailure(new Error("agent gateway 502: upstream timed out"), "memory");
  assert.doesNotMatch(error, /\d{3}|gateway|upstream/i);
});
