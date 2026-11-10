// The chat's swarm view: where each piece ran, in plain words, and nothing from the server unescaped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { where, row } from "../src/client/swarm-view.ts";

test("where a piece ran reads like a place", () => {
  assert.equal(where("box"), "your Own 1");
  assert.equal(where(undefined), "your Own 1");
  assert.equal(where("device:Nexy on AGENTWARE (Windows)"), "AGENTWARE (Windows)");
  assert.equal(where("device:0x1111111111111111111111111111111111111111"), "device 0x1111…");
  assert.equal(where("device:0xabc", { "0xabc": "Gaming PC" }), "Gaming PC");
});

test("rows escape whatever the server sends", () => {
  const h = row({ id: "x", kind: "chat", label: "<img src=x onerror=alert(1)>", on: "device:<b>", state: "done", ms: 4200 });
  assert.doesNotMatch(h, /<img|<b>/);
  assert.match(h, /done · 4 s/);
});
