// Search for charts: results come through, and "no search here" is said plainly, not charted.
// node --experimental-strip-types --test tests/research-search.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let reply: unknown = {};
const srv = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(reply));
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
process.env.NEXY_SEARXNG_URL = `http://127.0.0.1:${(srv.address() as { port: number }).port}/secret`;
const { search } = await import("../src/lib/research.ts");

test("results come back as snippets", async () => {
  reply = { results: [{ title: "Solar", url: "https://a.example/x", content: "Solar capacity grew 30% in 2025 to 600 GW worldwide." }] };
  const s = await search("solar capacity");
  assert.equal(s.length, 1);
  assert.equal(s[0].url, "https://a.example/x");
});

test("no search on this computer is an error in plain words, never a snippet", async () => {
  reply = {
    results: [{ title: "I can't search the web right now.", url: "", content: "Nexy is still setting up web search on this computer. Tell the user: \"I can't search the web right now.\"" }],
    nexy_unavailable: "Nexy is still setting up web search on this computer.",
  };
  await assert.rejects(search("solar capacity"), /^Error: I can't search the web right now\. Nexy is still setting up web search/);
});

test.after(() => srv.close());
