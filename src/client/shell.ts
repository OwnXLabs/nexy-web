import { chatScope, visibleChat, inChat, selectChat } from "./chat-scope";
import { savedOutputs, restoreOutputs } from "./canvas";
import type { ChatOutput } from "../lib/chat-output";
import { prefs, openSettings } from "./settings";
import { setPrivate, isPrivate, endPrivate } from "./private";
import { isOpen, closeCanvas } from "./canvas";
import { IC, DOTS, openCtx, confirmDel, inlineRename } from "./menus";
import { httpMsg, errText } from "./http";
import { hasApp, isBeta, localVoice, notHereYet, voiceApi } from "./place";
import { last } from "./compat";
import { refreshRoutineCards } from "./memory";
import { speechReady, tapPcm, toWav, type Pcm } from "./voice-local";
import { partialScheduler, type Partials } from "./voice-partials";

export interface ShellHooks {
  send(text: string): Promise<void>;
  showTab(name: string): void;
  projects(): { id: string; name: string }[];
  currentProject(): string;
  selectProject?(id: string): void;
  openProject(id: string): Promise<void>;
  isPrivate(): boolean;
  toast(t: string): void;
  renderSide(): void;
  needs(): number;
  history: { role: "user" | "assistant"; content: string }[];
  showResult?(open: ExampleOpen): void;
  // leave the current project and clear the work pane, for a chat that starts fresh
  fresh?(): void;
  // turn the visible chat into a Project
  promote?(): void;
}

export interface ExampleOpen { kind: string; title: string; href: string; ts?: number; ex?: string; needs?: string }

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

let H: ShellHooks;

interface Chat { id: string; title: string; nodes: DocumentFragment; history: ShellHooks["history"]; saved?: boolean; loaded?: boolean; example?: ExampleOpen | null; first?: string; named?: boolean; naming?: boolean; projectId?: string; loading?: Promise<void>; ts?: number; sig?: string }
const EX = "_examples";
const chats = new Map<string, Chat[]>();
const retired = new Map<string, Chat>();
let cur: { pid: string; cid: string } | null = null;
const cid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function scopedChat(): Chat | undefined {
  const id = chatScope();
  for (const list of chats.values()) { const c = list.find((c) => c.id === id); if (c) return c; }
  return retired.get(id);
}
export function chatThread(): HTMLElement | DocumentFragment {
  const c = scopedChat();
  return c && c.id !== visibleChat() ? c.nodes : document.querySelector<HTMLElement>("#thread")!;
}
export function chatHistory(): ShellHooks["history"] { return scopedChat()?.history ?? H.history; }
export function chatProject(): string {
  if (scopedChat()?.projectId) return scopedChat()!.projectId!;
  for (const [pid, list] of chats) if (list.some((c) => c.id === chatScope())) return pid === "_" || pid === EX ? "" : pid;
  return "";
}
export function setChatProject(id: string): void {
  const c = scopedChat(); if (!c) return;
  c.projectId = id;
  if (c.id === visibleChat()) H.selectProject?.(id);
}
function selected(): void {
  if (!cur) return;
  H.selectProject?.(inChat(cur.cid, chatProject));
  selectChat(cur.cid);
}

function stash(): void {
  if (!cur) return;
  saveChat();
  const c = (chats.get(cur.pid) ?? []).find((x) => x.id === cur!.cid);
  const th = $("#thread");
  if (!c || !th) return;
  c.nodes = document.createDocumentFragment();
  while (th.firstChild) c.nodes.appendChild(th.firstChild);
  H.history.length = 0;

}

// A saved transcript comes back as markup only: its buttons belonged to a page that
// is gone, so they are disabled rather than left looking clickable.
function revive(html: string): DocumentFragment {
  const t = document.createElement("template");
  t.innerHTML = html;
  t.content.querySelectorAll("script,iframe[srcdoc],#typing,[data-resume]").forEach((n) => (n.closest(".msg") ?? n).remove());
  t.content.querySelectorAll<HTMLElement>("*").forEach((el) => {
    for (const a of [...el.attributes]) if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
  });
  // "Ask again" on an interrupted answer still works: it only sends the question again; the
  // phone's "in the work view" only opens the pane
  t.content.querySelectorAll<HTMLButtonElement>("button:not([data-ask-again]):not([data-open-work])").forEach((b) => { b.disabled = true; b.title = "From an earlier visit"; });
  return t.content;
}

export function chatReady(): Promise<void> | undefined {
  const c = scopedChat();
  return c?.saved && !c.loaded ? fetchChat(c) : undefined;
}
export const chatDeleted = () => retired.has(chatScope());
function fetchChat(c: Chat): Promise<void> {
  return c.loading ??= readChat(c).finally(() => { c.loading = undefined; });
}
async function readChat(c: Chat): Promise<void> {
  const r = await fetch(`/api/v1/chats?id=${encodeURIComponent(c.id)}`);
  const d = await r.json() as { chat?: { html: string; history: ShellHooks["history"]; outputs?: ChatOutput[]; activeOutput?: string; projectId?: string }; error?: string };
  if (!r.ok || !d.chat) throw new Error(d.error ?? httpMsg(r.status));
  c.nodes = revive(d.chat.html);
  c.history.splice(0, c.history.length, ...d.chat.history);
  c.projectId = d.chat.projectId;
  c.ts = (d.chat as { ts?: number }).ts;
  c.sig = sigOf({ title: c.title, projectId: c.projectId, ...d.chat });
  // Older chats did not save output IDs. Recover only explicit URLs in their own
  // transcript, never a title/time match against the machine-wide history.
  const outputs = d.chat.outputs ?? [];
  if (!d.chat.outputs) {
    const t = document.createElement("template"); t.innerHTML = d.chat.html;
    for (const el of t.content.querySelectorAll<HTMLAnchorElement | HTMLIFrameElement>("a[href],iframe[src]")) {
      const href = el.getAttribute("href") ?? el.getAttribute("src") ?? "";
      if (/^\/api\/apps\/(build|qiki)\/.*\/preview(?:\?|$)/.test(href))
        outputs.push({ id: href, kind: "html", title: c.title, href });
    }
  }
  inChat(c.id, () => restoreOutputs(outputs, d.chat!.activeOutput));
  c.loaded = true;
}

function load(pid: string, id: string): void {
  const c = (chats.get(pid) ?? []).find((x) => x.id === id);
  const th = $("#thread");
  if (!c || !th) return;
  cur = { pid, cid: id };
  selected();
  if (c.saved && c.loaded) freshen(pid, c);
  if (c.saved && !c.loaded) {
    const note = document.createElement("div");
    note.className = "feednote";
    note.textContent = `Opening ${c.title}…`;
    th.prepend(note);
    fetchChat(c).then(() => {
      note.remove();
      if (cur?.cid !== id) return;
      th.prepend(c.nodes);
      H.history.splice(0, H.history.length, ...c.history);
      selected();
      th.scrollTop = th.scrollHeight;
      cardsNow(th);
    }).catch((e: Error) => {
      note.className = "feednote bad";
      note.textContent = `This chat could not be opened: ${errText(e)}`;
    });
    return;
  }
  th.appendChild(c.nodes);
  H.history.splice(0, H.history.length, ...c.history);
  th.scrollTop = th.scrollHeight;
  cardsNow(th);
}

