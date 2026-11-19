import { loadEngines, type Caps, type EngineList } from "./engines";
import { boxHere, hasApp, here, inCloud, isBeta, localVoice, onOwn1, voiceApi } from "./place";
import { reportDefaults, setReportDefaults, type ReportDefaults } from "./problem-report";

// where this Nexy and its data are, said plainly
const onHere = onOwn1 ? "On this Own1" : inCloud ? "On Nexy Cloud's server" : "On this computer";
import { APP_PASSWORDS, HUB, connectAppPassword, loadCatalog, loadGrants, pauseConnector, resumeConnector, revokeConnector, type CatalogEntry } from "./perm";
import { httpMsg, errText } from "./http";

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
  ["cloud", "Nexy Cloud"], ["data", "Your data"], ["security", "Security and privacy"], ["appearance", "Appearance"], ["workspaces", "Workspaces"], ["about", "About"]];

const sw = (on: boolean, id: string) => `<button type="button" class="sw${on ? " on" : ""}" data-sw="${id}" role="switch" aria-checked="${on}"><i></i></button>`;
const row = (l: string, c: string | null, sub?: string) => `<div class="srow"><div><div class="sl">${l}</div>${sub ? `<div class="ss">${sub}</div>` : ""}</div><div class="sc">${c ?? ""}</div></div>`;
const sel = (id: string, opts: [string, string][], val: string) => `<select data-sel="${id}">${opts.map(([v, t]) => `<option value="${esc(v)}"${v === val ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
const not = (why: string) => `<span class="faint">${esc(why)}</span>`;

export function applyPrefs(): void {
  document.body.dataset.theme = P.theme === "default" ? "" : P.theme;
  document.body.dataset.size = P.size === "standard" ? "" : P.size;
  document.body.classList.toggle("reduce", P.reduce);
  const wp = $(".wp"); if (wp) wp.style.backgroundImage = P.bg ? `url("${P.bg}")` : "";
  document.body.classList.toggle("ownbg", !!P.bg);
  if (P.name) document.querySelectorAll(".user .n, .pm-h .n").forEach((n) => { n.textContent = P.name; });
}

const speech = localVoice ? "Speech" : "Own Voice";
// this machine has its own web search (an Own1's, or one configured on this computer)
const searchHere = typeof document !== "undefined" && document.documentElement.dataset.search === "1";
let voices: { id: string; name: string }[] = [];
async function loadVoices(): Promise<void> {
  if (voices.length || !hasApp("voice")) return;
  const r = await fetch(voiceApi("voices")).then((x) => x.json()).catch((e) => { console.warn("[nexy] voices unavailable", e); return {}; });
  voices = (r.voices ?? []).map((v: any) => ({ id: String(v.id), name: String(v.name ?? v.id).replace(/^en_US-/, "").replace(/-/g, " ") }));
  // this computer speaks in its own default voice until one is picked
  if (localVoice && voices.length) voices.unshift({ id: "", name: "This computer's voice" });
}
const pickedVoice = () => (voices.some((v) => v.id === P.voice) ? P.voice : localVoice ? "" : P.voice);

// memory across chats and routines: the box owner's, so offered only where the server allows them,
// and only where the engine in use keeps them
const boxRows = (c: Caps): string => !boxHere
  ? row("Memory and routines", not("Need your own Nexy"), "Memory across chats, and prompts that run later, are for the owner of this Nexy")
  : (c.memory ? row("Memory", `<button class="btn small" type="button" data-act="mem">What Nexy remembers</button>`, "List, export or forget the conversations the agent keeps")
    : row("Memory", not("None to show"), "This engine keeps no memory Nexy can show")) +
    (c.routines ? row("Routines", `<button class="btn small" type="button" data-act="routines">Show routines</button>`, "Prompts that run on a schedule or when an email or file arrives, on this machine")
    : row("Routines", not("Not with this engine"), "This engine has no routines Nexy can set"));

async function section(sec: string): Promise<string> {
  if (sec === "general") return `<h3>General</h3>` +
    row("Your name", `<input data-txt="name" value="${esc(P.name || $(".user .n")?.textContent?.trim() || "")}">`, "Shown in the sidebar, on this browser") +
    row("Language", sel("lang", [["en", "English"]], "en")) +
    row("Open at login", not("Nexy is ready before you sit down")) +
    row("Notifications", sw(P.notif, "notif"), "Approvals, finished work, and nothing else") +
    (hasApp("startup") ? row("Where new projects live", sel("defloc", [["own1", "Own 1, this desk"]], "own1")) : "");
  if (sec === "nexy") {
    await loadVoices();
    const list = await loadEngines(true), caps = capsIn(list);
    const o1 = await own1Row();
    if (!hasApp("voice")) return `<h3>Nexy</h3>` + engineRow(list) + o1 +
      row("Voice", not("Coming in an update"), "Talking to Nexy on this computer arrives in an update") +
      boxRows(caps);
    return `<h3>Nexy</h3>` + engineRow(list) + o1 +
      row("Voice", voices.length ? sel("voice", voices.map((v) => [v.id, v.name]), pickedVoice()) : not(`${speech} is not answering`), localVoice ? "Spoken by this computer's own voices; nothing leaves it" : "Spoken by Own Voice on this machine") +
      row("Speak replies aloud", sw(P.speakAlways, "speakAlways"), "Off: only in voice mode") +
      row("Hold space to talk", sw(P.wakeKey, "wakeKey")) +
      boxRows(caps) +
      `<div class="sbtns"><button class="btn small" type="button" data-act="testVoice">Test the voice</button></div>`;
  }
  if (sec === "team" && !hasApp("startup")) return `<h3>Team</h3><p class="sp">A team of agents working through a plan runs on an Own1 or Nexy Cloud. On this computer, Nexy is one assistant.</p>`;
  if (sec === "team") {
    const live = H.projects().filter((p) => p.taskCount && p.doneCount < p.taskCount);
    return `<h3>Team</h3><p class="sp">Own Startup staffs plans from a fixed roster. Each role runs on this machine, one task at a time; there is no per-agent budget because nothing is paid for.</p>` +
      H.roster.map((n) => row(esc(n), not(live.length ? "available to your plans" : "idle"))).join("") +
      row("Plans with work left", not(String(live.length)));
  }
  if (sec === "connections" && !hasApp("hub")) return `<h3>Connections</h3>` + await telegramRow() +
    `<p class="sp">Connecting outside apps like Gmail and Drive is coming to Nexy on this computer in an update.</p>`;
  if (sec === "connections") {
    const tg = await telegramRow();
    try {
      const cat = await loadCatalog();
      catalog = cat;
      const google = cat.some((c) => c.id === "gmail" || c.id === "drive") ? await googleRow() : "";
      // without the grants list, Pause and Resume can't be told apart, so they are not offered
      const granted = await loadGrants().catch((e) => { console.warn("[nexy] grants unavailable", e); return null; });
      return `<h3>Connections</h3>` + tg + `<p class="sp">Outside apps come from this machine's catalogue. Nexy asks before the first use of each one.</p>` + google +
        (cat.length ? cat.map((c) => (c.auth?.type === "app_password" ? appPasswordRow(c, granted) : connRow(c, granted))).join("") : row("Catalogue", not("Empty")));
    } catch (e) {
      return `<h3>Connections</h3>` + tg + row("Catalogue", not(`Not answering: ${errText(e)}`));
    }
  }
  if (sec === "data") return dataSection();
  if (sec === "permissions") return `<h3>Permissions</h3><p class="sp">What Nexy and its agents may touch on this machine.</p>` +
    (onOwn1 ? row("Apps on this machine", not("Read: builds, images, beats, docs, plans"), "Nexy reads each app's own records and hands work back to the app that owns it") : "") +
    row("Manage the desktop", not("Not available"), "Nexy has no control over the desktop's windows yet") +
    (onOwn1 ? row("Install from the App Store", not("Restricted"), "Installs are switched off on this Own1, by the owner's decision") : "") +
    row("Agents inherit these", null, "An agent never has more than Nexy");
  if (sec === "cloud") return `<h3>Nexy Cloud</h3><p class="sp">Offloading heavy work to a region you choose is not connected on ${here}. Everything runs here.</p>` +
    row("Connection", not("Not connected")) + row("Spending", not("Nothing can be spent"), "There is no wallet or payment method on this machine");
  const forgets = sec === "security" && boxHere && capsIn(await loadEngines()).memory;
  if (sec === "security") return `<h3>Security and privacy</h3>` +
    row("Where your data lives", not(onHere), inCloud ? "Chats and files stay on this server, which OwnX runs" : "Chats, files, builds and memory stay on this machine") +
    row("Telemetry", not("Off"), inCloud ? "Nothing is sent anywhere beyond this server" : isBeta ? "Nothing is sent to OwnX Labs except a beta report you choose to send" : "Nothing is sent to OwnX Labs") +
    (isBeta ? betaReportRows() : "") +
    row("Ultra-private chats", not("In memory only"), "Nothing written to disk, nothing reaches the agent that keeps memory; gone when you leave") +
    (searchHere ? row("Web search", not("Only when you ask"), // the search runs here but asks the search engines directly (privacy engineering doc, §3.5)
      `Through this machine's own search, never through OwnX. The search engines it asks see your query and ${onOwn1 ? "this Own1's" : inCloud ? "Nexy Cloud's" : "this computer's"} IP address, and so do pages Nexy opens`)
      : row("Web search", not("Not set up"), `There is no web search on ${here} yet, so nothing is searched`)) +
    `<div class="sbtns"><button class="btn small" type="button" data-act="feedback">Show my feedback</button><button class="btn small" type="button" data-act="clearfb">Clear my feedback</button>${forgets ? `<button class="btn small" type="button" data-act="forget">Forget what Nexy remembers</button>` : ""}</div>`;
  if (sec === "appearance") return `<h3>Appearance</h3><h4>Theme</h4><div class="themes">` +
    ([["default", "Default", "the aurora, glass"], ["standard", "Standard", "black, no glass, like the chat apps"], ["cyberpunk", "Cyberpunk", "neon on black"],
      ["win95", "Windows 95", "bevels, teal, Tahoma"], ["lcars", "LCARS", "elbows, amber, lavender"], ["topgun", "Top Gun", "tarmac, sunset, chrome"]] as const)
      .map(([id, n, d]) => `<button type="button" class="theme${P.theme === id ? " sel" : ""}" data-theme="${id}"><span class="sw-${id}">${id === "topgun" ? "<i></i>" : ""}</span><b>${n}</b><small>${d}</small></button>`).join("") + `</div>` +
    `<h4>Background</h4>` + row("Your own image", `<button class="btn small" type="button" data-act="bg">Upload</button> <button class="btn small ghost" type="button" data-act="bgreset">Reset</button>`, "Stays in this browser, on this machine") +
    row("Reduce transparency", sw(P.reduce, "reduce")) + row("Text size", sel("size", [["compact", "Compact"], ["standard", "Standard"], ["medium", "Medium"], ["large", "Large"]], P.size));
  if (sec === "workspaces") {
    const n = H.projects().length;
    return `<h3>Workspaces</h3>` + row(esc($("#pmWsName")?.textContent?.trim() || (onOwn1 ? "This Own1" : inCloud ? "Nexy Cloud" : "This computer")), not(`${n} project${n === 1 ? "" : "s"}`)) + row("More workspaces", not("One per machine for now"));
  }
  return `<h3>About</h3>` + row("Nexy", not(onHere)) + await versionRows() + row("The agent", not("On this machine"), "Private chats use the local model directly and are never kept") +
    row("Speech", not(localVoice ? "On this computer" : hasApp("voice") ? "Own Voice, on this machine" : "Coming in an update")) + row("Web pages", not("Read on this machine"), "No cloud reader");
}

// the desktop app's version and its last update check; nothing on an Own1, which has neither
type About = { version?: string; update?: { state: string; version?: string } | null };
const updateLine = (u: About["update"]): string =>
  !u ? "Not checked yet" : u.state === "current" ? "Up to date" : u.state === "available" ? `Nexy ${u.version ?? "update"} is ready: install it from Nexy Home` : "Couldn't check just now; Nexy tries again later";
async function versionRows(): Promise<string> {
  const a: About = await fetch("/api/v1/about").then((r) => r.json()).catch((e) => { console.warn("[nexy] version unavailable", e); return {}; });
  return a.version ? row("Version", not(`Nexy ${a.version}`)) + row("Updates", not(updateLine(a.update))) : "";
}

// a connected app is in use or paused (sign-in kept, Nexy's grant dropped); Disconnect deletes the sign-in
let catalog: CatalogEntry[] = [];
function connRow(c: CatalogEntry, granted: string[] | null): string {
  const n = esc(c.label), id = esc(c.id);
  if (!c.auth?.credentialStored) return row(n, `<button class="btn small primary" type="button" data-act="conn" data-n="${n}">Connect</button>`, "Not connected");
  const disc = `<button class="btn small ghost" type="button" data-act="disc" data-n="${n}">Disconnect</button>`;
  const scopes = `Scopes: ${esc((c.auth.grantedScopes ?? c.scopes ?? []).map((x) => x.split("/").pop()).join(", ") || "as granted")}`;
  if (granted && !granted.includes(c.id)) return row(n, `<span class="faint paused">Paused — Nexy can't read it</span> <button class="btn small" type="button" data-act="resume" data-n="${id}">Resume</button> ${disc}`, scopes);
  const pause = granted ? ` <button class="btn small ghost" type="button" data-act="pause" data-n="${id}">Pause</button>` : "";
  return row(n, `<span class="faint connected">Connected</span>${pause} ${disc}`, granted ? scopes : `${scopes}. Nexy's access can't be read right now`);
}

// the agent engine for new chats; names come from the server, which lists what runs here
// what the engine in use keeps; without a list, the one engine here, which keeps both
const capsIn = (r: EngineList | null): Caps => {
  const cur = r?.engines.find((e) => e.id === r.selected) ?? r?.engines[0];
  return { memory: cur?.memory !== false, routines: cur?.routines !== false };
};
function engineRow(r: EngineList | null): string {
  // engine names show only where there is a real choice between them
  if (!r || r.engines.length < 2) return "";
  const def = r.engines.find((e) => e.id === r.default) ?? r.engines[0];
  const cur = r.engines.find((e) => e.id === r.selected) ?? def;
  const name = (e: typeof cur) => e.id === def.id ? `${e.label} (default)` : e.label;
  return row("Agent engine", `<select data-engine>${r.engines.map((e) => `<option value="${esc(e.id)}"${e.id === cur.id ? " selected" : ""}>${esc(name(e))}</option>`).join("")}</select>`,
    `${esc(cur.note)}. Applies to new chats; each chat stays with the engine it started on.`);
}

// Nexy Cloud: John's Own1 answers this person's chats while it is free; off unless they switch it on
const OWN1 = "/api/v1/own1";
async function own1Row(): Promise<string> {
  if (document.documentElement.dataset.place !== "cloud") return "";
  const o = await fetch(OWN1).then((r) => (r.ok ? r.json() : null)).catch((e) => { console.warn("[nexy] Own 1 setting unavailable", e); return null; });
  if (!o?.offered) return "";
  return row("Use John's Own 1 when it's free", `<button type="button" class="sw${o.on ? " on" : ""}" data-own1 role="switch" aria-checked="${!!o.on}" aria-label="Use John's Own 1 when it's free"><i></i></button>`,
    "Best effort for performance, no privacy guarantees: your messages are answered on a computer in John's home.");
}

// the same choices the report window keeps with "Remember my choices": one setting, two places
const REPORT_PARTS: [keyof ReportDefaults, string, string][] = [
  ["state", "What the app was doing", "Recent errors and failed requests"],
  ["logs", "App logs", "The last 200 lines, keys and tokens removed"],
  ["hardware", "Hardware", "OS, CPU, RAM, graphics, free disk, tier and model; never serial numbers, names or addresses"],
];
function betaReportRows(): string {
  const d = reportDefaults();
  return `<h4>Beta reports</h4>` +
    row("Sent", not("Only when you press Send"), "From the BETA button or a chat's Report this chat. You see exactly what goes first") +
    REPORT_PARTS.map(([k, l, sub]) => row(`Include ${l.charAt(0).toLowerCase()}${l.slice(1)}`, `<button type="button" class="sw${d[k] ? " on" : ""}" data-rsw="${k}" role="switch" aria-checked="${d[k]}" aria-label="${l}"><i></i></button>`, sub)).join("") +
    row("This conversation", not("Never by default"), "Only when you switch it on in the report, and only that chat");
}

export async function renderSettings(sec = "general"): Promise<void> {
  const nav = $("#setNav"), body = $("#setBody");
  if (!nav || !body) return;
  nav.innerHTML = SECTIONS.map(([id, t]) => `<button type="button" class="snav${id === sec ? " active" : ""}" data-sec="${id}">${t}</button>`).join("");
  nav.querySelectorAll<HTMLElement>("[data-sec]").forEach((b) => b.addEventListener("click", () => void renderSettings(b.dataset.sec!)));
  body.innerHTML = await section(sec);
  // an app connected here ticks "Connect an app" in Get started
  if (sec === "connections" && body.querySelector('[data-act="tgoff"], .sc .connected')) window.dispatchEvent(new CustomEvent("nexy:did", { detail: "apps" }));
  body.querySelectorAll<HTMLElement>("[data-sw]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.sw as "speakAlways" | "wakeKey" | "notif" | "reduce"; P[k] = !P[k]; save(); applyPrefs(); void renderSettings(sec);
    if (k === "notif" && P.notif && "Notification" in window && Notification.permission === "default") void Notification.requestPermission();
  }));
  body.querySelectorAll<HTMLElement>("[data-rsw]").forEach((b) => b.addEventListener("click", () => {
    const d = reportDefaults(), k = b.dataset.rsw as keyof ReportDefaults;
    setReportDefaults({ state: d.state, logs: d.logs, hardware: d.hardware, [k]: !d[k] });
    void renderSettings(sec);
  }));
  body.querySelectorAll<HTMLSelectElement>("[data-sel]").forEach((s) => s.addEventListener("change", () => {
    (P as any)[s.dataset.sel!] = s.value; save(); applyPrefs();
  }));
  body.querySelectorAll<HTMLSelectElement>("[data-engine]").forEach((s) => s.addEventListener("change", async () => {
    const r = await fetch("/api/v1/engines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: s.value }) }).catch(() => null);
    H.toast(r?.ok ? `New chats will use ${s.selectedOptions[0]?.textContent ?? s.value}` : "The engine wasn't changed");
    await loadEngines(true);
    void renderSettings(sec);
  }));
  body.querySelectorAll<HTMLElement>("[data-own1]").forEach((b) => b.addEventListener("click", async () => {
    const want = b.getAttribute("aria-checked") !== "true";
    const r = await fetch(OWN1, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: want }) }).catch(() => null);
    if (!r?.ok) H.toast("The setting wasn't changed");
    void renderSettings(sec);
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
  body.querySelectorAll<HTMLInputElement>("#apEmail, #apPass").forEach((i) => i.addEventListener("input", () => apNote("")));
  body.querySelectorAll<HTMLElement>("[data-dexp]").forEach((b) => b.addEventListener("click", () => exportData(b.dataset.dexp!)));
}

