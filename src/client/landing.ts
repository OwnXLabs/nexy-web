// The chat home, after the v23 landing design: the greeting with three suggestions, the
// Get started list, the model download chip and the first-visit pill. Only what works on this
// machine is offered; what isn't here is left out or explained.
import { boxHere, hasApp, here, inCloud, onGuestCode, onOwn1, sharedOn } from "./place";
import { httpMsg } from "./http";
import { isPrivate } from "./private";
import { prefs } from "./settings";

export interface LandingHooks {
  send(text: string): void;
  settings(sec: string): void;
  talk(): void;
  toast(t: string): void;
}

let H: LandingHooks;
const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const svg = (d: string) => `<svg class="i" viewBox="0 0 24 24">${d}</svg>`;
const I = {
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  send: svg('<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>'),
  pen: svg('<path d="M4 20l4-1 11-11-3-3L5 16z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>'),
};
const isPhone = () => matchMedia("(max-width:820px)").matches;
const firstName = () => (prefs().name || "").trim().split(/\s+/)[0] ?? "";

// ---- the model download, as the host app reports it ----
export interface ModelState { ready: boolean; model?: string; progress?: number }
let model: ModelState = { ready: true };
let known = false;
let waiters: (() => void)[] = [];
export const modelState = (): ModelState => model;
export const modelReady = (): Promise<void> => model.ready ? Promise.resolve() : new Promise((ok) => waiters.push(ok));

async function pollModel(): Promise<void> {
  try {
    const r = await fetch("/api/v1/model");
    if (!r.ok) throw new Error(httpMsg(r.status));
    model = await r.json() as ModelState;
  } catch (e) {
    // can't tell: treat it as ready so nothing waits on a question nobody answers
    console.warn("[nexy] model status unavailable", e);
    model = { ready: true };
  }
  known = true;
  paintChip();
  greet();
  if (model.ready) { const w = waiters; waiters = []; w.forEach((f) => f()); welcome(); return; }
  setTimeout(() => void pollModel(), 2000);
}

function paintChip(): void {
  let c = $("#dlchip");
  if (model.ready) { c?.remove(); return; }
  if (!c) {
    c = document.createElement("span");
    c.className = "dlchip"; c.id = "dlchip";
    c.innerHTML = `<span class="led"></span><span class="sl"></span><span class="dlbar"><i></i></span>`;
    const row = $(".tabrow");
    row?.insertBefore(c, $(".tabtools", row));
  }
  $(".sl", c)!.textContent = `Downloading ${model.model} · ${model.progress ?? 0}%`;
  $<HTMLElement>(".dlbar i", c)!.style.width = `${model.progress ?? 0}%`;
}

// ---- web search installing in the background (a computer's first start) ----
// Shown with its progress until it is ready: never an offer to download it, which would start a
// second install of the one already running.
async function pollSearch(): Promise<void> {
  let st: { state?: string; progress?: number } = {};
  try {
    const r = await fetch("/api/v1/search-status");
    if (!r.ok) throw new Error(httpMsg(r.status));
    st = await r.json() as typeof st;
  } catch (e) { console.warn("[nexy] search status unavailable", e); }
  let c = $("#searchchip");
  if (st.state !== "installing") { c?.remove(); return; }
  if (!c) {
    c = document.createElement("span");
    c.className = "dlchip"; c.id = "searchchip"; c.setAttribute("role", "status");
    c.innerHTML = `<span class="led"></span><span class="sl"></span><span class="dlbar"><i></i></span>`;
    const row = $(".tabrow");
    row?.insertBefore(c, $(".tabtools", row));
  }
  $(".sl", c)!.textContent = `Setting up web search… ${st.progress ?? 0}%`;
  $<HTMLElement>(".dlbar i", c)!.style.width = `${st.progress ?? 0}%`;
  setTimeout(() => void pollSearch(), 3000);
}

