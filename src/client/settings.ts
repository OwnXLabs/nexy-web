import { loadCatalog } from "./perm";
import { httpMsg } from "./http";

export interface SettingsHooks {
  send(text: string): Promise<void>;
  toast(t: string): void;
  roster: string[];
  projects(): { name: string; taskCount: number; doneCount: number }[];
}

export interface Prefs {
  name: string; voice: string; speakAlways: boolean; wakeKey: boolean; notif: boolean; theme: string; size: string; reduce: boolean; bg: string | null;
}
const KEY = "nexy.settings.v1";
const DEFAULTS: Prefs = { name: "", voice: "en_US-amy-medium", speakAlways: false, wakeKey: true, notif: true, theme: "default", size: "standard", reduce: false, bg: null };

let P: Prefs = { ...DEFAULTS };
try { P = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; }
catch (e) { console.warn("[nexy] settings unreadable, using defaults", e); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { console.warn("[nexy] settings not saved", e); } };
export const prefs = (): Prefs => P;

let H: SettingsHooks;
const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const SECTIONS: [string, string][] = [["general", "General"], ["nexy", "Nexy"], ["team", "Team"], ["connections", "Connections"], ["permissions", "Permissions"],
  ["cloud", "OwnXCloud"], ["data", "Your data"], ["security", "Security and privacy"], ["appearance", "Appearance"], ["workspaces", "Workspaces"], ["about", "About"]];

