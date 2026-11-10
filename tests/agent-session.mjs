// The agent keeps one session per chat, so its browser stays on the page between turns instead
// of reopening on about:blank. The session is bound to the caller's demo sign-in: a guessed or
// reused chat id from another visitor never reaches the same session.
// Build first, then: node tests/agent-session.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "server", "entry.mjs");
const PORT = Number(process.env.TEST_PORT ?? 4427), B = `http://127.0.0.1:${PORT}`;
const results = [];
const check = (name, ok, got) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${JSON.stringify(got)}`}`); };

// a stand-in agent gateway that notes the session each turn asks for
const seen = [];
const gw = createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    if (req.url.startsWith("/v1/chat")) seen.push(req.headers["x-hermes-session-id"] ?? null);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
  });
});
await new Promise((r) => gw.listen(0, "127.0.0.1", r));

const dir = mkdtempSync(join(tmpdir(), "agent-session-"));
const srv = spawn(process.execPath, [ENTRY], {
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT), NEXY_DATA_DIR: dir, NEXY_ENGINE: "gateway",
    NEXY_AGENT_URL: `http://127.0.0.1:${gw.address().port}`, NEXY_AGENT_KEY: "test-key" },
  stdio: "ignore",
});
const turn = async (extra, cookie = "own1_demo_sid=visitor-a") => {
  const r = await fetch(B + "/api/v1/chat", { method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }], ...extra }) });
  await r.text();
  return seen.at(-1);
};
try {
  for (let i = 0; i < 50; i++) { if (await fetch(B + "/").then(() => true, () => false)) break; await new Promise((r) => setTimeout(r, 200)); }

  const a1 = await turn({ chat: "c1" });
  const a2 = await turn({ chat: "c1" });
  check("a chat asks for a named agent session", typeof a1 === "string" && /^nexy-[0-9a-f]{32}$/.test(a1), a1);
  check("every turn of that chat asks for the same session", a1 === a2, [a1, a2]);
  check("another chat gets its own session", (await turn({ chat: "c2" })) !== a1, "");
  check("the same chat id from another visitor is a different session", (await turn({ chat: "c1" }, "own1_demo_sid=visitor-b")) !== a1, "");
  check("the session does not carry the chat id or sign-in in the clear", !/c1|visitor/.test(a1), a1);
  check("no chat id: no session header (the old behaviour)", (await turn({})) === null, "");
  check("a malformed chat id is ignored", (await turn({ chat: "../../etc" })) === null, "");
  const before = seen.length;
  await turn({ chat: "c1", private: true });
  check("a private turn never reaches the agent", seen.length === before, seen.length - before);
} finally {
  srv.kill();
  gw.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`${results.filter(Boolean).length}/${results.length} agent-session checks pass`);
process.exit(results.every(Boolean) ? 0 : 1);
