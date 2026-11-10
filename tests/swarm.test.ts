// Swarm build with the Own1 and devices replaced by doubles: plan, parallel pieces, stitch.
// node --experimental-strip-types --test tests/swarm.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, parsePlan, clean, routes, type Deps, type Event } from "../src/lib/swarm.ts";

const plan = {
  title: "Ice cream shop", style: { bg: "#111111", fg: "#ffffff", accent: "#ff9a7a", font: "Georgia, serif" },
  sections: [{ id: "hero", title: "Hero", brief: "big welcome" }, { id: "menu", title: "Menu", brief: "flavours" }, { id: "visit", title: "Visit us", brief: "address" }],
  images: [{ id: "strawberry", prompt: "strawberry ice cream, photo", section: "menu" }, { id: "mint", prompt: "mint chip, photo", section: "menu" }],
};
const workers = [
  { address: "0xaaa", name: "MacBook", caps: ["chat:qwen3:8b"], online: true },
  { address: "0xbbb", name: "Gaming PC", caps: ["chat:qwen3:8b", "image:sd"], online: true },
  { address: "0xccc", name: "Off", caps: ["image:sd"], online: false },
];

function doubles(over: Partial<Deps> = {}) {
  const calls: { kind: string; route: string; at: number; end?: number }[] = [];
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  const deps: Deps = {
    async chat(body: any, route) {
      const c = { kind: "chat", route, at: Date.now() } as any; calls.push(c);
      const sys = body.messages[0].content as string;
      if (sys.includes("You plan")) { c.end = Date.now(); return { text: "Sure:\n" + JSON.stringify(plan), ranOn: "box" }; }
      await wait(60);
      const id = sys.match(/<section id="([a-z-]+)">/)![1];
      const imgs = [...sys.matchAll(/data-img="([a-z-]+)"/g)].map(m => m[1]);
      c.end = Date.now();
      return { text: `<section id="${id}" onclick="x()"><h2>${id}</h2>${imgs.map(i => `<img data-img="${i}" alt="">`).join("")}<script>bad()</script><a href="javascript:evil()">x</a></section>`, ranOn: route };
    },
    async image(_b, route) {
      const c = { kind: "image", route, at: Date.now() } as any; calls.push(c);
      await wait(60); c.end = Date.now();
      return { b64: "AAAA", mime: "image/webp", ranOn: route };
    },
    async workers() { return workers; },
    ...over,
  };
  return { deps, calls };
}

test("plan → pieces in parallel on several devices → one stitched page", async () => {
  const { deps, calls } = doubles();
  const events: Event[] = [];
  const html = await run("an ice cream shop site", deps, e => events.push(e));
  const pieces = calls.slice(1);
  assert.equal(pieces.length, 5, "3 sections + 2 images");
  // all pieces start before the first one finishes: parallel, not one after another
  assert.ok(Math.max(...pieces.map(c => c.at)) < Math.min(...pieces.map(c => c.end!)));
  const used = new Set(pieces.map(c => c.route));
  assert.ok(used.has("device:0xaaa") && used.has("device:0xbbb") && used.has("box"), [...used].join(","));
  assert.ok(!pieces.some(c => c.route.includes("0xccc")), "offline devices get nothing");
  assert.ok(!pieces.some(c => c.kind === "image" && c.route === "device:0xaaa"), "only image-capable devices get images");
  for (const id of ["hero", "menu", "visit"]) assert.match(html, new RegExp(`<section id="${id}"`));
  assert.equal((html.match(/data:image\/webp;base64,AAAA/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<script|onclick|javascript:/i);
  assert.equal(events.at(-1)!.type, "done");
  assert.ok(events.some(e => e.type === "task" && e.task.state === "done" && e.task.on === "device:0xbbb"));
});

test("a failed piece doesn't sink the site; a failed plan does", async () => {
  const { deps } = doubles({ async image() { throw new Error("device left"); } });
  const events: Event[] = [];
  const html = await run("site", deps, e => events.push(e));
  assert.match(html, /<section id="menu"/);
  assert.ok(events.some(e => e.type === "task" && e.task.state === "failed" && e.task.error === "device left"));
  const bad = doubles({ async chat() { return { text: "no json here", ranOn: "box" }; } });
  const ev2: Event[] = [];
  await assert.rejects(run("site", bad.deps, e => ev2.push(e)));
  assert.equal(ev2.at(-1)!.type, "failed");
});

test("no devices: everything runs on the Own1", () => {
  assert.deepEqual(routes("image", 3, []), ["box", "box", "box"]);
});

test("plans and pieces from the model are bounded and cleaned", () => {
  const p = parsePlan(JSON.stringify({ title: "x", style: { bg: "red;}", font: "a;b{c}" }, sections: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, title: "t", brief: "b" })).concat([{ id: "BAD ID", title: "t", brief: "b" }]), images: [{ id: "i", prompt: "p", section: "nope" }] }));
  assert.equal(p.sections.length, 6);
  assert.equal(p.images.length, 0, "images must point at a real section");
  assert.equal(p.style.bg, "#0f0f14");
  assert.doesNotMatch(p.style.font, /[;{}]/);
  assert.doesNotMatch(clean(`<section id="a"><iframe src="https://x"></iframe><img src="https://tracker/x.png"><div style="background:url(https://x)">`, "a"), /iframe|https:/);
});

test("plans wrapped in thinking, fences or prose still parse", async () => {
  const { jsonIn } = await import("../src/lib/swarm.ts");
  const body = JSON.stringify(plan);
  for (const reply of [
    `<think>Let me plan {this} carefully…</think>\n${body}`,
    "Here is the plan:\n```json\n" + body + "\n```\nHope it helps!",
    `<think>still thinking about {braces} and "quotes"`, // cut off inside thinking: nothing usable
  ].slice(0, 2)) assert.equal(jsonIn(reply).title, "Ice cream shop");
  assert.throws(() => jsonIn(`<think>never finished {`));
  assert.equal(jsonIn(`{"a":"has } brace", "b": 1}`).b, 1);
});

test("a cut-off plan is asked for again once", async () => {
  let n = 0;
  const { deps } = doubles({
    async chat(body: any, route) {
      if (body.messages[0].content.includes("You plan")) return { text: ++n === 1 ? '{"title":"Ice cr' : JSON.stringify(plan), ranOn: "box" };
      const id = body.messages[0].content.match(/<section id="([a-z-]+)">/)![1];
      return { text: `<section id="${id}">x</section>`, ranOn: route };
    },
  });
  const events: Event[] = [];
  const html = await run("site", deps, e => events.push(e));
  assert.equal(n, 2);
  assert.match(html, /<section id="hero"/);
  assert.ok(events.some(e => e.type === "task" && e.task.id === "plan-2" && e.task.state === "done"));
});
