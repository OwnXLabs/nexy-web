// Reading a connected app from chat: which messages are lookups in Gmail or Drive, the query sent,
// and what the model is handed for granted, missing and failing connectors, against a stand-in hub.
// node --experimental-strip-types --test tests/connectors.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const { connectorAsk, connectorTurn } = await import("../src/lib/connectors.ts");

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
