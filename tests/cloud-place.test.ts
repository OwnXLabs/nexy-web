// Nexy Cloud wording: what the page says it can't do there, and who Nexy says it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientModule } from "./client-module.ts";

(globalThis as any).document = { documentElement: { dataset: { place: "cloud", apps: "" } } };
const place = await clientModule("src/client/place.ts");
process.env.NEXY_PLACE = "cloud";
const { IDENTITY, guardIdentity } = await import("../src/lib/engine/identity-guard.ts");

test("in Nexy Cloud the page names Nexy Cloud, never this computer or Nexy Home", () => {
  assert.equal(place.onOwn1, false);
  assert.equal(place.here, "Nexy Cloud");
  for (const s of [place.notHereYet("Making music"), place.imagesOff()]) {
    assert.match(s, /Nexy Cloud/);
    assert.doesNotMatch(s, /this computer|Nexy Home|Mac|PC/);
    assert.match(s, /It works today on an Own1\.$/);
  }
});

test("Nexy says it is Nexy Cloud's", () => {
  assert.equal(IDENTITY, "I'm Nexy, the agent that works across everything in Nexy Cloud.");
  const g = guardIdentity("I am running on Qwen3 under the hood.");
  assert.equal(g.reply, IDENTITY);
});
