// Speech on this computer: the recording goes to the local speech service as a 16 kHz mono WAV, and
// the speech model is fetched once, with progress, before the first recording.

/** 16-bit PCM WAV of mono samples. */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const b = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); b.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, rate, true); b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true);
  str(36, "data"); b.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const v = Math.max(-1, Math.min(1, samples[i])); b.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return new Blob([b.buffer], { type: "audio/wav" });
}

/** Mono samples at `to` Hz from `from` Hz, each output the mean of the input span it covers. */
export function downsample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const r = from / to, out = new Float32Array(Math.floor(x.length / r));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * r), b = Math.max(a + 1, Math.floor((i + 1) * r));
    let s = 0;
    for (let j = a; j < b; j++) s += x[j];
    out[i] = s / (b - a);
  }
  return out;
}

/** The microphone as raw samples, so the recording so far can be read again while the user talks. */
export function tapPcm(ac: AudioContext, src: AudioNode) {
  const parts: Float32Array[] = [];
  let n = 0;
  const node = ac.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (e) => { const c = new Float32Array(e.inputBuffer.getChannelData(0)); parts.push(c); n += c.length; };
  src.connect(node);
  node.connect(ac.destination); // silent: the output buffer stays zero, but the node only runs when connected
  return {
    seconds: () => n / ac.sampleRate,
    /** The last `sec` seconds (all by default) as a 16 kHz WAV. */
    wav(sec = Infinity): Blob {
      const want = Math.min(n, Math.round(sec * ac.sampleRate)), all = new Float32Array(want);
      let at = want;
      for (let i = parts.length - 1; i >= 0 && at > 0; i--) {
        const p = parts[i], k = Math.min(p.length, at);
        all.set(p.subarray(p.length - k), at - k);
        at -= k;
      }
      return encodeWav(downsample(all, ac.sampleRate, 16000), 16000);
    },
    stop() { node.onaudioprocess = null; node.disconnect(); },
  };
}
export type Pcm = ReturnType<typeof tapPcm>;

/** Whatever the browser recorded (webm, mp4), as the WAV speech recognition reads. */
export async function toWav(blob: Blob): Promise<Blob> {
  const ac = new AudioContext();
  try {
    const src = await ac.decodeAudioData(await blob.arrayBuffer());
    const rate = 16000, off = new OfflineAudioContext(1, Math.max(1, Math.ceil(src.duration * rate)), rate);
    const node = off.createBufferSource();
    node.buffer = src; node.connect(off.destination); node.start();
    return encodeWav((await off.startRendering()).getChannelData(0), rate);
  } finally { void ac.close(); }
}

type Prep = { state: "missing" | "fetching" | "ready" | "failed"; done: number; total: number; error?: string };
const get = async (op: "status" | "prepare"): Promise<Prep> => {
  const r = await fetch(`/api/v1/voice/${op}`, op === "prepare" ? { method: "POST", headers: { "content-type": "application/json" }, body: "{}" } : {});
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
  return d as Prep;
};

/** Resolves once speech is ready, fetching the model the first time; `say` shows progress. */
export async function speechReady(say: (msg: string) => void): Promise<void> {
  let s = await get("status");
  if (s.state === "ready") return;
  s = await get("prepare");
  while (s.state === "fetching") {
    const mb = (n: number) => Math.round(n / 1e6);
    say(`Getting speech ready on this computer, once: ${mb(s.done)} of ${mb(s.total)} MB`);
    await new Promise((ok) => setTimeout(ok, 500));
    s = await get("status");
  }
  if (s.state !== "ready") throw new Error(s.error ?? "speech did not get ready");
}
