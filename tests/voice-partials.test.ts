// Live words while holding to talk: the scheduler that re-reads the recording so far.
// node --experimental-strip-types --test tests/voice-partials.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { partialScheduler } from "../src/client/voice-partials.ts";
import { downsample } from "../src/client/voice-local.ts";

// a hand-driven clock and interval
function clock() {
  let t = 0, f: (() => void) | null = null;
  return {
    now: () => t,
    timer: { set: (g: () => void) => { f = g; return 1; }, clear: () => { f = null; } },
    tick(ms: number) { t += ms; f?.(); },
    advance(ms: number) { t += ms; },
    get running() { return f !== null; },
  };
}
const flush = () => new Promise((r) => setImmediate(r));
function deferred<T>() { let ok!: (v: T) => void, bad!: (e: unknown) => void; const p = new Promise<T>((a, b) => { ok = a; bad = b; }); return { p, ok, bad }; }

test("one read at a time: ticks while a read runs are skipped, never queued", async () => {
  const c = clock(), jobs: ReturnType<typeof deferred<string | null>>[] = [], shown: string[] = [];
  let inFlight = 0, most = 0;
  const s = partialScheduler({ every: 1000, now: c.now, timer: c.timer, onText: (t) => shown.push(t),
    job: () => { inFlight++; most = Math.max(most, inFlight); const d = deferred<string | null>(); jobs.push(d); return d.p.finally(() => { inFlight--; }); } });
  c.tick(1000); c.tick(1000); c.tick(1000);
  assert.equal(jobs.length, 1, "the second and third ticks found a read running");
  jobs[0].ok("I run a");
  await flush();
  c.tick(1000);
  assert.equal(jobs.length, 2);
  jobs[1].ok("I run a sari sari");
  await flush();
  assert.equal(most, 1);
  assert.deepEqual(shown, ["I run a", "I run a sari sari"]);
  assert.deepEqual({ ...s.stats(), ms: undefined }, { runs: 2, skips: 2, slow: false, ms: undefined });
  s.stop();
});

test("null shows nothing new; a failed read is skipped; nothing shows after stop", async () => {
  const c = clock(), shown: string[] = [];
  const answers: (() => Promise<string | null>)[] = [() => Promise.resolve(null), () => Promise.reject(new Error("busy")), () => Promise.resolve("late")];
  const late = deferred<string | null>();
  answers[2] = () => late.p;
  let i = 0;
  const warn = console.warn; console.warn = () => {};
  try {
    const s = partialScheduler({ every: 1000, now: c.now, timer: c.timer, onText: (t) => shown.push(t), job: () => answers[i++]() });
    c.tick(1000); await flush();
    c.tick(1000); await flush();
    c.tick(1000);
    s.stop();
    assert.equal(c.running, false, "the interval is cleared");
    late.ok("words after letting go");
    await flush();
    assert.deepEqual(shown, [], "null, a failure and a read finishing after stop show nothing");
  } finally { console.warn = warn; }
});

test("a computer too slow for live words: two slow reads in a row stop them", async () => {
  const c = clock();
  let slow = 0, pending: ((v: string) => void) | null = null;
  const s = partialScheduler({ every: 1000, slowMs: 3000, now: c.now, timer: c.timer, onText: () => {}, onSlow: () => slow++,
    job: () => new Promise<string | null>((ok) => { pending = ok; }) });
  const read = async (ms: number) => { c.tick(1000); c.advance(ms); pending!("x"); await flush(); };
  await read(4000);
  await read(500);
  await read(4000);
  assert.equal(s.stats().slow, false, "slow reads not in a row are not enough");
  await read(4000);
  assert.equal(s.stats().slow, true);
  assert.equal(slow, 1);
  assert.equal(c.running, false, "stopped");
});

test("the microphone's 48 kHz becomes the 16 kHz speech recognition reads", () => {
  const x = new Float32Array(48).map((_, i) => (i % 3 === 0 ? 0.3 : i % 3 === 1 ? 0.6 : 0.9));
  const y = downsample(x, 48000, 16000);
  assert.equal(y.length, 16);
  for (const v of y) assert.ok(Math.abs(v - 0.6) < 1e-6);
  assert.equal(downsample(new Float32Array(441), 44100, 16000).length, 160);
  const same = new Float32Array([1, 2]);
  assert.equal(downsample(same, 16000, 16000), same);
});
