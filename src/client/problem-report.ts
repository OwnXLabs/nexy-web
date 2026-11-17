import { here } from "./place";
// "Report a problem": the tester's comments, up to five screenshots, and what the page was doing
// (recent errors, failed requests, the app's own state). Saved on this machine. A beta build can
// also send it to the Nexy team, only on the Send click, after showing exactly what goes: each
// part is a switch, and the preview is the body that is posted.
import { bareUrl, scrub, scrubLog } from "../lib/scrub";
import { httpMsg } from "./http";

export interface ReporterOptions {
  endpoint: string;                 // POST target on this app's own server
  app: string;                      // "nexy" | "desktop"
  version?: string;
  snapshot?: () => unknown;         // the app's state, sent only if the person keeps it on
  blocked?: () => string | null;    // a reason reports are off right now (ultra-private chat)
  team?: string;                    // beta builds: this app's route that forwards to the Nexy team
  conversation?: () => Turn[];      // the open chat; sent to the team only if switched on
}
type Turn = { role: string; text: string };
// "Report this chat": that thread only, with This conversation switched on
export interface ReportThread { title: string; turns: Turn[] }

type Hw = Record<string, unknown>;
type TeamCtx = { ready: boolean; version: string; os: string; logs: string; hardware?: Hw };

// the report server's limits (nexy-cloud update/beta_reports.py): a 2 MB body, one PNG or JPEG
// screenshot of up to 1.5 MB, the last 200 log lines, 20 messages of 2,000 characters
export const MAX_BODY = 2 * 1024 * 1024;
const ROOM = MAX_BODY - 16 * 1024;
export const MAX_SHOTS = 5;
const SHOT_BYTES = 1_200_000;      // the combined image, decoded; leaves room for the rest of the body
const LOG_LINES = 200, LOG_CHARS = 100_000, TURNS = 20, TURN_CHARS = 2000, TEXT_CHARS = 5000;
const MAX_W = 1600;

const bytesOf = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const utf8 = (s: string) => new TextEncoder().encode(s).length;
let shotCount = 0; // how many screenshots the one image holds, for the preview line
// the preview shows the screenshot as a line, not its bytes; everything else exactly as sent
export const previewOf = (body: Record<string, unknown>): string =>
  JSON.stringify({ ...body, ...(typeof body.screenshot === "string" ? { screenshot: shotCount > 1
    ? `[${shotCount} screenshots in one image, ${kb(bytesOf(body.screenshot))}]` : `[screenshot, ${kb(bytesOf(body.screenshot))}]` } : {}) }, null, 2);

type Err = { at: number; msg: string };
type Req = { at: number; method: string; url: string; status: number; ms: number };
const errors: Err[] = [], requests: Req[] = [];
const keep = <T>(list: T[], item: T, max = 30) => { list.push(item); if (list.length > max) list.shift(); };

// this device's choices: kept only when "Remember my choices" is ticked; the conversation never is
const DEFAULTS = "nexy.report.defaults.v1", DRAFT = "nexy.report.draft.v1";
export type ReportDefaults = { state: boolean; logs: boolean; hardware: boolean };
export function reportDefaults(): ReportDefaults & { saved: boolean } {
  try {
    const j = JSON.parse(localStorage.getItem(DEFAULTS) || "null");
    if (j && typeof j === "object") return { state: j.state !== false, logs: j.logs !== false, hardware: j.hardware !== false, saved: true };
  } catch (e) { console.warn("report: saved choices unreadable", e); }
  return { state: true, logs: true, hardware: true, saved: false };
}
export function setReportDefaults(d: ReportDefaults | null): void {
  try {
    if (d) localStorage.setItem(DEFAULTS, JSON.stringify({ state: !!d.state, logs: !!d.logs, hardware: !!d.hardware }));
    else localStorage.removeItem(DEFAULTS);
  } catch (e) { console.warn("report: choices not kept", e); }
}
const draft = {
  get(): { text: string; kind: string } {
    try { const j = JSON.parse(localStorage.getItem(DRAFT) || "null"); if (j && typeof j.text === "string") return { text: j.text, kind: String(j.kind || "bug") }; }
    catch (e) { console.warn("report: draft unreadable", e); }
    return { text: "", kind: "bug" };
  },
  set(text: string, kind: string): void {
    try { if (text.trim()) localStorage.setItem(DRAFT, JSON.stringify({ text: text.slice(0, TEXT_CHARS * 2), kind })); else localStorage.removeItem(DRAFT); }
    catch (e) { console.warn("report: draft not kept", e); }
  },
};

let opts: ReporterOptions | null = null;

