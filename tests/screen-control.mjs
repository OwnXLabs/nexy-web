// Who may watch and who may drive the agent's screen. Watching and driving need the live demo
// session (or, on an owner's box, the signed-in owner); taking control hands over the control
// password and marks the screen as driven, which pauses the agent; handing back clears it.
// Build first, then: node tests/screen-control.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "server", "entry.mjs");
const PORT = Number(process.env.TEST_PORT ?? 4426), B = `http://127.0.0.1:${PORT}`;
const results = [];
const check = (name, ok, got) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${JSON.stringify(got)}`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a stand-in for the desktop's session check: the cookie "own1_demo_sid=holder" holds the slot
const desk = createServer((req, res) => { res.statusCode = /own1_demo_sid=holder/.test(req.headers.cookie ?? "") ? 200 : 401; res.end(); });
await new Promise((r) => desk.listen(0, "127.0.0.1", r));
const DESK = `http://127.0.0.1:${desk.address().port}/api/demo-session`;

async function serve({ trust = false, session = DESK, local = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "screen-ctl-"));
  writeFileSync(join(dir, "view"), "VIEWPASS");
  writeFileSync(join(dir, "full"), "FULLPASS");
  mkdirSync(join(dir, "control"));
  const p = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT), NEXY_DATA_DIR: join(dir, "data"), NEXY_SCREEN_DIR: dir,
      NEXY_DEMO_SESSION_URL: session, NEXY_TRUST_XNODE_AUTH: trust ? "1" : "", NEXY_INSECURE_TRUST_ON_TCP: "1", NEXY_SCREEN_LOCAL: local ? "1" : "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) { if (await fetch(B + "/api/v1/screen").then(() => true, () => false)) break; await sleep(200); }
  return { driven: () => existsSync(join(dir, "control", "human")), stop: async () => { p.kill(); rmSync(dir, { recursive: true, force: true }); await sleep(400); } };
}
const screen = (headers = {}) => fetch(B + "/api/v1/screen", { headers }).then((r) => r.json());
const post = async (body, headers = {}) => {
  const r = await fetch(B + "/api/v1/screen", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const holder = { cookie: "own1_demo_sid=holder" };
const other = { cookie: "own1_demo_sid=someone-else" };

let s = await serve();
let g = await screen(other);
check("public demo, not the slot holder: may not watch", g.watch === false && !g.password, g);
g = await screen(holder);
check("the slot holder watches with the view password only", g.watch === true && g.password === "VIEWPASS" && g.control === true && g.driving === false, g);
let r = await post({ take: true }, other);
check("someone else cannot take control", r.status === 403 && !r.body.password && !s.driven(), r);
r = await post({ take: true }, { ...other, "xnode-auth-user": "forged" });
check("…not even with a forged identity header", r.status === 403 && !s.driven(), r);
r = await post({ take: true }, holder);
check("the slot holder takes control: gets the control password", r.status === 200 && r.body.password === "FULLPASS", r);
check("…and the screen is marked as driven (the agent pauses)", s.driven(), "");
check("the screen reports it is driven", (await screen(holder)).driving === true, "");
r = await post({ release: true }, other);
check("someone else cannot hand it back for them", r.status === 403 && s.driven(), r);
r = await post({ release: true }, holder);
check("handing back clears it (the agent resumes)", r.status === 200 && !s.driven(), r);
r = await fetch(B + "/api/v1/screen", { method: "POST", headers: { ...holder, "content-type": "application/json" }, body: "not json" }).then((x) => x.status);
check("a malformed request is refused", r === 400, r);
await s.stop();

s = await serve({ trust: true });
r = await post({ take: true }, { "xnode-auth-user": "owner@example" });
check("owner box: the signed-in owner may take control", r.status === 200 && r.body.password === "FULLPASS" && s.driven(), r);
r = await post({ take: true });
check("owner box, no identity and no session: refused", r.status === 403, r);
await s.stop();

s = await serve({ session: "http://127.0.0.1:9/none" });
g = await screen();
check("session check unreachable: no watching, no password", g.watch === false && !g.password, g);
await s.stop();
s = await serve({ session: "http://127.0.0.1:9/none", local: true });
g = await screen();
check("no desktop to ask (local development, opted in): watch only", g.watch === true && g.password === "VIEWPASS", g);
r = await post({ take: true });
check("…but never control on a guess", r.status === 403 && !s.driven(), r);
await s.stop();

desk.close();
console.log(`${results.filter(Boolean).length}/${results.length} screen-control checks pass`);
process.exit(results.every(Boolean) ? 0 : 1);
