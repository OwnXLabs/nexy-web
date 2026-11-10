// Swarm build with the Own1 and devices replaced by doubles: plan, parallel pieces, stitch.
// node --experimental-strip-types --test tests/swarm.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, parsePlan, clean, lanes, type Deps, type Event } from "../src/lib/swarm.ts";

const plan = {
  title: "Ice cream shop", style: { bg: "#111111", fg: "#ffffff", accent: "#ff9a7a", font: "Georgia, serif" },
  sections: [{ id: "hero", title: "Hero", brief: "big welcome" }, { id: "menu", title: "Menu", brief: "flavours" }, { id: "visit", title: "Visit us", brief: "address" }],
  images: [{ id: "strawberry", prompt: "strawberry ice cream, photo", section: "menu" }, { id: "mint", prompt: "mint chip, photo", section: "menu" }],
};
const A = "0x" + "a".repeat(40), B = "0x" + "b".repeat(40), C = "0x" + "c".repeat(40);
const workers = [
  { address: A, name: "MacBook", caps: ["chat:qwen3:8b"], online: true },
  { address: B, name: "Gaming PC", caps: ["chat:qwen3:8b", "image:sd"], online: true },
  { address: C, name: "Off", caps: ["image:sd"], online: false },
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
    async sleep() {},
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
  const used = new Set(pieces.map(c => c.route));
  assert.ok(used.has(`device:${A}`) && used.has(`device:${B}`) && used.has("box"), [...used].join(","));
  // one piece at a time per device, but the devices work at the same time
  for (const r of used) {
    const mine = pieces.filter(c => c.route === r).sort((x, y) => x.at - y.at);
    for (let i = 1; i < mine.length; i++) assert.ok(mine[i].at >= mine[i - 1].end!, `${r} ran two at once`);
  }
  const firstEnd = Math.min(...pieces.map(c => c.end!));
  assert.ok(pieces.filter(c => c.at < firstEnd).length >= 3, "three devices start before any finishes");
  assert.ok(!pieces.some(c => c.route.includes(C)), "offline devices get nothing");
  assert.ok(!pieces.some(c => c.kind === "image" && c.route === `device:${A}`), "only image-capable devices get images");
  assert.ok(pieces.filter(c => c.kind === "image").every(c => c.route === `device:${B}`), "the graphics card takes the images");
  for (const id of ["hero", "menu", "visit"]) assert.match(html, new RegExp(`<section id="${id}"`));
  assert.equal((html.match(/data:image\/webp;base64,AAAA/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<script|onclick|javascript:/i);
  assert.equal(events.at(-1)!.type, "done");
  assert.ok(events.some(e => e.type === "task" && e.task.state === "done" && e.task.on === `device:${B}`));
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

test("no devices: everything runs on the Own1, one piece at a time, and busy is retried", async () => {
  assert.deepEqual(lanes([]).map(l => l.route), ["box"]);
  let busyLeft = 2, inFlight = 0, most = 0;
  const { deps } = doubles({
    async workers() { return []; },
    async chat(body: any, route) {
      if (body.messages[0].content.includes("You plan")) return { text: JSON.stringify(plan), ranOn: "box" };
      if (busyLeft-- > 0) throw new Error("busy");
      inFlight++; most = Math.max(most, inFlight); await new Promise(r => setTimeout(r, 20)); inFlight--;
      const id = body.messages[0].content.match(/<section id="([a-z-]+)">/)![1];
      return { text: `<section id="${id}">x</section>`, ranOn: route };
    },
  });
  const html = await run("site", deps, () => {});
  assert.equal(most, 1, "the Own1 is never asked for two at once");
  for (const id of ["hero", "menu", "visit"]) assert.match(html, new RegExp(`<section id="${id}"`));
});

test("a piece that keeps failing is reported, the rest of the page still ships", async () => {
  const { deps } = doubles({ async workers() { return []; }, async image() { throw new Error("busy"); } });
  const events: Event[] = [];
  const html = await run("site", deps, e => events.push(e));
  assert.match(html, /<section id="menu"/);
  const failed = events.filter(e => e.type === "task" && e.task.state === "failed");
  assert.ok(failed.length >= 1);
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

test("images: placed once with their own data, a forgotten one is added, broken ones are dropped", async () => {
  const { stitch } = await import("../src/lib/swarm.ts");
  const p = { ...plan, images: [...plan.images, { id: "shop", prompt: "shop front", section: "visit" }] } as any;
  const img = { b64: "QUJD", mime: "image/png" };
  const html = stitch(p, new Map([
    ["hero", `<section id="hero"><img src="placeholder.jpg" alt="x"></section>`],
    ["menu", `<section id="menu"><img data-img="strawberry" src="#" alt="a"><img data-img="strawberry" alt="b"><img data-img="mint"></section>`],
    ["visit", `<section id="visit"><p>come by</p></section>`],
  ]), new Map([["strawberry", img], ["mint", img], ["shop", img]]));
  assert.equal((html.match(/data:image\/png;base64,QUJD/g) ?? []).length, 3, "three images, each once");
  assert.doesNotMatch(html, /placeholder\.jpg|src="#"/);
  assert.match(html, /<section id="visit"><p>come by<\/p><img alt="" src="data:image\/png/);
});