// start recording errors and failed requests; call once, as early as possible
export function installReporter(o: ReporterOptions): void {
  if (opts) return;
  opts = o;
  addEventListener("error", (e) => keep(errors, { at: Date.now(), msg: String(e.message || e.error).slice(0, 300) }));
  addEventListener("unhandledrejection", (e) => keep(errors, { at: Date.now(), msg: `unhandled: ${String((e.reason as Error)?.message ?? e.reason).slice(0, 300)}` }));
  const cerr = console.error.bind(console);
  console.error = (...a: unknown[]) => { keep(errors, { at: Date.now(), msg: a.map(String).join(" ").slice(0, 300) }); cerr(...a); };
  const f = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const t = performance.now(), method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = String(input instanceof Request ? input.url : input).replace(location.origin, "").slice(0, 200);
    try {
      const r = await f(input, init);
      if (r.status >= 400 && !url.startsWith(o.endpoint) && !(o.team && url.startsWith(o.team))) keep(requests, { at: Date.now(), method, url, status: r.status, ms: Math.round(performance.now() - t) });
      return r;
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") keep(requests, { at: Date.now(), method, url, status: 0, ms: Math.round(performance.now() - t) });
      throw e;
    }
  };
}

// What the Hardware switch adds, as lines at the top of the logs (the report server keeps only
// known fields; logs is one). From the desktop app when it measured this computer, else only
// what the browser plainly says. Never a serial number, host or user name, path or address.
export function hardwareLines(h: Hw | undefined): string[] {
  const out: string[] = [];
  const s = (k: string) => (typeof h?.[k] === "string" ? String(h[k]) : "");
  const n = (k: string) => (typeof h?.[k] === "number" ? Number(h[k]) : null);
  if (s("cpu")) {
    out.push("== hardware");
    if (s("os")) out.push(`os: ${s("os")}${s("arch") ? ` (${s("arch")})` : ""}`);
    out.push(`cpu: ${s("cpu")}`);
    if (n("ram_gb")) out.push(`ram: ${n("ram_gb")} GB`);
    if (s("gpu")) out.push(`gpu: ${s("gpu")}${n("gpu_cores") ? `, ${n("gpu_cores")} cores` : ""}${n("vram_gb") ? `, ${n("vram_gb")} GB graphics memory` : ", no graphics memory of its own"}`);
    if (n("free_disk_gb") !== null) out.push(`free disk: ${n("free_disk_gb")} GB`);
  } else {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string }; deviceMemory?: number };
    out.push("== hardware (what this browser reports)");
    const plat = nav.userAgentData?.platform || nav.platform;
    if (plat) out.push(`platform: ${plat}`);
    if (nav.hardwareConcurrency) out.push(`cpu threads: ${nav.hardwareConcurrency}`);
    if (nav.deviceMemory) out.push(`ram: at least ${nav.deviceMemory} GB`);
  }
  if (s("tier")) out.push(`nexy tier: ${s("tier")}`);
  if (s("model")) out.push(`model: ${s("model")}, ${h!.tested ? "tested by Nexy" : "not tested by Nexy"}${s("class") ? ` (${s("class")})` : ""}`);
  return out.map((l) => scrubLog(l).slice(0, 200));
}

// one frame of this tab via the browser's screen-capture prompt (it also sees app windows
// the page itself cannot draw); null when the browser has no screen capture, as on phones
async function captureTab(): Promise<string | null> {
  const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (c: unknown) => Promise<MediaStream> };
  if (!md?.getDisplayMedia) return null;
  const stream = await md.getDisplayMedia({ video: { displaySurface: "browser" }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" });
  try {
    const v = document.createElement("video");
    v.srcObject = stream; v.muted = true;
    await v.play();
    await new Promise((r) => setTimeout(r, 250));
    return toJpeg(v, v.videoWidth, v.videoHeight);
  } finally { stream.getTracks().forEach((t) => t.stop()); }
}

function toJpeg(src: CanvasImageSource, w: number, h: number, maxW = MAX_W, q = 0.75): string {
  const k = Math.min(1, maxW / w), c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q);
}

const loadImg = (src: string) => new Promise<HTMLImageElement>((ok, bad) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = () => bad(new Error("that file is not an image"));
  img.src = src;
});

// a picked, pasted or dropped image, made smaller and compressed here, on the device
async function fromFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try { const img = await loadImg(url); return toJpeg(img, img.naturalWidth, img.naturalHeight); }
  finally { URL.revokeObjectURL(url); }
}

