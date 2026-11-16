import { isPrivate } from "./private";
import { hasStudio } from "./place";
import { pickFor } from "./pick";
import { chatScope, visibleChat, inChat } from "./chat-scope";
import type { ChatOutput } from "../lib/chat-output";
import { htmlArtifact, gameArtifact, markdownArtifact, readable } from "./content-view";
import { imageArtifact } from "./image-tools";
import { sheetArtifact } from "./sheet-view";
import { artifactFor } from "./artifacts";
import { errText, httpMsg } from "./http";
export type ArtifactKind =
  | "plan" | "image" | "audio" | "html" | "doc" | "table" | "text"
  | "code" | "diagram" | "game" | "screen";

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  meta?: string;
  href?: string;
  render: (host: HTMLElement) => void;
  gen?: boolean;
  ephemeral?: boolean;
  snapshot?: () => Partial<ChatOutput>;
  source?: { get(): string; set(html: string): void };
}

// the Docs app; it opens one document from ?doc=<id>
const DOCS_URL = `https://docs.${location.hostname.replace(/^nexy\./, "")}/`;
import { trackOpen, openEditable } from "./edit-loop";
import { startFx } from "./genfx";
import { plainName } from "./state";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s);
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const say = (msg: string) =>
  window.dispatchEvent(new CustomEvent("nexy:toast", { detail: msg }));

const panes = new Map<string, Pane>();
function paneFor(id = chatScope()): Pane {
  let p = panes.get(id);
  if (!p) { p = { open: [], active: "", shown: false }; panes.set(id, p); }
  return p;
}
let view = paneFor();
const changed = (id: string) => window.dispatchEvent(new CustomEvent("nexy:outputs-changed", { detail: id }));
window.addEventListener("nexy:chat-selected", () => {
  view = paneFor(visibleChat());
  if (view.shown && view.open.length) { document.body.classList.add("canvas-open"); paint(); }
  else { closeCanvas(); $("#cvTabs")?.replaceChildren(); $("#cvBody")?.replaceChildren(); }
});

export function current(): Artifact | null {
  return paneFor().open.find((x) => x.id === paneFor().active) ?? null;
}

export function isOpen(): boolean {
  return document.body.classList.contains("canvas-open");
}

export function closeCanvas(): void {
  view.shown = false;
  full(false);
  document.body.classList.remove("canvas-open", "live");
  // "Show the work" only when there is work to bring back; on an empty pane it did nothing
  if (!view.open.length) return;
  const ai = document.querySelectorAll("#thread .m.ai");
  ai[ai.length - 1]?.classList.add("reopen");
}

// Each chat owns its work pane: a new chat starts empty, and going back to a chat
// brings back the tabs it had.
export interface Pane { open: Artifact[]; active: string; shown: boolean }
export function savePane(): Pane {
  return paneFor();
}
export function loadPane(p?: Pane): void {
  if (p) panes.set(chatScope(), p);
  view = paneFor(visibleChat());
  if (view.shown && view.open.length) { document.body.classList.add("canvas-open"); paint(); }
  else { closeCanvas(); $("#cvTabs")?.replaceChildren(); $("#cvBody")?.replaceChildren(); }
}
// Persist data and rendered snapshots, never functions or another chat's feed.
export function outputsForChat(): Artifact[] { return paneFor().open.filter((a) => !a.gen); }
export function savedOutputs(): { outputs: ChatOutput[]; activeOutput: string } {
  return { outputs: outputsForChat().filter((a) => !a.ephemeral).map((a) => {
    const saved: ChatOutput = { id: a.id, kind: a.kind, title: a.title, meta: a.meta, href: a.href };
    if (a.source) saved.source = a.source.get();
    else if (a.snapshot) Object.assign(saved, a.snapshot());
    else if (!a.href) {
      const host = document.createElement("div");
      a.render(host);
      saved.markup = host.innerHTML;
    }
    return saved;
  }), activeOutput: paneFor().active };
}