// A chat reopened from memory: if another device saved it since, show that copy instead
// (QA 2026-11-12: the phone reopened its old copy without the Mac's turn). Not while this copy
// has a save on its way or a reply still arriving.
function freshen(pid: string, c: Chat): void {
  const seen = c.ts;
  if (seen === undefined) return;
  fetch("/api/v1/chats").then(async (r) => {
    const d = await r.json() as { chats?: { id: string; ts: number }[]; error?: string };
    if (!r.ok) throw new Error(d.error ?? httpMsg(r.status));
    const m = d.chats?.find((x) => x.id === c.id);
    const th = $("#thread");
    if (!m || m.ts <= seen || c.ts !== seen || cur?.cid !== c.id || !th || writes.has(c.id) || th.querySelector(".msg[data-pending]")) return;
    c.loaded = false; c.ts = undefined; c.sig = undefined;
    th.replaceChildren(); c.nodes = document.createDocumentFragment();
    load(pid, c.id);
  }).catch((e: Error) => console.warn("[nexy] could not check for a newer copy of this chat", e));
}

// a routine card in a chat shown again says where that routine stands now
const cardsNow = (th: HTMLElement) => refreshRoutineCards(th).catch((e: Error) => console.warn("[nexy] routine cards not brought up to date", e));

// Another device saved this chat after this one read it. Nothing here is written over
// it: the chat is read again when opened, and an open chat offers the newer copy.
function staleChat(c: Chat): void {
  c.loaded = false; c.ts = undefined; c.sig = undefined;
  H.toast("This chat changed on another device, so this copy was not saved over it.");
  const th = $("#thread");
  if (cur?.cid !== c.id || !th || th.querySelector("[data-stale]")) return;
  const note = document.createElement("div");
  note.className = "feednote";
  note.dataset.stale = "1";
  note.textContent = "This chat changed on another device. ";
  const show = document.createElement("button");
  show.type = "button"; show.className = "btn small"; show.textContent = "Show latest";
  show.addEventListener("click", () => {
    if (cur?.cid !== c.id) return;
    th.replaceChildren(); c.nodes = document.createDocumentFragment();
    load(cur.pid, c.id);
  });
  note.append(show);
  th.append(note);
  th.scrollTop = th.scrollHeight;
}

// after each turn: the thread as shown, and the turns the model sees
export function saveChat(): void {
  if (H.isPrivate() || chatDeleted()) return;
  const c = scopedChat();
  const th = chatThread();
  if (!c || c.example !== undefined || !th || !th.querySelector('.msg.me:not([data-private="1"])') || (c.saved && !c.loaded)) return;
  const copy = document.createElement("div"); copy.append(th.cloneNode(true));
  copy.querySelectorAll('[data-private="1"],#typing,#emptyState,[data-stale]').forEach((n) => n.remove());
  // A reply still being written is saved as interrupted: if Nexy quits or crashes now, the chat
  // comes back with the question, what had arrived, and a way to ask again. The unanswered
  // question stays out of the history, so asking again does not send it twice.
  const history = c.history.slice();
  const pending = copy.querySelectorAll<HTMLElement>(".msg[data-pending]");
  pending.forEach(interrupted);
  if (pending.length && last(history)?.role === "user") history.pop();
  c.saved = true;
  c.loaded = true;
  persist(c, { id: c.id, pid: [...chats].find(([, list]) => list.includes(c))?.[0] ?? "_", title: c.title, html: copy.firstElementChild?.id === "thread" ? copy.firstElementChild.innerHTML : copy.innerHTML,
    history, projectId: c.projectId, ...savedOutputs() });
}

function interrupted(m: HTMLElement): void {
  m.querySelectorAll(".wait,.cur,.macts").forEach((n) => n.remove());
  const note = document.createElement("div");
  note.className = "feednote";
  note.dataset.interrupted = "1";
  note.textContent = "This answer stopped before it finished. ";
  const again = document.createElement("button");
  again.type = "button";
  again.className = "btn small";
  again.dataset.askAgain = m.dataset.q ?? "";
  again.textContent = "Ask again";
  note.append(again);
  (m.querySelector(".bub") ?? m).append(note);
  delete m.dataset.pending;
}

