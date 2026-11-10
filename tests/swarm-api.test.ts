// The swarm endpoint's run store: progress replays after a dropped connection; other people can't read it.
// node --experimental-strip-types --test tests/swarm-api.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { start, sse, page, busy, boxDeps } from "../src/lib/swarm-runs.ts";
import type { Deps } from "../src/lib/swarm.ts";

const plan = { title: "Shop", style: {}, sections: [{ id: "hero", title: "Hero", brief: "hi" }], images: [] };
const deps: Deps = {
  async chat(b: any) { return b.messages[0].content.includes("You plan") ? { text: JSON.stringify(plan), ranOn: "box" } : { text: `<section id="hero">hi</section>`, ranOn: "device:0xaaa" }; },
  async image() { throw new Error("none"); },
  async workers() { return []; },
};
const read = async (r: Response) => (await r.text()).split("\n\n").filter(l => l.startsWith("data:")).map(l => JSON.parse(l.slice(5)));

test("progress replays in full, the page is only for its owner, one build at a time", async () => {
  const id = start("o_a", "a shop", deps);
  assert.ok(busy("o_a"));
  const live = await read(sse(id, "o_a")!);
  assert.equal(live.at(-1).type, "done");
  assert.equal(live.at(-1).html, "", "the page isn't sent inside the progress stream");
  const again = await read(sse(id, "o_a")!);
  assert.deepEqual(again.map(e => e.type), live.map(e => e.type), "a reconnect gets the same events");
  assert.equal(sse(id, "o_b"), null);
  assert.equal(page(id, "o_b"), undefined);
  assert.match(page(id, "o_a")!, /<section id="hero"/);
  assert.ok(!busy("o_a"));
});

test("no job route on the box: the endpoint stays off", () => {
  assert.equal(boxDeps({}), null);
  assert.ok(boxDeps({ NEXY_INFER_URL: "http://127.0.0.1:9/infer" }));
});
