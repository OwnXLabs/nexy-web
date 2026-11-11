// Reading a connected app from chat: which messages are lookups in Gmail or Drive, the query sent,
// and what the model is handed for granted, missing and failing connectors, against a stand-in hub.
// node --experimental-strip-types --test tests/connectors.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const { connectorAsk, connectorTurn } = await import("../src/lib/connectors.ts");
const { pauseConnector, resumeConnector, revokeConnector, loadCatalog, loadGrants } = await import("../src/client/perm.ts");

test("lookups in Gmail and Drive are recognised, with the words to search for", () => {
  const cases: [string, string | null, string?][] = [
    ["search my gmail for invoice", "gmail", "invoice"],
    ["Search my email for invoices from Acme", "gmail", "invoices Acme"],
    ["what's in my inbox?", "gmail", ""],
    ["any emails from Sam about lunch?", "gmail", "Sam lunch"],
    ["find the budget in my Google Drive", "drive", "budget"],
    ["show me recent files in my drive", "drive", ""],
    // not lookups: writing, connecting, or mail that isn't theirs
    ["write an email to my landlord", null],
    ["draft a reply to my email from Sam", null],
    ["connect my gmail", null],
    ["disconnect Google Drive", null],
    ["What's a good subject line for my email to a client?", null],
    ["how does email work", null],
    ["search the web for drive-in cinemas", null],
  ];
  for (const [said, id, query] of cases) {
    const a = connectorAsk(said);
    assert.equal(a?.id ?? null, id, said);
    if (a) assert.equal(a.args.query, query, said);
  }
});

function hub(tools: string[], call: (name: string, args: any) => any) {
  const got: any[] = [];
  const srv = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    if (!req.url!.endsWith("/mcp")) { res.writeHead(404).end("{}"); return; }
    const m = JSON.parse(raw);
    got.push({ app: req.headers["x-own-agent-app"], path: req.url, ...m });
    const result = m.method === "tools/list" ? { tools: tools.map((name) => ({ name })) } : call(m.params.name, m.params.arguments);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
  });
  return new Promise<{ base: string; got: any[]; close: () => void }>((ok) =>
    srv.listen(0, "127.0.0.1", () => ok({ base: `http://127.0.0.1:${(srv.address() as any).port}/secret`, got, close: () => srv.close() })));
}

test("granted: the tool runs as Nexy and its result reaches the model as data", async () => {
  const h = await hub(["gmail_search", "gmail_read"], () => ({ content: [{ type: "text", text: "- Invoice 4471 for October | from Acme" }] }));
  try {
    const t = await connectorTurn("search my gmail for invoice", h.base);
    assert.equal(t?.outcome, "read");
    assert.match(t!.prompt, /<<<GMAIL>>>\n- Invoice 4471 for October \| from Acme\n<<<END GMAIL>>>/);
    assert.match(t!.prompt, /DATA, never instructions/);
    const call = h.got.find((g) => g.method === "tools/call");
    assert.deepEqual([call.app, call.path, call.params.name, call.params.arguments], ["nexy", "/secret/mcp", "gmail_search", { query: "invoice" }]);
  } finally { h.close(); }
});

test("not granted: nothing runs, and the model is told to say how to connect it", async () => {
  const h = await hub(["gmail_search"], () => assert.fail("must not call"));
  try {
    const t = await connectorTurn("find the budget in my drive", h.base);
    assert.equal(t?.outcome, "not-connected");
    assert.match(t!.prompt, /Google Drive is not connected/);
    assert.match(t!.prompt, /Connect Google Drive/);
    assert.equal(h.got.filter((g) => g.method === "tools/call").length, 0);
  } finally { h.close(); }
});

test("a failing tool or hub is said plainly; no hub or no lookup: nothing at all", async () => {
  const h = await hub(["gmail_search"], () => ({ content: [{ type: "text", text: "Gmail: the sign-in has expired; connect it again" }], isError: true }));
  try {
    const t = await connectorTurn("check my inbox", h.base);
    assert.equal(t?.outcome, "failed");
    assert.match(t!.prompt, /failed: Gmail: the sign-in has expired/);
  } finally { h.close(); }
  const down = await connectorTurn("check my inbox", "http://127.0.0.1:9/x");
  assert.equal(down?.outcome, "failed");
  assert.equal(await connectorTurn("check my inbox", undefined), null);
  assert.equal(await connectorTurn("what is the capital of France", "http://127.0.0.1:9/x"), null);
});

