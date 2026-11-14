// Websites, apps and games built on this computer: the engine's builder pack writes ONE
// self-contained HTML file, checked here before anyone sees it. One attempt per job; the
// browser runs the page in a sandbox and decides whether to try once more.
import { randomUUID } from "node:crypto";
import { AGENT_KEY } from "./engine/key.ts";

const AGENT = (process.env.NEXY_AGENT_URL ?? "").replace(/\/+$/, "");
const KEY = AGENT_KEY;
const COMPUTER = process.env.NEXY_STUDIOS === "off";
const BOT = "builder";
const TURN_MS = 1000_000; // the pack stops itself at 900 s
const MAX_PAGE = 1_500_000;

const auth = (user: string): Record<string, string> => ({
  "content-type": "application/json", "x-nexy-user": user, ...(KEY ? { authorization: `Bearer ${KEY}` } : {}),
});

// ---- is the builder here: a computer whose engine has the builder pack

let known: { ok: boolean; at: number } | null = null;
export async function builderAvailable(): Promise<boolean> {
  if (!COMPUTER || !AGENT) return false;
  if (known && (known.ok || Date.now() - known.at < 20_000)) return known.ok;
  let ok = false;
  try {
    const r = await fetch(`${AGENT}/health`, { headers: auth("nexy"), signal: AbortSignal.timeout(1500) });
    const j: any = r.ok ? await r.json() : {};
    ok = Array.isArray(j?.bots) && j.bots.includes(BOT);
  } catch (e) {
    console.warn(`[nexy] builder check: ${(e as Error).message}`);
  }
  known = { ok, at: Date.now() };
  return ok;
}

// ---- what the brief asks for

