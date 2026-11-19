// Nexy Cloud's model network, per signed-in person: John's Own 1 is on by default and can be switched
// off (then the local model alone), paid boost is off for everyone unless set, and the first turn
// that may go to the Own 1 carries a one-time notice. Only where NEXY_NETWORK_MODEL is set and the
// shared engine answers the person. The engine is asked for exactly that model; where it says the
// reply ran (boost, own1) reaches the reply.
// node --experimental-strip-types --test tests/model-network.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexy-network-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const entry = path.join(dir, "entry.ts");
const src = path.join(import.meta.dirname, "..", "src/lib");
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(src, "own1.ts"))};\nexport { gatewayEngine } from ${JSON.stringify(path.join(src, "engine/hermes.ts"))};\n`);

let n = 0;
async function load(env: Record<string, string>): Promise<any> {
  const keep = { ...process.env };
  for (const k of Object.keys(process.env)) if (/^NEXY_(ENGINES|ENGINE_|NETWORK|AGENT_|PLACE|STUDIOS)/.test(k)) delete process.env[k];
  Object.assign(process.env, { NEXY_DATA_DIR: path.join(dir, String(n++)), ...env });
  try {
    const r = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
    return await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}#${n}`);
  } finally { process.env = keep; }
}
const CLOUD = { NEXY_ENGINES: "nexy-engine", NEXY_ENGINE_NEXY_ENGINE_URL: "http://127.0.0.1:9", NEXY_ENGINE_NEXY_ENGINE_USER_URLS: "u01=http://127.0.0.1:9", NEXY_ENGINE_NEXY_ENGINE_USER_KEYS: "u01:k" };

test("Own 1 on by default, off on request; paid boost off unless set; offered only with the base model, signed in, on the shared engine", async () => {
  const none = await load(CLOUD);
  assert.equal(none.networkModel("t01"), undefined, "nothing without NEXY_NETWORK_MODEL");
  const m = await load({ ...CLOUD, NEXY_NETWORK_MODEL: "qwen3-1.7b" });
  assert.equal(m.networkModel(null), undefined, "nothing without a signed-in person");
  assert.equal(m.networkModel("u01"), undefined, "nothing on a person's own engine yet");
  assert.equal(m.own1On("t01"), true, "on by default");
  assert.equal(m.networkModel("t01"), "qwen3-1.7b+own1", "Own 1 first, never boost without payment");
  m.setOwn1("t01", false);
  assert.equal(m.networkModel("t01"), undefined, "switched off: the engine's own model, the local one");
  assert.equal(m.networkModel("t02"), "qwen3-1.7b+own1", "one person's switch is theirs alone");
  const file = path.join(dir, String(n - 1), "network.json");
  assert.equal(fs.statSync(file).mode & 0o077, 0, "the settings file is the server's alone");
  m.setOwn1("t01", true);
  assert.equal(m.networkModel("t01"), "qwen3-1.7b+own1");
  // paid boost is set on the server only (no payment yet)
  fs.writeFileSync(file, JSON.stringify({ p1: { boost: true }, p2: { boost: true, own1: false } }));
  const paid = await load({ ...CLOUD, NEXY_NETWORK_MODEL: "qwen3-1.7b", NEXY_DATA_DIR: path.dirname(file) });
  assert.equal(paid.networkModel("p1"), "qwen3-1.7b+boost+own1");
  assert.equal(paid.networkModel("p2"), "qwen3-1.7b+boost");
  assert.equal(paid.networkModel("t09"), "qwen3-1.7b+own1");
});

test("the notice comes once per person, and never with Own 1 off", async () => {
  const m = await load({ ...CLOUD, NEXY_NETWORK_MODEL: "qwen3-1.7b" });
  assert.equal(m.firstOwn1Use("t01"), true);
  assert.equal(m.firstOwn1Use("t01"), false, "once");
  m.setOwn1("t02", false);
  assert.equal(m.firstOwn1Use("t02"), false);
  assert.equal(m.firstOwn1Use("u01"), false, "not where it is not offered");
  assert.match(m.OWN1_NOTICE, /^Your messages are answered on a computer in John's home: best effort for performance, no privacy guarantees\.$/);
});

test("the engine is asked for the turn's model only when there is one; where it ran comes back", async () => {
  const got: any[] = [];
  let on: unknown = "own1";
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
      got.push(JSON.parse(b));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello" }, finish_reason: "stop" }], nexy: { tools: [], answered_on: on } }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  after(() => srv.close());
  const m = await load(CLOUD);
  const e = m.gatewayEngine(`http://127.0.0.1:${(srv.address() as any).port}`, "k", "nexy-engine");
  let r = await e.chat("hi", [], "sys", undefined, "s1", undefined, { user: "t01", model: "qwen3-1.7b+own1" });
  assert.equal(got[0].upstream_model, "qwen3-1.7b+own1");
  assert.equal(r.answeredOn, "own1");
  on = "boost";
  r = await e.chat("hi", [], "sys", undefined, "s1", undefined, { user: "t02" });
  assert.equal("upstream_model" in got[1], false, "Own 1 switched off: no model asked for");
  assert.equal(r.answeredOn, "boost");
  on = "local";
  r = await e.chat("hi", [], "sys", undefined, "s1");
  assert.equal(r.answeredOn, undefined, "the local model is not mentioned");
});