const writes = new Map<string, Promise<void>>();
const writeFailures = new Map<string, Error>();
export async function flushChat(): Promise<void> {
  const id = chatScope();
  saveChat();
  await writes.get(id);
  if (writeFailures.has(id)) throw writeFailures.get(id);
}
type Body = { id: string; pid: string; title: string; html: string; history: ShellHooks["history"]; outputs?: ChatOutput[]; activeOutput?: string; projectId?: string };
// What a save would change: the words on screen, the turns, the name, the outputs.
// Markup details (a disabled button, a spinner) are not changes.
function sigOf(b: Pick<Body, "title" | "html" | "history" | "outputs" | "activeOutput" | "projectId">): string {
  return JSON.stringify([b.title, b.projectId ?? "", b.history, revive(b.html).textContent ?? "", b.outputs ?? [], b.activeOutput ?? ""]);
}
class Stale extends Error {}
function persist(c: Chat, body: Body): void {
  const sig = sigOf(body);
  // A device that only looked at a chat has nothing to save, and must not save its old copy.
  if (sig === c.sig && c.ts !== undefined) return;
  // Serialize writes per chat: an earlier request must not overwrite a completed job.
  // The version is read when the request goes, after the previous write has answered.
  const next = (writes.get(body.id) ?? Promise.resolve()).then(async () => {
    const r = await fetch("/api/v1/chats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, base: c.ts ?? 0 }) });
    const d = await r.json().catch(() => ({})) as { error?: string; ts?: number };
    if (r.status === 409) throw new Stale(d.error ?? "this chat changed on another device");
    if (!r.ok) throw new Error(d.error ?? httpMsg(r.status));
    c.ts = d.ts; c.sig = sig;
    writeFailures.delete(body.id);
  }).catch((e: Error) => {
    writeFailures.set(body.id, e);
    if (e instanceof Stale) staleChat(c);
    else H.toast(`This chat was not saved: ${errText(e)}`);
  });
  writes.set(body.id, next);
  void next.then(() => { if (writes.get(body.id) === next) writes.delete(body.id); });
}

// resave a chat that is not on screen (rename, move)
function resave(pid: string, c: Chat): void {
  if (!c.saved) return;
  const go = () => persist(c, { id: c.id, pid, title: c.title, html: [...c.nodes.childNodes].map((n) => (n as Element).outerHTML ?? n.textContent ?? "").join(""), history: c.history, projectId: c.projectId, ...inChat(c.id, savedOutputs) });
  if (cur?.cid === c.id) { saveChat(); return; }
  if (c.loaded) go(); else fetchChat(c).then(go).catch((e: Error) => H.toast(`This chat was not saved: ${errText(e)}`));
}

// saved chats, newest first, into the sidebar; the open project shows its latest
// `pending`: the request already started at boot, so the list does not wait behind other loads
export async function restoreChats(pending?: Promise<Response>): Promise<void> {
  const r = await (pending ?? fetch("/api/v1/chats"));
  const d = await r.json() as { chats?: { id: string; pid: string; title: string }[]; examples?: { id: string; title: string; ts: number; open?: ExampleOpen }[]; error?: string };
  if (!r.ok) throw new Error(d.error ?? httpMsg(r.status));
  chats.set(EX, (d.examples ?? []).map((e) => ({ id: e.id, title: e.title, nodes: document.createDocumentFragment(), history: [], saved: true, example: e.open ? { ...e.open, ts: e.ts } : null })));
  for (const m of d.chats ?? []) {
    const list = chats.get(m.pid) ?? [];
    if (list.some((x) => x.id === m.id)) continue;
    list.push({ id: m.id, title: m.title, nodes: document.createDocumentFragment(), history: [], saved: true });
    chats.set(m.pid, list);
  }
  const pid = H.currentProject() || "_";
  const th = $("#thread");
  const blank = !th?.querySelector(".msg.me");
  const first = (chats.get(pid) ?? []).find((x) => x.saved);
  if (blank && first && !H.isPrivate()) {
    H.history.splice(0, H.history.length);
    chats.set(pid, (chats.get(pid) ?? []).filter((x) => x.saved || x.id !== cur?.cid));
    load(pid, first.id);
  }
  H.renderSide();
}

// Back on screen (a phone woken, a tab switched to): chats made or changed on another device
// show up, and one changed there opens fresh rather than from the copy held here.
let refreshedAt = 0;
export async function refreshChats(): Promise<void> {
  if (Date.now() - refreshedAt < 5_000) return;
  refreshedAt = Date.now();
  const r = await fetch("/api/v1/chats");
  const d = await r.json() as { chats?: { id: string; pid: string; title: string; ts: number }[]; error?: string };
  if (!r.ok) throw new Error(d.error ?? httpMsg(r.status));
  for (const m of [...(d.chats ?? [])].reverse()) {
    const list = chats.get(m.pid) ?? [];
    const c = list.find((x) => x.id === m.id);
    if (!c) { list.unshift({ id: m.id, title: m.title, nodes: document.createDocumentFragment(), history: [], saved: true }); chats.set(m.pid, list); continue; }
    if (cur?.cid === c.id || writes.has(c.id)) continue;
    c.title = m.title;
    if (c.loaded && c.ts !== undefined && m.ts > c.ts) { c.loaded = false; c.ts = undefined; c.sig = undefined; }
  }
  H.renderSide();
}

function blockedByPrivate(): boolean {
  if (!H.isPrivate()) return false;
  H.toast("End the ultra-private session first: its conversation lives only in this page and would be lost.");
  return true;
}

function ensure(pid: string): void {
  if (cur && cur.pid === pid) return;
  const list = chats.get(pid) ?? [];
  if (!list.length) {
    list.push({ id: cid(), title: "New chat", nodes: document.createDocumentFragment(), history: [] });
    chats.set(pid, list);
  }
  cur = { pid, cid: list[0].id };
  selected();
}

// The New chat button starts a general chat with an empty work pane; a project's own
// "New chat" passes inProject to stay in that project.
export function newChat(opts: { inProject?: boolean } = {}): void {
  if (blockedByPrivate()) return;
  $("#chips")?.replaceChildren(); // a suggestion belongs to the chat it was made in
  // already on a blank chat: keep it, just give it a clean pane
  const blank = !!cur && !$("#thread")?.childElementCount;
  if (!blank) stash();
  if (!opts.inProject) H.fresh?.();

  const pid = H.currentProject() || "_";
  ensure(pid);
  if (blank && cur && cur.pid === pid) { H.showTab("chat"); H.renderSide(); return; }
  const list = chats.get(pid)!;
  // An untouched "New chat" may already be sitting in this project from an earlier visit
  // (navigated away before typing) — reuse it instead of piling up another empty one.
  const idle = list.find((x) => x.title === "New chat" && x.id !== cur?.cid);
  const c = idle ?? { id: cid(), title: "New chat", nodes: document.createDocumentFragment(), history: [] };
  if (!idle) list.unshift(c);
  cur = { pid, cid: c.id };
  selected();
  H.showTab("chat");
  H.renderSide();
  ($("#input") as HTMLTextAreaElement | null)?.focus();
}

export function switchChat(pid: string, id: string): void {
  if (cur && cur.pid === pid && cur.cid === id) { H.showTab("chat"); return; }
  if (blockedByPrivate()) return;
  $("#chips")?.replaceChildren();
  stash();
  load(pid, id);
  H.showTab("chat");
  H.renderSide();
}

export function projectChanged(pid: string): void {
  if (cur && cur.pid === pid) return;
  if (H.isPrivate()) return;
  stash();
  const list = chats.get(pid);
  if (list?.length) load(pid, list[0].id);
  else { cur = null; ensure(pid); }
}

export function noteUserMessage(text: string): void {
  const c = scopedChat();
  if (c && c.title === "New chat") { c.title = text.replace(/\s+/g, " ").trim().slice(0, 40); c.first = text; H.renderSide(); }
}

// After the first reply, the model names the chat in a few words, as chat apps do.
export function nameChat(reply: string): void {
  if (!cur || H.isPrivate()) return;
  const c = scopedChat();
  const pid = [...chats].find(([, list]) => c && list.includes(c))?.[0] ?? "_";
  if (!c || c.named || c.naming || !c.first || c.example !== undefined) return;
  // `named` is only set on confirmed success — a timeout, non-OK response, or a null
  // title (model busy/empty output) used to permanently strip the chat of a real title,
  // since `named` was set up front. Leaving it unset lets the next reply's call retry.
  c.naming = true;
  fetch("/api/v1/title", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `Person: ${c.first}\nAssistant: ${reply.slice(0, 600)}` }) })
    .then(async (r) => { const d = await r.json() as { title?: string | null; error?: string }; if (!r.ok) throw new Error(d.error ?? httpMsg(r.status)); return d.title; })
    .then((t) => { if (!t) return; c.title = t; c.named = true; H.renderSide(); resave(pid, c); })
    .catch((e: Error) => console.warn("[nexy] chat not named", e))
    .finally(() => { c.naming = false; });
}

