// Nexy Cloud is "Coming soon": what Nexy on a computer says it cannot do here never sends the
// person to it. 0.2.8 offered it for making images.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientModule } from "./client-module.ts";

(globalThis as any).document = { documentElement: { dataset: { place: "computer", apps: "" } } };
const { imagesOff, notHereYet } = await clientModule("src/client/place.ts");

test("images off and studios not here yet name no Nexy Cloud", () => {
  assert.match(imagesOff(), /Make images on this (Mac|PC)/);
  assert.match(imagesOff(), /but an Own1 can\.$/);
  assert.doesNotMatch(imagesOff(), /Cloud/);
  assert.equal(notHereYet("Making music"), "Making music isn't in Nexy on this computer yet; it's coming in an update. It works today on an Own1.");
});