const close = () => $("#ovSet")?.classList.remove("open");
// Telegram: the owner's own bot, wired into the agent. Only shown
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
    return row("Telegram", not(`Not answering: ${errText(e)}`));
  }
  if (t.connected) return row("Telegram", `<span class="faint">Connected as @${esc(t.bot ?? "?")}</span> <button class="btn small ghost" type="button" data-act="tgoff">Disconnect</button>`,
    `Message the bot to talk to your agent. Only Telegram user ${esc(t.users ?? "")} can command it; in a group, @mention it.`);
  return `<div class="srow" style="flex-wrap:wrap;gap:8px"><div><div class="sl">Telegram</div><div class="ss">Talk to your agent from Telegram. Create a bot with @BotFather, and get your user ID from @userinfobot. Only that ID can command it.</div></div>` +
    `<div style="display:flex;gap:6px;flex-wrap:wrap;width:100%"><input id="tgToken" type="password" autocomplete="off" spellcheck="false" placeholder="Bot token" style="${field};flex:2 1 220px">` +
    `<input id="tgUsers" inputmode="numeric" autocomplete="off" placeholder="Your Telegram user ID" style="${field};flex:1 1 140px">` +
    `<button class="btn small primary" type="button" data-act="tgon">Connect</button></div></div>`;
}