let chatsAll = false;
// `max` keeps a long list short; the open chat is never hidden behind "Show all"
export function chatRows(pid: string, max = Infinity): string {
  const all = chats.get(pid) ?? [];
  if (all.length <= 1 && all[0]?.title === "New chat" && !isPrivate()) return "";
  const open = chatsAll || all.findIndex((c) => c.id === cur?.cid) >= max;
  const list = open ? all : all.slice(0, max);
  const more = all.length > max ? `<button class="chat faint" type="button" data-chatmore>${open ? "Show fewer ▴" : `Show all ${all.length} ▾`}</button>` : "";
  const lock = `<svg class="i" viewBox="0 0 24 24" style="display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:-1px"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
  return list.map((c) => {
    const priv = isPrivate() && cur?.cid === c.id;
    return `<button class="chat${cur?.cid === c.id ? " active" : ""}" type="button" data-chat="${esc(c.id)}" data-pid="${esc(pid)}">${priv ? `${lock}Private: ` : ""}${esc(c.title)}</button>`;
  }).join("") + more;
}

function deleteChat(pid: string, id: string): void {
  const list = chats.get(pid) ?? [];
  const deleted = list.find((c) => c.id === id);
  if (deleted) retired.set(id, deleted);
  const wasCurrent = cur?.pid === pid && cur.cid === id;
  chats.set(pid, list.filter((c) => c.id !== id));
  if (list.find((c) => c.id === id)?.saved) {
    fetch(`/api/v1/chats?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: { "content-type": "application/json" } })
      .then((r) => { if (!r.ok) throw new Error(httpMsg(r.status)); })
      .catch((e: Error) => H.toast(`The saved copy was not deleted: ${errText(e)}`));
  }
  if (wasCurrent) {
    const th = $("#thread");
    if (th) th.replaceChildren();
    H.history.splice(0, H.history.length);
    cur = null;
    const next = chats.get(pid)?.[0];
    if (next) load(pid, next.id); else ensure(pid);
  }
  H.renderSide();
  H.toast("Deleted chat");
}

export function moveChat(from: string, id: string, to: string): boolean {
  if (from === to || blockedByPrivate()) return false;
  if (cur?.pid === from && cur.cid === id) { stash(); cur = null; }
  const c = (chats.get(from) ?? []).find((x) => x.id === id);
  if (!c) return false;
  chats.set(from, (chats.get(from) ?? []).filter((x) => x !== c));
  chats.set(to, [c, ...(chats.get(to) ?? [])]);
  resave(to, c);
  return true;
}

export function wireChatRows(root: HTMLElement): void {
  root.querySelector<HTMLElement>("[data-chatmore]")?.addEventListener("click", () => { chatsAll = !chatsAll; H.renderSide(); });
  root.querySelectorAll<HTMLElement>("[data-chat]").forEach((b) => {
    const pid = b.dataset.pid!, id = b.dataset.chat!;
    b.addEventListener("click", () => switchChat(pid, id));
    b.insertAdjacentHTML("beforeend", DOTS);
    const open = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const c = (chats.get(pid) ?? []).find((x) => x.id === id);
      if (!c) return;
      const r = b.getBoundingClientRect();
      openCtx([
        { label: "Rename", icon: IC.pen, run: () => inlineRename(b, c.title, (v) => { if (v) { c.title = v; resave(pid, c); } H.renderSide(); }) },
        ...(pid === "_" && !c.projectId && !H.isPrivate() ? [{ label: "Make it a project", icon: IC.plus, run: () => { switchChat(pid, id); void (c.loading ?? Promise.resolve()).then(() => H.promote?.()); } }] : []),
        { label: "Move to another project", icon: IC.move, run: () => H.toast("Drag the chat onto a project in the sidebar") },
        { label: "Delete chat", icon: IC.trash, danger: true, run: () => confirmDel("Delete chat?", `<b>${esc(c.title)}</b> will be removed from this project.`, () => deleteChat(pid, id)) },
      ], r.right - 176, r.bottom + 4);
    };
    b.querySelector(".dots")?.addEventListener("click", open);
    b.addEventListener("contextmenu", open);
    b.draggable = true;
    b.addEventListener("dragstart", (e) => { e.dataTransfer?.setData("text/plain", JSON.stringify({ p: pid, c: id })); b.classList.add("drag"); });
    b.addEventListener("dragend", () => b.classList.remove("drag"));
  });
}

export function chatDrop(target: HTMLElement, to: string, done: (title: string) => void): void {
  target.addEventListener("dragover", (e) => { e.preventDefault(); target.classList.add("over"); });
  target.addEventListener("dragleave", () => target.classList.remove("over"));
  target.addEventListener("drop", (e) => {
    e.preventDefault();
    target.classList.remove("over");
    let d: { p?: string; c?: string } = {};
    try { d = JSON.parse(e.dataTransfer?.getData("text/plain") ?? "{}"); }
    catch (err) { console.warn("[nexy] drop ignored", err); return; }
    if (!d.p || !d.c) return;
    const title = (chats.get(d.p) ?? []).find((x) => x.id === d.c)?.title ?? "chat";
    if (moveChat(d.p, d.c, to)) done(title);
  });
}

// the rail is a drawer below the width where it, a chat and the work pane fit side by side
const isTablet = () => window.innerWidth <= 1000;
function railDrawer(on: boolean): void {
  document.body.classList.toggle("rail-open", on);
}
function toggleRail(): void {
  if (isTablet()) { railDrawer(!document.body.classList.contains("rail-open")); return; }
  document.body.classList.toggle("rail-closed");
  setTimeout(sizeMini, 240);
}
function wireRailDrawer(): void {
  const stage = document.querySelector(".stage");
  if (stage && !document.getElementById("railShade")) {
    const shade = document.createElement("div");
    shade.className = "railshade";
    shade.id = "railShade";
    shade.addEventListener("click", () => railDrawer(false));
    stage.appendChild(shade);
  }
  document.querySelector(".rail")?.addEventListener("click", (e) => {
    if (isTablet() && (e.target as Element).closest(".proj,.chat")) setTimeout(() => railDrawer(false), 60);
  });
  window.addEventListener("resize", () => { if (!isTablet()) railDrawer(false); });
}

const isMobile = () => innerWidth <= 820;

function wireMobile(): void {
  if (document.getElementById("mbar")) return;
  const glyph = document.querySelector(".ws .glyph")?.outerHTML ?? "";
  const bar = document.createElement("div");
  bar.className = "mbar";
  bar.id = "mbar";
  bar.innerHTML =
    `<button class="hbtn" id="mMenu" title="Menu"><svg class="i" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>` +
    `<div class="mt">${glyph}<span id="mTitle">Nexy</span></div>` +
    (isBeta ? `<button class="betabadge" id="mBeta" title="This is a beta. Report a problem to the Nexy team">BETA</button>` : "") +
    `<button class="hbtn" id="mReport" title="Report a problem" aria-label="Report a problem"><svg class="i" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5Z"/><path d="M12 8v3M12 13.5h.01"/></svg></button>` +
    `<button class="hbtn" id="mNeeds" title="Needs you"><svg class="i" viewBox="0 0 24 24"><path d="M12 3l9 16H3L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg><b id="mNeedCount">0</b></button>` +
    `<button class="btn small" id="mChat" title="Back to the chat"><svg class="i" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>Chat</button>` +
    `<button class="hbtn" id="mWork" title="The work"><svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="3"/><path d="M3 9h18M8 21h8"/></svg></button>`;
  document.body.appendChild(bar);
  const stage = document.querySelector(".stage");
  if (stage && !document.getElementById("cvShade")) {
    const cs = document.createElement("div");
    cs.className = "cvshade";
    cs.id = "cvShade";
    cs.addEventListener("click", closeCanvas);
    stage.appendChild(cs);
  }
  $("#mReport")?.addEventListener("click", () => window.dispatchEvent(new CustomEvent("nexy:report")));
  $("#mBeta")?.addEventListener("click", () => window.dispatchEvent(new CustomEvent("nexy:report")));
  $("#mMenu")?.addEventListener("click", () => railDrawer(!document.body.classList.contains("rail-open")));
  $("#mChat")?.addEventListener("click", closeCanvas);
  $("#mNeeds")?.addEventListener("click", () => window.dispatchEvent(new CustomEvent("nexy:panel", { detail: "needs" })));
  $("#mWork")?.addEventListener("click", () => {
    if (isOpen()) { closeCanvas(); return; }
    const h = $<HTMLButtonElement>("#cvHandle");
    if (h && !h.hidden) h.click();
  });
  const sync = () => {
    if (!isMobile()) return;
    const t = $("#mTitle");
    if (t) t.textContent = H.projects().find((p) => p.id === H.currentProject())?.name ?? "Nexy";
    const n = H.needs();
    $("#mNeeds")?.classList.toggle("badge", n > 0);
    const c = $("#mNeedCount");
    if (c) c.textContent = String(n);
  };
  addEventListener("resize", sync);
  setInterval(sync, 1000);
  sync();
  const vh = () => document.documentElement.style.setProperty("--vh", `${innerHeight}px`);
  vh();
  addEventListener("resize", vh);
  window.visualViewport?.addEventListener("resize", vh);
}

