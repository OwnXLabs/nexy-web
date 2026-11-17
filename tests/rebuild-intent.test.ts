// "build again" right after a build reruns that build's brief, told what went wrong; never a
// new build of the word "again".
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientModule } from "./client-module.ts";

const { retryOf, classify } = await clientModule("src/client/intent.ts");
const BRIEF = "Build a simple landing website for a game developer";
const ERROR = "Uncaught TypeError: Cannot read properties of undefined (reading 'length') (line 42:7)";
const failed = { brief: BRIEF, deliverable: "web_app", id: "build:r1", outcome: "failed", error: ERROR };
const RETRIES = ["again", "build again", "Build again.", "try again", "rebuild", "build it again", "do it again", "retry", "fix it", "that didn't work, try again", "That didn’t work. Try again please"];

test("a retry after a failed build reruns its brief and kind with the error", () => {
  for (const t of RETRIES) {
    const r = retryOf(t, failed);
    assert.equal(r?.kind, "rebuild", t);
    assert.equal(r.brief, BRIEF, t);
    assert.equal(r.deliverable, "web_app", t);
    assert.match(r.fix, /previous build failed its run check with: Uncaught TypeError: Cannot read properties of undefined \(reading 'length'\) \(line 42:7\)\. Fix that\./, t);
  }
  assert.equal(retryOf("build again", { ...failed, deliverable: "diagram" }).deliverable, "diagram");
});

test("Own Build's code excerpt goes back to the builder whole", () => {
  const error = "Uncaught TypeError: Cannot read properties of undefined (reading 'length') (line 214: `const n = obstacles.length;`)";
  const r = retryOf("build again", { ...failed, error });
  assert.equal(r.error, error);
  assert.equal(r.fix, `The previous build failed its run check with: ${error}. Fix that.`);
});

test("a retry after a build that worked reruns it without a fix; fix it is left to the page", () => {
  const ok = { brief: BRIEF, deliverable: "web_app", outcome: "done" };
  assert.deepEqual(retryOf("build it again", ok), { kind: "rebuild", brief: BRIEF, deliverable: "web_app", error: "", fix: "" });
  assert.equal(retryOf("fix it", ok), null);
});

test("with no build in the chat: no rebuild, and build again asks what to build", () => {
  for (const t of RETRIES) assert.notEqual(retryOf(t, null)?.kind, "rebuild", t);
  assert.equal(retryOf("build again", null).kind, "unavailable");
  assert.match(retryOf("build again", null).say, /What should I build\?/);
  assert.equal(retryOf("try again", null), null);
});

test("only right after the build, unless it says build", () => {
  const later = { ...failed, next: true };
  assert.equal(retryOf("try again", later), null);
  assert.equal(retryOf("again", later), null);
  assert.equal(retryOf("build it again", later).brief, BRIEF);
});

test("other asks are not retries", () => {
  for (const t of ["make a website for my bakery", "again and again, why?", "fix the header colour", "build a game again for kids", "try again tomorrow at 9"])
    assert.equal(retryOf(t, failed), null, t);
  assert.equal(classify("make a website for my bakery").kind, "make");
});