// Gmail with an app password: no Google Cloud project. The password goes from the field straight
// to the connector hub, which checks it with Gmail and keeps it sealed; this page never stores it.
function appPasswordRow(c: CatalogEntry, granted: string[] | null): string {
  const n = esc(c.label), id = esc(c.id);
  if (c.auth?.credentialStored) {
    const off = `<button class="btn small ghost" type="button" data-act="apoff" data-n="${id}">Disconnect</button>`;
    const sub = "Read-only. Disconnect deletes it here; also remove it in your Google account";
    if (granted && !granted.includes(c.id)) return row(n, `<span class="faint paused">Paused — Nexy can't read it</span> <button class="btn small" type="button" data-act="resume" data-n="${id}">Resume</button> ${off}`, sub);
    const pause = granted ? ` <button class="btn small ghost" type="button" data-act="pause" data-n="${id}">Pause</button>` : "";
    return row(n, `<span class="faint connected">Connected</span>${pause} ${off}`, granted ? sub : `${sub}. Nexy's access can't be read right now`);
  }
  return `<div class="srow" style="flex-wrap:wrap;gap:8px"><div><div class="sl">${n}</div><div class="ss"><div>1. Turn on 2-Step Verification in your Google account.<br>` +
    `2. Create an app password at <a href="${APP_PASSWORDS}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">myaccount.google.com/apppasswords</a>.<br>` +
    `3. Paste it here. Nexy reads your mail, read-only. Work or school accounts may not offer app passwords.</div></div></div>` +
    `<div style="display:flex;gap:6px;flex-wrap:wrap;width:100%"><input id="apEmail" type="email" autocomplete="off" spellcheck="false" placeholder="Your Gmail address" style="${field};flex:1 1 180px">` +
    `<input id="apPass" type="password" autocomplete="off" spellcheck="false" placeholder="App password" style="${field};flex:1 1 180px">` +
    `<button class="btn small primary" type="button" data-act="apon" data-n="${id}">Connect</button></div>` +
    `<div id="apNote" class="ss" role="alert" style="width:100%;display:none"></div></div>`;
}