type Cmd = [label: string, key: string, run: () => void];
function commands(): Cmd[] {
  const say = (t: string) => () => void H.send(t);
  return [
    ["Generate an image", "", () => {
      const i = $<HTMLTextAreaElement>("#input");
      if (!i) return;
      i.value = "Generate an image of ";
      i.dispatchEvent(new Event("input"));
      i.focus();
    }],
    ["New project", "⌘N", () => $("#newProject")?.click()],
    ["This project", "", () => window.dispatchEvent(new CustomEvent("nexy:panel", { detail: "project" }))],
    ["Needs you", "", () => window.dispatchEvent(new CustomEvent("nexy:panel", { detail: "needs" }))],
    ["Show the work", "", () => { const h = $<HTMLButtonElement>("#cvHandle"); if (h && !h.hidden) h.click(); }],
    ["Watch the agent's screen", "", () => window.dispatchEvent(new CustomEvent("nexy:screen"))],
    ["New chat", "N", () => newChat()],
    ["Connect Telegram", "", say("Connect Telegram")],
    ["Connect an app", "", () => openSettings("connections")],
    ["Install from OwnApp Store", "", say("Install Kdenlive from the app store")],
    ["Render on OwnCloud", "", say("Render shots 1 to 6, whatever is fastest")],
    ["Clean up my desktop", "", say("Clean up my desktop")],
    ["Pause every agent", "", say("Pause everything")],
  ];
}

function openCmd(): void {
  const ov = $("#ovCmd"), inp = $<HTMLInputElement>("#cmdIn");
  if (!ov || !inp) return;
  ov.classList.add("open");
  inp.value = "";
  cmdFilter();
  setTimeout(() => inp.focus(), 0);
}

function cmdFilter(): void {
  const inp = $<HTMLInputElement>("#cmdIn"), res = $("#cmdRes");
  if (!inp || !res) return;
  const q = inp.value.toLowerCase().trim();
  const items: Cmd[] = commands().filter((c) => !q || c[0].toLowerCase().includes(q));
  for (const p of H.projects())
    if (!q || p.name.toLowerCase().includes(q)) items.push([`Open ${p.name}`, "", () => void H.openProject(p.id)]);
  if (q && !items.length) items.push([`Ask Nexy: ${inp.value}`, "↵", () => void H.send(inp.value)]);
  res.innerHTML = items.map((c, i) => `<button class="ci${i === 0 ? " sel" : ""}" type="button" data-i="${i}">${esc(c[0])}<span class="k">${esc(c[1])}</span></button>`).join("");
  res.querySelectorAll<HTMLElement>(".ci").forEach((b) =>
    b.addEventListener("click", () => { $("#ovCmd")?.classList.remove("open"); items[Number(b.dataset.i)][2](); }));
}

let mctx: CanvasRenderingContext2D | null = null, mt = 0, typeE = 0, listening = false;
function sizeMini(): void {
  const mc = $<HTMLCanvasElement>("#miniWave");
  if (!mc) return;
  const d = Math.min(devicePixelRatio || 1, 2), r = mc.getBoundingClientRect();
  mc.width = Math.round(r.width * d); mc.height = Math.round(r.height * d);
  mctx = mc.getContext("2d"); mctx?.setTransform(d, 0, 0, d, 0, 0);
}
function drawMini(): void {
  const mc = $<HTMLCanvasElement>("#miniWave");
  if (mc && mctx) {
    mt += 1 / 60; typeE *= 0.86;
    const e = listening ? 0.5 + 0.5 * Math.abs(Math.sin(mt * 9) * Math.sin(mt * 3.7)) : typeE;
    const W = mc.clientWidth, Hh = mc.clientHeight, mid = Hh / 2;
    mctx.clearRect(0, 0, W, Hh);
    const g = mctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.2, "rgba(255,246,236,.95)");
    g.addColorStop(0.6, "rgba(255,140,110,.95)"); g.addColorStop(1, "rgba(124,92,255,0)");
    mctx.strokeStyle = g; mctx.lineWidth = 1.4; mctx.lineCap = "round"; mctx.beginPath();
    for (let x = 0; x <= W; x += 1) {
      const u = x / W, ed = Math.sin(u * Math.PI);
      const y = mid + ed * (Math.sin(u * 9 + mt * (2 + e * 8)) * 1.6 + Math.sin(u * 23 - mt * (3 + e * 12)) * 1.1 + e * (Math.sin(u * 41 + mt * 20) * 4 + Math.sin(u * 67 - mt * 27) * 2.5));
      x ? mctx.lineTo(x, y) : mctx.moveTo(x, y);
    }
    mctx.stroke();
  }
  requestAnimationFrame(drawMini);
}

let rec: MediaRecorder | null = null, chunks: Blob[] = [], stream: MediaStream | null = null, analyser: AnalyserNode | null = null, ac: AudioContext | null = null, spaceHeld = false;
// speech on this computer: raw samples too, so the words so far can be read while the user talks
let pcm: Pcm | null = null;

function drawV(): void {
  const c = $<HTMLCanvasElement>("#vwave"), x = c?.getContext("2d");
  if (!c || !x) return;
  const buf = new Uint8Array(128);
  let vt = 0;
  const frame = () => {
    if (!listening) { x.clearRect(0, 0, c.width, c.height); return; }
    vt += 0.09;
    let lvl = 0.4 + 0.6 * Math.abs(Math.sin(vt * 2.3));
    if (analyser) {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      lvl = 0.25 + Math.min(1, peak / 40);
    }
    x.clearRect(0, 0, 320, 72);
    x.strokeStyle = "#FF8C68";
    x.lineWidth = 2.5;
    x.beginPath();
    for (let px = 0; px <= 320; px += 4) {
      const u = px / 320, e = Math.sin(u * Math.PI);
      const y = 36 + e * (Math.sin(u * 18 + vt * 3) * 10 + Math.sin(u * 41 - vt * 5) * 7 + Math.sin(u * 7 + vt) * 6) * lvl;
      if (px) x.lineTo(px, y); else x.moveTo(px, y);
    }
    x.stroke();
    requestAnimationFrame(frame);
  };
  frame();
}

