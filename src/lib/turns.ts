import { randomUUID } from "node:crypto";
import { visible } from "./stream-guard";

// A chat turn that keeps running when the person's connection drops. They reconnect with its id
// and get what is written so far, then the rest.
export type TurnEvent = { reset: string } | { done: { status: number; body: unknown } };
// key: the client's id for the question, so the same question sent again joins this turn
// left: called when the last person following it goes before it is done
type Turn = { who: string; key: string; wait?: string; raw: string; shown: string; done?: { status: number; body: unknown }; subs: Set<(e: TurnEvent) => void>; at: number; timer?: ReturnType<typeof setTimeout>; left?: () => void };

const TURNS = new Map<string, Turn>();
const KEEP_MS = 10 * 60_000;
const MAX = 200;

const RUNNING_EACH = 3;

function sweep(): void {
  const now = Date.now();
  for (const [id, t] of TURNS) if (t.done && now - t.at > KEEP_MS) TURNS.delete(id);
  for (const [id, t] of TURNS) { if (TURNS.size < MAX) break; if (t.done) TURNS.delete(id); }
}

export function canStart(who: string): boolean {
  sweep();
  let mine = 0;
  for (const t of TURNS.values()) if (!t.done && t.who === who) mine++;
  return mine < RUNNING_EACH && TURNS.size < MAX;
}

// The turn this person's question `key` already started, unless that one failed: a question sent
// again because its first request got no answer must not ask the model twice.
export function rejoin(who: string, key: string): string | null {
  if (!key) return null;
  for (const [id, t] of TURNS) if (t.who === who && t.key === key && !(t.done && t.done.status >= 400)) return id;
  return null;
}

export function startTurn(who: string, run: (onText: (d: string) => void, restart: () => void) => Promise<{ status: number; body: unknown }>,
  opts: { id?: string; key?: string; left?: () => void; wait?: string } = {}): string {
  const id = opts.id ?? randomUUID();
  const t: Turn = { who, key: opts.key ?? "", wait: opts.wait, raw: "", shown: "", subs: new Set(), at: Date.now(), left: opts.left };
  TURNS.set(id, t);
  const emit = (e: TurnEvent) => { for (const s of t.subs) s(e); };
  const flush = () => {
    t.timer = undefined;
    const next = visible(t.raw);
    if (next !== t.shown) { t.shown = next; emit({ reset: next }); }
  };
  const onText = (d: string) => {
    if (t.done || t.raw.length > 400_000) return;
    t.raw += d;
    t.timer ??= setTimeout(flush, 60);
  };
  const restart = () => { t.raw = ""; t.timer ??= setTimeout(flush, 0); };
  run(onText, restart)
    .catch((e) => { console.warn("[nexy] a streamed turn failed", (e as Error).message); return { status: 502, body: { error: "the model on this machine did not answer" } }; })
    .then((done) => {
      clearTimeout(t.timer);
      t.done = done; t.at = Date.now();
      emit({ done });
      t.subs.clear();
    });
  return id;
}

// null: no such turn for this person (expired, another person's, or the server restarted)
export function follow(id: string, who: string, on: (e: TurnEvent) => void): (() => void) | null {
  const t = TURNS.get(id);
  if (!t || t.who !== who) return null;
  if (t.shown) on({ reset: t.shown });
  if (t.done) { on({ done: t.done }); return () => {}; }
  t.subs.add(on);
  return () => t.subs.delete(on);
}

export function sse(id: string, who: string): Response | null {
  const t = TURNS.get(id);
  if (t?.who !== who) return null;
  let stop: (() => void) | null = null, ping: ReturnType<typeof setInterval> | undefined;
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const send = (s: string) => { try { c.enqueue(enc.encode(s)); } catch { end(); } };
      const end = () => { stop?.(); clearInterval(ping); try { c.close(); } catch { /* already closed */ } };
      send(`event: turn\ndata: ${JSON.stringify({ id, ...(t.wait ? { wait: t.wait } : {}) })}\n\n`);
      ping = setInterval(() => send(": ping\n\n"), 15_000);
      stop = follow(id, who, (e) => {
        if ("reset" in e) send(`event: text\ndata: ${JSON.stringify({ text: e.reset })}\n\n`);
        else { send(`event: done\ndata: ${JSON.stringify(e.done)}\n\n`); end(); }
      });
    },
    cancel() {
      stop?.(); clearInterval(ping);
      if (!t.done && t.subs.size === 0) t.left?.();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
