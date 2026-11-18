// A guest code (NEXY_OWN1_GUEST=1): who Nexy says it is names whose Own 1 it is, and a busy shared
// Own 1 is said as busy, apart from one that is offline.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXY_OWN1_GUEST = "1";
process.env.NEXY_OWN1_GUEST_ON = "John's Own 1";
const { IDENTITY } = await import("../src/lib/engine/identity-guard.ts");
const { guestFault, guestOn, SHARED_BUSY, SHARED_OFFLINE } = await import("../src/lib/guest.ts");

test("who Nexy says it is on a guest code: whose Own 1, never \"your Own1\"", () => {
  assert.match(IDENTITY, /as a guest on John's Own 1\.$/);
  assert.doesNotMatch(IDENTITY, /your Own ?1/);
});

test("whose Own 1: the app's name, or the shared Own 1 when it gives none or an unusable one", () => {
  assert.equal(guestOn(), "John's Own 1");
  for (const bad of ["", "   ", "x".repeat(61)]) {
    process.env.NEXY_OWN1_GUEST_ON = bad;
    assert.equal(guestOn(), "the shared Own 1", JSON.stringify(bad));
  }
  process.env.NEXY_OWN1_GUEST_ON = "Sam‮'s Own 1";
  assert.equal(guestOn(), "Sam's Own 1", "no direction-changing characters");
  process.env.NEXY_OWN1_GUEST_ON = "John's Own 1";
});

test("busy is busy, before any 503 is taken for offline", () => {
  for (const m of [
    "llama-swap 503: The shared Own 1 is busy with its owner's work. Try again shortly.",
    'agent gateway upstream failed: model server 503: {"error":{"message":"The shared Own 1 is busy with its owner\'s work. Tr',
  ]) assert.deepEqual(guestFault(new Error(m)), { reply: SHARED_BUSY, result: "guest-busy" }, m);
  assert.deepEqual(guestFault(new Error("llama-swap 503: {}")), { reply: SHARED_OFFLINE, result: "guest-offline" });
  assert.deepEqual(guestFault(new Error("your Own1 answered 503")), { reply: SHARED_OFFLINE, result: "guest-offline" });
  assert.match(SHARED_BUSY, /try again shortly\.$/i);
});

test("a device paired for AI only (NEXY_OWN1_GUEST_ON without NEXY_OWN1_GUEST): who Nexy says it is names that Own 1", async () => {
  delete process.env.NEXY_OWN1_GUEST;
  process.env.NEXY_OWN1_GUEST_ON = "Buri's Own 1";
  const { IDENTITY: id } = await import(`../src/lib/engine/identity-guard.ts?ai-only`);
  const { sharedHere } = await import("../src/lib/guest.ts");
  assert.equal(id, "I'm Nexy, the agent on this computer, using the AI on Buri's Own 1.");
  assert.ok(sharedHere());
  delete process.env.NEXY_OWN1_GUEST_ON;
  assert.ok(!sharedHere());
});
