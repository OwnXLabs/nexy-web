// The agent's screen, live in the work pane: watch its browser as it works, or take control of it.
// Watching uses the view password, and the screen server drops input sent with it; taking control
// asks Nexy for the control password, which also pauses the agent until the screen is handed back.
import "./compat"; // Uint8Array.at, which noVNC needs, on older engines
import RFBModule from "@novnc/novnc/lib/rfb";
import { rfbClass } from "./rfb-class";

const RFB = rfbClass<typeof RFBModule>(RFBModule);
import type { Artifact } from "./canvas";
import { isPrivate } from "./private";
import { httpMsg, errText } from "./http";
import { boxHere } from "./place";

interface Screen { available: boolean; watch?: boolean; control?: boolean; driving?: boolean; reason?: string; password?: string; path?: string; error?: string }

let rfb: { disconnect(): void } | null = null;
let watch: ReturnType<typeof setInterval> | null = null;
let driving = false;
// the step the agent asked the person to do; taking control starts as soon as the screen shows
let asked: string | null = null;
let pendingTake = false;
// Returns true when the screen was already showing and control is being taken there; false means
// the caller opens the screen, which takes control as soon as it connects. Re-opening a showing
// screen would reconnect it and hand control straight back.
export function takeControlFor(what: string): boolean {
  asked = what;
  if (driving) return true;
  const live = document.querySelector<HTMLButtonElement>(".screen-live .screen-take");
  if (live) { live.click(); return true; }
  pendingTake = true;
  return false;
}

