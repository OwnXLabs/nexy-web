// Speech on a computer without an Own1, with stand-ins for the recogniser, the system voices and the
// model download: parsing, the checksummed fetch, transcripts and spoken replies.
// node --experimental-strip-types --test tests/voice.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexy-voice-"));
const standins = path.join(import.meta.dirname, "standins");
const model = Buffer.from("stand-in speech model ".repeat(5000));
const log = path.join(dir, "log");
let served = model;
const srv = http.createServer((_q, r) => { r.writeHead(200, { "content-length": served.length }); r.end(served); });
await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
Object.assign(process.env, {
  NEXY_STUDIOS: "off", NEXY_VOICE_DIR: dir, STANDIN_LOG: log,
  NEXY_WHISPER_BIN: path.join(standins, "whisper-cli"), NEXY_SAY_BIN: path.join(standins, "say"),
  NEXY_VOICE_MODEL_URL: `http://127.0.0.1:${(srv.address() as any).port}/model.bin`,
  NEXY_VOICE_MODEL_SHA256: createHash("sha256").update(model).digest("hex"), NEXY_VOICE_MODEL_BYTES: String(model.length),
});
const V = await import("../src/lib/voice.ts");
const { encodeWav } = await import("../src/client/voice-local.ts");
test.after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 20)); };

test("English voices only, novelty voices left out, names readable", () => {
  const v = V.parseVoices("Samantha            en_US    # Hello!\nBells               en_US    # Hi\nAnna                de_DE    # Hallo\nEddy (English (UK)) en_GB    # Hello!\nEddy (English (UK)) en_GB    # again\n");
  assert.deepEqual(v, [{ id: "Samantha", name: "Samantha" }, { id: "Eddy (English (UK))", name: "Eddy, English (UK)" }]);
});

test("transcripts drop markers and spacing", () => {
  assert.equal(V.cleanTranscript(" [BLANK_AUDIO]\n Hello there. (music)\n How are you?\n"), "Hello there. How are you?");
  assert.equal(V.cleanTranscript("[BLANK_AUDIO]"), "");
});

test("the WAV the page sends is one speech recognition reads", () => {
  const b = encodeWav(new Float32Array([0, 0.5, -1, 1]), 16000);
  return b.arrayBuffer().then((ab) => {
    const u = new Uint8Array(ab), d = new DataView(ab);
    assert.ok(V.isWav(new Uint8Array([...u, ...new Uint8Array(8)])));
    assert.equal(d.getUint32(24, true), 16000);
    assert.equal(d.getUint16(22, true), 1);
    assert.equal(d.getUint32(40, true), 8);
    assert.deepEqual([d.getInt16(44, true), d.getInt16(46, true), d.getInt16(48, true), d.getInt16(50, true)], [0, 16383, -32768, 32767]);
  });
});

test("local voice is on with both tools here; other uploads are not WAVs", () => {
  assert.equal(V.localVoice(), true);
  assert.equal(V.isWav(Buffer.from("not a wav at all, just some bytes padding padding padding")), false);
});

test("a model that fails its checksum is not kept", async () => {
  served = Buffer.from("tampered");
  assert.equal(V.prepare().state, "fetching");
  await until(() => V.status().state !== "fetching");
  assert.equal(V.status().state, "failed");
  assert.match(V.status().error!, /checksum/);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".bin") || f.endsWith(".part")), []);
  served = model;
});

test("the model is fetched once, then speech to text and spoken replies run", async () => {
  assert.equal(V.prepare().state, "fetching");
  assert.equal(V.prepare().state, "fetching", "a second prepare joins the first");
  await until(() => V.status().state === "ready");
  assert.equal(V.status().state, "ready");
  assert.equal(fs.readFileSync(path.join(dir, V.MODEL.file)).length, model.length);

  const wav = new Uint8Array(await encodeWav(new Float32Array(16000), 16000).arrayBuffer());
  assert.equal(await V.transcribe(wav), "What is the weather like today?");
  const out = await V.speak("Sunny, 24 degrees.", "Samantha");
  assert.ok(V.isWav(out));
  await V.speak("Default voice.", "en_US-amy-medium");
  assert.deepEqual(await V.voices(), [{ id: "Samantha", name: "Samantha" }, { id: "Eddy (English (UK))", name: "Eddy, English (UK)" }]);
  assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), ["stt 32044", "tts Samantha: Sunny, 24 degrees.", "tts default: Default voice."]);
  assert.deepEqual(fs.readdirSync(path.join(dir, "tmp")), [], "no recordings or replies left on disk");
});

test("live words skip a turn while a speech job runs, instead of queueing behind it", async () => {
  const wav = new Uint8Array(await encodeWav(new Float32Array(16000), 16000).arrayBuffer());
  process.env.STANDIN_SLEEP = "0.4";
  try {
    const final = V.transcribe(wav);
    assert.equal(V.speechBusy(), true);
    assert.equal(await V.transcribe(wav, true), null, "skipped, not queued");
    assert.equal(await final, "What is the weather like today?");
  } finally { delete process.env.STANDIN_SLEEP; }
  assert.equal(V.speechBusy(), false);
  assert.equal(await V.transcribe(wav, true), "What is the weather like today?", "idle: live words run");
});
