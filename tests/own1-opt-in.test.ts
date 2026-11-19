// "Use John's Own 1 when it's free" (Nexy Cloud): offered only with NEXY_OWN1_MODEL, to a signed-in
// person on the shared engine; off by default and kept per person. Only a person who switched it on
// has the engine asked for that model; where the engine says it ran (boost, own1) reaches the reply.
// node --experimental-strip-types --test tests/own1-opt-in.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexy-own1-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const entry = path.join(dir, "entry.ts");
const src = path.join(import.meta.dirname, "..", "src/lib");
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(src, "own1.ts"))};\nexport { gatewayEngine } from ${JSON.stringify(path.join(src, "engine/hermes.ts"))};\n`);

let n = 0;
async function load(env: Record<string, string>): Promise<any> {
  const keep = { ...process.env };
  for (const k of Object.keys(process.env)) if (/^NEXY_(ENGINES|ENGINE_|OWN1|AGENT_|PLACE|STUDIOS)/.test(k)) delete process.env[k];
  Object.assign(process.env, { NEXY_DATA_DIR: path.join(dir, String(n++)), ...env });
  try {
    const r = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
    return await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}#${n}`);
  } finally { process.env = keep; }
}
const CLOUD = { NEXY_ENGINES: "nexy-engine", NEXY_ENGINE_NEXY_ENGINE_URL: "http://127.0.0.1:9", NEXY_ENGINE_NEXY_ENGINE_USER_URLS: "u01=http://127.0.0.1:9", NEXY_ENGINE_NEXY_ENGINE_USER_KEYS: "u01:k" };

test("offered only with the model set, to a signed-in person on the shared engine; off by default, kept per person", async () => {
  const none = await load(CLOUD);
  assert.equal(none.own1Offered("t01"), false, "not without NEXY_OWN1_MODEL");
  const m = await load({ ...CLOUD, NEXY_OWN1_MODEL: "qwen3-1.7b+own1" });
  assert.equal(m.own1Offered(null), false, "not without a signed-in person");
  assert.equal(m.own1Offered("u01"), false, "not on a person's own engine yet");
  assert.equal(m.own1Offered("t01"), true);
  assert.equal(m.own1On("t01"), false, "off by default");
  m.setOwn1("t01", true);
  assert.equal(m.own1On("t01"), true);
  assert.equal(m.own1On("t02"), false, "one person's switch is theirs alone");
  const file = path.join(dir, String(n - 1), "own1.json");
  assert.equal(fs.statSync(file).mode & 0o077, 0, "the settings file is the server's alone");
  m.setOwn1("t01", false);
  assert.equal(m.own1On("t01"), false);
});

test("only an opted-in turn asks the engine for the Own1 model; where it ran comes back", async () => {
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
  const url = `http://127.0.0.1:${(srv.address() as any).port}`;
  const m = await load({ ...CLOUD, NEXY_OWN1_MODEL: "qwen3-1.7b+own1" });
  const e = m.gatewayEngine(url, "k", "nexy-engine");
  let r = await e.chat("hi", [], "sys", undefined, "s1", undefined, { user: "t01", own1: true });
  assert.equal(got[0].upstream_model, "qwen3-1.7b+own1");
  assert.equal(r.answeredOn, "own1");
  on = "boost";
  r = await e.chat("hi", [], "sys", undefined, "s1", undefined, { user: "t02" });
  assert.equal("upstream_model" in got[1], false, "a person who did not switch it on never asks for it");
  assert.equal(r.answeredOn, "boost");
  on = "local";
  r = await e.chat("hi", [], "sys", undefined, "s1");
  assert.equal(r.answeredOn, undefined, "the local model is not mentioned");
  const off = await load(CLOUD);
  await off.gatewayEngine(url, "k", "nexy-engine").chat("hi", [], "sys", undefined, "s1", undefined, { own1: true });
  assert.equal("upstream_model" in got[3], false, "nothing asked where no Own1 model is set");
});