function restored(o: ChatOutput): Artifact {
  const kind = o.kind as ArtifactKind;
  const base = { id: o.id, kind, title: o.title, meta: o.meta, href: o.href };
  // a sheet keeps its CSV: rebuilt as a page, a reopened chat showed it as raw text (QA 2026-11-12)
  if (o.source !== undefined && kind === "table") { const a = sheetArtifact({ title: o.title, rows: [], meta: o.meta }); a.source!.set(o.source); return { ...a, id: o.id }; }
  if (o.source !== undefined && kind === "doc") return { ...markdownArtifact({ title: o.title, meta: o.meta, md: o.source }), id: o.id };
  if (o.source !== undefined) return { ...(kind === "game" ? gameArtifact({ ...base, html: o.source }) : htmlArtifact({ ...base, html: o.source })), id: o.id };
  if (kind === "image" && o.href) return imageArtifact({ ...base, src: o.href });
  if (o.href) return { ...artifactFor({ kind, title: o.title, app: o.href.split("/")[3] ?? "nexy", appLabel: o.meta?.split(" · ")[0] ?? "Nexy", ts: 0, href: o.href }), id: o.id, meta: o.meta };
  return { ...base, snapshot: () => ({ markup: o.markup }), render(host) {
    if (o.href && (kind === "html" || kind === "game")) {
      const f = document.createElement("iframe");
      f.sandbox.add("allow-scripts", "allow-forms");
      f.src = o.href;
      const wrap = document.createElement("div"); wrap.className = "frame tall";
      wrap.append(f); host.replaceChildren(wrap); return;
    }
    const t = document.createElement("template"); t.innerHTML = o.markup ?? "";
    t.content.querySelectorAll("script,object,embed,base,meta,link").forEach((n) => n.remove());
    t.content.querySelectorAll<HTMLElement>("*").forEach((el) => {
      for (const a of [...el.attributes]) if (/^on/i.test(a.name) || /^\s*(javascript|vbscript):/i.test(a.value)) el.removeAttribute(a.name);
    });
    t.content.querySelectorAll("iframe").forEach((f) => f.setAttribute("sandbox", "allow-scripts allow-forms"));
    host.replaceChildren(t.content);
    if (!host.childNodes.length) host.textContent = "This older output has no saved preview.";
  } };
}
export function restoreOutputs(outputs: ChatOutput[], activeOutput?: string): void {
  const p = paneFor();
  if (p.open.length) return; // never replace a job that is already running here
  p.open.push(...outputs.map(restored));
  p.active = outputs.some((o) => o.id === activeOutput) ? activeOutput! : outputs[0]?.id ?? "";
  p.shown = outputs.length > 0;
  if (chatScope() === visibleChat()) loadPane(p);
}

export function forgetPrivateOutputs(): void {
  for (const p of panes.values()) {
    p.open = p.open.filter((a) => !a.ephemeral);
    if (!p.open.some((a) => a.id === p.active)) p.active = p.open[0]?.id ?? "";
  }
  if (view.open.length && view.shown) paint(); else { closeCanvas(); $("#cvTabs")?.replaceChildren(); $("#cvBody")?.replaceChildren(); }
}
export function resetCanvas(): void {
  panes.set(chatScope(), { open: [], active: "", shown: false });
  loadPane();
}

export function reopen(): boolean {
  view.shown = true;
  if (!view.open.length) return false;
  if (!view.open.some((x) => x.id === view.active)) view.active = view.open[0].id;
  document.body.classList.add("canvas-open");
  paint();
  return true;
}

let firstWork: () => Artifact | null = () => null;
export function setFirstWork(fn: () => Artifact | null): void { firstWork = fn; }