const sw = (on: boolean, id: string) => `<button type="button" class="sw${on ? " on" : ""}" data-sw="${id}" role="switch" aria-checked="${on}"><i></i></button>`;
const row = (l: string, c: string | null, sub?: string) => `<div class="srow"><div><div class="sl">${l}</div>${sub ? `<div class="ss">${sub}</div>` : ""}</div><div class="sc">${c ?? ""}</div></div>`;
const sel = (id: string, opts: [string, string][], val: string) => `<select data-sel="${id}">${opts.map(([v, t]) => `<option value="${esc(v)}"${v === val ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
const not = (why: string) => `<span class="faint">${esc(why)}</span>`;

export function applyPrefs(): void {
  document.body.dataset.theme = P.theme === "default" ? "" : P.theme;
  document.body.dataset.size = P.size === "standard" ? "" : P.size;
  document.body.classList.toggle("reduce", P.reduce);
  const wp = $(".wp"); if (wp) wp.style.backgroundImage = P.bg ? `url("${P.bg}")` : "";
  if (P.name) document.querySelectorAll(".user .n, .pm-h .n").forEach((n) => { n.textContent = P.name; });
}

let voices: { id: string; name: string }[] = [];
async function loadVoices(): Promise<void> {
  if (voices.length) return;
  const r = await fetch("/api/apps/voice/api/voices").then((x) => x.json()).catch((e) => { console.warn("[nexy] voices unavailable", e); return {}; });
  voices = (r.voices ?? []).map((v: any) => ({ id: String(v.id), name: String(v.name ?? v.id).replace(/^en_US-/, "").replace(/-/g, " ") }));
}

async function section(sec: string): Promise<string> {
  if (sec === "general") return `<h3>General</h3>` +
    row("Your name", `<input data-txt="name" value="${esc(P.name || $(".user .n")?.textContent?.trim() || "")}">`, "Shown in the sidebar, on this browser") +
    row("Language", sel("lang", [["en", "English"]], "en")) +
    row("Open at login", not("Nexy is ready before you sit down")) +
    row("Notifications", sw(P.notif, "notif"), "Approvals, finished work, and nothing else") +
    row("Where new projects live", sel("defloc", [["own1", "Own 1, this desk"]], "own1"));
  if (sec === "nexy") {
    await loadVoices();
    return `<h3>Nexy</h3>` +
      row("Voice", voices.length ? sel("voice", voices.map((v) => [v.id, v.name]), P.voice) : not("Own Voice is not answering"), "Spoken by Own Voice on this machine") +
      row("Speak replies aloud", sw(P.speakAlways, "speakAlways"), "Off: only in voice mode") +
      row("Hold space to talk", sw(P.wakeKey, "wakeKey")) +
      row("Memory", `<button class="btn small" type="button" data-act="mem">What Nexy remembers</button>`, "List, export or forget the conversations the agent keeps") +
      row("Routines", `<button class="btn small" type="button" data-act="routines">Show routines</button>`, "Prompts that run on a schedule, on this machine") +
      `<div class="sbtns"><button class="btn small" type="button" data-act="testVoice">Test the voice</button></div>`;
  }
  if (sec === "team") {
    const live = H.projects().filter((p) => p.taskCount && p.doneCount < p.taskCount);
    return `<h3>Team</h3><p class="sp">Own Startup staffs plans from a fixed roster. Each role runs on this machine, one task at a time; there is no per-agent budget because nothing is paid for.</p>` +
      H.roster.map((n) => row(esc(n), not(live.length ? "available to your plans" : "idle"))).join("") +
      row("Plans with work left", not(String(live.length)));
  }
  if (sec === "connections") {
    const tg = await telegramRow();
    try {
      const cat = await loadCatalog();
      return `<h3>Connections</h3>` + tg + `<p class="sp">Outside apps come from this machine's catalogue. Nexy asks before the first use of each one.</p>` +
        (cat.length ? cat.map((c) => row(esc(c.label), c.auth?.credentialStored ? not("Connected") : `<button class="btn small primary" type="button" data-act="conn" data-n="${esc(c.label)}">Connect</button>`,
          c.auth?.credentialStored ? `Scopes: ${esc((c.auth.grantedScopes ?? c.scopes ?? []).join(", ") || "as granted")}` : "Not connected")).join("") : row("Catalogue", not("Empty")));
    } catch (e) {
      return `<h3>Connections</h3>` + tg + row("Catalogue", not(`Not answering: ${(e as Error).message}`));
    }
  }
  if (sec === "data") return dataSection();
  if (sec === "permissions") return `<h3>Permissions</h3><p class="sp">What Nexy and its agents may touch on this machine.</p>` +
    row("Apps on this machine", not("Read: builds, images, beats, docs, plans"), "Nexy reads each app's own records and hands work back to the app that owns it") +
    row("Manage the desktop", not("Not available"), "Nexy has no control over the desktop's windows yet") +
    row("Install from the App Store", not("Restricted"), "Installs are switched off on this Own1, by the owner's decision") +
    row("Agents inherit these", null, "An agent never has more than Nexy");
  if (sec === "cloud") return `<h3>OwnXCloud</h3><p class="sp">Offloading heavy work to a region you choose is not connected on this Own1. Everything runs here.</p>` +
    row("Connection", not("Not connected")) + row("Spending", not("Nothing can be spent"), "There is no wallet or payment method on this machine");
  if (sec === "security") return `<h3>Security and privacy</h3>` +
    row("Where your data lives", not("On this Own1"), "Chats, files, builds and memory stay on this machine") +
    row("Telemetry", not("Off"), "Nothing is sent to OwnX Labs") +
    row("Ultra-private chats", not("In memory only"), "Nothing written to disk, nothing reaches the agent that keeps memory; gone when you leave") +
    row("Web search", not("Only when you ask"), "Through this machine's own search; the query is the only thing that leaves") +
    `<div class="sbtns"><button class="btn small" type="button" data-act="feedback">Show my feedback</button><button class="btn small" type="button" data-act="clearfb">Clear my feedback</button><button class="btn small" type="button" data-act="forget">Forget what Nexy remembers</button></div>`;
  if (sec === "appearance") return `<h3>Appearance</h3><h4>Theme</h4><div class="themes">` +
    ([["default", "Default", "the sunset, warm glass"], ["standard", "Standard", "black, no glass, like the chat apps"], ["cyberpunk", "Cyberpunk", "neon on black"],
      ["win95", "Windows 95", "bevels, teal, Tahoma"], ["lcars", "LCARS", "elbows, amber, lavender"], ["topgun", "Top Gun", "tarmac, sunset, chrome"]] as const)
      .map(([id, n, d]) => `<button type="button" class="theme${P.theme === id ? " sel" : ""}" data-theme="${id}"><span class="sw-${id}">${id === "topgun" ? "<i></i>" : ""}</span><b>${n}</b><small>${d}</small></button>`).join("") + `</div>` +
    `<h4>Background</h4>` + row("Your own image", `<button class="btn small" type="button" data-act="bg">Upload</button> <button class="btn small ghost" type="button" data-act="bgreset">Reset</button>`, "Stays in this browser, on this machine") +
    row("Reduce transparency", sw(P.reduce, "reduce")) + row("Text size", sel("size", [["compact", "Compact"], ["standard", "Standard"], ["medium", "Medium"], ["large", "Large"]], P.size));
  if (sec === "workspaces") {
    const n = H.projects().length;
    return `<h3>Workspaces</h3>` + row(esc($("#pmWsName")?.textContent?.trim() || "This Own1"), not(`${n} project${n === 1 ? "" : "s"}`)) + row("More workspaces", not("One per machine for now"));
  }
  return `<h3>About</h3>` + row("Nexy", not("On this Own1")) + row("The agent", not("On this machine"), "Private chats use the local model directly and are never kept") +
    row("Speech", not("Own Voice, on this machine")) + row("Web pages", not("Read on this machine"), "No cloud reader");
}

export async function renderSettings(sec = "general"): Promise<void> {
  const nav = $("#setNav"), body = $("#setBody");
  if (!nav || !body) return;
  nav.innerHTML = SECTIONS.map(([id, t]) => `<button type="button" class="snav${id === sec ? " active" : ""}" data-sec="${id}">${t}</button>`).join("");
  nav.querySelectorAll<HTMLElement>("[data-sec]").forEach((b) => b.addEventListener("click", () => void renderSettings(b.dataset.sec!)));
  body.innerHTML = await section(sec);
  body.querySelectorAll<HTMLElement>("[data-sw]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.sw as "speakAlways" | "wakeKey" | "notif" | "reduce"; P[k] = !P[k]; save(); applyPrefs(); void renderSettings(sec);
    if (k === "notif" && P.notif && "Notification" in window && Notification.permission === "default") void Notification.requestPermission();
  }));
  body.querySelectorAll<HTMLSelectElement>("[data-sel]").forEach((s) => s.addEventListener("change", () => {
    (P as any)[s.dataset.sel!] = s.value; save(); applyPrefs();
  }));
  body.querySelectorAll<HTMLInputElement>("[data-txt]").forEach((i) => i.addEventListener("change", () => {
    (P as any)[i.dataset.txt!] = i.value.trim().slice(0, 40); save(); applyPrefs();
  }));
  body.querySelectorAll<HTMLElement>("[data-theme]").forEach((b) => b.addEventListener("click", () => {
    P.theme = b.dataset.theme!; save(); applyPrefs(); void renderSettings("appearance");
    window.dispatchEvent(new CustomEvent("nexy:theme"));
    H.toast(({ default: "Default theme", standard: "Standard theme", cyberpunk: "Cyberpunk theme", win95: "Windows 95 theme", lcars: "LCARS theme", topgun: "Top Gun theme applied" } as Record<string, string>)[P.theme] ?? "Theme applied");
  }));
  body.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => b.addEventListener("click", () => void act(b.dataset.act!, b.dataset.n)));
  body.querySelectorAll<HTMLElement>("[data-dexp]").forEach((b) => b.addEventListener("click", () => exportData(b.dataset.dexp!)));
}

