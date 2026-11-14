import { here } from "./place";
// "Report a problem": what went wrong, an optional screenshot, and what the page was doing
// (recent errors, failed requests, the app's own state). Saved on this box. A beta build can
// also send it to the Nexy team, only when ticked, after showing exactly what goes.
// Kept identical in nexy/src/client and desktop-demo/src/lib.
import { bareUrl, scrub } from "../lib/scrub";
import { httpMsg } from "./http";

export interface ReporterOptions {
  endpoint: string;                 // POST target on this app's own server
  app: string;                      // "nexy" | "desktop"
  version?: string;
  snapshot?: () => unknown;         // the app's state, sent only if the person keeps it ticked
  blocked?: () => string | null;    // a reason reports are off right now (ultra-private chat)
  team?: string;                    // beta builds: this app's route that forwards to the Nexy team
  conversation?: () => { role: string; text: string }[]; // sent to the team only if ticked
}

type TeamCtx = { ready: boolean; version: string; os: string; logs: string };
const kb = (dataUrl: string) => Math.round((dataUrl.length * 3) / 4 / 1024);
// the preview shows the screenshot as a line, not its bytes; everything else exactly as sent
export const previewOf = (body: Record<string, unknown>): string =>
  JSON.stringify({ ...body, ...(typeof body.screenshot === "string" ? { screenshot: `[screenshot, ${kb(body.screenshot)} KB]` } : {}) }, null, 2);

type Err = { at: number; msg: string };
type Req = { at: number; method: string; url: string; status: number; ms: number };
const errors: Err[] = [], requests: Req[] = [];
const keep = <T>(list: T[], item: T, max = 30) => { list.push(item); if (list.length > max) list.shift(); };
const MAX_W = 1600;

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
      if (r.status >= 400 && !url.startsWith(o.endpoint)) keep(requests, { at: Date.now(), method, url, status: r.status, ms: Math.round(performance.now() - t) });
      return r;
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") keep(requests, { at: Date.now(), method, url, status: 0, ms: Math.round(performance.now() - t) });
      throw e;
    }
  };
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

function toJpeg(src: CanvasImageSource, w: number, h: number): string {
  const k = Math.min(1, MAX_W / w), c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.75);
}