function wireHandles(): void {
  const mk = (id: string, cls: string, title: string, svg: string) => {
    const b = document.createElement("button");
    b.className = `edgehandle ${cls}`;
    b.id = id;
    b.title = title;
    b.innerHTML = svg;
    document.body.appendChild(b);
    return b;
  };
  const cv = mk("cvHandle", "right", "Show the work", `<svg class="i" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>`);
  const rail = mk("railHandle", "left", "Show the sidebar ( [ )", `<svg class="i" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M9 5v14"/></svg>`);
  const sync = () => {
    cv.hidden = isOpen() || (!view.open.length && !firstWork());
    rail.hidden = !document.body.classList.contains("rail-closed");
  };
  cv.addEventListener("click", () => {
    const a = view.open.length ? null : firstWork();
    if (a) show(a);
    else reopen();
    sync();
  });
  rail.addEventListener("click", () => { document.body.classList.remove("rail-closed"); sync(); });
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  setInterval(sync, 800);
  sync();
  document.querySelector("#thread")?.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (isOpen() || t.closest("button,a,.block")) return;
    const m = t.closest("#thread .m.ai");
    const ai = document.querySelectorAll("#thread .m.ai");
    if (m && m === ai[ai.length - 1] && reopen()) say("Work column back");
  });
}

const stage = () => document.querySelector<HTMLElement>(".stage");
const pane = () => document.querySelector<HTMLElement>(".canvas");
let cw = 560;
const room = (chatMin: number) =>
  (stage()?.clientWidth ?? window.innerWidth) - (document.body.classList.contains("rail-closed") ? 0 : 248) - 12 - chatMin;
function setCW(w: number): void {
  cw = Math.max(360, Math.min(room(340), Math.round(w)));
  stage()?.style.setProperty("--cwv", `${cw}px`);
}
function pulse(): void {
  const sp = $("#splitter");
  if (!sp) return;
  sp.classList.add("pulse");
  setTimeout(() => sp.classList.remove("pulse"), 2600);
}
function settle(): void {
  const w = room(380);
  const target = Math.min(w, Math.max(cw, Math.round(w * 0.6)));
  if (target > cw + 20) { setCW(target); pulse(); }
}
function wide(): void {
  setCW(Math.max(560, Math.round(room(380) * 0.72)));
  pulse();
}
function fitNarrow(): void {
  const c = pane();
  if (c) c.classList.toggle("narrow", c.clientWidth < 520);
}
export function full(on: boolean): void {
  pane()?.classList.toggle("full", on);
  document.body.classList.toggle("canvas-full", on);
  setTimeout(fitNarrow, 50);
  if (!on) return;
  const last = [...document.querySelectorAll("#thread .msg.ai .t")].pop();
  const dl = document.querySelector("#dockLast");
  if (dl) dl.textContent = last?.textContent?.trim() ?? "";
  setTimeout(() => document.querySelector<HTMLTextAreaElement>("#dockInput")?.focus(), 50);
}

function wireDock(): void {
  const cv = pane();
  if (!cv || document.querySelector("#cvdock")) return;
  const d = document.createElement("div");
  d.className = "cvdock";
  d.id = "cvdock";
  d.innerHTML = `<div class="cvdock-last" id="dockLast"></div><div class="line"><textarea id="dockInput" rows="1" placeholder="Talk to Nexy"></textarea><div class="keys">` +
    `<button type="button" id="dockMic" title="Talk"><svg class="i" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></button>` +
    `<button type="button" id="dockSend" aria-label="Send"><svg class="i" viewBox="0 0 24 24"><path d="M20 5v6a3 3 0 0 1-3 3H5m0 0 4-4m-4 4 4 4"/></svg></button></div></div>`;
  cv.appendChild(d);
  const inp = d.querySelector<HTMLTextAreaElement>("#dockInput")!;
  const go = () => {
    const v = inp.value.trim();
    if (!v) return;
    inp.value = "";
    window.dispatchEvent(new CustomEvent("nexy:send", { detail: v }));
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } });
  d.querySelector("#dockSend")!.addEventListener("click", go);
  d.querySelector("#dockMic")!.addEventListener("click", () => document.querySelector<HTMLButtonElement>("#micBtn")?.click());
  new MutationObserver(() => {
    if (!document.body.classList.contains("canvas-full")) return;
    const last = [...document.querySelectorAll("#thread .msg.ai .t")].pop();
    const dl = document.querySelector("#dockLast");
    if (dl && last) dl.textContent = last.textContent?.trim() ?? "";
  }).observe(document.querySelector("#thread")!, { childList: true, subtree: true, characterData: true });
}