const close = () => $("#ovSet")?.classList.remove("open");
// Telegram: the owner's own bot, wired into the agent (Hermes' Telegram platform). Only shown
// where the server enables it (a private, signed-in Nexy); the token is never shown back.
type Tg = { enabled?: boolean; connected?: boolean; bot?: string; users?: string; error?: string };
const TG = "/api/v1/connections/telegram";
const field = "font:inherit;padding:6px 9px;border-radius:8px;border:1px solid var(--line2,#444);background:transparent;color:inherit;min-width:0";
async function telegramRow(): Promise<string> {
  let t: Tg;
  try {
    const r = await fetch(TG, { headers: { accept: "application/json" } });
    if (r.status === 404) return "";
    if (r.ok) { const d = await r.clone().json().catch(() => ({})); if (d?.enabled === false) return ""; }
    t = await r.json();
    if (!r.ok) return row("Telegram", not(t.error ?? `Not answering: ${httpMsg(r.status)}`));
  } catch (e) {
    return row("Telegram", not(`Not answering: ${(e as Error).message}`));
  }
  if (t.connected) return row("Telegram", `<span class="faint">Connected as @${esc(t.bot ?? "?")}</span> <button class="btn small ghost" type="button" data-act="tgoff">Disconnect</button>`,
    `Message the bot to talk to your agent. Only Telegram user ${esc(t.users ?? "")} can command it; in a group, @mention it.`);
  return `<div class="srow" style="flex-wrap:wrap;gap:8px"><div><div class="sl">Telegram</div><div class="ss">Talk to your agent from Telegram. Create a bot with @BotFather, and get your user ID from @userinfobot. Only that ID can command it.</div></div>` +
    `<div style="display:flex;gap:6px;flex-wrap:wrap;width:100%"><input id="tgToken" type="password" autocomplete="off" spellcheck="false" placeholder="Bot token" style="${field};flex:2 1 220px">` +
    `<input id="tgUsers" inputmode="numeric" autocomplete="off" placeholder="Your Telegram user ID" style="${field};flex:1 1 140px">` +
    `<button class="btn small primary" type="button" data-act="tgon">Connect</button></div></div>`;
}