const control = async (take: boolean): Promise<{ password?: string; error?: string }> => {
  const r = await fetch("/api/v1/screen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(take ? { take: true } : { release: true }) });
  const d = await r.json().catch((e: Error) => ({ error: `unreadable reply: ${errText(e)}` }));
  return r.ok ? d : { error: d?.error ?? `The screen could not change hands: ${httpMsg(r.status)}` };
};
// closing the tab mid-drive must not leave the agent paused for the rest of the session
if (typeof window !== "undefined")
  addEventListener("pagehide", () => { if (driving) navigator.sendBeacon("/api/v1/screen", JSON.stringify({ release: true })); });

// The agent's browser closes when its turn ends, leaving the screen black. Keep the last page it
// showed and put it back, dimmed and marked, until the browser opens again.
const LAST = "nexy.screen.last";
// never in an ultra-private session: a frame of what the agent browsed would outlive it
const remember = (url: string, at: number) => {
  if (isPrivate()) return;
  try { sessionStorage.setItem(LAST, JSON.stringify({ url, at })); } catch (e) { console.warn("[nexy] screen: last frame not kept", e); }
};
const recall = (): { url: string; at: number } | null => { try { return JSON.parse(sessionStorage.getItem(LAST) ?? "null"); } catch (e) { console.warn("[nexy] screen: last frame unreadable", e); return null; } };

// an empty screen: nearly every sampled pixel is black
function blank(c: HTMLCanvasElement): boolean {
  const w = 48, h = 30, t = document.createElement("canvas");
  t.width = w; t.height = h;
  const g = t.getContext("2d", { willReadFrequently: true });
  if (!g || !c.width) return true;
  g.drawImage(c, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 45) lit++;
  return lit < (w * h) / 50;
}

export async function screenAvailable(): Promise<boolean> {
  try { const s = (await (await fetch("/api/v1/screen")).json()) as Screen; return s.available && s.watch !== false; }
  catch (e) { console.warn("[nexy] agent screen status", e); return false; }
}

export function screenArtifact(): Artifact {
  return {
    id: "agent-screen",
    kind: "screen",
    title: "The agent's screen",
    meta: "Live",
    ephemeral: true,
    render: (host) => { void mount(host); },
  };
}

async function mount(host: HTMLElement): Promise<void> {
  if (driving) { driving = false; void control(false); }
  rfb?.disconnect();
  rfb = null;
  if (watch) clearInterval(watch);
  watch = null;
  host.innerHTML = `<div class="screen-live" style="position:relative;width:100%;height:100%;min-height:360px;background:#0b0b0f;border-radius:12px;overflow:hidden"><div class="screen-msg" style="position:absolute;inset:0;display:grid;place-items:center;color:#a0a0ab;font-size:13px;text-align:center;padding:16px">Connecting to the agent's screen…</div></div>`;
  const box = host.querySelector<HTMLElement>(".screen-live")!;
  const msg = host.querySelector<HTMLElement>(".screen-msg")!;
  const idle = document.createElement("div");
  idle.className = "screen-idle";
  idle.style.cssText = "position:absolute;inset:0;display:none;background:#0b0b0f;z-index:2";
  box.appendChild(idle);
  const hint = document.createElement("div");
  hint.className = "screen-hint";
  hint.hidden = true;
  hint.style.cssText = "position:absolute;left:12px;bottom:12px;right:12px;padding:8px 12px;border-radius:10px;background:rgba(0,0,0,.65);color:#d4d4d8;font-size:12px;z-index:2;pointer-events:none";
  hint.textContent = "Nothing is open on the agent's screen yet. Ask Nexy to open a website, then use it here.";
  box.appendChild(hint);
  const showIdle = () => {
    const last = recall();
    const when = last ? new Date(last.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    idle.innerHTML = last
      ? `<img src="${last.url}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:.45"><div style="position:absolute;left:12px;bottom:12px;right:12px;padding:8px 12px;border-radius:10px;background:rgba(0,0,0,.65);color:#d4d4d8;font-size:12px">Last seen ${when}. The agent's browser is closed now; it comes back here live the next time Nexy browses.</div>`
      : `<div style="position:absolute;inset:0;display:grid;place-items:center;color:#a0a0ab;font-size:13px;text-align:center;padding:16px">Nothing is open on the agent's screen. Ask Nexy to open a website and you can watch it here.</div>`;
    idle.style.display = "block";
  };
  const say = (text: string, retry = false) => {
    msg.hidden = false;
    msg.innerHTML = `<div>${text}${retry ? `<br><button class="btn small" style="margin-top:10px">Reconnect</button>` : ""}</div>`;
    msg.querySelector("button")?.addEventListener("click", () => void mount(host));
  };
  let s: Screen;
  try { s = (await (await fetch("/api/v1/screen")).json()) as Screen; }
  catch (e) { say(`The agent's screen could not be reached: ${errText(e)}`, true); return; }
  if (!s.available) { say("The agent's screen is not running on this machine."); return; }
  if (s.watch === false || !s.password) { say(s.reason ?? "Sign in to the demo to watch the agent's screen."); return; }
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${s.path ?? "/screen/ws"}`;
  const viewPassword = s.password;
  // connects with the view password to watch, or the control password to drive
  const open = (password: string, drive: boolean) => {
    if (watch) clearInterval(watch);
    watch = null;
    rfb?.disconnect();
    connect(password, drive);
  };
  const connect = (password: string, drive: boolean) => {
    try {
      const r = new RFB(box, url, { credentials: { password } });
      r.viewOnly = !drive;
      driving = drive;
      if (s.control) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn small screen-take";
        b.style.cssText = "position:absolute;top:10px;right:10px;z-index:3";
        b.textContent = drive ? "Hand back" : "Take control";
        b.title = drive ? "Let the agent use its browser again" : "Use the agent's browser yourself; the agent pauses until you hand it back";
        const take = async () => {
          b.disabled = true;
          const d = await control(true);
          if (d.error || !d.password) { b.disabled = false; b.textContent = d.error ?? "Could not take control"; return; }
          box.querySelector(".screen-take")?.remove();
          open(d.password, true);
        };
        // handing back can carry a note: what the person did, so the agent carries on their way
        const handBack = () => {
          if (box.querySelector(".screen-handback")) return;
          const f = document.createElement("form");
          f.className = "screen-handback";
          f.style.cssText = "position:absolute;top:44px;right:10px;z-index:4;width:min(340px,calc(100% - 20px));padding:12px;border-radius:12px;background:rgba(18,18,24,.96);color:#e4e4e7;font-size:12px;display:grid;gap:8px";
          f.innerHTML = `<label>What did you do? <span style="opacity:.6">(optional; Nexy reads it when it carries on. Never a password.)</span><textarea name="note" rows="3" style="width:100%;margin-top:4px;resize:vertical" placeholder="e.g. Signed in, then the export is under Settings, Data"></textarea></label>`
            + (boxHere ? `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="remember"> Remember this as a routine</label>` : "")
            + `<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn small" data-cancel>Keep control</button><button type="submit" class="btn small">Hand back</button></div>`;
          f.querySelector("[data-cancel]")!.addEventListener("click", () => f.remove());
          f.addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const note = String(new FormData(f).get("note") ?? "").trim().slice(0, 2000);
            const remember = !!new FormData(f).get("remember");
            const d = await control(false);
            if (d.error) { f.querySelector<HTMLButtonElement>("[type=submit]")!.textContent = d.error; return; }
            f.remove();
            box.querySelector(".screen-take")?.remove();
            open(viewPassword, false);
            if (note || asked || remember) {
              const msg = (note ? `I used your browser and handed it back. Here is what I did: ${note}` : "I've done that step in your browser and handed it back.")
                + " Look at the page that's open now and carry on."
                + (remember ? " Save how I did this to your memory as a routine, so you can do it yourself next time." : "");
              window.dispatchEvent(new CustomEvent("nexy:send", { detail: msg }));
            }
            asked = null;
          });
          box.appendChild(f);
          f.querySelector("textarea")!.focus();
        };
        b.addEventListener("click", () => void (drive ? handBack() : take()));
        box.querySelector(".screen-take")?.remove();
        box.appendChild(b);
        if (drive) r.focus();
        if (!drive && pendingTake) { pendingTake = false; void take(); }
      }
      r.scaleViewport = true;
      r.background = "#0b0b0f";
      r.addEventListener("connect", () => {
        msg.hidden = true;
        // every 2 s: keep the latest real frame, and cover a black screen with the last one
        watch = setInterval(() => {
          const c = box.querySelector("canvas");
          if (!c) return;
          // never cover the screen someone is driving: a dark page would swallow their clicks.
          // A note that lets clicks through says why an empty screen has nothing to use yet.
          if (driving) { idle.style.display = "none"; hint.hidden = !blank(c); return; }
          hint.hidden = true;
          if (blank(c)) { if (idle.style.display !== "block") showIdle(); return; }
          idle.style.display = "none";
          try { remember(c.toDataURL("image/jpeg", 0.7), Date.now()); } catch (e) { console.warn("[nexy] screen: frame not readable", e); }
        }, 2000);
      });
      r.addEventListener("disconnect", (ev: CustomEvent<{ clean: boolean }>) => {
        // switching between watching and driving replaces this connection on purpose
        if (rfb !== r) return;
        if (watch) clearInterval(watch);
        watch = null;
        say(ev.detail?.clean ? "The agent's screen closed." : "Lost the connection to the agent's screen.", true);
      });
      r.addEventListener("securityfailure", () => say("The agent's screen refused this viewer.", true));
      rfb = r;
    } catch (e) {
      say(`The agent's screen could not open: ${errText(e)}`, true);
    }
  };
  // a page reload mid-drive: hand the screen back rather than leave the agent paused
  if (s.driving) void control(false);
  connect(viewPassword, false);
}