const mmss = (ms: number) => {
  const t = Math.round(ms / 1000);
  return t < 60 ? `${t}s` : `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, "0")}s`;
};

export interface Generating {
  note(text: string): void;
  replaceWith(a: Artifact): void;
  fail(text: string): void;
  live(step: string, html?: string): void;
}

export function generating(title: string, kind: ArtifactKind, label: string, typicalMs: number): Generating {
  const owner = chatScope();
  const ephemeral = isPrivate();
  const work = paneFor(owner);
  const id = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const heading = kind === "html" ? "Building the site" : kind === "game" ? "Building the game" : kind === "diagram" ? "Building the flowchart" : `Generating: ${title}`;
  const t0 = Date.now();
  let text = label;
  let state: "live" | "failed" = "live";
  const line = () => {
    if (state === "failed") return text;
    const el = Date.now() - t0;
    // a countdown from what this kind of work has taken on this machine
    const left = typicalMs - el;
    const tail = left > 15_000 ? `about ${mmss(left)} left` : el < typicalMs * 1.5 ? "almost done" : `taking longer than the usual ${mmss(typicalMs)}, still going`;
    return `${text} · ${mmss(el)} · ${tail}`;
  };
  const paintLine = () => {
    const gs = document.querySelector<HTMLElement>(`[data-gen="${id}"] .gs`);
    if (gs) gs.textContent = line();
  };
  const timer = window.setInterval(paintLine, 1000);
  let stopFx = () => {};
  let liveHtml = "";
  const progress = () => Math.min(0.95, (Date.now() - t0) / typicalMs);
  // the page so far, swapped in on load so it never flashes blank
  const paintLive = () => {
    const box = document.querySelector<HTMLElement>(`[data-gen="${id}"] .glive`);
    if (!box) return;
    const f = document.createElement("iframe");
    f.sandbox.add("allow-same-origin");
    f.title = "The page so far";
    f.onload = () => {
      f.contentDocument?.scrollingElement?.scrollTo(0, 1e7);
      box.querySelectorAll("iframe").forEach((x) => { if (x !== f) x.remove(); });
      f.classList.add("on");
    };
    // the frame runs no scripts (half-written code must not run), so leave them out rather than
    // have every partial page log "Blocked script execution" into the console
    f.srcdoc = readable(liveHtml).replace(/<script\b[\s\S]*?(?:<\/script>|$)/gi, "");
    box.append(f);
  };
  show({
    id, kind, title: heading, meta: "on this machine", gen: true,
    render: (host) => {
      host.innerHTML =
        `<div class="gen running${liveHtml ? " haslive" : ""}" data-gen="${id}"><div class="gh"><span class="led${state === "failed" ? " warn" : ""}"></span>${esc(heading)}</div>` +
        `<div class="gs"></div><div class="progress${state === "live" ? " sweep" : ""}"><i></i></div>${liveHtml ? `<div class="glive"></div>` : ""}<div class="gnoise"></div></div>`;
      paintLine();
      stopFx();
      const g = host.querySelector<HTMLElement>(".gen");
      if (g && state === "live") stopFx = startFx(g, progress);
      if (liveHtml) paintLive();
    },
  });
  const drop = () => {
    window.clearInterval(timer);
    stopFx();
    const k = work.open.findIndex((x) => x.id === id);
    if (k >= 0) work.open.splice(k, 1);
  };
  return {
    note(t) { text = t; paintLine(); },
    live(step, html) {
      text = step;
      paintLine();
      if (!html || html.length < 600 || html === liveHtml) return;
      const first = !liveHtml;
      liveHtml = html;
      if (!first) paintLive();
      else if (view === work && work.active === id) paint();
    },
    replaceWith(a) {
      drop();
      a.ephemeral = ephemeral;
      inChat(owner, () => show(a));
      window.dispatchEvent(new CustomEvent("nexy:done", { detail: `${a.title} is ready` }));
      if (a.kind === "image") {
        const img = document.querySelector<HTMLElement>("#cvBody img");
        if (img) { img.classList.add("revealing"); setTimeout(() => img.classList.remove("revealing"), 1800); }
      }
    },
    fail(t) {
      window.clearInterval(timer);
      stopFx();
      state = "failed";
      text = t;
      if (view === work && work.active === id) paint();
    },
  };
}