async function act(a: string, n?: string): Promise<void> {
  if (a === "testVoice") {
    const r = await fetch("/api/apps/voice/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Hi, I am Nexy. I live on this machine.", voice_id: P.voice }) });
    if (!r.ok) { H.toast(`Own Voice did not answer: ${httpMsg(r.status)}`); return; }
    const url = URL.createObjectURL(await r.blob()); const au = new Audio(url); au.onended = () => URL.revokeObjectURL(url); void au.play();
    return;
  }
  if (a === "bg") { $<HTMLInputElement>("#bgPick")?.click(); return; }
  if (a === "bgreset") { P.bg = null; save(); applyPrefs(); H.toast("Background reset"); return; }
  const say: Record<string, string> = { mem: "what do you remember", routines: "show my routines", feedback: "show my feedback", clearfb: "clear my feedback", forget: "forget everything" };
  if (say[a]) { close(); await H.send(say[a]); return; }
  if (a === "conn" && n) { close(); await H.send(`Connect ${n}`); }
  if (a === "tgon") {
    const token = $<HTMLInputElement>("#tgToken")?.value.trim() ?? "", users = $<HTMLInputElement>("#tgUsers")?.value.trim() ?? "";
    const r = await fetch(TG, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, users }) });
    const d = (await r.json().catch(() => ({}))) as Tg & { ok?: boolean };
    H.toast(r.ok ? `Connected @${d.bot}. Give the agent a few seconds, then message it.` : (d.error ?? `Could not connect: ${httpMsg(r.status)}`));
    if (r.ok) void renderSettings("connections");
  }
  if (a === "tgoff") {
    if (!confirm("Disconnect Telegram? The bot stops answering until you connect it again.")) return;
    const r = await fetch(TG, { method: "DELETE" });
    H.toast(r.ok ? "Telegram disconnected" : `Could not disconnect: ${httpMsg(r.status)}`);
    void renderSettings("connections");
  }
}

export function openSettings(sec = "general"): void {
  $("#pmenu")?.classList.remove("open");
  $("#ovSet")?.classList.add("open");
  void renderSettings(sec);
}