// The report server keeps one image, so several screenshots go as one: stacked, then made smaller
// until it fits. One screenshot that already fits goes as it is.
export async function combineShots(shots: string[], budget = SHOT_BYTES): Promise<string> {
  if (shots.length === 1 && bytesOf(shots[0]) <= budget) return shots[0];
  const imgs = await Promise.all(shots.map(loadImg));
  const gap = imgs.length > 1 ? 12 : 0;
  let w = Math.min(imgs.length > 2 ? 1100 : 1400, Math.max(...imgs.map((i) => i.naturalWidth))), q = 0.8;
  for (;;) {
    const hs = imgs.map((i) => Math.max(1, Math.round((i.naturalHeight * w) / i.naturalWidth)));
    const total = hs.reduce((a, b) => a + b, 0) + gap * (imgs.length - 1);
    if (total > 12000) { w = Math.floor((w * 12000) / total); continue; }
    const c = document.createElement("canvas");
    c.width = w; c.height = total;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0b0b10"; g.fillRect(0, 0, w, total);
    let y = 0;
    imgs.forEach((img, k) => { g.drawImage(img, 0, y, w, hs[k]); y += hs[k] + gap; });
    const out = c.toDataURL("image/jpeg", q);
    if (bytesOf(out) <= budget || w <= 320) return out;
    if (q > 0.55) q -= 0.1; else w = Math.round(w * 0.8);
  }
}