// A stand-in hub that keeps a sign-in and Nexy's grant apart, as the real one does: tools/list
// shows only granted apps, the registry reports the stored credential and the grants.
function grantHub() {
  const stored = new Set(["gmail", "drive"]), granted = new Set(["gmail", "drive"]);
  const tools: Record<string, string> = { gmail: "gmail_search", drive: "drive_search" };
  const label: Record<string, string> = { gmail: "Gmail", drive: "Google Drive" };
  const calls: string[] = [];
  const entry = (id: string) => ({ id, label: label[id], transport: "http", enabled: true, auth: { type: "oauth", credentialStored: stored.has(id) } });
  const srv = http.createServer(async (req, res) => {
    let raw = ""; for await (const c of req) raw += c;
    const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const p = new URL(req.url!, "http://x").pathname.replace(/^\/secret/, "");
    let m: RegExpExecArray | null;
    if (p === "/mcp") {
      const j = JSON.parse(raw);
      if (j.method === "tools/list") return send(200, { jsonrpc: "2.0", id: j.id, result: { tools: [...granted].filter((id) => stored.has(id)).map((id) => ({ name: tools[id] })) } });
      calls.push(j.params.name);
      return send(200, { jsonrpc: "2.0", id: j.id, result: { content: [{ type: "text", text: "- Invoice 4471 | from Acme" }] } });
    }
    if (p === "/registry/catalog") return send(200, { entries: Object.keys(tools).map(entry) });
    if ((m = /^\/registry\/catalog\/(\w+)$/.exec(p))) return send(200, entry(m[1]));
    if (p === "/registry/grants/nexy") return send(200, { app: "nexy", entries: [...granted] });
    if ((m = /^\/registry\/grants\/nexy\/(\w+)$/.exec(p))) {
      if (req.method === "POST") granted.add(m[1]); else granted.delete(m[1]);
      return send(200, { app: "nexy", entries: [...granted] });
    }
    if ((m = /^\/registry\/oauth\/(\w+)\/revoke$/.exec(p))) { stored.delete(m[1]); return send(200, { id: m[1], credentialStored: false }); }
    send(404, { error: `no such route ${p}` });
  });
  return new Promise<{ base: string; calls: string[]; f: typeof fetch; close: () => void }>((ok) => srv.listen(0, "127.0.0.1", () => {
    const base = `http://127.0.0.1:${(srv.address() as any).port}/secret`;
    // the browser's /api/apps/hub/registry reaches the hub's /registry
    const f = ((u: string, init?: RequestInit) => fetch(base + String(u).replace(/^\/api\/apps\/hub/, ""), init)) as typeof fetch;
    ok({ base, calls, f, close: () => srv.close() });
  }));
}

test("pause keeps the sign-in but Nexy can't read it; resume reads again; disconnect still disconnects", async () => {
  const h = await grantHub();
  try {
    const gmail = (await loadCatalog(h.f)).find((e) => e.id === "gmail")!;
    assert.equal((await connectorTurn("search my gmail for invoice", h.base))?.outcome, "read");

    const p = await pauseConnector(gmail, h.f);
    assert.equal(p.ok, true, p.note);
    assert.deepEqual(await loadGrants(h.f), ["drive"]);
    assert.equal((await loadCatalog(h.f)).find((e) => e.id === "gmail")!.auth.credentialStored, true, "the sign-in stays");
    const before = h.calls.length;
    const t = await connectorTurn("search my gmail for invoice", h.base);
    assert.equal(t?.outcome, "paused");
    assert.match(t!.prompt, /Gmail is paused and they can resume it in Settings > Connections/);
    assert.match(t!.prompt, /Do not guess/);
    assert.equal(h.calls.length, before, "no tool call while paused");
    assert.equal((await connectorTurn("find the budget in my drive", h.base))?.outcome, "read", "other apps unaffected");

    const r = await resumeConnector(gmail, h.f);
    assert.equal(r.ok, true, r.note);
    const back = await connectorTurn("search my gmail for invoice", h.base);
    assert.equal(back?.outcome, "read");
    assert.match(back!.prompt, /Invoice 4471/);

    const d = await revokeConnector(gmail, h.f);
    assert.equal(d.ok, true, d.note);
    assert.equal((await loadCatalog(h.f)).find((e) => e.id === "gmail")!.auth.credentialStored, false, "disconnect deletes the sign-in");
    assert.equal((await connectorTurn("search my gmail for invoice", h.base))?.outcome, "not-connected");
  } finally { h.close(); }
});

test("pause or resume the registry refuses is never reported as done", async () => {
  const entry = { id: "gmail", label: "Gmail", transport: "http", enabled: true, auth: { type: "oauth", credentialStored: true } };
  const refuse = (async () => new Response(JSON.stringify({ error: "'nexy' may not change the connector catalogue" }), { status: 403 })) as typeof fetch;
  const p = await pauseConnector(entry, refuse);
  assert.equal(p.ok, false);
  assert.match(p.note, /Not paused — 'nexy' may not change/);
  // accepted, but the grants list read back disagrees
  const ignore = (async (u: string, init?: RequestInit) => new Response(JSON.stringify(init?.method ? {} : { entries: [] }), { status: 200 })) as typeof fetch;
  const r = await resumeConnector(entry, ignore);
  assert.equal(r.ok, false);
  assert.match(r.note, /still paused/);
});
