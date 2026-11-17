// What leaves the device in a beta report: keys, tokens, passwords, cookies and wallets go from
// everything; logs, errors and a shared chat also lose emails, phone numbers, home-folder user
// names, IP and MAC addresses. Scrubbing twice changes nothing (the preview is what is sent).
// node --experimental-strip-types --test tests/scrub.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { scrub, scrubLog } from "../src/lib/scrub.ts";

const W = "0x52908400098527886E0F7030069857D2E4169EE7";

test("secrets and wallets go from every field", () => {
  const cases: [string, string][] = [
    ["Authorization: Bearer abcdef123456", "Authorization: [removed]"],
    ["Cookie: nexy_owner=abc; sid=1", "Cookie: [removed]"],
    ['{"password":"hunter2","ok":true}', '{"password":"[removed]","ok":true}'],
    ["sending with bearer xyzxyzxyz12", "sending with bearer [removed]"],
    ["NEXY_ENGINE_KEY=deadbeef port=5000", "NEXY_ENGINE_KEY=[removed] port=5000"],
    ["key sk-proj-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6", "key [removed]"],
    [`send to ${W} now`, "send to [removed] now"],
    [`pk 0x${"ab".repeat(32)}`, "pk [removed]"],
  ];
  for (const [i, want] of cases) {
    assert.equal(scrub(i), want, i);
    assert.equal(scrub(scrub(i)), scrub(i), `twice: ${i}`);
  }
});

test("logs lose emails, phones, home folders, IP and MAC addresses", () => {
  const cases: [string, string][] = [
    ["mail from jane.doe+x@example.co.uk failed", "mail from [removed] failed"],
    ["call +61 412 345 678 or (555) 123-4567 or 555-123-4567", "call [removed] or [removed] or [removed]"],
    ["opened /Users/jane/Library/Logs/nexy.log", "opened /Users/[user]/Library/Logs/nexy.log"],
    ["C:\\Users\\Jane Doe\\AppData", "C:\\Users\\[user]\\AppData"],
    ["/home/jane/.ollama", "/home/[user]/.ollama"],
    ["peer 192.168.1.20:443 and 8.8.8.8", "peer [removed]:443 and [removed]"],
    ["engine ready on 127.0.0.1:5000", "engine ready on 127.0.0.1:5000"],
    ["en0 ether a4:83:e7:12:34:56", "en0 ether [removed]"],
    ["ygg 200:1234:abcd:ef01:2345:6789:abcd:ef01 up", "ygg [removed] up"],
  ];
  for (const [i, want] of cases) {
    assert.equal(scrubLog(i), want, i);
    assert.equal(scrubLog(scrubLog(i)), scrubLog(i), `twice: ${i}`);
  }
});

test("ordinary log lines are left alone", () => {
  for (const l of [
    "2026-11-17 09:15:22 model qwen3.5-9b loaded in 2.1s",
    "GET /api/v1/chat 200 812ms",
    "Nexy 0.2.18 on Darwin 25.5.0 arm64",
    "at 1700000000123 took +0000",
    "The keyboard shortcut does not work",
  ]) assert.equal(scrubLog(l), l);
});

// a log line that is JSON stays JSON: only values go, never the brackets, quotes or commas around them
test("JSON log lines stay valid JSON", () => {
  const cases: [string, string][] = [
    ['{"result":"answered","contextKeys":["projects","apps","memory"],"turns":3}', '{"result":"answered","contextKeys":["projects","apps","memory"],"turns":3}'],
    ['{"usage":{"prompt_tokens":812,"max_tokens":4096},"cached":true,"session":null}', '{"usage":{"prompt_tokens":812,"max_tokens":4096},"cached":true,"session":null}'],
    ['{"password":"hunter 2, really","next":1}', '{"password":"[removed]","next":1}'],
    ['{"apiKey":"it\'s a secret","x":[1,2]}', '{"apiKey":"[removed]","x":[1,2]}'],
    ['{"auth":{"token":"abc123def","user":"me"}}', '{"auth":{"token":"[removed]","user":"me"}}'],
    ['{"msg":"sent Cookie: sid=abc; theme=dark","ok":true}', '{"msg":"sent Cookie: [removed]","ok":true}'],
    ['{"msg":"Authorization: Bearer abcdef123456","n":2}', '{"msg":"Authorization: [removed]","n":2}'],
    ['{"line":"{\\"password\\":\\"hunter 2\\"}","ok":true}', '{"line":"{\\"password\\":\\"[removed]\\"}","ok":true}'],
    ['{"from":"jane@example.com","peer":"192.168.1.20","home":"/Users/jane/x"}', '{"from":"[removed]","peer":"[removed]","home":"/Users/[user]/x"}'],
    [`{"wallet":"${W}","keys":[]}`, '{"wallet":"[removed]","keys":[]}'],
  ];
  for (const [i, want] of cases) {
    JSON.parse(i);
    const got = scrubLog(i);
    assert.equal(got, want, i);
    assert.doesNotThrow(() => JSON.parse(got), `still JSON: ${got}`);
    assert.equal(scrubLog(got), got, `twice: ${i}`);
    assert.doesNotThrow(() => JSON.parse(scrub(i)), `scrub keeps JSON: ${i}`);
  }
});

test("a turn log line as the server writes it stays JSON and keeps its counts", () => {
  const line = JSON.stringify({ t: "2026-11-17T09:15:22.123Z", kind: "chat", turn: "ab12cd34", result: "answered", via: "nexy",
    contextKeys: ["projects", "apps"], tools: [], sources: "unknown", cited: 0, searchAsked: true, replyChars: 812, research: true });
  const got = scrubLog(line);
  assert.deepEqual(JSON.parse(got), JSON.parse(line));
});