// Gmail's refusal stays on the card until the owner edits a field or tries again: as a toast it
// was gone in 3 s, before it could be read
function apNote(text: string): void {
  const el = $<HTMLElement>("#apNote");
  if (!el) return;
  el.textContent = text;
  // .ss sets its own display, which would show a [hidden] note
  el.style.display = text ? "" : "none";
}

// Gmail and Drive sign in with a Google OAuth client (type Desktop app). The owner's own, from
// their Google Cloud project, is kept by the connector hub on this machine; its secret is never shown.
const GCLIENT = `${HUB.replace(/\/registry$/, "")}/connectors/google`;
async function googleRow(): Promise<string> {
  let g: { configured?: boolean; source?: string | null; clientIdEnd?: string | null; error?: string };
  try {
    const r = await fetch(GCLIENT);
    g = await r.json();
    if (!r.ok) return row("Google sign-in", not(g.error ?? `Not answering: ${httpMsg(r.status)}`));
  } catch (e) {
    return row("Google sign-in", not(`Not answering: ${errText(e)}`));
  }
  const pick = `<input type="file" id="gClientPick" accept="application/json,.json" hidden>`;
  if (g.configured) return row("Google sign-in", `<span class="faint">${g.source === "owner" ? `Your OAuth client …${esc(g.clientIdEnd ?? "")}` : "Built in"}</span>` +
    (g.source === "owner" ? ` <button class="btn small ghost" type="button" data-act="gclientoff">Remove</button>` : ""), "Gmail and Drive sign in through it, in your browser");
  return row("Google sign-in", `<button class="btn small" type="button" data-act="gclient">Choose the client file…</button>${pick}`,
    "Gmail and Drive need a Google OAuth client of type Desktop app, from your Google Cloud project with the Gmail and Drive APIs turned on. Download its JSON file and choose it here. It stays on this computer.");
}