// ---- greeting and suggestions ----
function suggestions(): [string, string][] {
  // a routine starter only where routines are allowed
  const brief: [string, string] = [I.sun, boxHere ? "Give me a news brief every morning" : "Give me today's news brief"];
  // AI on someone's Own 1: what a guest gets there (chat, research, images), not this computer's apps
  if (sharedOn) return [[I.pen, "Write the story for my bakery's website"], [I.chart, "Research my top 5 competitors"],
    hasApp("images") ? [I.image, "Make an image"] : brief];
  return [
    hasApp("build") ? [I.globe, "Build a landing page for my bakery"] : [I.pen, "Write the story for my bakery's website"],
    [I.chart, "Research my top 5 competitors"],
    !hasApp("hub") ? brief
      : onOwn1 ? (boxHere ? [I.send, "Send me a summary on Telegram every morning"] : brief) : [I.send, "Find the latest invoice in my email"],
  ];
}

const list = (a: string[]) => a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`;
function hello(): string {
  const n = firstName();
  const tail = model.ready ? "What should we start with?" : `I’m still downloading ${esc(model.model ?? "the model")}, but you can give me a job now.`;
  // AI on someone's Own 1: what it does there, named, and never "privately on this computer"
  if (sharedOn) {
    const can = list(["write, plan and research with you", ...(hasApp("images") ? ["make images"] : [])]);
    return `Hi${n ? ` ${esc(n)}` : ""}. I ${can}, using ${esc(sharedOn)}${onGuestCode ? " as a guest" : ""}. ${tail}`;
  }
  const can = list([
    hasApp("build") ? "plan and build things" : "write, plan and research with you",
    ...(hasApp("startup") ? ["run a team of agents for you"] : []),
    ...(hasApp("hub") ? ["work with your apps"] : []),
  ]);
  const where = onOwn1 || inCloud ? "" : ", privately on this computer";
  return `Hi${n ? ` ${esc(n)}` : ""}. I ${can}${where}. ${tail}`;
}

/** The home greeting in an empty chat with no project open. */
export function greet(): void {
  const g = $("#emptyState.home .t");
  if (g && g.innerHTML !== hello()) g.innerHTML = hello();
}

export function homeNode(): HTMLElement {
  const d = document.createElement("div");
  d.className = "m ai home";
  d.id = "emptyState";
  d.innerHTML = `<div class="t">${hello()}</div><div class="sugg">` +
    suggestions().map(([i, t]) => `<button type="button" class="chip" data-sug="${esc(t)}">${i}${esc(t)}</button>`).join("") + `</div>`;
  d.querySelectorAll<HTMLElement>("[data-sug]").forEach((b) => b.addEventListener("click", () => H.send(b.dataset.sug!)));
  return d;
}

// ---- Get started ----
interface Item { k: string; t: string; tip: string; act?: string; run?(): void }
const DONE_KEY = "nexy.getStarted.v1";
const done = new Set<string>((() => {
  try { return JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]") as string[]; }
  catch (e) { console.warn("[nexy] get started list unreadable", e); return []; }
})());

function items(): Item[] {
  const loop = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const out: Item[] = [{ k: "ask", t: "Ask your first thing", tip: `<b>Ask for outcomes</b>Describe what you want done. ${hasApp("startup") ? "Nexy plans it and puts agents on it." : "Nexy works on it with you."}` }];
  // no speech in an ultra-private chat (shell.ts speechOffWhilePrivate)
  if (hasApp("voice") && !isPrivate()) out.push({ k: "voice", t: "Talk instead of typing", act: "Try it now", run: () => H.talk(),
    tip: `<b>Just talk</b>${isPhone() ? "Hold the mic button and speak. Let go, check the words, then Send." : 'Hold <span class="gs-key">Space</span> anywhere and speak. Let go, check the words, then press Enter.'}` });
  // a computer's Nexy reaches a phone through the app's "Add your phone…" (a QR code over the mesh)
  if (!onOwn1 && !inCloud) out.push({ k: "phone", t: "Get Nexy on your phone", act: "Got it", run: () => did("phone"),
    tip: "<b>Approve from anywhere</b>In the <b>Nexy</b> menu at the top of the screen, choose <b>Add your phone…</b>, then scan the code with Nexy on your phone. It is this same Nexy, with your chats." });
  else out.push(loop
    ? { k: "phone", t: "Get Nexy on your phone", tip: "<b>Approve from anywhere</b>Open your Own1’s Nexy address in your phone’s browser. It is this same Nexy, with your chats and approvals." }
    : { k: "phone", t: "Get Nexy on your phone", act: "Copy link", run: () => void copyLink(),
      tip: `<b>Approve from anywhere</b>Open <span class="gs-key">${esc(location.host)}</span> in your phone’s browser. It is this same Nexy, with your chats and approvals.` });
  // Nexy Cloud connects no apps and links nothing yet
  if (inCloud) return out;
  out.push({ k: "apps", t: "Connect an app", act: "Choose an app", run: () => H.settings("connections"),
    tip: hasApp("hub") && !onOwn1 ? "<b>Work where you work</b>Gmail and Google Drive, read-only, each one only after you approve it in your browser. Its sign-in stays on this computer."
      : hasApp("hub") ? "<b>Work where you work</b>Telegram, Gmail, GitHub, Notion… each one gets only the access it needs, and you can see exactly what."
      : "<b>Work where you work</b>See what Nexy can connect to on this computer. Gmail, Drive and others arrive in an update." });
  out.push(onOwn1
    ? { k: "power", t: "Add more power", act: "Set up", run: () => { did("power"); H.settings("cloud"); },
      tip: `<b>Need more power?</b>Nexy Cloud can take the heavy jobs, and you approve each one. Running on ${here} never needs an account.` }
    : { k: "power", t: "Add more power", act: "Got it", run: () => did("power"),
      tip: "<b>Need more power?</b>Linking an Own1 or Nexy Cloud to Nexy on this computer is coming in an update. Running here never needs an account." });
  return out;
}

async function copyLink(): Promise<void> {
  try { await navigator.clipboard.writeText(location.origin); H.toast("Link copied. Open it on your phone"); did("phone"); }
  catch (e) { console.warn("[nexy] clipboard refused", e); H.toast(`Open ${location.host} on your phone`); }
}

/** The owner did one of the Get started things. */
export function did(k: string): void {
  if (done.has(k)) return;
  done.add(k);
  try { localStorage.setItem(DONE_KEY, JSON.stringify([...done])); }
  catch (e) { console.warn("[nexy] get started progress not saved", e); }
  paintList();
}

function paintList(): void {
  const all = items(), n = all.filter((g) => done.has(g.k)).length, left = all.filter((g) => !done.has(g.k));
  const box = $("#gs"), m = $("#gsM");
  if (box) {
    box.hidden = !left.length;
    box.innerHTML = `<div class="gh">Get started<small>${n} of ${all.length}</small></div><div class="gbar"><i style="width:${(n / all.length) * 100}%"></i></div>` +
      all.map((g) => `<button type="button" class="gi${done.has(g.k) ? " ok" : ""}" data-g="${g.k}"><span class="c"></span>${g.t}</button>`).join("");
    box.querySelectorAll<HTMLElement>("[data-g]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); tip(all.find((g) => g.k === b.dataset.g)!, b); }));
  }
  if (m) {
    m.hidden = !left.length;
    m.innerHTML = `<div class="gs-m"><div class="gh">Get started<small>${n} of ${all.length}</small></div><div class="row">` +
      left.map((g) => `<button type="button" data-gk="${g.k}">${g.t}</button>`).join("") + `</div></div>`;
    m.querySelectorAll<HTMLElement>("[data-gk]").forEach((b) => b.addEventListener("click", () => {
      const g = all.find((x) => x.k === b.dataset.gk)!;
      H.toast(`${g.t}: ${g.tip.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`);
      if (g.run) g.run(); else if (g.k === "ask") $<HTMLTextAreaElement>("#input")?.focus();
    }));
  }
}

function closeTip(): void {
  document.querySelector(".gs-tip")?.remove();
  document.querySelectorAll(".gi.act").forEach((x) => x.classList.remove("act"));
}

function tip(g: Item, btn: HTMLElement): void {
  closeTip();
  btn.classList.add("act");
  const t = document.createElement("div");
  t.className = "gs-tip"; // "tip" and "gtip" are taken by the chart, report and timeline views
  t.innerHTML = g.tip + (!done.has(g.k) && g.act ? `<div class="ta"><button type="button" data-do>${g.act}</button><button type="button" class="s" data-no>Later</button></div>` : "");
  document.body.appendChild(t);
  const r = btn.getBoundingClientRect(), top = r.top - 20, ft = Math.max(10, Math.min(top, innerHeight - t.offsetHeight - 10));
  t.style.left = `${r.right + 14}px`; t.style.top = `${ft}px`; t.style.setProperty("--ay", `${top - ft + 28}px`);
  t.addEventListener("click", (e) => e.stopPropagation());
  $("[data-do]", t)?.addEventListener("click", () => { closeTip(); g.run?.(); });
  $("[data-no]", t)?.addEventListener("click", closeTip);
}

// ---- first visit ----
const WELCOMED = "nexy.welcomed.v1";
/** The first chat home this browser shows: a short note, once. */
export function welcome(): void {
  const phone = isPhone();
  // on a computer the note waits until the model is in
  if ((!phone && (!known || !model.ready)) || !document.body.classList.contains("home")) return;
  try { if (localStorage.getItem(WELCOMED)) return; localStorage.setItem(WELCOMED, "1"); }
  catch (e) { console.warn("[nexy] first-visit note skipped", e); return; }
  const w = document.createElement("div");
  w.className = "welcome-toast";
  w.innerHTML = `<span class="led ok"></span>${phone ? "All set. Approvals will come here." : `You’re all set. Nexy is ready on ${here}.`}`;
  $(".main")?.appendChild(w);
  setTimeout(() => w.remove(), 4600);
}

// the box's hint line cycles through things to try, each one something that works here
const SPACE = "Hold Space to talk";
function rotatePlaceholder(): void {
  const R = ["Try: “Summarise my week”", ...(hasApp("images") ? ["Try: “Make a logo for my bakery”"] : []),
    ...(hasApp("hub") ? [onOwn1 ? "Try: “What’s on my calendar tomorrow?”" : "Try: “Search my email for invoices”"] : []), ...(hasApp("voice") && !isPhone() ? [SPACE] : [])];
  const own = new Set(["Talk to Nexy", ...R]);
  let i = 0;
  setInterval(() => {
    const inp = $<HTMLTextAreaElement>("#input");
    if (!inp || inp.value || !own.has(inp.placeholder)) return;
    const tries = isPrivate() ? R.filter((t) => t !== SPACE) : R;
    inp.placeholder = document.body.classList.contains("home") ? tries[i++ % tries.length] : "Talk to Nexy";
  }, 3200);
}

export function initLanding(h: LandingHooks): void {
  H = h;
  if (isPhone() && matchMedia("(pointer:coarse)").matches) did("phone"); // Nexy is open on this phone
  paintList();
  document.addEventListener("click", closeTip);
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeTip(); });
  addEventListener("nexy:did", (e) => did(String((e as CustomEvent).detail)));
  addEventListener("nexy:private", () => { closeTip(); paintList(); });
  rotatePlaceholder();
  void pollModel();
  // a computer's own search installs in the background on its first start
  if (!onOwn1 && !inCloud && document.documentElement.dataset.search === "1") void pollSearch();
  // the design opens the voice tip once, a moment after landing
  setTimeout(() => {
    const b = $<HTMLElement>('#gs [data-g="voice"]');
    if (!b || done.has("voice") || !b.offsetParent || !document.body.classList.contains("home")) return;
    try { if (localStorage.getItem("nexy.voiceTip.v1")) return; localStorage.setItem("nexy.voiceTip.v1", "1"); }
    catch (e) { console.warn("[nexy] voice tip skipped", e); return; }
    b.click();
  }, 4500);
}