const decode = (s: string) => s
  .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;|&#0*38;|&#x0*26;/gi, "&")
  .replace(/&rsquo;|&lsquo;|&#0*39;|&#x0*27;|&apos;/gi, "'").replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const flat = (s: string) => decode(s).toLowerCase().replace(/\s+/g, " ");

const CAP = String.raw`(?:[A-Z0-9][\w'’.!-]*|&)`;
const JOIN = String.raw`(?:&|and|of|the|de|la|le|du|on|at)`;
const NAMED = new RegExp(String.raw`\b(?:called|named|titled|name it|branded as|brand name)\s+["“']?(${CAP}(?:\s+(?:${CAP}|${JOIN}))*)`, "g");
const TAIL = new RegExp(String.raw`(?:\s+${JOIN})+$|[.,!?;:'’]+$`);

// names the page must carry: "a flower shop called Petal & Stem" → ["Petal & Stem"]
export function names(brief: string): string[] {
  const out = new Set<string>();
  for (const m of brief.matchAll(NAMED)) {
    let n = m[1];
    for (let prev = ""; prev !== n;) { prev = n; n = n.replace(TAIL, ""); }
    if (n.length >= 2) out.add(n);
  }
  for (const m of brief.matchAll(/["“]([^"”\n]{2,60})["”]/g)) out.add(m[1].trim());
  return [...out];
}

const STOP = new Set(("build make create code write design give want need please nexy can could would will you me my our for the and with that this " +
  "website site web page landing app application game simple small single file html one called named titled using about some " +
  "business company shop store two three four five six new nice good great modern clean beautiful little quick just like where which when what has have " +
  "into from their them they there its it's let lets also very really full fully working").split(" "));

// the subject: at least one of these must be in the page ("flower", "shop" for a flower shop)
export function topicWords(brief: string): string[] {
  const named = new Set(names(brief).flatMap((n) => n.toLowerCase().split(/\s+/)));
  const words = (brief.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).map((w) => w.replace(/'s$/, ""))
    .filter((w) => !STOP.has(w) && !named.has(w));
  return [...new Set(words)];
}

// external loads: the page must work with nothing outside it
const OUTSIDE = /<(?:script|img|link|iframe|audio|video|source|embed|object)\b[^>]*?\s(?:src|href|data)\s*=\s*["']?(?!data:|blob:|#|javascript:)([^"'\s>]+)|url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)|@import\s+(?:url\()?["']?([^"');\s]+)/i;

// why the page cannot be shown, or "" when it can
export function checkPage(html: string, brief: string): string {
  if (html.length < 200 || !/<(?:body|div|main|section|canvas|svg|h1)\b/i.test(html)) return "it wrote no page";
  if (html.length > MAX_PAGE) return "the page is too large";
  const out = OUTSIDE.exec(html);
  if (out) return `it loads something from outside the page (${(out[1] ?? out[2] ?? out[3]).slice(0, 60)})`;
  const text = flat(html.replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
  const n = names(brief);
  for (const x of n) if (!text.includes(flat(x))) return `it left out the name "${x}"`;
  // with no name to look for, the subject: one of its words in the page
  const topic = n.length ? [] : topicWords(brief);
  const squashed = text.replace(/[^a-z0-9]/g, "");
  if (topic.length && !topic.some((w) => squashed.includes(w.replace(/[^a-z0-9]/g, "").slice(0, 4))))
    return `it is not about ${topic.slice(0, 3).join(" ")}`;
  return "";
}

// nothing the page asks for can load: the browser enforces what the check above reads
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; worker-src blob:">`;
// first, so the page's own rules win: width:100% plus padding no longer spills off the side
const BASE = "<style>*,::before,::after{box-sizing:border-box}</style>";
export function offline(html: string): string {
  const m = /<head[^>]*>/i.exec(html) ?? /<html[^>]*>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
  return m ? html.slice(0, m.index + m[0].length) + CSP + BASE + html.slice(m.index + m[0].length) : CSP + BASE + html;
}

// "a ping pong ball business" is a shop, not a game
const GAME = /\b(?:game|(?<!ping[\s-])pong|snake|tetris|breakout|asteroids|platformer|arcade|flappy)\b/i;
export function promptFor(brief: string, fix = ""): string {
  const n = names(brief);
  return [
    brief.trim().replace(/[.!?]*$/, "."),
    `Make it about exactly this${n.length ? `, with ${n.map((x) => `"${x}"`).join(" and ")} written as given` : ""}: real content for it, no placeholder companies, people, testimonials or lorem ipsum.`,
    "Give it what a real one has, filled in, and keep the layout simple and responsive so no text overlaps.",
    // no invented addresses or history
    "Use only facts the brief gives. Never invent an address, phone number, email, opening hours, prices, years in business, awards, reviews or claims; where a real one would show them, write a plain placeholder such as [Your address] or [Year founded].",
    ...(GAME.test(brief) ? ["Draw the start screen right away and show which keys to press."] : []),
    ...(fix ? [`Your last version did not pass a check: ${fix}. Fix that this time.`] : []),
    "Save it as index.html.",
  ].join("\n");
}

// the page the model saved: the last .html it wrote, or a whole page in its reply
export function pageFrom(messages: any[], reply: string): string {
  for (const m of [...messages].reverse()) {
    if (m?.role !== "tool" || m?.tool_name !== "write_file") continue;
    let rec: any;
    try { rec = JSON.parse(String(m.content)); } catch { continue; } // not a tool receipt
    const p = String(rec?.args?.path ?? ""), c = rec?.args?.content;
    if (/\.html?$/i.test(p) && typeof c === "string" && /^wrote /.test(String(rec?.result ?? ""))) return c;
  }
  const fenced = /```(?:html)?\s*\n([\s\S]*?<\/html>)\s*```/i.exec(reply)?.[1];
  return fenced ?? (/<!doctype html[\s\S]*<\/html>/i.exec(reply)?.[0] ?? "");
}

// ---- one engine turn, streamed

async function turn(prompt: string, user: string, session: string, onTool: (name: string) => void): Promise<string> {
  const res = await fetch(`${AGENT}/p/${BOT}/v1/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(TURN_MS),
    headers: { ...auth(user), "x-session-id": session },
    body: JSON.stringify({ model: BOT, stream: true, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok || !res.body) throw new Error(`the engine answered ${res.status}`);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", reply = "", last: any = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      const tool = /^: tool (\w+)/.exec(line)?.[1];
      if (tool) { onTool(tool); continue; }
      if (!line.startsWith("data:") || line === "data: [DONE]") continue;
      let c: any;
      try { c = JSON.parse(line.slice(5)); } catch { continue; } // a cut line; the final chunk decides
      const d = c?.choices?.[0]?.delta?.content;
      if (typeof d === "string") reply += d;
      if (c?.choices?.[0]?.finish_reason) last = c;
    }
  }
  if (last?.choices?.[0]?.finish_reason === "error") throw new Error(String(last?.nexy?.error ?? "the model stopped").slice(0, 200));
  return reply;
}

async function messages(user: string, session: string): Promise<any[]> {
  const r = await fetch(`${AGENT}/p/${BOT}/api/sessions/${encodeURIComponent(session)}/messages?limit=500`,
    { headers: auth(user), signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`the engine kept no record of the build (${r.status})`);
  return ((await r.json()) as any)?.data ?? [];
}

// ---- jobs: each keeps its events so a dropped connection picks up where it left off

export type BuildEvent =
  | { type: "step"; text: string }
  | { type: "done"; html: string; title: string; secs: number }
  | { type: "failed"; error: string; check: boolean; secs: number };

interface Job { who: string; events: BuildEvent[]; subs: Set<(e: BuildEvent) => void>; done: boolean; at: number }
const JOBS = new Map<string, Job>();
const KEEP_MS = 30 * 60_000;

export function busy(): boolean {
  for (const [id, j] of JOBS) if (j.done && Date.now() - j.at > KEEP_MS) JOBS.delete(id);
  return [...JOBS.values()].some((j) => !j.done);
}

export function start(who: string, brief: string, fix = ""): string {
  const id = randomUUID();
  const job: Job = { who, events: [], subs: new Set(), done: false, at: Date.now() };
  JOBS.set(id, job);
  const emit = (e: BuildEvent) => {
    job.events.push(e);
    if (e.type !== "step") { job.done = true; job.at = Date.now(); }
    for (const s of job.subs) s(e);
  };
  void run(id, brief, fix, emit);
  return id;
}

async function run(id: string, brief: string, fix: string, emit: (e: BuildEvent) => void): Promise<void> {
  const t0 = Date.now(), secs = () => Math.round((Date.now() - t0) / 1000);
  const user = `build-${id.slice(0, 8)}`, session = `build-${id}`;
  emit({ type: "step", text: "Writing it on this computer" });
  let html = "";
  try {
    const reply = await turn(promptFor(brief, fix), user, session, (t) => {
      if (t === "write_file") emit({ type: "step", text: "Saving the page" });
    });
    html = pageFrom(await messages(user, session), reply);
  } catch (e) {
    console.warn(`[nexy] local build ${id}: ${(e as Error).message}`);
    return emit({ type: "failed", error: (e as Error).message, check: false, secs: secs() });
  }
  emit({ type: "step", text: "Checking it" });
  const why = checkPage(html, brief);
  if (why) return emit({ type: "failed", error: why, check: true, secs: secs() });
  const title = decode(/<title[^>]*>([^<]{1,80})<\/title>/i.exec(html)?.[1] ?? "").trim();
  emit({ type: "done", html: offline(html), title, secs: secs() });
}

export function stream(id: string, who: string): Response | null {
  const job = JOBS.get(id);
  if (!job || job.who !== who) return null;
  const enc = new TextEncoder();
  let off = () => {}, ping: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const end = () => { off(); clearInterval(ping); try { c.close(); } catch { /* already closed */ } };
      const send = (e: BuildEvent) => {
        try { c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { return end(); }
        if (e.type !== "step") end();
      };
      for (const e of job.events) send(e);
      if (job.done) return end();
      job.subs.add(send);
      off = () => job.subs.delete(send);
      ping = setInterval(() => { try { c.enqueue(enc.encode(": ping\n\n")); } catch { end(); } }, 15_000);
    },
    cancel() { off(); clearInterval(ping); },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