/** `pre`: an audio context made inside the user's key press or touch, so Safari lets it run. */
async function startRecording(pre?: AudioContext): Promise<boolean> {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    void pre?.close();
    H.toast(`The microphone is not available: ${errText(e)}`);
    return false;
  }
  chunks = [];
  ac = pre ?? new AudioContext();
  analyser = ac.createAnalyser();
  analyser.fftSize = 256;
  const src = ac.createMediaStreamSource(stream);
  src.connect(analyser);
  if (localVoice) pcm = tapPcm(ac, src);
  ac.resume().catch((e) => console.warn("[nexy] audio context did not start", e));
  rec = new MediaRecorder(stream);
  rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
  rec.start();
  listening = true;
  return true;
}

async function stopAndTranscribe(): Promise<string> {
  listening = false;
  const r = rec;
  rec = null;
  if (!r) return "";
  await new Promise<void>((ok) => { r.onstop = () => ok(); r.stop(); });
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  analyser = null;
  const p = pcm;
  pcm = null;
  p?.stop();
  void ac?.close();
  ac = null;
  let blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
  if (p && p.seconds() > 0) blob = p.wav();
  else if (!blob.size) return "";
  else if (localVoice) blob = await toWav(blob);
  const res = await fetch(voiceApi("stt"), { method: "POST", headers: { "content-type": blob.type }, body: blob });
  const d = (await res.json().catch((e) => { console.warn("[nexy] speech reply unreadable", e); return {}; })) as { text?: string; error?: string };
  if (!res.ok) throw new Error(d.error ?? httpMsg(res.status));
  return (d.text ?? "").trim();
}

/** Stop the microphone and drop what it heard. */
function discardRecording(): void {
  listening = false;
  rec?.stop(); rec = null;
  stream?.getTracks().forEach((t) => t.stop()); stream = null;
  pcm?.stop(); pcm = null;
  analyser = null;
  void ac?.close(); ac = null;
}

// Hold to talk: the words appear in the message box while the user speaks; on letting go they stay
// there to check and edit, and nothing is sent until Send (Enter). Redo (Esc) discards and listens again.
let vphase: "idle" | "listen" | "finish" | "review" = "idle", vbase = "", live: Partials | null = null, pressAt = 0, vabort = false;
const QUICK_MS = 400, LIVE_EVERY = 1000, LIVE_WINDOW_S = 28;
const vin = () => $<HTMLTextAreaElement>("#input");
function setComposer(t: string): void {
  const i = vin(); if (!i) return;
  i.value = t;
  i.dispatchEvent(new Event("input"));
  const sb = $<HTMLButtonElement>("#sendBtn");
  if (sb && (vphase === "listen" || vphase === "finish")) sb.disabled = true; // nothing goes until the user lets go
}
const withBase = (t: string) => (vbase && t ? `${vbase} ${t}` : vbase || t);
const vsay = (t: string) => { const vt = $("#vtext"); if (vt) vt.textContent = t; };

async function liveWords(): Promise<string | null> {
  const p = pcm;
  if (!p || p.seconds() < 0.6) return null;
  const cut = p.seconds() > LIVE_WINDOW_S;
  const res = await fetch(`${voiceApi("stt")}?live=1`, { method: "POST", headers: { "content-type": "audio/wav" }, body: p.wav(LIVE_WINDOW_S) });
  if (res.status === 409) return null; // a speech job is running; next turn
  const d = (await res.json()) as { text?: string; error?: string };
  if (!res.ok) throw new Error(d.error ?? httpMsg(res.status));
  const t = (d.text ?? "").trim();
  return cut && t ? `… ${t}` : t;
}

function closeV(): void {
  $("#voice")?.classList.remove("open");
  $("#micBtn")?.classList.remove("on");
  const i = vin(); if (i) i.readOnly = false;
  vphase = "idle";
}
function endReview(): void {
  const r = $("#vreview"); if (r) r.hidden = true;
  if (vphase === "review") vphase = "idle";
}

async function startV(): Promise<boolean> {
  if (!hasApp("voice")) { H.toast(notHereYet("Talking to Nexy")); return false; }
  if (listening || vphase === "finish") return false;
  endReview();
  vabort = false; // Esc while the microphone starts cancels it
  const pre = new AudioContext(); // before any wait, while the key press or touch still counts
  pre.resume().catch((e) => console.warn("[nexy] audio context waits for the microphone", e));
  if (localVoice) {
    try { await speechReady((m) => H.toast(m)); }
    catch (e) { void pre.close(); H.toast(`Speech is not ready: ${errText(e)}`); return false; }
  }
  if (!(await startRecording(pre))) return false;
  window.dispatchEvent(new CustomEvent("nexy:did", { detail: "voice" }));
  vphase = "listen";
  const i = vin();
  vbase = i?.value.trim() ?? "";
  if (i) i.readOnly = true;
  setComposer(vbase); // keeps Send off while listening
  $("#voice")?.classList.add("open");
  $("#micBtn")?.classList.add("on");
  vsay("Listening…");
  // live words only from this computer's own speech; on an Own1 the words come when the user lets go
  if (localVoice) live = partialScheduler({
    every: LIVE_EVERY, job: liveWords,
    onText: (t) => { if (vphase === "listen") setComposer(withBase(t)); },
    onSlow: () => { if (vphase === "listen") vsay("Listening… the words will show when you let go"); },
  });
  drawV();
  if (vabort) { cancelV(); return false; }
  return true;
}
/** Let go: the final words go in the message box to check; nothing is sent. */
async function stopV(): Promise<void> {
  if (!listening || vphase !== "listen") return;
  vphase = "finish";
  live?.stop(); live = null;
  vsay("Transcribing on this machine…");
  let t: string;
  try { t = await stopAndTranscribe(); }
  catch (e) { closeV(); setComposer(vbase); H.toast(`Could not transcribe: ${errText(e)}`); return; }
  closeV();
  if (!t) { setComposer(vbase); H.toast("Didn't catch that. Hold to try again."); return; }
  setComposer(withBase(t));
  vphase = "review";
  const r = $("#vreview"); if (r) r.hidden = false;
  const i = vin();
  if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}
/** Stop listening and put the message box back as it was. */
function cancelV(): void {
  if (vphase !== "listen") return;
  live?.stop(); live = null;
  discardRecording();
  closeV();
  setComposer(vbase);
}
/** Discard the words and listen again (Done, Space or the mic ends it). */
function redoV(): void {
  endReview();
  setComposer(vbase);
  vin()?.blur();
  void startV();
}
const releaseV = () => (performance.now() - pressAt < QUICK_MS ? cancelV() : void stopV());

