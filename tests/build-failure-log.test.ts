// A failed build leaves one line in Nexy's turn log, which outlives the build's files on the box:
// id, kind, builder, the brief's length, duration, the error and where it happened. No brief text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/pages/api/v1/build-log.ts";
import { whereIn } from "../src/lib/turn-log.ts";

async function logged(body: unknown): Promise<{ status: number; lines: any[] }> {
  const lines: any[] = [], log = console.log;
  console.log = (s: string) => { lines.push(JSON.parse(s)); };
  try {
    const r = await POST({ request: new Request("http://x/api/v1/build-log", { method: "POST", body: JSON.stringify(body) }) } as any);
    return { status: r.status, lines };
  } finally { console.log = log; }
}

test("a failed run check is one build-failed line, without the brief", async () => {
  const brief = "Build a simple landing website for a game developer called Pixel Forge";
  const { status, lines } = await logged({ build: "build:r1", kind: "web_app", builder: "own-build", briefChars: brief.length, ms: 41234,
    error: "Uncaught TypeError: Cannot read properties of undefined (reading 'length') (line 19:24)", brief, prompt: brief });
  assert.equal(status, 200);
  assert.equal(lines.length, 1);
  const [l] = lines;
  assert.equal(l.endpoint, "build");
  assert.equal(l.result, "build-failed");
  assert.match(l.turn, /^[0-9a-f-]{8}$/);
  assert.equal(l.build, "build:r1");
  assert.equal(l.kind, "web_app");
  assert.equal(l.builder, "own-build");
  assert.equal(l.briefChars, brief.length);
  assert.equal(l.ms, 41234);
  assert.match(l.error, /reading 'length'/);
  assert.equal(l.where, "line 19:24");
  assert.doesNotMatch(JSON.stringify(l), /Pixel Forge|game developer/);
});

test("odd fields are cut down, a bad id or no error is refused and not logged", async () => {
  const { lines } = await logged({ build: "build:local-1", kind: "<b>", builder: "x", briefChars: "lots", ms: -5, error: "x".repeat(900) });
  assert.equal(lines[0].kind, "web_app");
  assert.equal(lines[0].builder, "own-build");
  assert.equal(lines[0].briefChars, 0);
  assert.equal(lines[0].ms, 0);
  assert.equal(lines[0].error.length, 300);
  for (const body of [{ build: "a b\nc", error: "boom" }, { build: "build:r1" }, null]) {
    const r = await logged(body);
    assert.equal(r.status, 400);
    assert.equal(r.lines.length, 0);
  }
});

test("Own Build's code excerpt: the line number logged, never the code", async () => {
  const { lines } = await logged({ build: "build:b7", kind: "game", builder: "own-build", briefChars: 40, ms: 9000,
    error: "Uncaught TypeError: Cannot read properties of undefined (reading 'length') (line 214: `const n = obstacles.length;`)" });
  assert.equal(lines[0].where, "line 214");
  assert.equal(lines[0].error, "Uncaught TypeError: Cannot read properties of undefined (reading 'length') (line 214)");
  assert.doesNotMatch(JSON.stringify(lines[0]), /obstacles|const n/);
});

test("where the builder says it failed", () => {
  assert.equal(whereIn("boom (line 7)"), "line 7");
  assert.equal(whereIn("ReferenceError: x is not defined at app.js:12:5"), "app.js:12:5");
  assert.equal(whereIn("it shows nothing when it runs"), undefined);
});
