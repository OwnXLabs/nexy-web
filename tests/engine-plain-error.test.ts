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

test("the engine's own plain explanation is passed on without its code", () => {
  const { error } = engineFailure(new Error("agent gateway 409: this routine is waiting for confirmation: confirm or discard it"), "routines");
  assert.equal(error, "this routine is waiting for confirmation: confirm or discard it");
});

// the app's router refuses in plain words; the engine passes them on inside its own text
import { refusal } from "../src/lib/engine/plain-error.ts";
const OFFLINE = "The shared Own 1 is offline right now. Try again in a few minutes.";
const LIMIT = "You have used today's messages on this shared Own 1. They reset at midnight.";
const DENIED = "This guest code has expired or was revoked. Ask the owner for a new one.";
const routerSaid = (code: number, message: string) => JSON.stringify({ error: { message, type: "router" } });

test("the router's own sentence for 503, 429 and 403 is the words, never its JSON", () => {
  for (const [code, said, result] of [[503, OFFLINE, "model-offline"], [429, LIMIT, "model-limit"], [403, DENIED, "model-denied"]] as const) {
    for (const raw of [`model server ${code}: ${routerSaid(code, said)}`, `llama-swap ${code}: ${routerSaid(code, said)}`,
      `agent gateway upstream failed: model server ${code}: ${routerSaid(code, said)}`]) {
      const r = refusal(new Error(raw));
      assert.deepEqual(r, { code, message: said, result }, raw);
      assert.doesNotMatch(r!.message, /[{}"]|model server|\d{3}/);
    }
    assert.equal(engineFailure(new Error(`agent gateway upstream failed: model server ${code}: ${routerSaid(code, said)}`), "routines").error, said);
  }
});

test("a refusal cut short on the way keeps its sentence only when it arrived whole", () => {
  const whole = `model server 429: ${routerSaid(429, LIMIT)}`;
  assert.equal(refusal(whole.slice(0, whole.indexOf(LIMIT) + LIMIT.length + 1))?.message, LIMIT);
  assert.equal(refusal(whole.slice(0, whole.indexOf(LIMIT) + 10)), null);
});

test("anything else is not a refusal: the usual plain failure stays", () => {
  for (const raw of [
    "model server 500: " + routerSaid(500, "CUDA out of memory"),
    'model server 503: {"error":"the AI is not answering"}',
    "model server 503: " + routerSaid(503, "your Own1 answered 503"),
    "model server 503: <html>Service Unavailable</html>",
    "model server unreachable: connection refused",
    "llama-swap 503: no model loaded",
  ]) assert.equal(refusal(new Error(raw)), null, raw);
  const { error } = engineFailure(new Error("model server 503: " + routerSaid(503, "<b>down</b>")), "memory");
  assert.doesNotMatch(error, /[{}<]|503/);
});