const fromFile = (file: File) => new Promise<string>((ok, bad) => {
  const img = new Image();
  img.onload = () => { ok(toJpeg(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(img.src); };
  img.onerror = () => bad(new Error("that file is not an image"));
  img.src = URL.createObjectURL(file);
});

const STYLE = `
.prp-scrim{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.prp{width:min(460px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#17171c;color:#ececf1;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:18px;font:14px/1.45 system-ui,-apple-system,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.prp h2{margin:0 0 4px;font-size:16px;font-weight:600}.prp p{margin:0 0 12px;color:#a0a0ab;font-size:13px}
.prp textarea{width:100%;box-sizing:border-box;min-height:96px;resize:vertical;background:#0f0f13;color:inherit;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:10px;font:inherit}
.prp .kinds{display:flex;gap:6px;margin:10px 0}.prp .kinds button{flex:1;min-height:36px}
.prp button{background:#24242c;color:inherit;border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:8px 12px;font:inherit;cursor:pointer}
.prp button[aria-pressed=true]{border-color:#8b8bf5;background:#2b2b45}.prp button.go{background:#5b5bd6;border-color:#5b5bd6;color:#fff}
.prp label{display:flex;gap:8px;align-items:flex-start;margin:8px 0;color:#c8c8d0;font-size:13px}
.prp .shot{display:flex;gap:8px;align-items:center;margin:8px 0}.prp .shot img{max-width:120px;max-height:72px;border-radius:6px;border:1px solid rgba(255,255,255,.14)}
.prp .row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}.prp .msg{min-height:18px;color:#f3a6a6;font-size:13px;margin-top:8px}
.prp .team{border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px;margin:8px 0}
.prp .team input[type=email]{width:100%;box-sizing:border-box;background:#0f0f13;color:inherit;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:8px;font:inherit;margin:4px 0 6px}
.prp .team ul{margin:6px 0;padding-left:18px;color:#c8c8d0;font-size:12.5px}
.prp .team pre{max-height:180px;overflow:auto;background:#0f0f13;border-radius:8px;padding:8px;font:11px/1.4 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;margin:6px 0 0}
`;

export function openReporter(): void {
  if (!opts || document.querySelector(".prp-scrim")) return;
  const o = opts;
  if (!document.getElementById("prp-style")) { const s = document.createElement("style"); s.id = "prp-style"; s.textContent = STYLE; document.head.append(s); }
  const blocked = o.blocked?.();
  const scrim = document.createElement("div");
  scrim.className = "prp-scrim";
  scrim.innerHTML = `<div class="prp" role="dialog" aria-modal="true" aria-labelledby="prpT">
    <h2 id="prpT">Report a problem</h2>
    <p>${o.team ? "Saved on this computer. Tick “Send to the Nexy team” to send it to the team too; you see exactly what goes first." : `Saved on ${here} for its owner. It is never sent anywhere else.`}</p>
    ${blocked ? `<p>${blocked}</p><div class="row"><button data-x>Close</button></div>` : `
    <textarea id="prpText" placeholder="What happened, and what did you expect?"></textarea>
    <div class="kinds" role="group" aria-label="Kind"><button data-k="bug" aria-pressed="true">Something broke</button><button data-k="looks" aria-pressed="false">Looks wrong</button><button data-k="idea" aria-pressed="false">Idea</button></div>
    <div class="shot"><button data-shot>Add a screenshot</button><input type="file" accept="image/*" hidden><img hidden alt="Screenshot preview"><button data-unshot hidden>Remove</button></div>
    <label><input type="checkbox" id="prpState" checked> Include what the app was doing (recent errors, failed requests${o.snapshot ? ", and what is open" : ""})</label>
    ${o.team ? `<label><input type="checkbox" id="prpTeam"> Send to the Nexy team</label>
    <div class="team" hidden>
      <input type="email" id="prpEmail" placeholder="Email, so we can reply (optional)" autocomplete="email" maxlength="254">
      <label><input type="checkbox" id="prpConv"> Include this conversation</label>
      <label hidden><input type="checkbox" id="prpShotTeam" checked> Include the screenshot</label>
      <div>What will be sent:</div><ul id="prpWhat"></ul>
      <details><summary>Exactly what is sent</summary><pre id="prpPreview"></pre></details>
    </div>` : ""}
    <div class="msg" aria-live="polite"></div>
    <div class="row"><button data-x>Cancel</button><button class="go" data-send>Save report</button></div>`}
  </div>`;
  document.body.append(scrim);
  const $ = <T extends Element>(s: string) => scrim.querySelector<T>(s)!;
  const close = () => { scrim.remove(); removeEventListener("keydown", esc); };
  const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  addEventListener("keydown", esc);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
  scrim.querySelectorAll("[data-x]").forEach((b) => b.addEventListener("click", close));
  if (blocked) return;
  $<HTMLTextAreaElement>("#prpText").focus();
  let kind = "bug", shot: string | null = null;
  const msg = $<HTMLElement>(".msg"), img = $<HTMLImageElement>(".shot img"), unshot = $<HTMLButtonElement>("[data-unshot]"), file = $<HTMLInputElement>(".shot input");
  const send = $<HTMLButtonElement>("[data-send]");
  // beta: the body for the team, built from what is on screen; the preview renders this same object
  const team = o.team ? $<HTMLInputElement>("#prpTeam") : null;
  let tctx: TeamCtx | null = null, shown: Record<string, unknown> | null = null; // shown is what gets sent
  const teamBody = (): Record<string, unknown> => {
    const withState = $<HTMLInputElement>("#prpState").checked, c = tctx!;
    const email = $<HTMLInputElement>("#prpEmail").value.trim();
    const conv = $<HTMLInputElement>("#prpConv").checked && o.conversation ? o.conversation().slice(-20) : null;
    return {
      kind, text: scrub($<HTMLTextAreaElement>("#prpText").value.trim()).slice(0, 5000), app: o.app, version: c.version, os: c.os,
      errors: withState ? errors.map((e) => ({ at: e.at, msg: scrub(e.msg) })) : [],
      requests: withState ? requests.map((r) => ({ ...r, url: bareUrl(r.url) })) : [],
      logs: withState ? scrub(c.logs) : "",
      ...(email ? { email } : {}),
      ...(conv ? { conversation: conv.map((t) => ({ role: t.role.slice(0, 20), text: scrub(t.text).slice(0, 2000) })) } : {}),
      ...(shot && $<HTMLInputElement>("#prpShotTeam").checked ? { screenshot: shot } : {}),
    };
  };
  const refresh = () => {
    if (!team) return;
    const on = team.checked && !!tctx;
    $<HTMLElement>(".team").hidden = !on;
    send.textContent = on ? "Save and send" : "Save report";
    $<HTMLElement>("#prpShotTeam").closest("label")!.hidden = !shot;
    if (!on) return;
    const b = (shown = teamBody()), n = (k: string) => (b[k] as unknown[]).length;
    const items = [
      b.text ? "What you wrote above (keys and tokens removed)" : "",
      `App ${b.version || "version unknown"}, ${b.os}`,
      b.logs ? `The last ${String(b.logs).split("\n").length} lines of the app's own logs, keys and tokens removed` : "",
      n("errors") ? `${n("errors")} recent errors` : "", n("requests") ? `${n("requests")} failed requests (addresses without query strings)` : "",
      b.screenshot ? "The screenshot" : "", b.conversation ? `This conversation (${(b.conversation as unknown[]).length} messages)` : "Not this conversation",
      b.email ? `Your email: ${b.email}` : "",
    ].filter(Boolean);
    const ul = $<HTMLUListElement>("#prpWhat");
    ul.replaceChildren(...items.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
    $<HTMLElement>("#prpPreview").textContent = previewOf(b);
  };
  team?.addEventListener("change", async () => {
    if (team.checked && !tctx) {
      msg.textContent = "";
      try {
        const r = await fetch(o.team!);
        const j = await r.json().catch((e: Error) => ({ error: `unreadable answer: ${e.message}` }));
        if (!r.ok || !j.ready) throw new Error(j.error || "sending is not set up in this build");
        tctx = j;
      } catch (e) {
        team.checked = false;
        msg.textContent = `Can't send to the Nexy team: ${(e as Error).message}`;
      }
    }
    refresh();
  });
  scrim.addEventListener("input", refresh);
  scrim.addEventListener("change", (e) => { if (e.target !== team) refresh(); });
  const setShot = (s: string | null) => { shot = s; img.hidden = !s; unshot.hidden = !s; if (s) img.src = s; refresh(); };
  scrim.querySelectorAll<HTMLButtonElement>("[data-k]").forEach((b) => b.addEventListener("click", () => {
    kind = b.dataset.k!; scrim.querySelectorAll("[data-k]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    refresh();
  }));
  $<HTMLButtonElement>("[data-shot]").addEventListener("click", async () => {
    msg.textContent = "";
    scrim.style.visibility = "hidden";
    try {
      const s = await captureTab();
      if (s) setShot(s); else file.click();
    } catch (e) {
      // the person cancelled the browser's prompt, or it is blocked: offer a file instead
      if ((e as Error)?.name !== "NotAllowedError") msg.textContent = `Could not take a screenshot: ${(e as Error).message}`;
      file.click();
    } finally { scrim.style.visibility = ""; }
  });
  file.addEventListener("change", async () => {
    const f = file.files?.[0]; file.value = "";
    if (f) try { setShot(await fromFile(f)); } catch (e) { msg.textContent = (e as Error).message; }
  });
  unshot.addEventListener("click", () => setShot(null));
  let savedId = ""; // a failed send keeps the local copy; trying again only sends
  const saveLocal = async (text: string) => {
    const withState = $<HTMLInputElement>("#prpState").checked;
    let state: unknown = null;
    if (withState && o.snapshot) try { state = o.snapshot(); } catch (e) { state = { error: String((e as Error).message) }; }
    const r = await fetch(o.endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app: o.app, kind, text, screenshot: shot,
        context: {
          url: location.pathname + location.search, version: o.version ?? "", at: new Date().toISOString(),
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone, viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
          ua: navigator.userAgent, touch: matchMedia("(pointer: coarse)").matches,
          ...(withState ? { errors: errors.slice(), requests: requests.slice(), state } : {}),
        },
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "this machine could not save the report just now; try again in a moment");
    savedId = String(j.id);
  };
  const done = (title: string, line: string) => {
    const box = scrim.querySelector(".prp")!;
    box.innerHTML = `<h2></h2><p></p><div class="row"><button data-x>Close</button></div>`;
    box.querySelector("h2")!.textContent = title;
    box.querySelector("p")!.textContent = line;
    box.querySelector("[data-x]")!.addEventListener("click", close);
  };
  send.addEventListener("click", async () => {
    const text = $<HTMLTextAreaElement>("#prpText").value.trim();
    if (!text && !shot) { msg.textContent = "Say what happened, or add a screenshot."; return; }
    const toTeam = !!team?.checked && !!tctx && !!shown;
    send.disabled = true;
    try {
      if (!savedId) { msg.textContent = "Saving…"; await saveLocal(text); }
    } catch (e) {
      msg.textContent = `Could not save it: ${(e as Error).message}`;
      send.disabled = false;
      return;
    }
    if (!toTeam) return done("Thanks, saved", `Report ${savedId} is on ${here} for its owner. It was not sent anywhere else.`);
    msg.textContent = "Sending…";
    try {
      const r = await fetch(o.team!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(shown) });
      const j = await r.json().catch((e: Error) => ({ error: `unreadable answer: ${e.message}` }));
      if (!r.ok) throw new Error(j.error || httpMsg(r.status));
      done("Sent", `Sent. Reference ${j.ref}. A copy is kept on this computer.`);
    } catch (e) {
      msg.textContent = `Saved on this computer, but not sent: ${(e as Error).message}`;
      send.disabled = false;
    }
  });
}
