// Running swarm builds: each keeps its events so a dropped connection can pick up where it left off.
import { randomUUID } from "node:crypto";
import { run, type Deps, type Event, type Worker } from "./swarm.ts";

interface Run { who: string; events: Event[]; subs: Set<(e: Event) => void>; done: boolean; html?: string; at: number }
const RUNS = new Map<string, Run>();
const KEEP_MS = 2 * 3600_000, MAX = 50;

function sweep() {
  for (const [id, r] of RUNS) if (r.done && Date.now() - r.at > KEEP_MS) RUNS.delete(id);
}

export function busy(who: string): boolean {
  sweep();
  return [...RUNS.values()].some(r => r.who === who && !r.done) || RUNS.size >= MAX;
}

export function start(who: string, prompt: string, deps: Deps): string {
  const id = randomUUID();
  const r: Run = { who, events: [], subs: new Set(), done: false, at: Date.now() };
  RUNS.set(id, r);
  const emit = (e: Event) => {
    r.events.push(e.type === "done" ? { ...e, html: "" } : e); // the page itself is fetched separately
    if (e.type === "done") r.html = e.html;
    if (e.type === "done" || e.type === "failed") { r.done = true; r.at = Date.now(); }
    for (const s of r.subs) s(e.type === "done" ? { ...e, html: "" } : e);
  };
  run(prompt, deps, emit).catch(() => { /* already sent as a "failed" event */ });
  return id;
}

export function page(id: string, who: string): string | undefined {
  const r = RUNS.get(id);
  return r?.who === who ? r.html : undefined;
}

export function sse(id: string, who: string): Response | null {
  const r = RUNS.get(id);
  if (!r || r.who !== who) return null;
  const enc = new TextEncoder();
  let off = () => {}, ping: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const send = (e: Event) => {
        try { c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { end(); return; }
        if (e.type === "done" || e.type === "failed") end();
      };
      const end = () => { off(); clearInterval(ping); try { c.close(); } catch { /* closed */ } };
      for (const e of r.events) send(e);
      if (r.done) return end();
      r.subs.add(send);
      off = () => r.subs.delete(send);
      ping = setInterval(() => { try { c.enqueue(enc.encode(": ping\n\n")); } catch { end(); } }, 15_000);
    },
    cancel() { off(); clearInterval(ping); },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

/** Model calls go through the Own1's job routing (a loopback address on the box), so devices can take them. */
export function boxDeps(env = process.env): Deps | null {
  const base = env.NEXY_INFER_URL?.replace(/\/$/, "");
  if (!base) return null;
  const auth: Record<string, string> = {};
  const h = env.NEXY_INFER_AUTH; // "Header-Name: value", given by the box
  if (h?.includes(":")) auth[h.slice(0, h.indexOf(":")).trim()] = h.slice(h.indexOf(":") + 1).trim();
  const post = async (path: string, body: object, route: string, ms: number) => {
    const res = await fetch(`${base}${path}`, {
      method: "POST", headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ ...body, route }), signal: AbortSignal.timeout(ms),
    });
    if (!res.ok) throw new Error(`${res.status === 429 ? "busy" : res.status === 503 ? "device didn't pick it up" : "answered " + res.status}`);
    return { json: await res.json(), ranOn: res.headers.get("x-ran-on") ?? "box" };
  };
  return {
    async chat(body, route) {
      const { json, ranOn } = await post("/v1/chat/completions", { ...body, stream: false }, route, 300_000);
      return { text: String(json?.choices?.[0]?.message?.content ?? ""), ranOn };
    },
    async image(body, route) {
      const { json, ranOn } = await post("/v1/images/generations", { ...body, response_format: "b64_json" }, route, 200_000);
      const b64 = String(json?.data?.[0]?.b64_json ?? "");
      if (!b64) throw new Error("no image came back");
      const mime = b64.startsWith("UklGR") ? "image/webp" : b64.startsWith("/9j/") ? "image/jpeg" : "image/png";
      return { b64, mime, ranOn };
    },
    async workers() {
      const res = await fetch(`${base}/v1/workers`, { headers: auth, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      const j = await res.json();
      return (Array.isArray(j?.devices) ? j.devices : []) as Worker[];
    },
  };
}