const EMAIL = /^[^@\s<>"']{1,64}@[^@\s<>"']{1,190}\.[A-Za-z]{2,24}$/; // what the report server keeps

const STYLE = `
.prp-scrim{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.5);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px}
.prp{position:relative;width:min(580px,100%);max-height:calc(100vh - 32px);overflow:auto;overscroll-behavior:contain;background:var(--glass2,rgba(16,14,20,.94));-webkit-backdrop-filter:blur(30px) saturate(1.2);backdrop-filter:blur(30px) saturate(1.2);color:var(--fg,#fff);border:1px solid var(--line2,rgba(255,255,255,.18));border-radius:20px;padding:20px 20px 16px;font:13px/1.45 var(--font,system-ui,-apple-system,sans-serif);box-shadow:0 40px 100px rgba(0,0,0,.6)}
.prp.drop{border-color:#ffd666;box-shadow:0 0 0 3px rgba(255,214,102,.25),0 40px 100px rgba(0,0,0,.6)}
.prp *{box-sizing:border-box}
.prp h2{margin:0;font-size:17px;line-height:1.3;font-weight:600;letter-spacing:-.01em;padding-right:36px}
.prp p{margin:0}.prp .lede{color:var(--fg2,rgba(255,255,255,.72));margin:6px 0 16px}
.prp .x{position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:var(--fg3,rgba(255,255,255,.46));background:none;border:0;cursor:pointer}
.prp .x:hover{background:rgba(255,255,255,.1);color:#fff}
.prp .pill{display:inline-block;margin-bottom:10px;height:20px;padding:0 8px;border-radius:999px;border:1px solid rgba(255,214,102,.55);background:rgba(255,214,102,.12);color:#ffd666;font:600 10px/18px system-ui,sans-serif;letter-spacing:.1em}
.prp .card{border:1px solid var(--line,rgba(255,255,255,.1));border-radius:14px;background:rgba(255,255,255,.035);padding:12px;margin-bottom:12px}
.prp .lab{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 8px;font-weight:600;margin-bottom:6px}
.prp .lab label{white-space:nowrap}
.prp .lab small,.prp .d{font-weight:400;color:var(--fg3,rgba(255,255,255,.46));font-size:12px}
.prp textarea{width:100%;min-height:104px;resize:vertical;background:rgba(0,0,0,.28);color:inherit;border:1px solid var(--line2,rgba(255,255,255,.18));border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;line-height:1.45;display:block}
.prp textarea:focus,.prp input[type=email]:focus{outline:none;border-color:rgba(255,255,255,.5)}
.prp .kinds{display:flex;gap:6px;margin:10px 0 0;flex-wrap:wrap}
.prp button{font:inherit;color:inherit;cursor:pointer}
.prp .chip{height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--line2,rgba(255,255,255,.18));background:rgba(0,0,0,.25);font-size:12.5px}
.prp .chip[aria-pressed=true]{background:var(--frost,rgba(232,232,236,.9));color:var(--ink,#1D1C22);border-color:transparent;font-weight:500}
.prp .shots{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:stretch}
.prp .shots figure{margin:0;position:relative;width:104px;border-radius:10px;overflow:hidden;border:1px solid var(--line2,rgba(255,255,255,.18));background:#000}
.prp .shots img{display:block;width:100%;height:64px;object-fit:cover}
.prp .shots figcaption{display:flex;align-items:center;justify-content:space-between;gap:4px;padding:3px 4px 3px 7px;font-size:11px;color:var(--fg2,rgba(255,255,255,.72));background:rgba(16,14,20,.9)}
.prp .shots figcaption button{border:0;background:none;color:#f3a6a6;font-size:11px;padding:2px 4px;border-radius:6px}
.prp .shots figcaption button:hover{background:rgba(243,166,166,.14)}
.prp .addshot{min-height:86px;width:104px;border:1px dashed var(--line2,rgba(255,255,255,.18));border-radius:10px;background:none;color:var(--fg2,rgba(255,255,255,.72));font-size:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-align:center;padding:6px}
.prp .addshot[hidden]{display:none}
.prp .addshot:hover{border-color:rgba(255,255,255,.45);color:#fff}
.prp .hint{font-size:11.5px;color:var(--fg3,rgba(255,255,255,.46));margin-top:8px}
.prp .secs{border:1px solid var(--line,rgba(255,255,255,.1));border-radius:14px;overflow:hidden;margin-bottom:12px}
.prp .sec{display:flex;gap:12px;align-items:center;padding:11px 12px;cursor:pointer}
.prp .sec+.sec{border-top:1px solid var(--line,rgba(255,255,255,.1))}
.prp .sec>span{flex:1;min-width:0}.prp .sec b{display:block;font-weight:600}.prp .sec .d{display:block;margin-top:1px}
.prp input.sw{appearance:none;-webkit-appearance:none;flex:none;width:36px;height:20px;margin:0;border-radius:999px;border:1px solid var(--line2,rgba(255,255,255,.18));background:rgba(255,255,255,.08);position:relative;cursor:pointer;transition:background .15s}
.prp input.sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:rgba(255,255,255,.7);transition:left .15s,background .15s}
.prp input.sw:checked{background:var(--frost,rgba(232,232,236,.9));border-color:transparent}
.prp input.sw:checked::after{left:18px;background:var(--ink,#1D1C22)}
.prp input.sw:focus-visible{outline:1px solid rgba(255,255,255,.7);outline-offset:2px}
.prp input[type=email]{width:100%;background:rgba(0,0,0,.28);color:inherit;border:1px solid var(--line2,rgba(255,255,255,.18));border-radius:10px;padding:8px 12px;font:inherit}
.prp .what{margin:0;padding-left:18px;color:var(--fg2,rgba(255,255,255,.72));font-size:12.5px}
.prp .what li+li{margin-top:2px}.prp .what li.cut{color:#ffd666}
.prp details{margin-top:8px}.prp summary{cursor:pointer;color:var(--fg2,rgba(255,255,255,.72));font-size:12.5px}
.prp pre{max-height:220px;overflow:auto;background:rgba(0,0,0,.35);border-radius:10px;padding:10px;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;margin:8px 0 0}
.prp .fine{display:flex;gap:8px;align-items:flex-start;color:var(--fg3,rgba(255,255,255,.46));font-size:12px;margin:2px 2px 12px}
.prp .fine svg{width:14px;height:14px;flex:none;margin-top:1px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.prp .remember{display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--fg2,rgba(255,255,255,.72));cursor:pointer}
.prp .foot{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:4px}
.prp .btns{display:flex;gap:8px;margin-left:auto}
.prp .btn{height:34px;padding:0 14px;border-radius:999px;border:1px solid var(--line2,rgba(255,255,255,.18));background:rgba(0,0,0,.25);font-size:13px;white-space:nowrap;text-align:center}
.prp .btn:hover{background:rgba(255,255,255,.1)}
.prp .btn.go{background:var(--frost,rgba(232,232,236,.9));color:var(--ink,#1D1C22);border-color:transparent;font-weight:600}
.prp .btn.go:hover{background:#fff}.prp .btn:disabled{opacity:.5;cursor:default}
.prp .msg{color:#f3a6a6;font-size:12.5px;margin:0 2px 10px}
.prp .msg:empty{display:none}
.prp .ok{font-size:15px;margin-top:10px}.prp .ok b{font-family:ui-monospace,Menlo,monospace;letter-spacing:.04em}
@media (max-width:520px){
  .prp-scrim{padding:8px;align-items:flex-end}
  .prp{padding:16px 14px 12px;max-height:calc(100vh - 16px);border-radius:18px}
  .prp h2{font-size:16px}
  .prp .shots figure,.prp .addshot{width:calc(33.33% - 6px)}
  .prp .btns{width:100%;flex-direction:column-reverse;margin-left:0}
  .prp .btn{width:100%;height:40px}
}
`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const sec = (id: string, title: string, d: string, on: boolean) =>
  `<label class="sec" for="${id}"><span><b>${title}</b><span class="d" id="${id}D">${d}</span></span><input type="checkbox" class="sw" role="switch" id="${id}"${on ? " checked" : ""} aria-describedby="${id}D"></label>`;
const LOCK = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>`;
const X = `<button type="button" class="x" data-x aria-label="Close"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;

export function openReporter(thread?: ReportThread | null): void {
  if (!opts || document.querySelector(".prp-scrim")) return;
  const o = opts, beta = !!o.team;
  const th = thread && Array.isArray(thread.turns) && typeof thread.title === "string" ? thread : null; // not a click event
  if (!document.getElementById("prp-style")) { const s = document.createElement("style"); s.id = "prp-style"; s.textContent = STYLE; document.head.append(s); }
  const blocked = o.blocked?.();
  const def = reportDefaults(), saved = draft.get();
  const scrim = document.createElement("div");
  scrim.className = "prp-scrim";
  const convD = th
    ? `Only “${esc(th.title.slice(0, 60))}”: its last ${TURNS} messages, keys and tokens removed. No other chat.`
    : `Only the chat open now: its last ${TURNS} messages, keys and tokens removed. Never your other chats.`;
  scrim.innerHTML = `<div class="prp" role="dialog" aria-modal="true" aria-labelledby="prpT">${X}
    ${beta ? `<span class="pill">BETA</span><h2 id="prpT">Thanks for being part of the Nexy Beta Program!</h2>
    <p class="lede">To help us ship faster, please share the information below:</p>`
    : `<h2 id="prpT">Report a problem</h2><p class="lede">Saved on ${here} for its owner. It is never sent anywhere else.</p>`}
    ${blocked ? `<p>${esc(blocked)}</p><div class="foot"><div class="btns"><button type="button" class="btn" data-x>Close</button></div></div>` : `
    <div class="card">
      <div class="lab"><label for="prpText">Your comments</label><small>What happened${beta ? ", its kind and any screenshots" : ""}</small></div>
      <textarea id="prpText" placeholder="What happened, and what did you expect?" maxlength="${TEXT_CHARS * 2}"></textarea>
      <div class="kinds" role="group" aria-label="Kind"><button type="button" class="chip" data-k="bug">Something broke</button><button type="button" class="chip" data-k="looks">Looks wrong</button><button type="button" class="chip" data-k="idea">Idea</button></div>
      <div class="shots" id="prpShots"><button type="button" class="addshot" data-shot><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="3"/><circle cx="12" cy="12.5" r="3.2"/><path d="M8.5 6l1.4-2h4.2l1.4 2"/></svg>Add a screenshot</button></div>
      <input type="file" accept="image/*" multiple hidden>
      <div class="hint">Up to ${MAX_SHOTS} screenshots. Paste one (${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+"}V) or drop it here. Each is made smaller on this device first.</div>
    </div>
    ${beta ? `<div class="secs">
      ${sec("prpState", "What the app was doing", "Recent errors and failed requests (addresses without query strings).", def.state)}
      ${sec("prpLogs", "App logs", `The last ${LOG_LINES} lines of Nexy's own logs, keys and tokens removed.`, def.logs)}
      ${sec("prpHw", "Hardware", "OS and version, CPU, RAM, graphics and its memory, free disk, Nexy's tier and model. No serial numbers, names or addresses.", def.hardware)}
      ${sec("prpConv", "This conversation", convD, !!th)}
    </div>
    <div class="card">
      <div class="lab"><label for="prpEmail">Email, so we can reply</label><small>Optional</small></div>
      <input type="email" id="prpEmail" placeholder="you@example.com" autocomplete="email" maxlength="254">
    </div>
    <div class="card">
      <div class="lab">What will be sent</div>
      <ul class="what" id="prpWhat"><li>Getting this device's details…</li></ul>
      <details><summary>Exactly what is sent</summary><pre id="prpPreview"></pre></details>
    </div>
    <p class="fine">${LOCK}<span>Nothing is sent until you press Send. Kept 90 days at most, then deleted. A copy stays on this computer.</span></p>`
    : `<div class="secs">${sec("prpState", "Include what the app was doing", `Recent errors, failed requests${o.snapshot ? " and what is open" : ""}.`, def.state)}</div>`}
    <div class="msg" aria-live="polite"></div>
    <div class="foot">
      ${beta ? `<label class="remember"><input type="checkbox" id="prpRemember"${def.saved ? " checked" : ""}> Remember my choices</label>` : ""}
      <div class="btns">${beta ? `<button type="button" class="btn" data-save>Save on this computer only</button><button type="button" class="btn go" data-send disabled>Send to the Nexy team</button>`
        : `<button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn go" data-send>Save report</button>`}</div>
    </div>`}
  </div>`;
  document.body.append(scrim);
  const $ = <T extends Element>(s: string) => scrim.querySelector<T>(s)!;
  const box = $<HTMLElement>(".prp");
  const onPaste = (e: ClipboardEvent) => {
    const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file" && i.type.startsWith("image/")).map((i) => i.getAsFile()).filter((f): f is File => !!f);
    if (files.length) { e.preventDefault(); void addFiles(files); }
  };
  const close = () => { scrim.remove(); removeEventListener("keydown", onKey); removeEventListener("paste", onPaste); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  addEventListener("keydown", onKey);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  scrim.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  if (blocked) return;
  addEventListener("paste", onPaste);

  const text = $<HTMLTextAreaElement>("#prpText"), msg = $<HTMLElement>(".msg"), file = $<HTMLInputElement>("input[type=file]");
  const send = $<HTMLButtonElement>("[data-send]"), saveOnly = beta ? $<HTMLButtonElement>("[data-save]") : null;
  const sw = (id: string) => scrim.querySelector<HTMLInputElement>(`#${id}`)?.checked ?? false;
  let kind = ["bug", "looks", "idea"].includes(saved.kind) ? saved.kind : "bug";
  // the comment is kept as a draft on this device until it is saved or sent
  text.value = saved.text;
  text.focus();
  text.setSelectionRange(text.value.length, text.value.length);
  const kinds = () => scrim.querySelectorAll("[data-k]").forEach((x) => x.setAttribute("aria-pressed", String((x as HTMLElement).dataset.k === kind)));
  kinds();

  // screenshots: each made smaller here; for the team, one image of them all (the server keeps one)
  const shots: string[] = [];
  let combined: string | null = null, combining: Promise<void> | null = null;
  const shotsEl = $<HTMLElement>("#prpShots"), add = $<HTMLButtonElement>("[data-shot]");
  const drawShots = () => {
    shotsEl.querySelectorAll("figure").forEach((f) => f.remove());
    shots.forEach((s, i) => {
      const f = document.createElement("figure");
      f.innerHTML = `<img alt="Screenshot ${i + 1}"><figcaption><span>${kb(bytesOf(s))}</span><button type="button" data-rm="${i}" aria-label="Remove screenshot ${i + 1}">Remove</button></figcaption>`;
      f.querySelector("img")!.src = s;
      f.querySelector("button")!.addEventListener("click", () => { shots.splice(i, 1); msg.textContent = ""; shotsChanged(); });
      shotsEl.insertBefore(f, add);
    });
    add.hidden = shots.length >= MAX_SHOTS;
  };
  const shotsChanged = () => {
    drawShots();
    combined = null;
    if (!beta || !shots.length) { combining = null; refresh(); return; }
    const mine = shots.slice();
    const job: Promise<void> = combineShots(mine).then((c) => { if (job === combining) { combined = c; shotCount = mine.length; } })
      .catch((e: Error) => { msg.textContent = `Could not prepare the screenshots: ${e.message}`; })
      .finally(() => { if (job === combining) { combining = null; refresh(); } });
    combining = job;
    refresh();
  };
  const addFiles = async (files: File[]) => {
    msg.textContent = "";
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (files.length && !imgs.length) { msg.textContent = "That file is not an image."; return; }
    const room = MAX_SHOTS - shots.length;
    if (imgs.length > room) msg.textContent = room ? `Up to ${MAX_SHOTS} screenshots: the first ${room} were added.` : `Up to ${MAX_SHOTS} screenshots. Remove one to add another.`;
    for (const f of imgs.slice(0, Math.max(0, room))) {
      try {
        let s = await fromFile(f);
        if (bytesOf(s) > SHOT_BYTES) s = await combineShots([s]);
        if (shots.length < MAX_SHOTS) shots.push(s);
      } catch (e) { msg.textContent = (e as Error).message; }
    }
    shotsChanged();
  };
  add.addEventListener("click", async () => {
    msg.textContent = "";
    scrim.style.visibility = "hidden";
    try {
      const s = await captureTab();
      if (s) { shots.push(s); shotsChanged(); } else file.click();
    } catch (e) {
      // the person cancelled the browser's prompt, or it is blocked: offer a file instead
      if ((e as Error)?.name !== "NotAllowedError") msg.textContent = `Could not take a screenshot: ${(e as Error).message}`;
      file.click();
    } finally { scrim.style.visibility = ""; }
  });
  file.addEventListener("change", () => { const f = [...(file.files ?? [])]; file.value = ""; void addFiles(f); });
  box.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types ?? [])].includes("Files")) { e.preventDefault(); box.classList.add("drop"); } });
  box.addEventListener("dragleave", (e) => { if (e.target === box) box.classList.remove("drop"); });
  box.addEventListener("drop", (e) => { e.preventDefault(); box.classList.remove("drop"); void addFiles([...(e.dataTransfer?.files ?? [])]); });

  // beta: the body for the team, built from what is on screen; the preview renders this same object
  let tctx: TeamCtx | null = null, tctxErr = "", shown: Record<string, unknown> | null = null;
  const convOf = (): Turn[] => (th ? th.turns : o.conversation?.() ?? []);
  const teamBody = (): { body: Record<string, unknown>; notes: string[] } => {
    const c = tctx!, notes: string[] = [];
    const raw = text.value.trim();
    if (raw.length > TEXT_CHARS) notes.push(`Your comments are cut to ${TEXT_CHARS.toLocaleString("en")} characters.`);
    const hw = sw("prpHw") ? hardwareLines(c.hardware) : [];
    let logs = sw("prpLogs") && c.logs ? scrubLog(c.logs).split("\n").slice(-(LOG_LINES - hw.length)) : [];
    const turns = sw("prpConv") ? convOf().slice(-TURNS) : null;
    const conversation = turns?.map((t) => ({ role: scrub(String(t.role)).slice(0, 20), text: scrubLog(String(t.text).trim()).slice(0, TURN_CHARS).trim() }));
    const long = turns?.filter((t) => String(t.text).trim().length > TURN_CHARS).length ?? 0;
    if (long) notes.push(`${long} message${long === 1 ? " is" : "s are"} cut to ${TURN_CHARS.toLocaleString("en")} characters.`);
    const email = $<HTMLInputElement>("#prpEmail").value.trim();
    if (email && !EMAIL.test(email)) notes.push("The email is left out: it doesn't look like an address.");
    const make = (): Record<string, unknown> => ({
      kind, text: scrub(raw).slice(0, TEXT_CHARS), app: o.app, version: c.version, os: c.os,
      errors: sw("prpState") ? errors.map((e) => ({ at: e.at, msg: scrubLog(e.msg).slice(0, 300).trim() })) : [],
      requests: sw("prpState") ? requests.map((r) => ({ ...r, url: bareUrl(r.url).slice(0, 200) })) : [],
      logs: [...hw, ...logs].join("\n"),
      ...(email && EMAIL.test(email) ? { email } : {}),
      ...(conversation?.length ? { conversation } : {}),
      ...(combined ? { screenshot: combined } : {}),
    });
    let b = make();
    // under the server's limits: the oldest log lines go first, then the oldest messages
    const before = logs.length;
    while (logs.length && (utf8(JSON.stringify(b)) > ROOM || String(b.logs).length > LOG_CHARS)) { logs = logs.slice(Math.max(10, Math.ceil(logs.length / 10))); b = make(); }
    if (logs.length < before) notes.push(`App logs are cut to the last ${logs.length} lines to stay under the 2 MB limit.`);
    while (conversation?.length && utf8(JSON.stringify(b)) > ROOM) { conversation.shift(); b = make(); }
    if (turns?.length && conversation && conversation.length < turns.length) notes.push(`Only the last ${conversation.length} messages fit under the 2 MB limit.`);
    return { body: b, notes };
  };
  const refresh = () => {
    if (!beta) return;
    const ul = $<HTMLUListElement>("#prpWhat"), pre = $<HTMLElement>("#prpPreview");
    const li = (t: string, cls = "") => Object.assign(document.createElement("li"), { textContent: t, className: cls });
    if (!tctx) {
      ul.replaceChildren(li(tctxErr ? `Can't send to the Nexy team: ${tctxErr}` : "Getting this device's details…"));
      pre.textContent = ""; shown = null; send.disabled = true;
      return;
    }
    const { body: b, notes } = teamBody();
    shown = b;
    const n = (k: string) => (b[k] as unknown[]).length;
    const hwN = sw("prpHw") ? hardwareLines(tctx.hardware).length - 1 : 0;
    const logN = b.logs ? String(b.logs).split("\n").length - (hwN ? hwN + 1 : 0) : 0;
    const items = [
      b.text ? "Your comments (keys and tokens removed)" : "No comments", `The kind: ${kind === "bug" ? "something broke" : kind === "looks" ? "looks wrong" : "idea"}`,
      `App ${b.version || "version unknown"}, ${b.os}`,
      sw("prpState") ? `${plural(n("errors"), "recent error")} and ${plural(n("requests"), "failed request")} (addresses without query strings)` : "",
      logN > 0 ? `The last ${logN} lines of the app's own logs, keys, tokens and personal details removed` : sw("prpLogs") ? "App logs: none on this device" : "",
      hwN > 0 ? `Hardware: ${hwN} lines about this ${tctx.hardware?.cpu ? "computer" : "browser"}, at the top of the logs` : "",
      combining ? "Preparing the screenshots…" : shots.length ? `${shots.length} screenshot${shots.length > 1 ? "s" : ""} (${shots.map((s) => kb(bytesOf(s))).join(", ")})${combined && shots.length > 1 ? `, sent as one image of ${kb(bytesOf(combined))}` : ""}` : "",
      b.conversation ? `${th ? `“${th.title.slice(0, 60)}”` : "This conversation"}: ${(b.conversation as unknown[]).length} messages` : "Not this conversation",
      b.email ? `Your email: ${b.email}` : "",
      `${kb(utf8(JSON.stringify(b)))} in all, of the 2 MB limit`,
    ].filter(Boolean);
    ul.replaceChildren(...items.map((t) => li(t)), ...notes.map((t) => li(t, "cut")));
    pre.textContent = previewOf(b);
    send.disabled = !!combining || !tctx.ready;
  };
  if (beta) {
    void (async () => {
      try {
        const r = await fetch(o.team!);
        const j = await r.json().catch((e: Error) => ({ error: `unreadable answer: ${e.message}` }));
        if (!r.ok) throw new Error(j.error || httpMsg(r.status));
        if (!j.ready) throw new Error("sending is not set up in this build");
        tctx = j;
      } catch (e) {
        tctxErr = (e as Error).message;
        msg.textContent = `Can't send to the Nexy team: ${tctxErr}. You can still save it on this computer.`;
      }
      refresh();
    })();
  }
  text.addEventListener("input", () => draft.set(text.value, kind));
  scrim.addEventListener("input", refresh);
  scrim.addEventListener("change", (e) => { if (e.target !== file) refresh(); });
  scrim.querySelectorAll<HTMLButtonElement>("[data-k]").forEach((b) => b.addEventListener("click", () => {
    kind = b.dataset.k!; kinds(); draft.set(text.value, kind); refresh();
  }));

  let savedId = ""; // a failed send keeps the local copy; trying again only sends
  const saveLocal = async (txt: string) => {
    const withState = sw("prpState");
    let state: unknown = null;
    if (withState && o.snapshot) try { state = o.snapshot(); } catch (e) { state = { error: String((e as Error).message) }; }
    const shot = combined ?? (shots.length ? await combineShots(shots) : null);
    const r = await fetch(o.endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app: o.app, kind, text: txt, screenshot: shot,
        context: {
          url: location.pathname + location.search, version: o.version ?? "", at: new Date().toISOString(),
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone, viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
          ua: navigator.userAgent, touch: matchMedia("(pointer: coarse)").matches, screenshots: shots.length,
          ...(withState ? { errors: errors.slice(), requests: requests.slice(), state } : {}),
        },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "this machine could not save the report just now; try again in a moment");
    savedId = String(j.id);
  };
  const finish = (title: string, line: string, ref?: string) => {
    draft.set("", kind);
    box.innerHTML = `${X}<h2></h2><p class="ok"></p><p class="lede"></p><div class="foot"><div class="btns"><button type="button" class="btn go" data-x>Close</button></div></div>`;
    box.querySelector("h2")!.textContent = title;
    const ok = box.querySelector<HTMLElement>(".ok")!;
    if (ref) ok.append("Sent. Reference ", Object.assign(document.createElement("b"), { textContent: ref }), ".");
    else ok.remove();
    box.querySelector<HTMLElement>(".lede")!.textContent = line;
    box.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
    box.querySelector<HTMLButtonElement>(".btn.go")!.focus();
  };
  // the device's defaults: kept when ticked, forgotten when not; the conversation never
  const remember = () => {
    if (!beta) return;
    setReportDefaults($<HTMLInputElement>("#prpRemember").checked ? { state: sw("prpState"), logs: sw("prpLogs"), hardware: sw("prpHw") } : null);
  };
  const go = async (toTeam: boolean) => {
    const txt = text.value.trim();
    if (!txt && !shots.length) { msg.textContent = "Say what happened, or add a screenshot."; text.focus(); return; }
    if (toTeam && (!tctx?.ready || !shown || combining)) return;
    const body = toTeam ? shown : null; // exactly what the preview shows now
    send.disabled = true; if (saveOnly) saveOnly.disabled = true;
    remember();
    try {
      if (!savedId) { msg.textContent = "Saving…"; await saveLocal(txt); }
    } catch (e) {
      msg.textContent = `Could not save it: ${(e as Error).message}`;
      send.disabled = false; if (saveOnly) saveOnly.disabled = false;
      return;
    }
    if (!toTeam) return finish("Thanks, saved", `Report ${savedId} is on ${here}${beta ? "" : " for its owner"}. It was not sent anywhere else.`);
    msg.textContent = "Sending…";
    try {
      const r = await fetch(o.team!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch((e: Error) => ({ error: `unreadable answer: ${e.message}` }));
      if (!r.ok) throw new Error(j.error || httpMsg(r.status));
      finish("Thank you", "A copy is kept on this computer.", String(j.ref));
    } catch (e) {
      msg.textContent = `Saved on this computer, but not sent: ${(e as Error).message}`;
      send.disabled = false; if (saveOnly) saveOnly.disabled = false;
    }
  };
  send.addEventListener("click", () => void go(beta));
  saveOnly?.addEventListener("click", () => void go(false));
  refresh();
}
