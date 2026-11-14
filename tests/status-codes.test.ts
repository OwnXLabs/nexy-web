// HTTP status codes never reach the screen: the client turns them into words with httpMsg
// (src/client/http.ts), which logs the code to the console.
// node --experimental-strip-types --test tests/status-codes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const client = path.join(import.meta.dirname, "..", "src", "client");
// a status code or the browser's status text in a message: `error ${r.status}`, `HTTP ${...}`, r.statusText
const CODE = /\$\{[^}]*\.status\}|HTTP \$\{|\.statusText\b/;

test("no status code or status text in a message in src/client", () => {
  const bad: string[] = [];
  for (const f of fs.readdirSync(client).filter((f) => f.endsWith(".ts") && f !== "http.ts")) {
    fs.readFileSync(path.join(client, f), "utf8").split("\n").forEach((l, i) => {
      if (CODE.test(l)) bad.push(`${f}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
});