async function act(a: string, n?: string): Promise<void> {
  if (a === "testVoice") {
    const r = await fetch(voiceApi("tts"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Hi, I am Nexy. I live on this machine.", voice_id: P.voice }) });
    if (!r.ok) { H.toast(`${speech} did not answer: ${httpMsg(r.status)}`); return; }
    const url = URL.createObjectURL(await r.blob()); const au = new Audio(url); au.onended = () => URL.revokeObjectURL(url); void au.play();
    return;
  }
  if (a === "bg") { $<HTMLInputElement>("#bgPick")?.click(); return; }
  if (a === "bgreset") { P.bg = null; save(); applyPrefs(); H.toast("Background reset"); return; }
  const say: Record<string, string> = { mem: "what do you remember", routines: "show my routines", feedback: "show my feedback", clearfb: "clear my feedback", forget: "forget everything" };
  if (say[a]) { close(); await H.send(say[a]); return; }
  if (a === "conn" && n) { close(); await H.send(`Connect ${n}`); }
  if (a === "disc" && n) { close(); await H.send(`Disconnect ${n}`); }
  if ((a === "pause" || a === "resume") && n) {
    const entry = catalog.find((c) => c.id === n);
    if (!entry) { H.toast("That app is no longer in this machine's catalogue"); void renderSettings("connections"); return; }
    const out = await (a === "pause" ? pauseConnector(entry) : resumeConnector(entry)).catch((e): { ok: false; note: string } => {
      console.warn(`[nexy] ${a} ${entry.id} failed`, e);
      return { ok: false, note: `Not changed — ${errText(e)}` };
    });
    H.toast(out.note);
    void renderSettings("connections");
  }
  if ((a === "apon" || a === "apoff") && n) {
    const entry = catalog.find((c) => c.id === n);
    if (!entry) { H.toast("That app is no longer in this machine's catalogue"); void renderSettings("connections"); return; }
    if (a === "apoff") {
      if (!confirm(`Disconnect ${entry.label}? Nexy deletes the app password from this machine. Also remove it in your Google account at myaccount.google.com/apppasswords; Nexy can't do that for you.`)) return;
      const out = await revokeConnector(entry).catch((e): { ok: false; note: string } => {
        console.warn(`[nexy] disconnect ${entry.id} failed`, e);
        return { ok: false, note: `Not disconnected — ${errText(e)}` };
      });
      H.toast(out.note);
      void renderSettings("connections");
      return;
    }
    const email = $<HTMLInputElement>("#apEmail")?.value.trim() ?? "";
    const pass = $<HTMLInputElement>("#apPass");
    if (!email || !pass?.value.trim()) { apNote("Enter your Gmail address and the app password"); return; }
    apNote("Checking with Gmail…");
    const out = await connectAppPassword(entry, email, pass.value).catch((e): { ok: false; note: string } => {
      console.warn(`[nexy] connect ${entry.id} failed`, e);
      return { ok: false, note: `Not connected — ${errText(e)}` };
    });
    if (out.ok) { H.toast(out.note); pass.value = ""; void renderSettings("connections"); }
    else apNote(out.note);
    return;
  }
  if (a === "gclient") {
    const input = $<HTMLInputElement>("#gClientPick");
    if (!input) return;
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const r = await fetch(`${GCLIENT}?as=nexy`, { method: "PUT", headers: { "content-type": "application/json" }, body: await file.text() });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      H.toast(r.ok ? "Google sign-in is set up. Connect Gmail or Drive below." : (d.error ?? `Not saved: ${httpMsg(r.status)}`));
      void renderSettings("connections");
    };
    input.click();
  }
  if (a === "gclientoff") {
    if (!confirm("Remove your Google OAuth client? Connected apps keep working until their sign-in needs renewing.")) return;
    const r = await fetch(`${GCLIENT}?as=nexy`, { method: "DELETE", headers: { "content-type": "application/json" } });
    H.toast(r.ok ? "Google OAuth client removed" : `Not removed: ${httpMsg(r.status)}`);
    void renderSettings("connections");
  }
  if (a === "tgon") {
    const token = $<HTMLInputElement>("#tgToken")?.value.trim() ?? "", users = $<HTMLInputElement>("#tgUsers")?.value.trim() ?? "";
    const r = await fetch(TG, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, users }) });
    const d = (await r.json().catch(() => ({}))) as Tg & { ok?: boolean };
    H.toast(r.ok ? `Connected @${d.bot}. Give the agent a few seconds, then message it.` : (d.error ?? `Could not connect: ${httpMsg(r.status)}`));
    if (r.ok) void renderSettings("connections");
  }
  if (a === "tgoff") {
    if (!confirm("Disconnect Telegram? The bot stops answering until you connect it again.")) return;
    const r = await fetch(TG, { method: "DELETE", headers: { "content-type": "application/json" } });
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
  return Promise.all(src.filter(([, , path]) => hasApp(path.split("/")[0])).map(async ([name, sub, path, key, sized]) => {
    try {
      const l = await get(path, key);
      return { name, sub, count: l.length, bytes: sized ? sum(l) : null, list: l };
    } catch (e) {
      return { name, sub: `not answering: ${errText(e)}`, count: 0, bytes: null, list: [] };
    }
  }));
}

