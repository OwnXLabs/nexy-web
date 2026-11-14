// Talking to Nexy on a computer without an Own1: speech to text and spoken replies, both on this machine.
// Speech to text: the desktop app's bundled whisper-cli (NEXY_WHISPER_BIN) with a small English model
// (MIT) that Nexy fetches once, checksummed. Spoken replies: the computer's own voices (macOS `say`).
// No audio or text leaves the machine; the only download is the model file itself.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const env = process.env;
const DIR = env.NEXY_VOICE_DIR ?? path.join(env.NEXY_DATA_DIR ?? "/var/lib/nexy", "voice");
const BIN = env.NEXY_WHISPER_BIN ?? "";
const SAY = env.NEXY_SAY_BIN ?? (process.platform === "darwin" ? "/usr/bin/say" : "");

// whisper base.en, 8-bit (MIT, OpenAI weights in ggml form), pinned to one revision of the model repo
export const MODEL = {
  file: "ggml-base.en-q8_0.bin",
  url: env.NEXY_VOICE_MODEL_URL ??
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en-q8_0.bin",
  sha256: env.NEXY_VOICE_MODEL_SHA256 ?? "a4d4a0768075e13cfd7e19df3ae2dbc4a68d37d36a7dad45e8410c9a34f8c87e",
  bytes: Number(env.NEXY_VOICE_MODEL_BYTES ?? 81_781_811),
};
const modelPath = () => path.join(DIR, MODEL.file);

const runnable = (p: string) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } };

/** Local voice runs only where there are no studios (an Own1 has Own Voice) and both tools are here. */
export const localVoice = (): boolean => env.NEXY_STUDIOS === "off" && !!BIN && !!SAY && runnable(BIN) && runnable(SAY);

type Prep = { state: "missing" | "fetching" | "ready" | "failed"; done: number; total: number; error?: string };
let prep: Prep = { state: "missing", done: 0, total: MODEL.bytes };

export function status(): Prep {
  if (prep.state !== "fetching" && fs.existsSync(modelPath())) prep = { state: "ready", done: MODEL.bytes, total: MODEL.bytes };
  return prep;
}

/** Fetch the speech model once (idempotent); progress is in status(). */
export function prepare(): Prep {
  const s = status();
  if (s.state === "ready" || s.state === "fetching") return s;
  prep = { state: "fetching", done: 0, total: MODEL.bytes };
  fetchModel().then(
    () => { prep = { state: "ready", done: MODEL.bytes, total: MODEL.bytes }; },
    (e) => { prep = { state: "failed", done: 0, total: MODEL.bytes, error: String(e?.message ?? e).slice(0, 200) }; },
  );
  return prep;
}

async function fetchModel(): Promise<void> {
  fs.mkdirSync(DIR, { recursive: true });
  const free = (() => { try { const s = fs.statfsSync(DIR); return s.bavail * s.bsize; } catch { return Infinity; } })();
  if (MODEL.bytes + 1e9 > free) throw new Error(`not enough free disk space (${Math.round(MODEL.bytes / 1e6)} MB needed, plus 1 GB spare)`);
  const res = await fetch(MODEL.url, { signal: AbortSignal.timeout(1_800_000) });
  if (!res.ok || !res.body) {
    console.error(`speech model download: HTTP ${res.status}`);
    throw new Error("the speech model download failed; check the connection and try again");
  }
  const part = `${modelPath()}.part`, out = fs.createWriteStream(part), hash = createHash("sha256");
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((ok) => out.once("drain", ok));
      prep.done += chunk.length;
    }
    await new Promise<void>((ok, bad) => out.end((e?: Error | null) => (e ? bad(e) : ok())));
  } catch (e) { out.destroy(); fs.rmSync(part, { force: true }); throw e; }
  if (hash.digest("hex") !== MODEL.sha256) { fs.rmSync(part, { force: true }); throw new Error("the speech model didn't match its checksum, so it wasn't used"); }
  fs.renameSync(part, modelPath());
}

