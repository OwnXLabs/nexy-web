// NEXY_DEFAULT_ENGINE: the engine of anyone who has not picked one, and of paths with no owner
// (selectEngine). A pick still wins; a default that is not here, or none set, keeps the order as
// before; the computer place ignores it. Which engines speak as themselves.
// node --experimental-strip-types --test tests/default-engine.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexy-default-engine-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const HERMES = "http://127.0.0.1:9/hermes", NEXY = "http://127.0.0.1:9/nexy", OC = "http://127.0.0.1:9/oc";
const THREE = { NEXY_AGENT_URL: HERMES, NEXY_ENGINES: "nexy-engine,openclaw", NEXY_ENGINE_NEXY_ENGINE_URL: NEXY, NEXY_ENGINE_OPENCLAW_URL: OC };

// a fresh copy of the engine layer for each env: it reads the env when it loads
let n = 0;
async function load(env: Record<string, string>): Promise<any> {
  const keep = { ...process.env };
  for (const k of Object.keys(process.env)) if (/^NEXY_(ENGINES|ENGINE|AGENT_|DEFAULT_ENGINE|STUDIOS|PLACE)/.test(k)) delete process.env[k];
  const data = path.join(dir, String(n++));
  Object.assign(process.env, { NEXY_DATA_DIR: data, ...env });
  try {
    const r = await build({ entryPoints: [path.join(import.meta.dirname, "..", "src/lib/engine/index.ts")], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
    return await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}#${n}`);
  } finally { process.env = keep; }
}
const idOf = (m: any, e: any) => m.ENGINES.find((c: any) => c.engine === e)?.id ?? (e.upstream === m.ENGINES[0]?.engine.upstream ? "base" : e.id);

test("no pick: NEXY_DEFAULT_ENGINE; an explicit pick wins; no owner uses it too", async () => {
  const m = await load({ ...THREE, NEXY_DEFAULT_ENGINE: "nexy-engine" });
  assert.equal(m.defaultChoice().id, "nexy-engine");
  assert.equal(m.chosen("o_fresh_0123456789abcdef").id, "nexy-engine");
  assert.equal(m.chosen(null).id, "nexy-engine");
  m.pick("o_picker_0123456789abcdef", "hermes");
  assert.equal(m.chosen("o_picker_0123456789abcdef").id, "hermes", "an explicit pick wins");
  assert.equal(idOf(m, m.selectEngine()), "nexy-engine", "a path with no owner uses the default");
  assert.equal(idOf(m, m.engineFor(false, false, null)), "nexy-engine");
});

test("unset, or set to an engine that is not here: as before", async () => {
  for (const env of [THREE, { ...THREE, NEXY_DEFAULT_ENGINE: "ironclaw" }]) {
    const m = await load(env);
    assert.equal(m.defaultChoice().id, "hermes");
    assert.equal(m.chosen("o_fresh_0123456789abcdef").id, "hermes");
    assert.equal(idOf(m, m.selectEngine()), "base", "the deploy-time agent");
  }
  const local = await load({ ...THREE, NEXY_DEFAULT_ENGINE: "nexy-engine", NEXY_ENGINE: "local", NEXY_LLM_URL: "http://127.0.0.1:9" });
  process.env.NEXY_ENGINE = "local";
  try { assert.equal(local.selectEngine().id, "local", "a machine set to the model alone stays so"); }
  finally { delete process.env.NEXY_ENGINE; }
});

test("Hermes in each of its modes and OpenClaw speak as themselves; Nexy Engine and others do not", async () => {
  const m = await load({ ...THREE, NEXY_ENGINES: "hermes-think,nexy-engine,openclaw,ironclaw", NEXY_ENGINE_HERMES_THINK_URL: HERMES, NEXY_ENGINE_IRONCLAW_URL: OC });
  const own = Object.fromEntries(m.ENGINES.map((c: any) => [c.id, !!c.engine.ownIdentity]));
  assert.deepEqual(own, { hermes: true, "hermes-think": true, "nexy-engine": false, openclaw: true, ironclaw: false });
  assert(!m.ENGINES.some((c: any) => /the default/.test(c.note)), "no engine calls itself the default");
  const named = await load({ ...THREE, NEXY_AGENT_NAME: "nexy-engine", NEXY_ENGINES: "" });
  assert.equal(named.ENGINES[0].engine.ownIdentity, undefined, "the deploy-time agent named nexy-engine speaks as Nexy");
});

test("the computer place: the app's own engine only, as Nexy, whatever else is set", async () => {
  const m = await load({ ...THREE, NEXY_STUDIOS: "off", NEXY_DEFAULT_ENGINE: "openclaw", NEXY_ENGINE_OPENCLAW_USER_URLS: "u01=http://x" });
  assert.deepEqual(m.ENGINES.map((c: any) => [c.id, c.label]), [["hermes", "Nexy Engine"]]);
  assert.equal(m.ENGINES[0].engine.ownIdentity, undefined);
  assert.equal(m.defaultChoice().id, "hermes");
  const cloud = await load({ ...THREE, NEXY_STUDIOS: "off", NEXY_PLACE: "cloud" });
  assert.equal(cloud.ENGINES.length, 3, "Nexy Cloud keeps its list");
});