const VM = { on: false, state: "idle" as "idle" | "listen" | "think" | "speak", audio: null as HTMLAudioElement | null };
function vmState(st: typeof VM.state, label: string): void {
  VM.state = st;
  const s = $("#vmState"); if (s) s.textContent = label;
  $("#vmode")?.classList.toggle("listening", st === "listen");
}
function vmDraw(): void {
  const c = $<HTMLCanvasElement>("#vmWave"), x = c?.getContext("2d");
  if (!c || !x) return;
  const d = Math.min(devicePixelRatio || 1, 2), r = c.getBoundingClientRect();
  c.width = Math.round(r.width * d); c.height = Math.round(r.height * d);
  x.setTransform(d, 0, 0, d, 0, 0);
  const buf = new Uint8Array(256);
  let t = 0, env = 0, envT = 0, target = 0.5;
  const frame = () => {
    if (!VM.on) return;
    t += 1 / 60;
    const st = VM.state, live = st === "listen" && !!analyser;
    if (live) {
      analyser!.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i += 2) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const tgt = Math.min(1, Math.sqrt(sum / (buf.length / 2)) * 6);
      env += (tgt - env) * (tgt > env ? 0.75 : 0.22);
    } else if (st === "speak") {
      if (t - envT > 0.05 + Math.random() * 0.07) { envT = t; target = Math.random() < 0.25 ? 0.08 : 0.25 + Math.random() * 0.7; }
      env += (target - env) * (target > env ? 0.6 : 0.22);
    } else if (st === "think") env = 0.25 + 0.15 * Math.sin(t * 5);
    else env *= 0.9;
    const W = c.clientWidth, H = c.clientHeight, mid = H / 2, e = env;
    const span = st === "idle" ? 260 : 360, x0 = (W - span) / 2;
    const amp = st === "listen" ? 6 + e * 40 : st === "speak" ? 5 + e * 34 : st === "think" ? 8 : 5;
    const tt = t * (st === "listen" || st === "speak" ? 3.6 : 1.4);
    const purple = st === "speak";
    const layers = [
      { k: 2.2, ph: 0, w: 1.4, a: .4, th: 6, g: 26, c: "255,246,236" },
      { k: 3.4, ph: 1.7, w: -1.1, a: .3, th: 9, g: 34, c: purple ? "124,92,255" : "255,196,158" },
      { k: 4.6, ph: 3.4, w: 1.9, a: .22, th: 13, g: 44, c: purple ? "124,92,255" : "255,150,118" },
      { k: 2.2, ph: 0, w: 1.4, a: .95, th: 1.2, g: 10, c: "255,255,255" },
    ];
    x.clearRect(0, 0, W, H);
    x.save();
    x.globalCompositeOperation = "lighter";
    for (const l of layers) {
      x.beginPath();
      const n = Math.round(span * 1.2);
      for (let i = 0; i <= n; i++) {
        const u = i / n, px = x0 + u * span, edge = Math.pow(Math.sin(u * Math.PI), 1.3);
        let y = Math.sin(u * Math.PI * l.k + tt * l.w + l.ph) + 0.35 * Math.sin(u * Math.PI * l.k * 2.3 - tt * l.w * 1.4 + l.ph) +
          e * (0.5 * Math.sin(u * Math.PI * 9 + tt * 5.5 + l.ph) + 0.3 * Math.sin(u * Math.PI * 17 - tt * 7.5 + l.ph * 2));
        if (live) y += (buf[Math.floor(u * (buf.length - 1))] - 128) / 128 * 2.6;
        const yy = mid + y * amp * edge;
        if (i) x.lineTo(px, yy); else x.moveTo(px, yy);
      }
      const g = x.createLinearGradient(x0, 0, x0 + span, 0);
      g.addColorStop(0, `rgba(${l.c},0)`); g.addColorStop(.18, `rgba(${l.c},${l.a})`);
      g.addColorStop(.82, `rgba(${l.c},${l.a})`); g.addColorStop(1, `rgba(${l.c},0)`);
      x.strokeStyle = g;
      x.lineWidth = l.th * (0.8 + 0.5 * e);
      x.lineCap = "round";
      x.shadowBlur = l.g * (1 + e);
      x.shadowColor = `rgba(${l.c},${l.a * 0.9})`;
      x.stroke();
    }
    x.restore();
    requestAnimationFrame(frame);
  };
  frame();
}

function vmOpen(): void {
  VM.on = true;
  window.dispatchEvent(new CustomEvent("nexy:did", { detail: "voice" }));
  $("#vmode")?.classList.add("open");
  const n = $("#vmNexy"), y = $("#vmYou"); if (n) n.textContent = ""; if (y) y.textContent = "";
  vmState("idle", "");
  requestAnimationFrame(vmDraw);
  setTimeout(() => void vmListen(), 400);
}
function vmClose(): void {
  VM.on = false;
  $("#vmode")?.classList.remove("open");
  if (listening) discardRecording();
  VM.audio?.pause();
  vmState("idle", "");
}
async function vmListen(): Promise<void> {
  if (!VM.on || VM.state === "listen") return;
  if (localVoice) {
    try { await speechReady((m) => vmState("think", m)); }
    catch (e) { vmState("idle", `Speech is not ready: ${errText(e)}`); return; }
    if (!VM.on) return;
  }
  if (!(await startRecording())) { vmClose(); return; }
  vmState("listen", "Listening — tap when you are done");
  const tap = $("#vmTap"); if (tap) tap.hidden = false;
}
async function vmSend(): Promise<void> {
  if (VM.state !== "listen") return;
  vmState("think", "Transcribing on this machine");
  try {
    const t = await stopAndTranscribe();
    const y = $("#vmYou"); if (y) y.textContent = t;
    if (!t) { vmState("idle", "I heard nothing. Tap to try again."); return; }
    vmState("think", "Thinking");
    await H.send(t);
  } catch (e) {
    vmState("idle", `Could not transcribe: ${errText(e)}`);
  }
}

export async function onReply(text: string): Promise<void> {
  if (!text.trim() || (!VM.on && !prefs().speakAlways) || !hasApp("voice")) return;
  const n = $("#vmNexy"); if (n && VM.on) n.textContent = text;
  if (VM.on) vmState("speak", "Speaking");
  try {
    const clean = text.replace(/\*\*/g, "").replace(/\s+/g, " ").slice(0, 600);
    const res = await fetch(voiceApi("tts"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: clean, voice_id: prefs().voice }) });
    if (!res.ok) throw new Error(httpMsg(res.status));
    const url = URL.createObjectURL(await res.blob());
    VM.audio = new Audio(url);
    await new Promise<void>((ok) => { VM.audio!.onended = () => ok(); VM.audio!.onerror = () => ok(); void VM.audio!.play().catch(() => ok()); });
    URL.revokeObjectURL(url);
  } catch (e) {
    console.warn("[nexy] voice reply not spoken", e);
  }
  if (VM.on) { vmState("idle", ""); setTimeout(() => void vmListen(), 400); }
}

