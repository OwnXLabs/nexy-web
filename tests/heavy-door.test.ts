// A job this computer's model is held back from (a page edit, a research chart) goes to the app's door
// to a shared Own 1 when it gives one (NEXY_HEAVY_LLM_URL); unset, to NEXY_LLM_URL as before.
// node --experimental-strip-types --test tests/heavy-door.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PAGE = `<!doctype html><html><head><title>Bakery</title></head><body><h1>Bakery</h1><footer><p>Bakery</p></footer></body></html>`;
const DONE = JSON.stringify({ edits: [{ find: "<footer>", replace: "<p>Open 7am to 6pm</p><footer>" }], css: "", say: "Added the hours." });
const seen: string[] = [];
const server = (name: string) => http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => { b += c; });
  req.on("end", () => { seen.push(name); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: DONE } }] })); });
});
const here = server("here"), door = server("door");
const at = (s: http.Server) => `http://127.0.0.1:${(s.address() as any).port}`;

before(async () => {
  await Promise.all([here, door].map((s) => new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()))));
  process.env.NEXY_LLM_URL = at(here);
  process.env.NEXY_HEAVY_LLM_URL = at(door);
});
after(() => { here.close(); door.close(); });

test("a page edit goes through the door, never this computer's model", async () => {
  const { revise } = await import("../src/lib/revise.ts");
  const r = await revise(PAGE, "Add our opening hours, 7am to 6pm.");
  assert.match(r.html, /7am to 6pm/);
  assert.deepEqual(seen, ["door"]);
});

test("research charts and page edits read the door, then NEXY_LLM_URL as before", () => {
  for (const f of ["research.ts", "revise.ts"]) {
    const src = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "lib", f), "utf8");
    assert.match(src, /const LLM = \(process\.env\.NEXY_HEAVY_LLM_URL \|\| \(process\.env\.NEXY_LLM_URL \?\? "http:\/\/127\.0\.0\.1:8080"\)\)/, f);
  }
});
