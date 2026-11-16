// Which kind of job a request is, and what a model's verdicts let through (src/client/capability.ts).
// node --experimental-strip-types --test tests/capability.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientModule } from "./client-module.ts";

const { taskOf, verdictFor, readCaps, blockLine } = await clientModule("src/client/capability.ts");
const { classify } = await clientModule("src/client/intent.ts");
const task = (t: string, revises = false) => taskOf(classify(t), t, revises);

test("requests by kind of job", () => {
  assert.equal(task("Build me a website for fishing in Lithuanian lakes"), "build_site");
  assert.equal(task("Build a landing page for my bakery"), "build_site");
  assert.equal(task("make me a flappy bird game"), "build_game");
  assert.equal(task("build a website for a ping pong ball business"), "build_site");
  assert.equal(task("draw a flowchart of our hiring process"), "diagram");
  assert.equal(task("make the background darker", true), "edit_page");
  assert.equal(task("Give me a news brief every morning"), "routine");
  assert.equal(task("Research my top 5 competitors"), "research");
  assert.equal(task("summarise this article for me"), "summarise");
  assert.equal(task("what fish live in Lithuanian lakes?"), "chat");
  assert.equal(task("write an email to my landlord"), "chat");
});

test("verdicts: none from the app lets everything through; what the app says is kept", () => {
  assert.equal(verdictFor(null, "build_site"), "allow");
  const c = readCaps(JSON.stringify({ model: "koiiLlama:latest", tier: "cpu", tested: false, class: "chat-only", tasks: { chat: "allow", build_site: "block" } }));
  assert.equal(verdictFor(c, "build_site"), "block");
  assert.equal(verdictFor(c, "chat"), "allow");
  assert.equal(readCaps("not json"), null);
  assert.equal(readCaps(""), null);
  assert.equal(blockLine("build_game"), "Building websites and games needs a bigger AI than this computer can run.");
});