export function initShell(hooks: ShellHooks): void {
  H = hooks;
  wireRailDrawer();
  wireMobile();
  ensure(H.currentProject() || "_");
  window.addEventListener("nexy:outputs-changed", (e) => {
    const id = String((e as CustomEvent).detail);
    queueMicrotask(() => inChat(id, saveChat));
  });
  // a new chat starts directly; private is a mode of the chat (the lock by the message box)
  $("#newChat")?.addEventListener("click", () => { if (isPrivate() && !endPrivate()) return; newChat(); });
  $("#privBtn")?.addEventListener("click", () => {
    if (isPrivate()) { if (endPrivate()) newChat(); return; }
    newChat();
    setPrivate(true);
  });
  $("#openCmd")?.addEventListener("click", openCmd);
  $("#railTog")?.addEventListener("click", toggleRail);
  $("#railOpen")?.addEventListener("click", toggleRail);
  $("#cmdIn")?.addEventListener("input", cmdFilter);
  $("#cmdIn")?.addEventListener("keydown", (e) => {
    const ke = e as KeyboardEvent;
    const all = Array.from(document.querySelectorAll<HTMLElement>("#cmdRes .ci"));
    const at = all.findIndex((x) => x.classList.contains("sel"));
    if (ke.key === "Enter") { (all[at] ?? all[0])?.click(); }
    if (ke.key === "ArrowDown" || ke.key === "ArrowUp") {
      ke.preventDefault();
      const i = ke.key === "ArrowDown" ? Math.min(all.length - 1, at + 1) : Math.max(0, at - 1);
      all.forEach((x) => x.classList.remove("sel")); all[i]?.classList.add("sel");
    }
  });
  document.querySelectorAll<HTMLElement>(".ov").forEach((o) => o.addEventListener("click", (e) => { if (e.target === o) o.classList.remove("open"); }));
  addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA/.test((document.activeElement as HTMLElement | null)?.tagName ?? "");
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openCmd(); }
    if (e.key === "Escape") {
      document.querySelectorAll(".ov.open").forEach((o) => o.classList.remove("open"));
      if (VM.on) vmClose();
      if (vphase === "review") { e.preventDefault(); redoV(); }
      else if (vphase === "listen") cancelV();
      else vabort = true;
      return;
    }
    if (typing) return;
    if (e.code === "Space" && !e.repeat && prefs().wakeKey && !VM.on) {
      e.preventDefault();
      if (listening) { if (!spaceHeld) void stopV(); return; } // started by a tap or Redo: Space ends it
      spaceHeld = true;
      pressAt = performance.now();
      void startV().then((ok) => { if (ok && !spaceHeld) releaseV(); });
      return;
    }
    if (e.key === "[") { e.preventDefault(); toggleRail(); }
    if (e.key === "n" && !e.metaKey && !e.ctrlKey) newChat();
  });
  addEventListener("keyup", (e) => {
    if (e.code !== "Space" || !spaceHeld) return;
    spaceHeld = false;
    e.preventDefault();
    if (listening) releaseV();
  });
  // the mic: hold to talk and let go, or tap to start and tap again (or Done) to stop
  const mic = $("#micBtn");
  let micHeld = false, micPointer = false;
  mic?.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    micPointer = true;
    if (listening) { void stopV(); return; }
    mic.setPointerCapture(e.pointerId);
    micHeld = true;
    pressAt = performance.now();
    void startV().then((ok) => { if (ok && !micHeld && performance.now() - pressAt >= QUICK_MS) void stopV(); });
  });
  const micUp = () => {
    if (!micHeld) return;
    micHeld = false;
    if (listening && performance.now() - pressAt >= QUICK_MS) void stopV(); // a quick tap keeps listening
  };
  mic?.addEventListener("pointerup", micUp);
  mic?.addEventListener("pointercancel", micUp);
  mic?.addEventListener("click", () => {
    if (micPointer) { micPointer = false; return; } // handled by the pointer events
    void (listening ? stopV() : startV()); // the keyboard
  });
  $("#vstop")?.addEventListener("click", () => void stopV());
  $("#vsend")?.addEventListener("click", () => { endReview(); $<HTMLButtonElement>("#sendBtn")?.click(); });
  $("#vredo")?.addEventListener("click", redoV);
  // the message box sends the words as any typed message; the review ends with it
  $("#input")?.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) endReview(); });
  // while listening the box shows words the user has not checked yet: Enter does not send them
  addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || (vphase !== "listen" && vphase !== "finish") || (e.target as Element | null)?.id !== "input") return;
    e.preventDefault(); e.stopPropagation();
  }, true);
  $("#sendBtn")?.addEventListener("click", endReview);
  // speech runs in Own Voice or on this computer; without either, Nexy says so instead of failing
  const talk = () => hasApp("voice") ? vmOpen() : H.toast(notHereYet("Talking to Nexy"));
  $("#waveBtn")?.addEventListener("click", talk);
  $("#voiceMode")?.addEventListener("click", talk);
  $("#vmClose")?.addEventListener("click", vmClose);
  const tapOrSend = () => void (VM.state === "listen" ? vmSend() : vmListen());
  $("#vmTap")?.addEventListener("click", tapOrSend);
  $("#vmMic")?.addEventListener("click", tapOrSend);
  $("#input")?.addEventListener("input", () => { typeE = 1; });
  sizeMini();
  addEventListener("resize", sizeMini);
  requestAnimationFrame(drawMini);
}

// Examples: real conversations every visitor can open; read-only, never saved over.
// Five examples by default, so a visitor's own projects stay in view below them.
const EX_SHOWN = 5;
let exAll = false;

// what each kind of example needs; an example may name its own app (a project board needs Own Startup)
const NEEDS: Record<string, string> = { html: "build", game: "build", image: "images", plan: "startup", audio: "beat" };
const makeable = (c: Chat) => { const app = c.example?.needs ?? NEEDS[c.example?.kind ?? ""]; return !app || hasApp(app); };

export function exampleRows(): string {
  const list = (chats.get(EX) ?? []).filter(makeable);
  const open = exAll || list.findIndex((c) => c.id === cur?.cid) >= EX_SHOWN;
  const rows = (open ? list : list.slice(0, EX_SHOWN)).map((c) =>
    `<button class="chat${cur?.cid === c.id ? " active" : ""}" type="button" data-ex="${esc(c.id)}">${esc(c.title)}</button>`).join("");
  if (list.length <= EX_SHOWN) return rows;
  return rows + `<button class="chat faint" type="button" data-exmore>${open ? "Show fewer ▴" : `Show all ${list.length} ▾`}</button>`;
}

export function wireExamples(root: HTMLElement): void {
  root.querySelector<HTMLElement>("[data-exmore]")?.addEventListener("click", () => { exAll = !exAll; H.renderSide(); });
  root.querySelectorAll<HTMLElement>("[data-ex]").forEach((b) => b.addEventListener("click", () => {
    const c = (chats.get(EX) ?? []).find((x) => x.id === b.dataset.ex);
    if (!c) return;
    switchChat(EX, c.id);
    if (c.example) H.showResult?.(c.example);
  }));
}

export const viewingExample = (): boolean => cur?.pid === EX;
export const currentChatId = (): string => cur?.cid ?? "";