export function initSettings(hooks: SettingsHooks): void {
  H = hooks;
  applyPrefs();
  $("#settingsBtn")?.addEventListener("click", () => openSettings("general"));
  $("#pmTeam")?.addEventListener("click", () => openSettings("team"));
  $("#pmConn")?.addEventListener("click", () => openSettings("connections"));
  document.querySelector("#ovSet [data-close]")?.addEventListener("click", close);
  const pick = $<HTMLInputElement>("#bgPick");
  pick?.addEventListener("change", () => {
    const f = pick.files?.[0]; pick.value = "";
    if (!f) return;
    if (f.size > 3_000_000) { H.toast("That image is over 3 MB; pick a smaller one"); return; }
    const rd = new FileReader();
    rd.onload = () => { P.bg = String(rd.result); save(); applyPrefs(); H.toast("Background set, in this browser"); };
    rd.readAsDataURL(f);
  });
}

export function notify(body: string): void {
  if (!P.notif || !document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
  new Notification("Nexy", { body });
}

interface DataRow { name: string; sub: string; count: number; bytes: number | null; list: unknown[] }

async function dataRows(): Promise<DataRow[]> {
  const get = async (path: string, key: string): Promise<Record<string, unknown>[]> => {
    const r = await fetch(`/api/apps/${path}`);
    if (!r.ok) throw new Error(httpMsg(r.status));
    const d = await r.json() as Record<string, unknown>;
    return (Array.isArray(d) ? d : d[key] ?? []) as Record<string, unknown>[];
  };
  const sum = (l: Record<string, unknown>[]) => l.reduce((a, x) => a + (Number(x.bytes) || 0), 0);
  const src: [string, string, string, string, boolean][] = [
    ["Images", "made or saved in Own Image Studio", "images/api/history?limit=200", "entries", true],
    ["Beats and voice takes", "Own Beat Studio", "beat/api/history?limit=200", "entries", true],
    ["Documents", "uploaded to Own Docs, read on this machine", "docs/api/v1/documents", "docs", true],
    ["Sites and apps", "built by Qiki and Own Build", "qiki/api/v1/director/runs", "runs", false],
    ["Projects", "plans in Own Startup", "startup/api/pm/projects", "projects", false],
  ];
  return Promise.all(src.map(async ([name, sub, path, key, sized]) => {
    try {
      const l = await get(path, key);
      return { name, sub, count: l.length, bytes: sized ? sum(l) : null, list: l };
    } catch (e) {
      return { name, sub: `not answering: ${(e as Error).message}`, count: 0, bytes: null, list: [] };
    }
  }));
}

const fmtB = (b: number) => b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;
let dataCache: DataRow[] = [];

async function dataSection(): Promise<string> {
  dataCache = await dataRows();
  const total = dataCache.reduce((a, r) => a + (r.bytes ?? 0), 0) || 1;
  const lock = `<svg class="i" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
  return `<h3>Your data</h3><div class="securebox">${lock}<div><b>All of it is on this machine.</b><span>Nothing here is synced or mirrored; each app keeps its own records on this Own1. Sizes are what each app reports${total > 1 ? `, ${fmtB(total)} in all` : ""}.</span></div></div>` +
    `<div class="datalist">` + dataCache.map((r, i) =>
      `<div class="drow"><span class="led${r.list.length || r.count ? " ok" : " off"}"></span><div class="dl"><b>${esc(r.name)}</b><small>${esc(r.sub)} · ${r.count} item${r.count === 1 ? "" : "s"}</small></div>` +
      `<span class="dsz num">${r.bytes === null ? "—" : fmtB(r.bytes)}</span><span class="dbar"><i style="width:${r.bytes ? Math.max(2, (r.bytes / total) * 100) : 0}%"></i></span>` +
      `<button class="btn small ghost" type="button" data-dexp="${i}">Export</button></div>`).join("") + `</div>` +
    row("Chat history", not("kept in this browser tab only; not stored on the machine")) +
    row("Export everything", `<button class="btn small" type="button" data-dexp="all">Export</button>`, "One JSON file listing everything above");
}

function exportData(which: string): void {
  const rows = which === "all" ? dataCache : [dataCache[Number(which)]].filter(Boolean);
  const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), machine: "Own1", items: rows.map((r) => ({ category: r.name, count: r.count, bytes: r.bytes, list: r.list })) }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `nexy-${which === "all" ? "everything" : rows[0]?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "data"}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  H.toast(`Exported ${which === "all" ? "everything" : rows[0]?.name ?? ""}`);
}
