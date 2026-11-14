// An ultra-private chat promises nothing is written to disk. Speech goes through temporary files (the
// recording and the reply, on this computer and in Own Voice on an Own1), so every speech request
// from a chat goes through speechFetch, which makes none while the chat is private.
// node --experimental-strip-types --test tests/private-speech.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const client = path.join(import.meta.dirname, "..", "src", "client");
// where the address is defined, and Settings: the voice list and a fixed test phrase, no chat text
const REVIEWED: Record<string, string> = {
  "place.ts": "defines voiceApi",
  "settings.ts": "the voice list and the fixed test phrase; no conversation text",
};
const SPEECH = /voiceApi\(|\/api\/(v1\/voice|apps\/voice)/;

test("every speech request in the client goes through speechFetch", () => {
  const bad: string[] = [];
  for (const f of fs.readdirSync(client).filter((f) => f.endsWith(".ts"))) {
    if (REVIEWED[f]) continue;
    fs.readFileSync(path.join(client, f), "utf8").split("\n").forEach((l, i) => {
      if (SPEECH.test(l) && !l.includes("speechFetch(")) bad.push(`${f}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepEqual(bad, []);
});

test("speechFetch makes no request while the chat is ultra-private", async () => {
  const { speechFetch, speechReady } = await import("../src/client/voice-local.ts");
  const { setPrivate } = await import("../src/client/private.ts");
  const calls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string) => { calls.push(String(u)); return new Response('{"state":"ready"}'); }) as typeof fetch;
  try {
    setPrivate(true, false);
    await assert.rejects(speechFetch("/api/v1/voice/tts", { method: "POST", body: "{}" }), /ultra-private/);
    await assert.rejects(speechFetch("/api/apps/voice/api/stt", { method: "POST" }), /ultra-private/);
    await assert.rejects(speechReady(() => {}), /ultra-private/);
    assert.deepEqual(calls.filter((u) => /voice/.test(u)), []);
    setPrivate(false, false);
    await speechReady(() => {});
    assert.deepEqual(calls.filter((u) => /voice/.test(u)), ["/api/v1/voice/status"]);
  } finally { globalThis.fetch = real; }
});