function run(bin: string, args: string[], ms: number): Promise<string> {
  return new Promise((ok, bad) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => p.kill("SIGKILL"), ms);
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => { clearTimeout(t); bad(e); });
    p.on("close", (code) => { clearTimeout(t); code === 0 ? ok(out) : bad(new Error((err.trim().split("\n").pop() || `exited ${code}`).slice(0, 200))); });
  });
}

// one speech job at a time: whisper uses the GPU, two at once only slows both
let queue: Promise<unknown> = Promise.resolve(), jobs = 0;
const one = <T>(job: () => Promise<T>): Promise<T> => {
  jobs++;
  const r = queue.then(job, job).finally(() => { jobs--; });
  queue = r.catch((e) => { console.warn("[voice] speech job failed", e?.message ?? e); });
  return r;
};
/** True while a speech job runs or waits; live words skip a turn rather than queue behind it. */
export const speechBusy = () => jobs > 0;

const tmp = (ext: string) => { fs.mkdirSync(path.join(DIR, "tmp"), { recursive: true }); return path.join(DIR, "tmp", `${randomUUID()}.${ext}`); };

export const isWav = (b: Uint8Array) => b.length >= 44 && Buffer.from(b.subarray(0, 4)).toString() === "RIFF" && Buffer.from(b.subarray(8, 12)).toString() === "WAVE";

/** Words from a WAV recording; markers such as [BLANK_AUDIO] are dropped. */
export function cleanTranscript(s: string): string {
  return s.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}

/** Words from a WAV. `live`: the recording so far, while the user still talks; null if speech is busy. */
export function transcribe(wav: Uint8Array, live = false): Promise<string | null> {
  if (live && speechBusy()) return Promise.resolve(null);
  return one(async () => {
    const f = tmp("wav");
    fs.writeFileSync(f, wav);
    try {
      const out = await run(BIN, ["-m", modelPath(), "-f", f, "-l", "en", "-nt", "-np", "-t", "4"], 120_000);
      return cleanTranscript(out);
    } finally { fs.rmSync(f, { force: true }); }
  });
}

// novelty voices make poor assistants
const NOVELTY = new Set(["Albert", "Bad News", "Bahh", "Bells", "Boing", "Bubbles", "Cellos", "Good News", "Jester", "Organ", "Superstar", "Trinoids", "Whisper", "Wobble", "Zarvox"]);

/** English voices from `say -v ?` lines such as "Eddy (English (UK)) en_GB    # Hello!". */
export function parseVoices(list: string): { id: string; name: string }[] {
  const seen = new Set<string>();
  return list.split("\n").flatMap((l) => {
    const m = /^(.+?)\s+(en_[A-Z]{2,3})\s+#/.exec(l);
    if (!m || NOVELTY.has(m[1]) || seen.has(m[1])) return [];
    seen.add(m[1]);
    return [{ id: m[1], name: m[1].replace(/ \((.+)\)$/, ", $1") }];
  });
}

let voiceList: { id: string; name: string }[] | null = null;
export async function voices(): Promise<{ id: string; name: string }[]> {
  voiceList ??= parseVoices(await run(SAY, ["-v", "?"], 15_000));
  return voiceList;
}

/** A WAV of `text` in `voice` (an id from voices(), else the computer's default voice). */
export function speak(text: string, voice?: string): Promise<Buffer> {
  return one(async () => {
    const known = voice && (await voices()).some((v) => v.id === voice);
    const [txt, wav] = [tmp("txt"), tmp("wav")];
    fs.writeFileSync(txt, text);
    try {
      await run(SAY, [...(known ? ["-v", voice!] : []), "-f", txt, "-o", wav, "--data-format=LEI16@22050"], 60_000);
      return fs.readFileSync(wav);
    } finally { fs.rmSync(txt, { force: true }); fs.rmSync(wav, { force: true }); }
  });
}