const fmtB = (b: number) => b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;
let dataCache: DataRow[] = [];

// chats are kept by this Nexy's own server, per owner; ultra-private ones never reach it
async function chatRow(): Promise<DataRow> {
  const sub = "saved by Nexy on this machine, for you only; ultra-private chats are never kept";
  try {
    const r = await fetch("/api/v1/chats");
    if (!r.ok) throw new Error(httpMsg(r.status));
    const l = ((await r.json()) as { chats?: Record<string, unknown>[] }).chats ?? [];
    return { name: "Chats", sub, count: l.length, bytes: null, list: l };
  } catch (e) {
    return { name: "Chats", sub: `not answering: ${errText(e)}`, count: 0, bytes: null, list: [] };
  }
}

async function dataSection(): Promise<string> {
  const [chats, rows] = await Promise.all([chatRow(), dataRows()]);
  dataCache = [chats, ...rows];
  const total = dataCache.reduce((a, r) => a + (r.bytes ?? 0), 0) || 1;
  const lock = `<svg class="i" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
  return `<h3>Your data</h3><div class="securebox">${lock}<div><b>All of it is on this machine.</b><span>Nothing here is synced or mirrored; each app keeps its own records on ${here}. Sizes are what each app reports${total > 1 ? `, ${fmtB(total)} in all` : ""}.</span></div></div>` +
    `<div class="datalist">` + dataCache.map((r, i) =>
      `<div class="drow"><span class="led${r.list.length || r.count ? " ok" : " off"}"></span><div class="dl"><b>${esc(r.name)}</b><small>${esc(r.sub)} · ${r.count} item${r.count === 1 ? "" : "s"}</small></div>` +
      `<span class="dsz num">${r.bytes === null ? "—" : fmtB(r.bytes)}</span><span class="dbar"><i style="width:${r.bytes ? Math.max(2, (r.bytes / total) * 100) : 0}%"></i></span>` +
      `<button class="btn small ghost" type="button" data-dexp="${i}">Export</button></div>`).join("") + `</div>` +
    row("Ultra-private chats", not("Never saved"), "Kept in this tab only and gone when you leave it") +
    row("Export everything", `<button class="btn small" type="button" data-dexp="all">Export</button>`, "One JSON file listing everything above");
}

function exportData(which: string): void {
  const rows = which === "all" ? dataCache : [dataCache[Number(which)]].filter(Boolean);
  const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), machine: onOwn1 ? "Own1" : "computer", items: rows.map((r) => ({ category: r.name, count: r.count, bytes: r.bytes, list: r.list })) }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `nexy-${which === "all" ? "everything" : rows[0]?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "data"}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  H.toast(`Exported ${which === "all" ? "everything" : rows[0]?.name ?? ""}`);
}
