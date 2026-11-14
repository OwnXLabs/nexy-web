// OpenClaw as an agent engine: the request it gets (agent target, bearer from the key file,
// one session key per chat, safe characters only), whole and streamed replies, and failures that
// throw so the chat falls back to the plain model. Against a stand-in gateway.
// node --experimental-strip-types --test tests/openclaw.test.ts
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const { openclawStandin } = createRequire(import.meta.url)("./standins/openclaw.cjs");
const TOKEN = "oc-operator-token-123";
const gw = await openclawStandin({ token: TOKEN });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexy-openclaw-"));
const keyFile = path.join(dir, "openclaw.key");
fs.writeFileSync(keyFile, `${TOKEN}\n`, { mode: 0o600 });
after(() => { gw.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// the server modules, bundled for Node (extensionless imports); the env is read when they load
async function load<T = any>(file: string, env: Record<string, string>): Promise<T> {
  const keep = { ...process.env };
  for (const k of Object.keys(process.env)) if (/^NEXY_(ENGINES|ENGINE_|AGENT_)/.test(k)) delete process.env[k];
  Object.assign(process.env, { NEXY_DATA_DIR: dir, ...env });
  try {
    const r = await build({ entryPoints: [path.join(import.meta.dirname, "..", file)], bundle: true, write: false, format: "esm", platform: "node", logLevel: "silent" });
    return await import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}`);
  } finally { process.env = keep; }
}
const oc = await load("src/lib/engine/openclaw.ts", {});

test("session keys: nexy-<chat>, safe characters only, never one of OpenClaw's own kinds", () => {
  assert.equal(oc.sessionKey("3f2a9c"), "nexy-3f2a9c");
  assert.equal(oc.sessionKey("subagent:main/../x y"), "nexy-subagentmainxy");
  for (const s of ["cron:daily", "acp:1", "subagent:a", "a\r\nx-evil: 1", "é漢🙂"]) {
    const k = oc.sessionKey(s);
    assert(k === "" || /^nexy-[A-Za-z0-9_-]+$/.test(k), `${JSON.stringify(s)} gave ${k}`);
    assert(!/^(subagent|cron|acp):/.test(k));
  }
  assert.equal(oc.sessionKey("é漢🙂"), "", "nothing safe left: no key at all");
  assert.equal(oc.sessionKey("a".repeat(500)).length, "nexy-".length + 96);
});

test("the request: agent target, bearer, session header and body user, no Hermes header", () => {
  const msgs = [{ role: "user", content: "hi" }];
  const r = oc.openclawRequest("http://127.0.0.1:18789/", "tok", "", msgs, true, "chat1");
  assert.equal(r.url, "http://127.0.0.1:18789/v1/chat/completions");
  assert.equal(r.init.method, "POST");
  const h = r.init.headers as Record<string, string>;
  assert.equal(h.authorization, "Bearer tok");
  assert.equal(h["x-openclaw-session-key"], "nexy-chat1");
  assert(!Object.keys(h).some((k) => /hermes/i.test(k)));
  assert.deepEqual(JSON.parse(String(r.init.body)), { model: "openclaw/default", messages: msgs, stream: true, user: "nexy-chat1" });
  const agent = JSON.parse(String(oc.openclawRequest("http://x", "tok", "openclaw/sales", msgs, false).init.body));
  assert.equal(agent.model, "openclaw/sales");
  assert.equal(agent.user, undefined, "no chat, no session");
  assert.equal((oc.openclawRequest("http://x", "", "", msgs, false).init.headers as any).authorization, undefined);
});

test("registered from NEXY_ENGINES: key from the key file, agent from NEXY_ENGINE_OPENCLAW_AGENT, no memory or routines", async () => {
  const reg = await load("src/lib/engine/registry.ts", {
    NEXY_ENGINES: "openclaw", NEXY_ENGINE_OPENCLAW_URL: gw.url, NEXY_ENGINE_OPENCLAW_KEY_FILE: keyFile, NEXY_ENGINE_OPENCLAW_AGENT: "openclaw/sales",
  });
  const c = reg.ENGINES.find((e: any) => e.id === "openclaw");
  assert(c, "listed");
  assert.equal(c.label, "OpenClaw");
  assert.deepEqual(reg.capsOf(c.engine), { memory: false, routines: false });
  assert.equal(c.engine.browsed, undefined);

  gw.seen.length = 0;
  const r = await c.engine.chat("what is 2+2", [{ role: "user", content: "earlier" }, { role: "assistant", content: "ok" }], "SYSTEM", undefined, "chat:42");
  assert.equal(r.via, "openclaw");
  assert.equal(r.reply, "answer from openclaw to what is 2+2");
  const hit = gw.seen.at(-1);
  assert.equal(hit.auth, `Bearer ${TOKEN}`, "the token from the key file, trimmed");
  assert.equal(hit.session, "nexy-chat42");
  assert.equal(hit.body.user, "nexy-chat42");
  assert.equal(hit.body.model, "openclaw/sales");
  assert.equal(hit.hermes, "");
  assert.deepEqual(hit.body.messages.map((m: any) => m.role), ["system", "user", "assistant", "user"]);

  // streamed: the words arrive as they come, and the whole reply is the same
  const parts: string[] = [];
  const s = await c.engine.chat("stream please", [], "SYSTEM", undefined, "chat42", (d: string) => parts.push(d));
  assert(parts.length > 1, "more than one delta");
  assert.equal(parts.join(""), s.reply);
  assert.equal(s.reply, "answer from openclaw to stream please");
  assert.equal(gw.seen.at(-1).body.stream, true);
  assert(!gw.seen.some((x: any) => x.path.startsWith("/api/")), "nothing but the chat API");
});

test("a refused token, a missing gateway and a stall all throw (the chat then falls back); the token is never in the error", async () => {
  const wrong = oc.openclawEngine(gw.url, "not-the-token");
  await assert.rejects(wrong.chat("hi", [], "S", undefined, "c1"), (e: Error) => /openclaw gateway 401/.test(e.message) && !e.message.includes("not-the-token"));
  await assert.rejects(oc.openclawEngine("http://127.0.0.1:9", TOKEN).chat("hi", [], "S", undefined, "c1"));
  const slow = await openclawStandin({ token: TOKEN, stall: true });
  try {
    const t0 = Date.now();
    await assert.rejects(oc.openclawEngine(slow.url, TOKEN).chat("hi", [], "S", AbortSignal.timeout(300), "c1"));
    assert(Date.now() - t0 < 5000, "the caller's budget stops it");
  } finally { slow.close(); }
  const empty = await openclawStandin({ token: TOKEN, reply: () => "" });
  try { await assert.rejects(oc.openclawEngine(empty.url, TOKEN).chat("hi", [], "S", undefined, "c1"), /no reply/); }
  finally { empty.close(); }
  assert.equal(oc.openclawEngine("", TOKEN).available(), false);
});