export function show(a: Artifact): void {
  a.ephemeral ??= isPrivate();
  const work = paneFor();
  const i = work.open.findIndex((x) => x.id === a.id);
  if (i >= 0) work.open.splice(i, 1);
  work.open.unshift(a);
  while (work.open.length > 100) work.open.pop();
  work.active = a.id;
  work.shown = true;
  if (!a.gen) changed(chatScope());
  if (chatScope() !== visibleChat()) return;
  trackOpen({ id: a.id, title: a.title, kind: a.kind });
  const src = a.source;
  if (src) {
    openEditable({
      id: a.id, title: a.title, kind: a.kind, source: src.get(),
      update: (html) => { src.set(html); if (view.active === a.id) { paint(); changed(visibleChat()); } },
    });
  }
  const wasOpen = isOpen();
  document.body.classList.add("canvas-open");
  paint();
  if (a.gen) return;
  if (/^(site|app|game|html)$/.test(a.kind) || a.id.startsWith("audio:studio")) wide(); else if (!wasOpen || i < 0) settle();
}

function paint(): void {
  window.dispatchEvent(new CustomEvent("nexy:canvas-selected"));
  const a = view.open.find((x) => x.id === view.active);
  if (!a) { closeCanvas(); return; }

  const tabs = $("#cvTabs");
  if (tabs) tabs.style.display = a.gen && view.open.length === 1 ? "none" : "";
  if (tabs) {
    tabs.innerHTML = view.open
      .map(
        (x) =>
          `<button type="button" class="cvtab${x.id === view.active ? " active" : ""}" data-a="${esc(x.id)}">${esc(plainName(x.title))}</button>`,
      )
      .join("");
    tabs.querySelectorAll<HTMLElement>(".cvtab").forEach((b) =>
      b.addEventListener("click", () => { view.active = b.dataset.a!; paint(); changed(visibleChat()); }),
    );
  }

  trackOpen({ id: a.id, title: a.title, kind: a.kind });
  if (a.source) openEditable({ id: a.id, title: a.title, kind: a.kind, source: a.source.get(),
    update: (html) => { a.source!.set(html); paint(); changed(visibleChat()); } });
  const title = $("#cvTitle");
  if (title) { title.textContent = plainName(a.title); title.title = a.meta ? `${a.meta}` : ""; }

  pickFor(a.id, (a.kind === "html" || a.kind === "game") && !!a.source);

  const openBtn = $("#cvOpenApp");
  if (openBtn) {
    const how = opener(a);
    const txt = openBtn.querySelector(".txt");
    if (txt) txt.textContent = how?.label ?? "Open";
    openBtn.style.display = how ? "" : "none";
    openBtn.onclick = how ? how.go : null;
  }

  for (const id of ["#cvEdit", "#cvShare"]) {
    const b = $(id);
    if (b) b.style.display = a.kind === "screen" ? "none" : "";
  }

  // Download saves a file. It used to open `href` in a new tab whenever there was one, so a
  // built page never downloaded (and after an in-place edit would have shown the original).
  const dl = $<HTMLAnchorElement>("#cvDownload");
  if (dl) {
    const src = a.source?.get() ?? a.snapshot?.().source;
    dl.style.display = (a.href || src) && a.kind !== "screen" ? "" : "none";
    dl.onclick = () => {
      const name = a.title.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "nexy";
      const save = (href: string, file: string) => {
        const link = document.createElement("a");
        link.href = href;
        link.download = file;
        document.body.append(link);
        link.click();
        link.remove();
      };
      if (src?.trim()) {
        const ext = /<html|<!doctype/i.test(src) ? "html" : a.kind === "doc" ? "md" : a.kind === "table" ? "csv" : "txt";
        const url = URL.createObjectURL(new Blob([src], { type: ext === "html" ? "text/html" : "text/plain" }));
        save(url, name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      if (!a.href) return;
      const fromUrl = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(a.href)?.[1];
      const fromData = /^data:[a-z]+\/([a-z0-9]+)/i.exec(a.href)?.[1];
      const ext = fromData ?? fromUrl ?? (a.kind === "image" ? "png" : a.kind === "audio" ? "wav" : "bin");
      save(a.href, `${name}.${ext}`);
    };
  }

  const body = $("#cvBody");
  if (body) {
    body.innerHTML = "";
    a.render(body);
    // a running page repaints every frame, and glass re-blurs on each one: 15fps instead of 120
    document.body.classList.toggle("live", !!body.querySelector("iframe"));
    // games cancel pointerdown, which also stops the click giving them focus: hand it over
    const game = a.kind === "game" ? body.querySelector<HTMLIFrameElement>(".frame iframe") : null;
    if (game) {
      game.addEventListener("load", () => game.focus());
      game.closest(".frame")?.addEventListener("pointerenter", () => game.focus());
    }
    if (a.meta && !a.gen && /^(html|game|diagram|audio)$/.test(a.kind)) {
      const note = document.createElement("div");
      note.className = "cvnote";
      note.textContent = a.meta;
      body.appendChild(note);
    }
  }
}

const newTab = (url: string) => window.open(url, "_blank", "noopener");

// Own Docs opens one document from `?doc=<id>` when its health lists "doc-link"
let docLink: boolean | undefined;
let docLinkAsked = false;
function checkDocLink(): void {
  if (docLinkAsked) return;
  docLinkAsked = true;
  // a 503 still carries the body: read it, not r.ok
  fetch("/api/apps/docs/api/v1/health").then((r) => r.json()).then(
    (h: { features?: unknown }) => { docLink = Array.isArray(h?.features) && h.features.includes("doc-link"); },
    (e) => { console.warn("[nexy] Own Docs health:", e); docLink = false; },
  ).then(() => { if (docLink && current()?.kind === "doc" && isOpen()) paint(); });
}

// the Own Docs id of each chat document, so a second click does not upload it again
const docIds = new Map<string, { md: string; id: Promise<number> }>();
async function uploadDoc(a: Artifact, md: string): Promise<number> {
  const had = docIds.get(a.id);
  if (had?.md === md) return had.id;
  const id = (async () => {
    const name = /\.md$/i.test(a.title) ? a.title : `${a.title}.md`;
    const r = await fetch(`/api/apps/docs/api/v1/documents?${new URLSearchParams({ filename: name })}`, {
      method: "POST", headers: { "content-type": "text/markdown" }, body: md,
    });
    const d = await r.json().catch((e) => { console.warn("[nexy] Own Docs upload:", e); return {}; }) as { accepted?: { docId?: unknown; error?: string }[]; error?: string };
    const got = d.accepted?.[0];
    if (typeof got?.docId !== "number") throw new Error(got?.error ?? d.error ?? httpMsg(r.status));
    return got.docId;
  })();
  docIds.set(a.id, { md, id });
  id.catch(() => { if (docIds.get(a.id)?.id === id) docIds.delete(a.id); });
  return id;
}
// indexing runs after the upload; the viewer says so if it is still going after 20 s
async function ready(id: number): Promise<void> {
  for (const end = Date.now() + 20_000; Date.now() < end; await new Promise((ok) => setTimeout(ok, 700))) {
    const d = await fetch(`/api/apps/docs/api/v1/document?id=${id}`).then((r) => r.json())
      .catch((e) => { console.warn("[nexy] Own Docs document:", e); return null; }) as { doc?: { status?: string } } | null;
    if (d?.doc?.status === "ready" || d?.doc?.status === "error") return;
  }
}

function opener(a: Artifact): { label: string; go: () => void } | null {
  // a live view or a job still running has nothing to open
  if (a.gen || a.kind === "screen" || a.id.startsWith("deck:")) return null;
  // the page as it is on the right, edits included; Own Build's preview is the original
  const page = a.kind === "html" || a.kind === "game" ? a.source?.get() : undefined;
  if (page?.trim()) return { label: "Open in a new tab", go: () => {
    const p = a.source?.get() ?? page;
    const attr = p.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const shell = `<!doctype html><meta charset="utf-8"><title>${esc(a.title ?? "Preview")}</title><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block}</style><iframe sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads" srcdoc="${attr}"></iframe>`;
    const url = URL.createObjectURL(new Blob([shell], { type: "text/html" }));
    newTab(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } };
  if (a.href && (a.kind === "html" || a.kind === "game" || /^https?:/.test(a.href))) {
    const href = a.href;
    return { label: "Open in a new tab", go: () => { newTab(new URL(href, location.href).href); } };
  }
  if (a.kind !== "doc" || !hasStudio("docs") || a.ephemeral) return null;
  checkDocLink();
  if (!docLink) return null;
  // already in Own Docs (an attached file), or written in chat and uploaded on the first click
  const held = a.href?.startsWith("/api/apps/docs/api/v1/document?") ? Number(new URL(a.href, location.origin).searchParams.get("id")) : NaN;
  const md = a.snapshot?.().source;
  if (!Number.isFinite(held) && !md?.trim()) return null;
  return { label: "Open in Docs", go: () => {
    if (Number.isFinite(held)) { newTab(`${DOCS_URL}?doc=${held}`); return; }
    // opened now, while the click still counts, so the browser does not block it
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    uploadDoc(a, md!).then(async (id) => {
      await ready(id);
      const url = `${DOCS_URL}?doc=${id}`;
      if (tab && !tab.closed) tab.location.href = url; else newTab(url);
    }, (e) => {
      tab?.close();
      say(`${plainName(a.title)} could not be put in Own Docs: ${errText(e)}. It is still here.`);
    });
  } };
}

function wireHeader(): void {
  $("#cvClose")?.addEventListener("click", closeCanvas);
  $("#cvMax")?.addEventListener("click", () => full(!pane()?.classList.contains("full")));

  const sp = $("#splitter");
  if (sp) {
    let drag = false;
    sp.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      drag = true;
      stage()?.classList.add("dragging");
      sp.setPointerCapture(e.pointerId);
    });
    sp.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = stage()?.getBoundingClientRect();
      if (r) setCW(r.right - 12 - e.clientX);
    });
    const end = () => { drag = false; stage()?.classList.remove("dragging"); };
    sp.addEventListener("pointerup", end);
    sp.addEventListener("pointercancel", end);
    sp.addEventListener("dblclick", () => setCW(560));
  }
  window.addEventListener("resize", () => setCW(cw));
  const c = pane();
  if (c && "ResizeObserver" in window) new ResizeObserver(fitNarrow).observe(c);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isOpen()) return;
    if (pane()?.classList.contains("full")) full(false); else closeCanvas();
  });
}

export function initCanvas(): void {
  window.addEventListener("nexy:theme", () => { if (isOpen()) paint(); });
  wireHeader();
  wireHandles();
  wireDock();
  setCW(cw);
  closeCanvas();
}
