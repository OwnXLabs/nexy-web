import { test } from "node:test";
import assert from "node:assert/strict";
import { rfbClass } from "../src/client/rfb-class.ts";

class R {}

test("the screen viewer's class is found whatever shape the bundler gives", () => {
  assert.equal(rfbClass(R), R);
  assert.equal(rfbClass({ default: R }), R); // Astro 7: the CommonJS exports object
  assert.equal(rfbClass({ default: { default: R } }), R);
  assert.throws(() => rfbClass({}), /did not load/);
});
