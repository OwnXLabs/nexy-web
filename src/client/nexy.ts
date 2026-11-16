import { chatScope, visibleChat, bindChat, inChat } from "./chat-scope";
import { playSwarm } from "./swarm-view";
import { shape, typeLabel, plainName, type Project, type FileRow, type Event, type UpstreamProject } from "./state";
import { initCanvas, show as showArtifact, generating, setFirstWork, current as currentArtifact, outputsForChat, forgetPrivateOutputs, isOpen, reopen } from "./canvas";
import { planArtifact, planBrief, buildable } from "./plan-view";
import { artifactFor, type FeedLike } from "./artifacts";
import { connectionsArtifact } from "./connections";
import { reportArtifact, type ReportRow } from "./report";
import { imageArtifact } from "./image-tools";
import { chartArtifact, type ChartData } from "./chart-view";
import { beatStudioArtifact } from "./beat-studio";
import { paintArtifact } from "./paint-app";
import { deckArtifact } from "./deck-view";
import { initShare } from "./share";
import { initPublishing } from "./publish";
import { offersProject } from "./promote";
import { fromReply, htmlArtifact, gameArtifact, markdownArtifact } from "./content-view";
import { slidesFrom, monthIn, subjectIn, type DocSource } from "./deck";
import { planBlock, markStarted, agentsBlock, consentBlock, resumeBlock, summaryBlock, autopilotBlock } from "./blocks";
import { classify, splitTasks, asksToChangePage, retryOf, fixNote } from "./intent";
import { ERROR_MAX, plainError, type LastBuild } from "../lib/chat-output";
import { connectIntent, playConnect } from "./perm";
import { handleEdit, editablePage, applyRevision } from "./edit-loop";
import { installReporter, openReporter } from "./problem-report";
import { screenArtifact, screenAvailable, takeControlFor } from "./screen-view";
import { takeoverAsk } from "./takeover";
import { pickedFor, clearPick, renderedFor, type Picked } from "./pick";
import { initPrivate, guard, conversation as privateConversation, isPrivate, privateConversationId, noteEphemeralDoc, setPrivate } from "./private";
import { matchSocial, playSocial } from "./social";
import { buildsHere, hasApp, hasStudio, here, isBeta, notHereYet, siteHost, imagesOff } from "./place";
import { renderGate } from "./build-gate";
import { caps, gameBrief, taskOf, verdictFor, gateCard, warnsFor, WARN_NOTE, THIN } from "./capability";
import { initShell, chatRows, wireChatRows, chatDrop, noteUserMessage, projectChanged, onReply, newChat, saveChat, flushChat, restoreChats, refreshChats, exampleRows, wireExamples, viewingExample, nameChat, chatThread, chatHistory, chatProject, setChatProject, chatReady, chatDeleted, currentChatId, engineSlot, chatLastBuild, setChatLastBuild, type ExampleOpen } from "./shell";
import { engineItems, initEngineChat, labelReply, renderEngineChip } from "./engine-chat";
import { loadEngines, pickedEngine } from "./engines";
import { IC, DOTS, openCtx, confirmDel, inlineRename } from "./menus";
import { matchMemory, playMemory, noteExampleRoutine, deviceZone, showWaitingRoutines } from "./memory";
import { initSettings, notify, openSettings } from "./settings";
import { initLanding, homeNode, did, welcome, modelState, modelReady } from "./landing";
import { initAurora } from "./aurora";
import { httpMsg, errText, unreachable, away } from "./http";
import { timeoutSignal } from "./compat";
import { inline, renderMd } from "./md";
import { connectorAsk } from "../lib/connector-ask.ts";
import { readLocally } from "../lib/file-text.ts";
import { slugOf } from "./doc-title";

// "on the right" is true only where the pane sits beside the chat. On a phone the pane covers the
// chat, so there the words are a button that brings it back (QA 2026-11-12).
const ON_RIGHT = `<span class="wide-only">on the right</span><span class="phone-only"><button type="button" class="linkbtn" data-open-work>in the work view</button></span>`;

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s);
const $$ = (s: string, r: ParentNode = document) => Array.from(r.querySelectorAll<HTMLElement>(s));
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const S = { projects: [] as Project[], cur: "", busy: false, job: "" as "" | "build", eta: { start: 0, ms: 0 }, paused: false, running: "", projectsError: "", feed: [] as FeedLike[], quiet: [] as string[], builds: [] as { prompt: string; when: string; status: string; ts: number; secs: number }[],
  redo: null as null | { pid: string; taskId: string; title: string } };
const P = () => S.projects.find((p) => p.id === chatProject());
const EVAL = new URLSearchParams(location.search).get("eval") === "1";
// The Android app draws its own Nexy button over the page's lower left (MainActivity.kt in the
// app); the page leaves room for it under the last message.
if (/; wv\)/.test(navigator.userAgent)) document.documentElement.dataset.shell = "android";

const conversation = (priv: boolean) => priv ? privateConversation(true) : chatHistory();
function captureWork() {
  const owner = chatScope();
  const project = P();
  const priv = isPrivate();
  return {
    owner,
    setChatProject: bindChat(setChatProject),
    visible: () => owner === visibleChat(),
    push: bindChat((who: "me" | "ai", html: string) => push(who, html, priv)), pushBlock: bindChat((el: HTMLElement) => pushBlock(el, priv)),
    showArtifact: bindChat((a: Parameters<typeof showArtifact>[0]) => { a.ephemeral ??= priv; showArtifact(a); }), generating: bindChat(generating),
    saveChat: bindChat(saveChat), nameChat: bindChat(nameChat), noteBuild: bindChat(noteBuild),
    conversation: bindChat(conversation), attachedDocs: bindChat(attachedDocs),
    P: () => project,
    playMake: bindChat(playMake), playDeck: bindChat(playDeck), autopilot: bindChat(autopilot),
    autopilotRun: bindChat(autopilotRun), runTask: bindChat(runTask),
    attachFiles: bindChat(attachFiles), playBoardEdit: bindChat(playBoardEdit),
    attachSample: bindChat(attachSample), playMemory: bindChat(playMemory), playSocial: bindChat(playSocial),
    playConnect: bindChat(playConnect), instant: bindChat(instant), addRole: bindChat(addRole),
    playChart: bindChat(playChart), playWorkLog: bindChat(playWorkLog), playGenerate: bindChat(playGenerate),
    playBuild: bindChat(playBuild), playChat: bindChat(playChat), playFeedbackLog: bindChat(playFeedbackLog),
    context: bindChat(context), noteUserMessage: bindChat(noteUserMessage),
    typingOff: bindChat(typingOff), onReply: bindChat(onReply),
  };
}

interface BuildDone {
  status: "done";
  elapsedSeconds: number;
  title?: string;
  artifact?: { html?: string; title?: string; produces?: { appKind?: string; unmet?: string[] } };
  runId?: string;
}
type BuildPoll =
  | { status: "running"; elapsedSeconds: number; step?: string; partialHtml?: string }
  | { status: "error"; elapsedSeconds: number; error?: string }
  | BuildDone;

// Behind xnode-auth a lost sign-in (session cookies end with the browser) turns every API
// call into a redirect to the sign-in page. Go there once, and come back here after,
// instead of reading that page as data. Never triggers where there is no sign-in.
const nativeFetch = window.fetch.bind(window);
let signingIn = false;
window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
  const r = await nativeFetch(...args);
  if (r.redirected && !signingIn) {
    const page = new URL(r.url).pathname;
    const login = page.startsWith("/connect/") ? "/connect/" : page.startsWith("/xnode-auth/") ? "/xnode-auth/" : "";
    if (login) {
      signingIn = true;
      location.assign(`${login}?redirect=${encodeURIComponent(location.href)}`);
    }
  }
  return r;
};

// A non-2xx answer. `status` drives retries; the message is what a person reads,
// so it never carries a bare status code.
class HttpError extends Error {
  constructor(readonly status: number, detail = "") {
    super([429, 502, 503, 504].includes(status) || !detail ? httpMsg(status) : detail);
  }
}
// loading, busy, or a dropped connection: worth waiting for, not worth showing
// GONE: the machine failed a health check mid-request (streamReply); asking again later may work
const GONE = "the machine did not answer";
const transient = (e: unknown) => e instanceof HttpError ? [429, 502, 503, 504].includes(e.status) : e instanceof TypeError || (e as Error)?.message === GONE;
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const req = async () => {
    const r = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", accept: "application/json", ...(init?.headers ?? {}) },
    });
    if (r.ok) return r;
    const detail = await r.json().then((j) => String(j?.error ?? ""), () => "");
    throw new HttpError(r.status, detail);
  };
  const read = !init?.method || init.method === "GET";
  for (let i = 0; ; i++) {
    try { return (await (await req()).json()) as T; }
    catch (e) { if (!read || !transient(e) || i >= 3) throw e; await sleep(2000 * (i + 1)); }
  }
};

// Waits out a loading or busy engine (about three minutes), saying so each time.
const WAITS = [10, 20, 30, 45, 60];
// the image engine heals itself within a minute of a failure, then reloads
const IMAGE_WAITS = [15, 30, 45, 60, 60, 60];
async function patient<T>(call: () => Promise<T>, waiting: (n: number, secs: number, of: number, e: unknown) => void, waits = WAITS): Promise<T> {
  for (const [n, secs] of waits.entries()) {
    try { return await call(); }
    catch (e) { if (!transient(e)) throw e; waiting(n + 1, secs, waits.length, e); await sleep(secs * 1000); }
  }
  return call();
}

// A live status line under a reply: dots while it works, cleared when it settles.
function status(holder: HTMLElement, text: string, etaMs?: number): void {
  const bub = holder.querySelector(".bub");
  if (!bub) return;
  let el = bub.querySelector<HTMLElement>(".wait");
  if (!el) { el = document.createElement("div"); el.className = "wait feednote"; bub.append(el); }
  el.innerHTML = `<span class="typing"><i></i><i></i><i></i></span> <span class="wl">${esc(text)}</span><span class="wt faint"></span>`;
  // the countdown runs from the first status of this reply, so step changes don't reset it
  if (etaMs) { el.dataset.t0 ??= String(Date.now()); el.dataset.eta = String(etaMs); }
  tick(el);
}
// same format as the work panel's ("7s", "8m 52s")
const clock = (ms: number) => { const t = Math.max(0, Math.round(ms / 1000)); return t < 60 ? `${t}s` : `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, "0")}s`; };
function tick(el: HTMLElement): void {
  const t = el.querySelector(".wt"); if (!t || !el.dataset.eta) return;
  const gone = Date.now() - Number(el.dataset.t0), left = Number(el.dataset.eta) - gone;
  t.textContent = ` · ${clock(gone)} · ${left > 10_000 ? `about ${clock(left)} left` : left > -Number(el.dataset.eta) / 2 ? "almost done" : "longer than usual, still going"}`;
}
setInterval(() => document.querySelectorAll<HTMLElement>("#thread .wait[data-eta]").forEach(tick), 1000);
const settle = (holder: HTMLElement) => holder.querySelector(".bub .wait")?.remove();
// no countdown while the machine can't be reached: it would count down to nothing
function stopClock(holder: HTMLElement): void {
  const w = holder.querySelector<HTMLElement>(".bub .wait");
  if (!w) return;
  delete w.dataset.eta;
  const t = w.querySelector(".wt"); if (t) t.textContent = "";
}
const retrying = (holder: HTMLElement, gen?: { note(t: string): void }) => (n: number, secs: number, of: number) => {
  const t = `Still loading on this machine. Trying again in ${secs}s (${n} of ${of}).`;
  status(holder, t);
  gen?.note(t);
};

async function loadBuilds(): Promise<void> {
  try {
    const d = await api<{ runs?: { prompt?: string; startedAt?: number; finishedAt?: number; steps?: { status?: string }[] }[] }>(
      "/api/apps/build/api/director/runs?limit=200",
    );
    S.builds = (d.runs ?? []).map((r) => ({
      prompt: String(r.prompt ?? "").slice(0, 90),
      when: r.startedAt ? new Date(r.startedAt).toLocaleDateString() : "",
      ts: Number(r.startedAt ?? 0),
      secs: r.startedAt && r.finishedAt && r.finishedAt > r.startedAt ? Math.round((r.finishedAt - r.startedAt) / 1000) : 0,
      status: (r.steps ?? []).every((x) => x.status === "done") ? "built" : "failed",
    }));
  } catch (e) {
    console.warn("[nexy] build history unavailable", e);
  }
}

async function loadProjects(): Promise<void> {
  // no Own Startup on this machine (a computer without an Own1): no projects, not an error
  const d = await api<{ projects?: UpstreamProject[] }>("/api/apps/startup/api/pm/projects").catch((e) => {
    if (e instanceof HttpError && e.status === 404) return { projects: [] };
    throw e;
  });
  S.projects = (d.projects ?? []).map(shape);
}

const loaded = new Set<string>();
async function loadProjectDetail(id: string): Promise<void> {
  if (loaded.has(id)) return;
  const d = await api<{ project?: UpstreamProject } & UpstreamProject>(
    `/api/apps/startup/api/pm/projects/${encodeURIComponent(id)}`,
  );
  const full = d.project ?? (d as UpstreamProject);
  const i = S.projects.findIndex((p) => p.id === id);
  if (i < 0) return;
  const fresh = shape(full, i);
  fresh.files = S.projects[i].files;
  fresh.activity = S.projects[i].activity;
  S.projects[i] = fresh;
  loaded.add(id);
}

// the owner's say on an AI employee's work (own-startup /review); redo carries their note
async function reviewTask(pid: string, taskId: string, verdict: "approve" | "redo", note?: string): Promise<void> {
  await api(`/api/apps/startup/api/pm/projects/${encodeURIComponent(pid)}/review`, { method: "POST", body: JSON.stringify({ taskId, verdict, note }) });
  loaded.delete(pid);
  await loadProjectDetail(pid);
  renderAll();
}

function onReview(pid: string, taskId: string, verdict: string): void {
  const { push, saveChat } = captureWork();
  const t = S.projects.find((p) => p.id === pid)?.tasks.find((x) => x.id === taskId);
  if (!t) return;
  if (verdict === "approve") {
    reviewTask(pid, taskId, "approve")
      .then(() => { push("ai", `Approved <b>${esc(t.t)}</b>.`); saveChat(); })
      .catch((e: Error) => toast(`That approval did not save: ${errText(e)}`));
    return;
  }
  S.redo = { pid, taskId, title: t.t };
  push("ai", `What should change in <b>${esc(t.t)}</b>? Tell me, and the ${esc(t.who)} redoes it with your note.`);
  const inp = $<HTMLTextAreaElement>("#input");
  if (inp) { inp.placeholder = `What to change in ${t.t.slice(0, 40)}`; inp.focus(); }
  saveChat();
}

async function openProject(id: string): Promise<void> {
  projectChanged(id);
  const { pushBlock, showArtifact } = captureWork();
  S.cur = id;
  renderAll();
  try {
    await loadProjectDetail(id);
    const p = S.projects.find((p) => p.id === id);
    if (p) {
      showArtifact(planArtifact(p));
      const resume = resumeBlock(p, () => void autopilot(p));
      document.querySelectorAll(`#thread [data-resume="${CSS.escape(p.id)}"]`).forEach((n) => n.closest(".msg")?.remove());
      if (resume) { resume.dataset.resume = p.id; pushBlock(resume); }
    }
  } catch (e) {
    S.projectsError = `could not open that project (${errText(e)})`;
  }
  renderAll();
}

async function loadFeed(): Promise<{ files: FileRow[]; activity: Event[]; note: string }> {
  type Item = { kind: string; title: string; appLabel: string; ts: number; href?: string };
  const d = await api<{
    items: Item[];
    silent?: { id: string; label: string }[];
    degraded?: { app: string; label?: string }[];
  }>("/api/v1/feed?limit=200");

  S.feed = d.items as unknown as FeedLike[];
  const files = d.items.map((i) => ({
    n: i.title, by: i.appLabel, app: i.appLabel, href: i.href, kind: i.kind,
    when: new Date(i.ts).toLocaleDateString([], { month: "short", day: "numeric" }),
  }));
  const activity = d.items.slice(0, 20).map((i) => ({
    t: new Date(i.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    x: `<b>${esc(i.appLabel)}</b> ${esc(i.kind === "doc" ? "holds" : "made")} ${esc(i.title)}`,
    k: "on" as const,
  }));

  const bad = (d.degraded ?? []).map((x) => x.label || x.app);
  const quiet = (d.silent ?? []).map((x) => x.label);
  S.quiet = quiet;
  const note =
    (bad.length ? `<div class="feednote bad">Not answering: ${esc(bad.join(", "))}</div>` : "") +
    (quiet.length
      ? `<div class="feednote">${esc(quiet.join(" and "))} ${quiet.length > 1 ? "do" : "does"} not publish activity yet — open ${quiet.length > 1 ? "them" : "it"} from the dock.</div>`
      : "");
  return { files, activity, note };
}

// an example's result: a build by URL, a plan by project id, Paint, or an image
async function showExample(o: ExampleOpen): Promise<void> {
  const { showArtifact } = captureWork();
  if (o.kind === "paint") { showArtifact(paintArtifact({ title: o.title || "Drawing app" })); return; }
  if (o.kind === "plan") {
    const p = S.projects.find((x) => x.id === o.href);
    if (p) {
      await loadProjectDetail(p.id).catch((e: Error) => console.warn("[nexy] example plan did not load", e));
      showArtifact(planArtifact(S.projects.find((x) => x.id === o.href) ?? p));
      return;
    }
    // not in the sidebar (an archived project still opens by id)
    // one quick try, not api()'s patient retries: on a box without the project the
    // snapshot below is the answer, and a missing Own Startup must not hold it up
    const d = await fetch(`/api/apps/startup/api/pm/projects/${encodeURIComponent(o.href)}`, { headers: { accept: "application/json" }, signal: timeoutSignal(4000) })
      .then((r) => (r.ok ? (r.json() as Promise<{ project?: UpstreamProject } & UpstreamProject>) : null))
      .catch((e: Error) => { console.warn("[nexy] example plan did not load", e); return null; });
    const full = d?.project ?? (d?.id ? (d as UpstreamProject) : null);
    if (full) { showArtifact(planArtifact(shape(full, S.projects.length))); return; }
    // a machine that never had this project: the example carries a snapshot of it
    if (o.ex) {
      try {
        const c = await api<{ chat?: { open?: { project?: UpstreamProject } } }>(`/api/v1/chats?id=${encodeURIComponent(o.ex)}`);
        const snap = c.chat?.open?.project;
        if (snap) { showArtifact(planArtifact(shape(snap, S.projects.length))); return; }
      } catch (e) { console.warn("[nexy] example plan snapshot did not load", e); }
    }
    toast("That plan is no longer on this machine");
    return;
  }
  showArtifact(artifactFor({ kind: o.kind, title: o.title, appLabel: o.kind === "image" ? "Own Image Studio" : "Own Build", app: o.kind === "image" ? "images" : "build", ts: o.ts ?? Date.now(), href: o.href }));
}

function renderSide(): void {
  const ex = $("#exList"), rows = exampleRows();
  if (ex) { ex.innerHTML = rows; wireExamples(ex); $("#exWrap")!.hidden = !rows; }
  // chats outside any project; without this list they were unreachable after New chat
  const cl = $("#chatList"), cr = chatRows("_", 5);
  if (cl) { cl.innerHTML = cr; wireChatRows(cl); $("#chatWrap")!.hidden = !cr; }
  const l = $("#projList");
  if (!l) return;
  if (S.projectsError) {
    l.innerHTML = `<div class="feednote bad">Own Startup is not answering (${esc(S.projectsError)}), so projects cannot be listed.</div>`;
    return;
  }
  l.innerHTML =
    S.projects
      .map(
        (p) =>
          `<button type="button" class="proj${p.id === S.cur ? " active" : ""}" data-p="${esc(p.id)}">` +
          `<span class="tile">${esc(p.name.charAt(0).toUpperCase())}</span>` +
          `<span class="nm">${esc(p.name)}</span>` +
          `<span class="prog"><i style="width:${p.progress}%"></i></span></button>` +
          (p.id === S.cur ? chatRows(p.id) : ""),
      )
      .join("") || `<div class="empty">No projects yet. Ask Nexy to build something.</div>`;
  wireChatRows(l);
  $$(".proj", l).forEach((b) => {
    const p = S.projects.find((x) => x.id === b.dataset.p);
    if (!p) return;
    b.addEventListener("click", () => void openProject(p.id));
    b.insertAdjacentHTML("beforeend", DOTS);
    const open = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const r = b.getBoundingClientRect();
      openCtx([
        { label: "New chat", icon: IC.plus, run: () => void openProject(p.id).then(() => newChat({ inProject: true })) },
        { label: "Rename", icon: IC.pen, run: () => { const nm = b.querySelector<HTMLElement>(".nm"); if (nm) inlineRename(nm, p.name, (v) => { if (v) void renameProject(p, v); else renderSide(); }); } },
        { label: "Delete project", icon: IC.trash, danger: true, run: () => confirmDel("Delete project?", `<b>${esc(p.name)}</b> and its ${p.taskCount} task${p.taskCount === 1 ? "" : "s"} will be removed from Own Startup on this machine. This cannot be undone.`, () => void deleteProject(p)) },
      ], r.right - 176, r.bottom + 4);
    };
    b.querySelector<HTMLElement>(".dots")?.addEventListener("click", open);
    b.addEventListener("contextmenu", open);
    chatDrop(b, p.id, (title) => { void openProject(p.id); toast(`Moved “${title}” to ${p.name}`); });
  });
}

async function renameProject(p: Project, name: string): Promise<void> {
  const url = `/api/apps/startup/api/pm/projects/${encodeURIComponent(p.id)}`;
  try {
    const d = await api<{ project?: UpstreamProject }>(url);
    if (!d.project) throw new Error("the project did not come back");
    await api(url, { method: "PUT", body: JSON.stringify({ ...d.project, title: name }) });
    p.name = name;
    p.activity.unshift({ t: now(), x: `<b>You</b> renamed the project to ${esc(name)}`, k: "on" });
    toast(`Renamed to ${name}`);
  } catch (e) {
    toast(`Own Startup did not rename it: ${errText(e)}`);
  }
  renderAll();
}

async function deleteProject(p: Project): Promise<void> {
  try {
    await api(`/api/apps/startup/api/pm/projects/${encodeURIComponent(p.id)}`, { method: "DELETE" });
    S.projects = S.projects.filter((x) => x.id !== p.id);
    toast(`Deleted ${p.name}`);
    if (S.cur === p.id) {
      const first = S.projects[0];
      if (first) { await openProject(first.id); return; }
      S.cur = "";
    }
  } catch (e) {
    toast(`Own Startup did not delete it: ${errText(e)}`);
  }
  renderAll();
}

function renderBoard(): void {
  const p = P(), b = $("#board");
  if (!b) return;
  if (!p) { b.innerHTML = `<div class="empty">No project selected.</div>`; return; }
  b.innerHTML = "";
  ([["todo", "To do"], ["doing", "Doing"], ["done", "Done"]] as const).forEach(([k, label]) => {
    const ts = p.tasks.filter((t) => t.s === k);
    const col = document.createElement("div");
    col.innerHTML =
      `<div class="colh"><span>${label}</span><span>${ts.length}</span></div>` +
      ts
        .map(
          (t) =>
            `<div class="tcard" data-t="${esc(t.id)}"><div class="tt">${esc(t.t)}</div>` +
            `<div class="tm"><span class="led${t.s === "done" ? " ok" : t.s === "doing" ? "" : " off"}"></span>` +
            `${esc(t.who)}${t.s === "doing" ? ", on device" : ""}</div></div>`,
        )
        .join("");
    b.appendChild(col);
  });
  $$(".tcard", b).forEach((c) => c.addEventListener("click", () => void cycleTask(p, c.dataset.t!)));
}

async function cycleTask(p: Project, id: string): Promise<void> {
  const t = p.tasks.find((x) => x.id === id);
  if (!t) return;
  const next = t.s === "todo" ? "doing" : t.s === "doing" ? "done" : "todo";
  try {
    await api(`/api/apps/startup/api/pm/projects/${encodeURIComponent(p.id)}/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: next }) });
    p.activity.unshift({ t: now(), x: `<b>You</b> moved “${esc(t.t)}” to ${next === "todo" ? "to do" : next}`, k: "on" });
    await refreshProject(p.id);
    reshowPlan(p.id);
  } catch (e) {
    toast(`Own Startup did not change it: ${errText(e)}`);
  }
}

async function fromFrame(e: MessageEvent): Promise<void> {
  const { showArtifact, saveChat } = captureWork();
  const d = e.data as { nexyToast?: string; nexySave?: { name: string; mime: string; dataUrl: string } } | null;
  if (!d || typeof d !== "object" || !e.source) return;
  const from = (sel: string) => [...document.querySelectorAll<HTMLIFrameElement>(sel)].some((f) => f.contentWindow === e.source);
  if (typeof d.nexyToast === "string" && from("#cvBody .studio iframe")) toast(d.nexyToast.slice(0, 200));
  const save = d.nexySave;
  if (!save || save.mime !== "audio/wav" || !from("#cvBody .studio iframe")) return;
  try {
    const blob = await (await fetch(save.dataUrl)).blob();
    const r = await fetch(`/api/apps/beat/api/import?title=${encodeURIComponent(save.name.replace(/\.wav$/, ""))}`, { method: "POST", headers: { "content-type": "audio/wav" }, body: blob });
    const res = await r.json() as { id?: string; error?: string };
    if (!r.ok || !res.id) throw new Error(res.error ?? httpMsg(r.status));
    (e.source as Window).postMessage({ nexySaved: save.name }, "*");
    toast(`Saved ${save.name} to Files, in Own Beat Studio`);
    showArtifact(artifactFor({ app: "beat", appLabel: "Own Beat Studio", kind: "audio", title: save.name, ts: Date.now(), href: `/api/apps/beat/api/history/${encodeURIComponent(res.id)}` }));
    saveChat();
  } catch (err) {
    toast(`Own Beat Studio did not take it: ${errText(err)}`);
  }
}

async function refreshProject(id: string): Promise<void> {
  loaded.delete(id);
  await loadProjectDetail(id);
  renderAll();
}

function reshowPlan(id: string): void {
  const p = P();
  if (p && p.id === id && currentArtifact()?.id === `plan:${id}`) showArtifact(planArtifact(p));
}

function renderFiles(note = ""): void {
  const g = $("#fgrid");
  if (!g) return;
  const cards = outputsForChat().map((a) => ({ n: a.title, by: a.meta ?? "Nexy", app: a.meta?.split(" · ")[0], kind: a.kind, href: a.href, when: "this chat", id: a.id }))
    .map((f) => {
      return (
        `<div class="fcard" data-key="${esc(f.id)}">` +
        (f.href && f.app === "Own Image Studio"
          ? `<div class="ft th"><img src="${esc(f.href)}" alt="" loading="lazy"></div>`
          : `<div class="ft">${esc(typeLabel(f))}</div>`) +
        `<div><div class="fname" style="font-weight:500;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(plainName(f.n))}</div>` +
        `<div class="faint" style="font-size:11.5px">${esc(f.by)}, ${esc(f.when)}</div></div></div>`
      );
    })
    .join("");
  g.innerHTML = note + (cards || `<div class="empty">No files yet. Ask Nexy to build something.</div>`);

  $$(".fcard", g).forEach((c) => {
    const row = outputsForChat().find((r) => r.id === c.dataset.key);
    if (!row) return;
    c.style.cursor = "pointer";
    c.addEventListener("click", () => {
      showArtifact(row);
    });
  });
}

const APP_TYPE: Record<string, string> = {
  game: "Game", plan: "Project plan",
  site: "Website", html: "Website", project: "Project plan", audio: "Beat studio",
};

function renderApps(): void {
  const g = $("#agrid");
  const count = $("#cApps");
  if (!g) return;
  const apps = outputsForChat().filter((f) => ["html", "game", "plan", "audio"].includes(f.kind));
  if (count) count.textContent = String(apps.length);
  g.innerHTML =
    apps
      .map(
        (f) =>
          `<div class="fcard app" data-key="${esc(f.id)}">` +
          `<div class="ft th app"><span class="apptype">${esc(APP_TYPE[f.kind])}</span></div>` +
          `<div><div class="fname" style="font-weight:500;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.title)}</div>` +
          `<div class="faint" style="font-size:11.5px">${esc(f.meta ?? "Nexy")}</div></div></div>`,
      )
      .join("") ||
    `<div class="empty">Nothing runnable yet. Sites, plans and studios show up here; ` +
    `plain files stay in Files.</div>`;

  $$(".fcard.app", g).forEach((c) => {
    const row = outputsForChat().find((r) => r.id === c.dataset.key);
    if (!row) return;
    c.style.cursor = "pointer";
    c.addEventListener("click", () => {
      showArtifact(row);
    });
  });
}

const PAUSED_KEY = "nexy.pausedAgents.v1";
const pausedAgents = new Set<string>((() => {
  try { return JSON.parse(localStorage.getItem(PAUSED_KEY) ?? "[]") as string[]; }
  catch (e) { console.warn("[nexy] paused agents unreadable", e); return []; }
})());
const isPaused = (pid: string, role: string) => pausedAgents.has(`${pid}:${role}`);
function togglePaused(p: Project, role: string): void {
  const k = `${p.id}:${role}`;
  const off = !pausedAgents.has(k);
  if (off) pausedAgents.add(k); else pausedAgents.delete(k);
  try { localStorage.setItem(PAUSED_KEY, JSON.stringify([...pausedAgents])); }
  catch (e) { console.warn("[nexy] paused agents not saved", e); }
  p.activity.unshift({ t: now(), x: `<b>You</b> ${off ? "paused" : "resumed"} ${esc(role)}`, k: off ? "off" : "on" });
  renderAll();
}

function renderAgents(): void {
  const p = P(), v = $("#agentsView");
  if (!v) return;
  v.innerHTML =
    (p?.agents ?? [])
      .map((a) => {
        const off = isPaused(p!.id, a.n);
        return `<div class="agrow"><span class="led${a.on && !off ? "" : " off"}"></span><div class="n">${esc(a.n)}</div>` +
          `<div class="task2">${esc(off ? "Paused" : a.task)}</div>` +
          `<div style="display:flex;gap:8px;align-items:center"><span class="scope">this machine</span>` +
          `<button class="btn small" type="button" data-n="${esc(a.n)}">${off ? "Resume" : "Pause"}</button></div></div>`;
      })
      .join("") ||
    `<div class="empty">No named agents yet.<br><span class="faint">Own Startup marks each task as yours or Nexy's, but does not assign specialists like Designer or Copywriter. Until it does, naming one here would be a job title nothing actually gave out.</span></div>`;
  if (p) v.querySelectorAll<HTMLElement>(".btn[data-n]").forEach((b) => b.addEventListener("click", () => togglePaused(p, b.dataset.n!)));
}

function renderActivity(note = ""): void {
  const p = P(), v = $("#activityView");
  if (!v) return;
  v.innerHTML =
    note +
    ((p?.activity ?? [])
      .map((e) => `<div class="ev"><div class="t">${e.t}</div><span class="led${e.k === "off" ? " off" : e.k === "warn" ? " warn" : ""}"></span><div class="x">${e.x}</div></div>`)
      .join("") || `<div class="empty">Nothing has happened on this machine yet.</div>`);
}

function openPanel(sec: string): void {
  const panel = $("#panel");
  if (!panel) return;
  renderPanel();
  document.body.classList.add("panel-open");
  panel.classList.add("open");
  $$(".psec", panel).forEach((x) => x.classList.add("active"));
  setTimeout(() => panel.querySelector(`.psec[data-sec="${sec}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 30);
}

function renderPanel(): void {
  const p = P();
  const needs = $("#needs");
  if (needs) {
    const open = (p?.tasks ?? []).filter((t) => t.human && t.s !== "done");
    needs.innerHTML = open.map((t) => `<div class="need" data-t="${esc(t.id)}"><b>${esc(t.t)}</b><small>${esc(t.ms || t.goal || p!.name)}</small></div>`).join("") ||
      `<div class="empty">Nothing waiting on you.</div>`;
    const reviews = (p?.tasks ?? []).filter((t) => t.review === "pending");
    if (reviews.length) needs.insertAdjacentHTML("afterbegin", reviews.map((t) =>
      `<div class="need rv"><b>Review: ${esc(t.t)}</b><small>${esc(t.who)}</small><span class="pbtns">` +
      `<button class="btn small primary" type="button" data-review="approve" data-id="${esc(t.id)}">Approve</button>` +
      `<button class="btn small ghost" type="button" data-review="redo" data-id="${esc(t.id)}">Send back</button></span></div>`).join(""));
    needs.querySelector(".empty")?.toggleAttribute("hidden", reviews.length > 0);
    $$("[data-review]", needs).forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); onReview(p!.id, b.dataset.id!, b.dataset.review!); }));
    $$(".need:not(.rv)", needs).forEach((n) => n.addEventListener("click", () => { showTab("tasks"); }));
  }
  const files = $("#rFiles");
  if (files) files.textContent = String(outputsForChat().length);
  const team = $("#rAgents");
  if (team) team.innerHTML = (p?.agents ?? []).map((a) => {
    const off = p && isPaused(p.id, a.n);
    return `<div class="tr"><span class="led${a.on && !off ? "" : " off"}"></span><div><div class="n">${esc(a.n)}</div><div class="task">${esc(off ? "Paused" : a.task)}</div></div><span class="scope">this machine</span></div>`;
  }).join("") || `<div class="empty">None yet.</div>`;
  const recos = $("#recos");
  if (recos && p) {
    const runnable = p.tasks.filter((t) => !t.human && t.s !== "done" && !isPaused(p.id, t.who)).length;
    const mine = p.tasks.filter((t) => t.human && t.s !== "done").length;
    const recs: [string, string, string][] = [];
    if (runnable && !S.running) recs.push(["Run the next tasks", `${runnable} task${runnable === 1 ? "" : "s"} Nexy can do on this machine`, "start the team"]);
    if (mine) recs.push(["Clear what is yours", `${mine} task${mine === 1 ? "" : "s"} only you can do`, "show the tasks"]);
    recos.innerHTML = recs.map(([t, sub, cmd]) => `<div class="rrec" data-cmd="${esc(cmd)}"><b>${esc(t)}</b><small>${esc(sub)}</small></div>`).join("") || `<div class="empty">Nothing to suggest right now.</div>`;
    $$(".rrec", recos).forEach((r) => r.addEventListener("click", () => void send(r.dataset.cmd!)));
  }
  const move = $("#moveBtn2");
  if (move) move.hidden = true;
}

function renderHead(): void {
  const p = P();
  const set = (id: string, v: string) => { const e = $(id); if (e) e.textContent = v; };
  set("#cTasks", String(p?.tasks.filter((t) => t.s !== "done").length ?? 0));
  set("#cFiles", String(outputsForChat().length));
  set("#cAgents", String(p?.agents.length ?? 0));
  set("#pName", p?.name ?? "");
  set("#pLoc", p?.loc ?? "");
  const bar = $("#rBar"); if (bar) bar.style.width = `${p?.progress ?? 0}%`;
  set("#rProg", `${p?.progress ?? 0}%`);
  set("#rNext", p?.next ? `Next: ${p.next}` : "");
}

function renderAll(): void {
  renderSide(); renderHead(); renderBoard(); renderApps(); renderFiles(); renderAgents(); renderActivity(); emptyState();
}

function pushBlock(el: HTMLElement, priv = isPrivate()): HTMLElement {
  const th = chatThread();
  const wrap = document.createElement("div");
  wrap.className = "msg ai";
  if (priv) wrap.dataset.private = "1";
  wrap.appendChild(el);
  th.appendChild(wrap);
  if (th instanceof HTMLElement) th.scrollTop = th.scrollHeight;
  return el;
}

const ICON_COPY = `<svg class="i" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>`;
const ICON_EDIT = `<svg class="i" viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>`;
const ICON_RETRY = `<svg class="i" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>`;
const THUMB = `<path d="M7 11v9H4v-9zM7 11l4-7c1.2 0 2 .9 1.8 2.1L12 10h6a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7"/>`;
const ICON_UP = `<svg class="i" viewBox="0 0 24 24">${THUMB}</svg>`;
const ICON_DOWN = `<svg class="i" viewBox="0 0 24 24"><g transform="matrix(1 0 0 -1 0 24)">${THUMB}</g></svg>`;

function messageActions(d: HTMLElement, who: "me" | "ai"): void {
  const acts = document.createElement("div");
  acts.className = `macts${who === "ai" ? " ai" : ""}`;
  const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  acts.innerHTML = who === "me"
    ? `<span class="faint">${at}</span><button type="button" data-a="copy" title="Copy">${ICON_COPY}</button>` +
      `<button type="button" data-a="edit" title="Edit">${ICON_EDIT}</button><button type="button" data-a="retry" title="Retry">${ICON_RETRY}</button>`
    : `<button type="button" data-a="copy" title="Copy">${ICON_COPY}</button><button type="button" data-a="retry" title="Try again">${ICON_RETRY}</button>`;
  const text = () => (d.querySelector(".bub") as HTMLElement | null)?.innerText.trim() ?? "";
  acts.querySelector('[data-a="copy"]')!.addEventListener("click", () => {
    navigator.clipboard?.writeText(text()).then(() => toast("Copied"), (e) => toast(`Could not copy: ${(e as Error).message}`));
  });
  acts.querySelector('[data-a="edit"]')?.addEventListener("click", () => {
    const inp = $<HTMLTextAreaElement>("#input");
    if (!inp) return;
    inp.value = text();
    inp.dispatchEvent(new Event("input"));
    inp.focus();
  });
  acts.querySelector('[data-a="retry"]')!.addEventListener("click", () => {
    let prev: Element | null = who === "me" ? d : d.previousElementSibling;
    while (prev && !prev.classList.contains("me")) prev = prev.previousElementSibling;
    const said = (prev?.querySelector(".bub") as HTMLElement | null)?.innerText.trim();
    if (said) void send(said); else toast("Nothing to retry");
  });
  d.appendChild(acts);
}

function push(who: "me" | "ai", html: string, priv = isPrivate()): HTMLElement {
  const th = chatThread();
  typingOff();
  const d = document.createElement("div");
  d.className = `msg m ${who}`;
  if (priv) d.dataset.private = "1";
  d.innerHTML = `<div class="bub t">${html}</div>`;
  messageActions(d, who);
  th.appendChild(d);
  if (th instanceof HTMLElement) th.scrollTop = th.scrollHeight;
  return d;
}

const typingOn = () => {
  const th = chatThread();
  if (!th || th.querySelector("#typing")) return;
  const t = document.createElement("div");
  t.className = "m ai";
  t.id = "typing";
  t.innerHTML = `<div class="typing"><i></i><i></i><i></i></div>`;
  th.appendChild(t);
  if (th instanceof HTMLElement) th.scrollTop = th.scrollHeight;
};
const typingOff = () => { chatThread()?.querySelector("#typing")?.remove(); };

// A readable name for an output: the subject, not the request around it.
// "Generate an image of a red apple on a wooden table" -> "Red apple on a wooden table".
function shortTitle(prompt: string, fallback: string): string {
  const core = prompt.split("\n")[0].split(/[,;:.!?](?:\s|$)/)[0]
    .replace(/^\s*(?:hey\s+nexy[,\s]+)?(?:please\s+)?(?:can you\s+)?(?:generate|make|draw|create|paint|produce|give)\s+(?:me\s+)?(?:an?\s+|some\s+)?/i, "")
    .replace(/^(?:image|picture|photo|illustration|beat|track|song)\s+(?:of\s+|about\s+|with\s+)?(?:an?\s+|the\s+)?/i, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();
  if (!core) return fallback;
  const cut = core.length <= 32 ? core : core.slice(0, 32).replace(/\s+\S*$/, "");
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}

function titleFor(brief: string): string {
  brief = brief.split("\n")[0];
  return (
    brief
      .replace(/^\s*(?:hey\s+nexy[,\s]+)?(?:please\s+)?(?:can you\s+)?(?:draw|build|make|create|give|code|write|design)\s+(?:me\s+)?(?:an?\s+)?/i, "")
      .replace(/\s+for me\s*$/i, "")
      .trim()
      .slice(0, 120) || brief.slice(0, 120)
  );
}

const ATTACH_MAX_BYTES = 40 * 1024 * 1024;

type Attachment = { id: string; filename: string; eph: boolean; conv?: string; local?: string };
interface TurnState { attached: Attachment[]; lastBuild: LastBuild | null; lastTurn: { prompt: string; el: HTMLElement | null; at?: number } }
const turns = new Map<string, TurnState>();
function turnState(): TurnState {
  const id = chatScope(); let state = turns.get(id);
  if (!state) { state = { attached: [], lastBuild: null, lastTurn: { prompt: "", el: null } }; turns.set(id, state); }
  return state;
}
// the chat's last build: brief, kind, id, outcome and error, saved with the chat
const lastBuild = (): LastBuild | null => turnState().lastBuild ?? chatLastBuild() ?? null;
function noteBuild(b: LastBuild): void {
  turnState().lastBuild = b;
  setChatLastBuild(b);
}
// A failed build in Nexy's own turn log, which outlives the build's files: no brief text, only its length.
function logBuildFailure(f: { build: string; kind: string; brief: string; ms: number; error: string; builder: "own-build" | "engine" }): void {
  if (isPrivate()) return;
  fetch("/api/v1/build-log", { method: "POST", keepalive: true, headers: { "content-type": "application/json" },
    body: JSON.stringify({ build: f.build, kind: f.kind, briefChars: f.brief.length, ms: f.ms, error: plainError(f.error).slice(0, 300), builder: f.builder }) })
    .then((r) => { if (!r.ok) console.warn("[nexy] build failure not logged", r.status); })
    .catch((e) => console.warn("[nexy] build failure not logged", e));
}

async function attachedDocs(priv: boolean): Promise<{ filename: string; text: string }[]> {
  const localTurn = turnState();
  const restored: Attachment[] = priv ? [] : outputsForChat().filter((a) => a.kind === "doc" && a.href?.startsWith("/api/apps/docs/api/v1/document?")).map((a) => ({ id: new URL(a.href!, location.origin).searchParams.get("id")!, filename: a.title, eph: false }));
  const mine = [...new Map([...restored, ...localTurn.attached.filter((a) => a.eph === priv)].map((a) => [a.id, a])).values()].slice(-4);
  const out: { filename: string; text: string }[] = [];
  for (const a of mine) {
    try {
      // read on this computer: its text is all there is
      if (a.id.startsWith("here:")) { out.push({ filename: a.filename, text: a.local ?? "" }); continue; }
      const url = (conv?: string) => `/api/apps/docs/api/v1/document?id=${encodeURIComponent(a.id)}${conv ? `&conv=${encodeURIComponent(conv)}` : ""}`;
      const d = await api<{ text?: string }>(url(a.conv)).catch((e) => (a.conv ? api<{ text?: string }>(url()) : Promise.reject(e)));
      out.push({ filename: a.filename, text: d.text?.trim() || a.local || "(still being read; no text yet)" });
    } catch (e) {
      out.push({ filename: a.filename, text: a.local || `(could not be read: ${errText(e)})` });
    }
  }
  return out;
}

const SAMPLE_FILES: [string, string][] = [
  ["SAMPLE-ledger-2025-FICTIONAL.csv",
    "# FICTIONAL SAMPLE DATA for trying Nexy. Not a real business.\n" +
    "date,description,category,amount_usd\n" +
    "2025-01-15,Client invoice #101 Harbor Cafe,income,4200.00\n2025-02-03,Client invoice #102 Lumen Studio,income,6800.00\n" +
    "2025-03-20,Client invoice #103 Harbor Cafe,income,3900.00\n2025-05-11,Client invoice #104 Northwind Co,income,12500.00\n" +
    "2025-07-08,Client invoice #105 Lumen Studio,income,7300.00\n2025-09-30,Client invoice #106 Northwind Co,income,9800.00\n" +
    "2025-11-19,Client invoice #107 Pine & Co,income,5400.00\n" +
    "2025-01-02,Laptop,equipment,2100.00\n2025-01-31,Co-working desk (12 months),rent,3600.00\n" +
    "2025-03-01,Design software subscription (annual),software,660.00\n2025-04-14,Accountant consultation,professional_fees,450.00\n" +
    "2025-06-06,Conference ticket + travel,travel,1280.00\n2025-08-22,Client lunches,meals,340.00\n" +
    "2025-10-10,Business insurance,insurance,720.00\n2025-12-01,Phone + internet (business share),utilities,960.00\n"],
  ["SAMPLE-notes-2025-FICTIONAL.txt",
    "FICTIONAL SAMPLE. Sole trader, freelance design, calendar year 2025.\n" +
    "Estimated tax payments made: 2025-04-15 $1,500; 2025-06-15 $1,500; 2025-09-15 $1,500.\n" +
    "Home office not claimed (co-working desk used). Laptop used 100% for business.\n"],
];

async function attachSample(said = "Use sample data"): Promise<void> {
  const { conversation, push, attachFiles } = captureWork();
  conversation(isPrivate()).push({ role: "user", content: said });
  push("ai", `Attaching a <b>fictional</b> sample set (a 2025 ledger for a made-up freelance designer, and notes)` +
    `${isPrivate() ? ", kept in memory only for this private session" : ""}. Nothing in it is real.`);
  await attachFiles(SAMPLE_FILES.map(([n, t]) => new File([t], n, { type: n.endsWith(".csv") ? "text/csv" : "text/plain" })));
}

// no Own Docs here (a computer without an Own1): the file is read in this page and goes with the chat
async function attachHere(files: File[]): Promise<void> {
  const localTurn = turnState();
  const { push, conversation, saveChat } = captureWork();
  const done: string[] = [];
  const failed: string[] = [];
  for (const f of files) {
    try {
      const r = await readLocally(f.name, f.type, new Uint8Array(await f.arrayBuffer()));
      if (r.kind === "image") { failed.push(`${f.name}: images can't be read here yet`); continue; }
      if (r.kind === "unreadable") { failed.push(`${f.name}: ${r.why}`); continue; }
      localTurn.attached.push({ id: `here:${Date.now()}:${f.name}`, filename: f.name, eph: isPrivate(), local: r.text });
      done.push(f.name);
    } catch (e) {
      failed.push(`${f.name}: couldn't be read (${errText(e)})`);
    }
  }
  const parts: string[] = [];
  if (done.length) {
    const t = conversation(isPrivate());
    t.push({ role: "user", content: `I attached ${done.join(", ")}.` });
    t.push({ role: "assistant", content: `Got ${done.length === 1 ? "it" : "them"}: ${done.join(", ")}. I can read ${done.length === 1 ? "it" : "them"} now.` });
    parts.push(`Read ${esc(done.join(", "))} on ${here}. Ask me about ${done.length === 1 ? "it" : "them"}.`);
  }
  if (failed.length) parts.push(`<div class="feednote bad"${done.length ? ' style="margin-top:8px"' : ""}>${esc(failed.join(" · "))}</div>`);
  push("ai", parts.join(""));
  saveChat();
}

async function attachFiles(files: File[]): Promise<void> {
  const localTurn = turnState();
  const { push, pushBlock, conversation, saveChat, showArtifact } = captureWork();
  if (!files.length) return;
  if (!hasStudio("docs")) return attachHere(files);

  const tooBig = files.filter((f) => f.size > ATTACH_MAX_BYTES);
  if (tooBig.length) {
    push("ai", `${esc(tooBig.map((f) => f.name).join(", "))} is over ${ATTACH_MAX_BYTES / 1024 / 1024} MB. Own Docs takes it directly for files that size.`);
    files = files.filter((f) => f.size <= ATTACH_MAX_BYTES);
    if (!files.length) return;
  }

  const holder = push(
    "ai",
    `Putting ${files.length === 1 ? esc(files[0].name) : `${files.length} files`} into Own Docs. ` +
      `Reading and indexing happens on this machine, so it takes a moment.` +
      `<div class="feednote" style="margin-top:8px">Uploading…</div>`,
  );

  const done: string[] = [];
  const failed: string[] = [];
  const added: { id: string; filename: string }[] = [];
  for (const f of files) {
    try {
      const q = new URLSearchParams({ filename: f.name });
      if (isPrivate()) {
        q.set("ephemeral", "1");
        const conv = privateConversationId();
        if (conv) q.set("conv", conv);
      }
      const r = await api<{ accepted?: { filename: string; docId?: string; error?: string }[]; error?: string }>(
        `/api/apps/docs/api/v1/documents?${q.toString()}`,
        {
          method: "POST",
          headers: { "content-type": !f.type || f.type === "text/plain" ? "application/octet-stream" : f.type },
          body: await f.arrayBuffer(),
        },
      );
      const a = r.accepted?.[0];
      if (!a || a.error) throw new Error(a?.error ?? r.error ?? "Own Docs did not accept it");
      done.push(f.name);
      if (a.docId) { added.push({ id: String(a.docId), filename: f.name }); localTurn.attached.push({ id: String(a.docId), filename: f.name, eph: isPrivate(), conv: isPrivate() ? privateConversationId() ?? undefined : undefined,
        local: /\.(csv|txt|md|json|tsv)$/i.test(f.name) && f.size < 200_000 ? await f.text() : undefined }); }
    } catch (e) {
      failed.push(`${f.name}: ${errText(e)}`);
    }
  }

  const parts: string[] = [];
  if (done.length) {
    const t = conversation(isPrivate());
    t.push({ role: "user", content: `I attached ${done.join(", ")}.` });
    t.push({ role: "assistant", content: `Got ${done.length === 1 ? "it" : "them"}: ${done.join(", ")}. I can read ${done.length === 1 ? "it" : "them"} now.` });
  }
  if (done.length) {
    parts.push(
      `${esc(done.join(", "))} ${done.length === 1 ? "is" : "are"} in Own Docs and being read now. ` +
        `Ask me about ${done.length === 1 ? "it" : "them"} once indexing finishes — Own Docs shows the progress.`,
    );
  }
  if (failed.length) parts.push(`<div class="feednote bad" style="margin-top:8px">${esc(failed.join(" · "))}</div>`);
  holder.querySelector(".bub")!.innerHTML = parts.join("");

  for (const a of added) showArtifact(artifactFor({ app: "docs", appLabel: "Own Docs", kind: "doc", title: a.filename, ts: Date.now(), href: `/api/apps/docs/api/v1/document?id=${encodeURIComponent(a.id)}` }));
  saveChat();
  if (isPrivate()) {
    for (const a of added) noteEphemeralDoc(a.filename);
  } else if (added.length) {
    pushBlock(
      consentBlock(added, (doc, row) => {
        const led = row.querySelector<HTMLElement>(".led");
        const slot = row.querySelector<HTMLElement>(".v");
        if (slot) slot.textContent = "allowing…";
        void api<{ document?: { shared_with_apps?: boolean }; error?: string }>(
          "/api/apps/docs/api/v1/share-with-apps",
          { method: "POST", body: JSON.stringify({ id: doc.id, share: true }) },
        )
          .then((d) => {
            if (!d.document?.shared_with_apps) throw new Error(d.error ?? "Own Docs did not record it");
            if (led) led.className = "led ok";
            if (slot) slot.textContent = "Nexy can read it";
          })
          .catch((e: Error) => {
            if (slot) slot.textContent = "";
            if (row) row.insertAdjacentHTML("beforeend", `<span class="faint">${esc(errText(e))}</span>`);
          });
      }),
    );
  }
}

const BUILD_POLL_MS = 3_000;
// No ceiling on a build: Own Build stops one only when it makes no progress. Nexy gives
// up only when the machine stops answering (a 30 min cap once dropped a working build).
const BUILD_UNREACHABLE_MS = 10 * 60_000;



// A job that failed says what happened in a plain sentence and offers Try again; the technical
// detail stays one click away, never as the reply itself.
function failedReply(bub: Element, sentence: string, detail: string, retry: () => void): void {
  bub.innerHTML = `${sentence}<div style="margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">` +
    `<button type="button" class="btn small" data-retry>Try again</button>` +
    `<details class="faint"><summary>What went wrong</summary><code>${esc(detail)}</code></details></div>`;
  bub.querySelector<HTMLButtonElement>("[data-retry]")!.addEventListener("click", (e) => {
    (e.currentTarget as HTMLButtonElement).disabled = true;
    retry();
  });
}

// On a computer the engine's builder writes the page: the server checks it is what was asked,
// the browser runs it unseen, and a failed check gets one more try, then a plain no.
const LOCAL_BUILD_MS = 90_000;
type LocalEnd = { type: "done"; html: string; title: string; secs: number } | { type: "failed"; error: string; check: boolean; secs: number };

function followBuild(id: string, onStep: (text: string) => void): Promise<LocalEnd> {
  return new Promise((resolve) => {
    let tries = 0;
    const open = () => {
      const es = new EventSource(`/api/v1/build?id=${encodeURIComponent(id)}`);
      es.onmessage = (m) => {
        let e: LocalEnd | { type: "step"; text: string };
        try { e = JSON.parse(m.data); } catch { return; } // a cut event; a reconnect replays it
        if (e.type === "step") return onStep(e.text);
        es.close();
        resolve(e);
      };
      // a dropped stream picks up again: the server replays what happened so far
      es.onerror = () => {
        es.close();
        if (++tries > 20) resolve({ type: "failed", error: "lost touch with the builder on this computer", check: false, secs: 0 });
        else setTimeout(open, Math.min(1000 * tries, 8000));
      };
    };
    open();
  });
}

type Again = { error: string } | undefined;
async function playLocalMake(brief: string, again?: Again): Promise<void> {
  const { push, generating, saveChat, noteBuild } = captureWork();
  noteBuild({ brief, deliverable: "web_app", outcome: "running" });
  const game = gameBrief(brief);
  const holder = push("ai", again
    ? (again.error ? "Building it again on this computer, and fixing the error it hit…" : "Building it again on this computer…")
    : "Building that on this computer, not in a datacentre. It will open when it is ready.");
  const gen = generating(titleFor(brief), game ? "game" : "html", "Writing it on this computer", LOCAL_BUILD_MS);
  status(holder, "Starting…", LOCAL_BUILD_MS);
  const t0 = Date.now();
  let fix = again?.error ?? "", why = "", checked = false, buildId = "";
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt === 2) { status(holder, "That version did not pass my checks. Trying once more…"); gen.live("Trying once more"); }
      const started = await patient(() => api<{ id?: string; error?: string }>("/api/v1/build", {
        method: "POST", body: JSON.stringify({ brief, fix }),
      }), retrying(holder, gen));
      if (!started.id) throw new Error(started.error ?? "the builder did not start");
      buildId = `build:local-${started.id}`;
      const r = await followBuild(started.id, (t) => { status(holder, `${t}…`); gen.live(t); });
      const failed = (error: string) => logBuildFailure({ build: buildId, kind: game ? "game" : "web_app", brief, ms: Date.now() - t0, error, builder: "engine" });
      if (r.type === "failed") { why = r.error; checked ||= r.check; fix = r.check ? r.error : ""; failed(r.error); continue; }
      status(holder, "Running it to check it works…");
      gen.live("Running it to check it works");
      const g = await renderGate(r.html);
      if (!g.ok) { why = fix = g.why; checked = true; failed(g.why); continue; }
      const secs = Math.round((Date.now() - t0) / 1000);
      const made = { title: (r.title || titleFor(brief)).replace(/\s+/g, " ").trim().slice(0, 48) || "Your build", meta: `Built on this computer · ${secs}s`, html: r.html };
      const output = game ? gameArtifact(made) : htmlArtifact({ ...made, url: siteHost });
      output.id = buildId;
      noteBuild({ brief, deliverable: "web_app", id: buildId, outcome: "done" });
      gen.replaceWith(output);
      push("ai", g.thin ? esc(THIN) : `Done. It is ${ON_RIGHT} and it runs. Built on this computer in ${secs}s.`);
      window.dispatchEvent(new CustomEvent("nexy:files-changed"));
      saveChat();
      return;
    }
    throw new Error(why || "the build did not finish");
  } catch (e) {
    const detail = plainError(errText(e));
    noteBuild({ brief, deliverable: "web_app", ...(buildId ? { id: buildId } : {}), outcome: "failed", error: (why || detail).slice(0, ERROR_MAX) });
    gen.fail("It did not work this time");
    failedReply(holder.querySelector(".bub")!, checked
      ? "I could not build that well enough to show you. I tried twice and neither version passed my checks, so I kept them back. Try again, or describe it a little differently."
      : "I could not build that: the builder on this computer did not finish. It usually works on a second try.",
      detail, () => void playLocalMake(brief, again));
  } finally {
    settle(holder);
  }
}

// again: a rebuild of the chat's last build, with the error it hit (empty when it ran)
async function playMake(brief: string, deliverable: "web_app" | "diagram" = "web_app", mode?: "phaser", again?: Again): Promise<void> {
  if (buildsHere && deliverable === "web_app") return playLocalMake(brief, again);
  const { push, generating, saveChat, noteBuild } = captureWork();
  noteBuild({ brief, deliverable, outcome: "running" });
  const holder = push(
    "ai",
    again
      ? `${deliverable === "diagram" ? "Drawing it again" : "Building it again"}${again.error ? ", and fixing the error it hit…" : "…"}`
      : `${deliverable === "diagram" ? "Drawing that" : "Building that"} on this machine, not in a datacentre. You can watch it come together ${ON_RIGHT}.`,
  );
  const t0 = Date.now();
  let buildId = "";
  const gen = generating(titleFor(brief), deliverable === "diagram" ? "diagram" : "html",
    deliverable === "diagram" ? "Drawing it on this machine" : "Writing it on this machine", typicalMs(deliverable === "diagram" ? "diagram" : "site"));
  status(holder, "Starting…", typicalMs(deliverable === "diagram" ? "diagram" : "site"));
  try {
    const started = await patient(() => api<{ buildId?: string; error?: string }>("/api/apps/build/api/build", {
      method: "POST",
      body: JSON.stringify({ kind: deliverable, title: titleFor(brief), description: again?.error ? `${brief}\n\n${fixNote(again.error)}` : brief, ...(mode ? { mode } : {}) }),
    }), retrying(holder, gen));
    if (!started.buildId) throw new Error(started.error ?? "own-build did not start the build");
    buildId = `build:${started.buildId}`;

    let done: BuildDone | undefined;
    let heard = Date.now();
    while (!done) {
      await new Promise((r) => setTimeout(r, BUILD_POLL_MS));
      // the build keeps going on the machine; a missed poll is not a failed build
      const d = await api<BuildPoll>(`/api/apps/build/api/build?id=${encodeURIComponent(started.buildId)}`)
        .catch((e) => { if (transient(e)) return null; throw e; });
      if (!d) {
        if (Date.now() - heard > BUILD_UNREACHABLE_MS) throw new Error(`Own Build has not answered for ${Math.round(BUILD_UNREACHABLE_MS / 60000)} minutes`);
        status(holder, "Reconnecting to Own Build…"); continue;
      }
      heard = Date.now();
      if (d.status === "running") { status(holder, d.step || "Working…", typicalMs(deliverable === "diagram" ? "diagram" : "site")); if (d.step) gen.live(d.step, d.partialHtml); continue; }
      if (d.status === "error") throw new Error(d.error ?? "the build failed");
      done = d as BuildDone;
    }

    const html = done.artifact?.html ?? "";
    if (!html.trim()) throw new Error("the build finished but produced no page");

    const isGame = done.artifact?.produces?.appKind === "game";
    const title = String(done.artifact?.title ?? done.title ?? "app");
    const secs = done.elapsedSeconds;

    const bub = push("ai", `Done — it is ${ON_RIGHT}. Built on this machine in ${secs}s. Checking it runs…`).querySelector(".bub")!;
    let fault = "";
    const onMsg = (e: MessageEvent) => { if (!fault && e.data?.nexyRunError) fault = String(e.data.nexyRunError); };
    addEventListener("message", onMsg);
    const id = done.runId ? `build:${done.runId}` : buildId;
    noteBuild({ brief, deliverable, id, outcome: "done" });
    setTimeout(() => {
      removeEventListener("message", onMsg);
      if (fault) {
        noteBuild({ brief, deliverable, id, outcome: "failed", error: fault.slice(0, ERROR_MAX) });
        logBuildFailure({ build: id, kind: isGame ? "game" : deliverable, brief, ms: Date.now() - t0, error: fault, builder: "own-build" });
      }
      const unmet = (done!.artifact?.produces?.unmet ?? []).filter(Boolean);
      const note = unmet.length
        ? `<div class="feednote" style="margin-top:8px">Not in it yet: ${unmet.map(esc).join(", ")}. Say “add the rest” and I will build them in.</div>`
        : "";
      bub.innerHTML = (fault
        ? `Done in ${secs}s, but it throws when it runs: <code>${esc(plainError(fault))}</code>. That is a fault in the generated code — ask me to build it again.`
        : `Done — it is ${ON_RIGHT} and it runs. Built on this machine in ${secs}s.`) + note;
      saveChat();
    }, RUN_CHECK_MS);

    const made = {
      title: title.replace(/\s+/g, " ").trim().slice(0, 48) || "Your build",
      meta: `Own Build · ${secs}s · on device`,
      html,
      href: done.runId ? `/api/apps/build/api/director/runs/${encodeURIComponent(done.runId)}/preview` : undefined,
    };
    const output = isGame ? gameArtifact(made) : htmlArtifact({ ...made, url: siteHost });
    output.id = id;
    gen.replaceWith(output);
    window.dispatchEvent(new CustomEvent("nexy:files-changed"));
  } catch (e) {
    const full = errText(e), why = plainError(full);
    noteBuild({ brief, deliverable, ...(buildId ? { id: buildId } : {}), outcome: "failed", error: full.slice(0, ERROR_MAX) });
    logBuildFailure({ build: buildId || "not-started", kind: deliverable, brief, ms: Date.now() - t0, error: full, builder: "own-build" });
    gen.fail(`Own Build stopped: ${why}`);
    // a generated page that fails the checks is the model's mistake, not a fault in the machine
    failedReply(holder.querySelector(".bub")!, /render gate|not playable|looks broken|cannot draw|not a readable/i.test(why)
      ? "I could not build that well enough to show you: the version I made did not pass my checks, so I kept it back."
      : "I could not build that: Own Build did not finish. It usually works on a second try.",
      why, () => void playMake(brief, deliverable, mode, again));
  } finally {
    settle(holder);
  }
}

function playWorkLog(days: number): void {
  const span = days === 1 ? "today" : `the last ${days} days`;
  push("ai", `Pulling ${span} from this machine's records: every build, what each app made, and how long builds held the model.`);
  const rows: ReportRow[] = [
    ...S.builds.map((b) => ({ ts: b.ts, app: "Own Build", what: b.prompt || "build", secs: b.secs })),
    ...S.feed.map((f) => ({ ts: f.ts, app: f.appLabel, what: f.title, secs: 0 })),
  ];
  showArtifact(reportArtifact(days, rows, S.projects.length));
  push("ai", "On the right: compute per day, the split by app, and the full list underneath. Switch to Items, filter by app, or export CSV. Chat and studio time is not metered yet, so it is not counted.");
}

async function playChart(question: string, priv: boolean): Promise<void> {
  const { push, showArtifact } = captureWork();
  const holder = push("ai", `Searching the web from this machine and checking every figure against its source…`);
  const bub = holder.querySelector(".bub")!;
  try {
    let res!: Response, c!: ChartData & { error?: string; note?: string };
    for (const wait of [15_000, 30_000, 45_000, 0]) {
      res = await fetch("/api/v1/research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, private: priv }) });
      c = (await res.json()) as ChartData & { error?: string; note?: string };
      if (!wait || !(res.status === 429 || /busy/i.test(c.error ?? ""))) break;
      if (!bub.querySelector(".feednote")) bub.insertAdjacentHTML("beforeend", `<div class="feednote" style="margin-top:6px">The model is busy with another job on this machine; waiting for it.</div>`);
      await new Promise((ok) => setTimeout(ok, wait));
    }
    if (c.error === "private" || c.error === "own-app" || c.error === "no-search") { bub.innerHTML = esc(c.note ?? "Web search is off in ultra-private mode."); return; }
    if (!res.ok || c.error) throw new Error(c.error || httpMsg(res.status));
    if (c.points.length < 1) {
      bub.innerHTML = `I searched for “${esc(c.query)}” but found ${c.points.length ? "only one figure" : "no figures"} I can trace to a source, so there is no chart rather than a made-up one.` +
        (c.dropped ? ` ${c.dropped} value${c.dropped === 1 ? "" : "s"} the model offered could not be found in any result and were left out.` : "") + ` Try a more specific question.`;
      return;
    }
    showArtifact(chartArtifact(c));
    bub.innerHTML = (c.kind === "table"
      ? `${c.points.length} figure${c.points.length === 1 ? "" : "s"} on <b>${esc(c.title)}</b>, each quoted from its source. They measure different things, so they are listed, not charted (searched for “${esc(c.query)}”).`
      : `${c.points.length} figures for <b>${esc(c.title)}</b>, each quoted from its source (searched for “${esc(c.query)}”).`) +
      (c.dropped ? `<div class="feednote" style="margin-top:8px">${c.dropped} value${c.dropped === 1 ? "" : "s"} could not be found in any source and were left out.</div>` : "");
  } catch (e) {
    bub.innerHTML = `The web search did not complete: <code>${esc(errText(e))}</code>`;
  }
}

const RUN_CHECK_MS = 6000;

async function playDeck(text: string, tasks: string[]): Promise<void> {
  const { push, showArtifact } = captureWork();
  const month = monthIn(text);
  const subject = month ? null : subjectIn(text);
  const about = subject ? `figures on ${esc(subject.toLowerCase())}` : `${esc(month ?? "the latest")} figures`;
  const holder = push("ai", `Pulling ${about} from your documents in Own Docs, on this machine…`);
  try {
    const question = subject
      ? `What do my documents say about ${subject.toLowerCase()}: market, customers, pricing and key figures? Quote the exact figures.`
      : `What were the ${month ?? "latest"} numbers — revenue, costs, cash, runway and key metrics? Quote the exact figures.`;
    let d: { answer?: string; sources?: DocSource[]; noMatch?: boolean; emptyCorpus?: boolean; error?: string } = {};
    for (let i = 0; i < 3; i++) {
      const r = await fetch("/api/apps/docs/api/v1/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, k: 8 }) });
      d = await r.json();
      if (r.status !== 429) { if (!r.ok) throw new Error(d.error ?? httpMsg(r.status)); break; }
      await new Promise((ok) => setTimeout(ok, 10_000));
    }
    const { slides, traced, dropped } = d.noMatch || d.emptyCorpus
      ? slidesFrom("", [], month, tasks, subject)
      : slidesFrom(d.answer ?? "", d.sources ?? [], month, tasks, subject);
    const title = subject ? `${subject} ${/\bpitch\b/i.test(text) ? "pitch deck" : "deck"}` : `${month ?? "Latest"} investor update`;
    showArtifact(deckArtifact({ title, slides, meta: `${slides.length} slides · figures from Own Docs · on device` }));
    holder.querySelector(".bub")!.innerHTML = traced
      ? `Three slides ${ON_RIGHT}. ${traced} figure${traced === 1 ? "" : "s"}, each traced to the document it came from` +
        `${dropped ? `; ${dropped} I could not trace to a document excerpt were left out` : ""}.`
      : d.emptyCorpus
        ? `Three slides ${ON_RIGHT}, but Own Docs has nothing indexed yet, so the numbers slide says so instead of inventing figures. ${subject ? "Attach material on it" : `Attach the ${esc(month ?? "latest")} P&L`} and ask again.`
        : `Three slides ${ON_RIGHT}. I found no ${subject ? about : `${esc(month ?? "")} figures`} in your documents that I could trace, so the numbers slide says so rather than making them up.`;
  } catch (e) {
    holder.querySelector(".bub")!.innerHTML = `The plan is ready, but I could not pull figures from Own Docs: <code>${esc(errText(e))}</code>`;
  }
}

// A conversation becomes a Project when the work has several steps or is meant to be published:
// the chat keeps its history and is linked to the new project, as one started from the form.
const madeIn = new Map<string, number>(); // things a chat has made (builds, images, charts)
const offeredIn = new Set<string>();

function suggestProject(text: string, kind: string): void {
  const id = currentChatId();
  if (!id || isPrivate() || chatProject()) return;
  if (kind === "make" || kind === "generate" || kind === "chart") madeIn.set(id, (madeIn.get(id) ?? 0) + 1);
  const made = madeIn.get(id) ?? 0;
  if (offeredIn.has(id) || !offersProject(made, text)) return;
  offeredIn.add(id);
  const chips = $("#chips");
  if (!chips) return;
  chips.innerHTML = `<button type="button" class="chip" id="toProject" data-chat="${esc(id)}">Make this a project</button>`;
  $("#toProject")?.addEventListener("click", (e) => {
    // offered in another chat than the one now open: not for this one
    if ((e.currentTarget as HTMLElement).dataset.chat !== currentChatId()) { chips.innerHTML = ""; return; }
    void promoteChat();
  });
}

async function promoteChat(): Promise<void> {
  const chips = $("#chips");
  if (chips) chips.innerHTML = "";
  if (isPrivate()) { toast("An ultra-private chat keeps nothing, so it cannot become a project"); return; }
  if (S.busy) { toast("Nexy is still working; make it a project when it is done"); return; }
  if (chatProject()) { toast("This chat is already part of a project"); return; }
  const asks = chatHistory().filter((t) => t.role === "user").map((t) => t.content.trim()).filter(Boolean);
  if (!asks.length) { toast("Ask Nexy for something first, then make it a project"); return; }
  // what the person asked for, first and latest, is the project's goal
  const goal = [asks[0], ...asks.slice(1).slice(-4)].join("; then ").slice(0, 1200);
  const { push, playBuild, saveChat } = captureWork();
  S.busy = true; S.job = "build";
  try {
    push("me", "Make this a project");
    await playBuild(goal);
  } finally {
    S.busy = false; S.job = "";
    saveChat();
  }
}

async function playBuild(text: string): Promise<void> {
  const { push, pushBlock, showArtifact, autopilot, playDeck, setChatProject } = captureWork();
  const holder = push(
    "ai",
    `Reading the objective and planning it out on this machine. This takes a few minutes — the model is doing the thinking here, not in a datacentre.<div class="feednote" style="margin-top:8px">Planning…</div>`,
  );
  try {
    const d = await api<{ project?: UpstreamProject; error?: string }>("/api/apps/startup/api/pm/projects", {
      method: "POST",
      body: JSON.stringify({ objective: text }),
    });
    if (!d.project) throw new Error(d.error ?? "no project came back");

    const p = shape(d.project, S.projects.length);
    S.projects.unshift(p);
    setChatProject(p.id);

    holder.querySelector(".bub")!.innerHTML =
      `On it. I planned it out on this machine and I am working through it now, one task at a time. ` +
      `I will stop only if something needs you.`;

    const block = pushBlock(
      planBlock(p, {
        onStart: (proj) => void autopilot(proj),
        onAdjust: () => {
          const inp = $<HTMLTextAreaElement>("#input");
          if (inp) { inp.value = "Adjust the plan: "; inp.dispatchEvent(new Event("input")); inp.focus(); }
        },
      }),
    );
    const roster = agentsBlock(p);
    if (roster) pushBlock(roster);

    renderAll();
    showArtifact(planArtifact(p));
    markStarted(block, "Running on autopilot.");
    void autopilot(p);
    if (/\b(deck|slides?|presentation)\b/i.test(text)) await playDeck(text, p.tasks.map((t) => t.t));
  } catch (e) {
    failedReply(holder.querySelector(".bub")!, "I could not build the plan this time. It usually works on a second try.",
      errText(e), () => void playBuild(text));
  }
}

async function objectiveOf(p: Project): Promise<string> {
  const d = await api<{ project?: UpstreamProject }>(`/api/apps/startup/api/pm/projects/${encodeURIComponent(p.id)}`);
  return d.project?.objective ?? "";
}

// runs what Nexy can do on a plan, one task at a time, then builds it if it is a build
let autoOn = false;
const autoQueue: { project: Project; run: () => Promise<void> }[] = [];

// one plan at a time on the model; the next waits its turn
async function autopilot(p: Project): Promise<void> {
  const { push, autopilotRun, owner } = captureWork();
  if (autoOn) {
    if (!autoQueue.some((q) => q.project === p)) { autoQueue.push({ project: p, run: bindChat(() => autopilot(p), owner) }); push("ai", `<b>${esc(p.name)}</b> is queued; it starts when the current plan is done.`); }
    return;
  }
  S.paused = false;
  autoOn = true;
  try { await autopilotRun(p); } finally { autoOn = false; }
  const next = autoQueue.shift();
  if (next && !S.paused) void next.run();
}

async function autopilotRun(p: Project): Promise<void> {
  const { pushBlock, saveChat, runTask, playMake, autopilot, conversation, visible } = captureWork();
  const count = () => ({ done: p.tasks.filter((t) => t.s === "done").length, total: p.tasks.length });
  const ui = autopilotBlock(p.name,
    () => { S.paused = true; show("paused", S.running ? `Pausing after “${S.running}” finishes` : "Paused"); },
    () => { markStarted(ui.el, "Resumed below."); void autopilot(p); });
  pushBlock(ui.el);
  const show = (state: "running" | "paused" | "finished", note?: string) => { const c = count(); ui.set(c.done, c.total, state, note); };
  show("running");
  const server = await followServer(p, show).catch((e: Error) => { console.warn("[nexy] autopilot on the box unavailable; running from this tab", e); return "unsupported" as const; });
  if (server === "paused" || server === "stopped") { saveChat(); return; }
  let waits = 0, waitingOn = "";
  // a task this loop already ran is never picked again: the project's task list can be swapped
  // for a fresh copy mid-run, and the "done" then landed on the old object, so every task
  // after the first ran twice (2026-10-25, local-autopilot-follow.cjs)
  const ran = new Set<string>();
  for (;server === "unsupported";) {
    const t = p.tasks.find((x) => x.s !== "done" && !ran.has(x.id) && !x.human && !isPaused(p.id, x.who));
    if (!t) break;
    if (t.id !== waitingOn) { waits = 0; waitingOn = t.id; }
    await untilIdle();
    if (S.paused) { show("paused", `Paused. Next: ${t.t}`); saveChat(); return; }
    show("running", `Now: ${t.t}`);
    const r = await runTask(t.id, p);
    if (r === "done") ran.add(t.id);
    if (r === "busy") continue;
    if (r === "wait") {
      if (++waits > 5) { show("paused", `Stopped: “${t.t}” kept hitting a busy or unreachable service. Resume to try again.`); saveChat(); return; }
      show("running", "The model or a service is busy; trying again shortly");
      await new Promise((ok) => setTimeout(ok, 20_000));
      continue;
    }
    if (r === "failed") { show("paused", `Stopped: “${t.t}” did not run. Resume to try it again.`); saveChat(); return; }
  }
  const needs = p.tasks.filter((t) => t.s !== "done" && t.human);
  const objective = await objectiveOf(p).catch((e: Error) => { console.warn("[nexy] objective unavailable", e); return ""; });
  if (buildable(objective)) {
    show("running", "Tasks done. Building it now.");
    await untilIdle();
    S.busy = true;
    try {
      await playMake(planBrief(objective, p));
      // send()'s own "make" path calls madeIt() right after playMake() so a follow-up
      // question has something to refer to. autopilotRun calls playMake() directly —
      // same gap, same fix, applied here since this path never goes through send().
      if (visible() && lastAiSaidDone()) {
        conversation(isPrivate()).push(
          { role: "user", content: objective },
          { role: "assistant", content: `I built it: ${titleFor(objective)}. It is open in the work pane.` },
        );
      }
    }
    finally { S.busy = false; drain(); }
  }
  show("finished", needs.length
    ? `Everything Nexy can do is done. ${needs.length} task${needs.length === 1 ? " is" : "s are"} yours.`
    : buildable(objective) ? "Every task is done and it is built." : "Every task is done.");
  saveChat();
}

function pausePlan(): void {
  if (!S.running && autoOn) {
    S.paused = true;
    push("ai", "Pausing autopilot. Nothing new starts; resume it from its card.");
    return;
  }
  if (!S.running) {
    push("ai", "Nothing is running right now, so there is nothing to pause.");
    return;
  }
  S.paused = true;
  push(
    "ai",
    `Pausing. <b>${esc(S.running)}</b> is already on the model and will finish; nothing new starts after it.`,
  );
}

const ROSTER = [
  "Market researcher", "Legal reviewer", "Data analyst", "Smart contract engineer",
  "Security auditor", "Software developer", "Designer", "Copywriter",
  "Executive assistant", "Project manager", "Video editor",
];
const ROLE_ALIASES: Array<[RegExp, string]> = [
  [/^(?:(?:launch|release|project)\s+)?(?:pm|project\s+manager|program\s+manager)$/i, "Project manager"],
  [/^(?:ea|assistant|pa)$/i, "Executive assistant"],
  [/^(?:dev|developer|engineer|coder)$/i, "Software developer"],
  [/^(?:writer|copy\s*writer)$/i, "Copywriter"],
];

async function addRole(asked: string): Promise<void> {
  const { P, push, pushBlock, playBoardEdit } = captureWork();
  const p = P();
  if (!p) { push("ai", "There is no project open to add someone to."); return; }
  const a = asked.trim().replace(/^(?:a|an|the)\s+/i, "");
  const role = ROSTER.find((r) => r.toLowerCase() === a.toLowerCase()) ?? ROLE_ALIASES.find(([re]) => re.test(a))?.[1];
  if (!role) {
    push(
      "ai",
      `<b>${esc(a)}</b> is not a role Own Startup can staff. Its team is a fixed roster: ${ROSTER.map(esc).join(", ")}. ` +
        `Nothing was changed.`,
    );
    return;
  }
  const on = p.agents.find((x) => x.n === role);
  if (on) { push("ai", `${esc(role)} is already on <b>${esc(p.name)}</b>${on.task ? `, on ${esc(on.task)}` : ""}.`); return; }
  const next = p.tasks.find((t) => t.s !== "done" && t.who === "Nexy");
  if (!next) {
    push("ai", `${esc(role)} joins <b>${esc(p.name)}</b> once a task is theirs. Say “assign &lt;task&gt; to ${esc(role)}”.`);
    return;
  }
  await playBoardEdit({ kind: "assignTask", title: next.t, role });
  const now = P();
  if (now?.tasks.find((t) => t.id === next.id)?.who === role)
  {
    push("ai", `${esc(role)}${role.toLowerCase() !== a.toLowerCase() ? ` (your ${esc(a)})` : ""} joined <b>${esc(p.name)}</b> and took <b>${esc(next.t)}</b> from Nexy.`);
    const card = document.createElement("div");
    card.className = "block";
    card.innerHTML = `<div class="bh">Added to the team<span class="r">${esc(p.name)}</span></div>` +
      `<div class="row"><span class="led"></span><span>${esc(role)}</span><span class="v">${esc(next.t)}</span></div>`;
    pushBlock(card);
  }
}

// a finished task's work: a structured result opens on the right, a short one sits in the chat
function resultHtml(title: string, out: string, show: typeof showArtifact): string {
  if (out && structured(out)) {
    show(markdownArtifact({ title: `${slugOf(title)}.md`, meta: `Own Startup · ${title.slice(0, 40)} · on device`, md: out }));
    return `<b>${esc(title)}</b> is done. ${inline(firstPart(out).slice(0, 220))}<br><span class="faint">The full result is ${ON_RIGHT}.</span>`;
  }
  return out
    ? `<b>${esc(title)}</b><div style="margin-top:6px">${bubbleText(out.slice(0, 1200))}</div>`
    : `<b>${esc(title)}</b> finished, but the run returned no text to show.`;
}

// Autopilot on the box (own-startup /autopilot): the team keeps working with this tab closed.
// This follows it, showing each task as it finishes. "unsupported" means an older Own Startup
// without the worker; the caller then runs the plan from this tab as before.
async function followServer(p: Project, show: (state: "running" | "paused" | "finished", note?: string) => void): Promise<"done" | "paused" | "stopped" | "unsupported"> {
  const { push, showArtifact, saveChat } = captureWork();
  const base = `/api/apps/startup/api/pm/projects/${encodeURIComponent(p.id)}`;
  const skip = [...new Set(p.tasks.map((t) => t.who))].filter((w) => isPaused(p.id, w));
  const r = await fetch(`${base}/autopilot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start", skip }) });
  if (r.status === 404 || r.status === 405) return "unsupported";
  if (!r.ok) { show("paused", `Autopilot did not start (${httpMsg(r.status)}). Resume to try again.`); return "stopped"; }
  const seen = new Set(p.tasks.filter((t) => t.s === "done").map((t) => t.id));
  for (;;) {
    if (S.paused) {
      await fetch(`${base}/autopilot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pause" }) })
        .catch((e: Error) => console.warn("[nexy] autopilot pause not sent", e));
      S.running = "";
      show("paused", "Paused. The task in hand finishes; nothing new starts.");
      return "paused";
    }
    await sleep(4000);
    type Live = UpstreamProject & { autopilot?: { state?: string; current?: string; error?: string }; goals?: { title: string; milestones?: { title: string; tasks?: { id: string; title: string; status?: string; result?: string }[] }[] }[] };
    const d = await api<{ project?: Live } & Live>(base)
      .catch((e: Error) => { console.warn("[nexy] autopilot progress unavailable", e); return null; });
    if (!d) continue;
    const full: Live = d.project ?? d;
    const i = S.projects.findIndex((x) => x.id === p.id);
    const fresh = shape(full, Math.max(0, i));
    p.tasks = fresh.tasks;
    p.progress = fresh.progress;
    for (const g of full.goals ?? []) for (const m of g.milestones ?? []) for (const t of m.tasks ?? []) {
      if (t.status !== "done" || seen.has(t.id)) continue;
      seen.add(t.id);
      push("ai", resultHtml(t.title, String(t.result ?? "").trim(), showArtifact));
    }
    const cur = p.tasks.find((t) => t.id === full.autopilot?.current);
    S.running = cur?.t ?? "";
    renderAll();
    saveChat();
    const state = full.autopilot?.state;
    if (state === "done") { S.running = ""; return "done"; }
    if (state === "stopped") { S.running = ""; show("paused", `Stopped: ${full.autopilot?.error ?? "a task did not run"}. Resume to try again.`); return "stopped"; }
    if (state === "paused") { S.running = ""; show("paused", "Paused."); return "paused"; }
    show("running", cur ? `Now: ${cur.t} (on this machine; it carries on if you close this tab)` : "Starting…");
  }
}

async function runTask(taskId: string, p: Project | undefined = P()): Promise<"done" | "failed" | "busy" | "wait"> {
  const { push, showArtifact, saveChat } = captureWork();
  const t = p?.tasks.find((x) => x.id === taskId);
  if (!p || !t) return "failed";
  if (S.busy) return "busy";
  let outcome: "done" | "failed" | "wait" = "failed";
  S.busy = true;
  S.running = t.t;
  t.s = "doing";
  renderBoard();
  const holder = push("ai", `Running <b>${esc(t.t)}</b> on this machine…`);
  try {
    const d = await api<{ task?: { result?: unknown }; output?: unknown; result?: unknown; content?: unknown }>(`/api/apps/startup/api/pm/projects/${p.id}/run`, {
      method: "POST",
      body: JSON.stringify({ taskId }),
    });
    t.s = "done";
    const out = String(
      d.task?.result ?? d.output ?? d.result ?? d.content ?? "",
    ).trim();
    holder.querySelector(".bub")!.innerHTML = resultHtml(t.t, out, showArtifact);
    p.progress = Math.round((p.tasks.filter((x) => x.s === "done").length / p.tasks.length) * 100);
    outcome = "done";
  } catch (e) {
    t.s = "todo";
    const msg = errText(e);
    if (unreachable(e) || /\b(429|502|503|504)\b|busy|loading|queue|timed out|hang up|fetch failed|network/i.test((e as Error).message)) {
      outcome = "wait";
      holder.remove();
    } else holder.querySelector(".bub")!.innerHTML =
      `<b>${esc(t.t)}</b> did not run: <code>${esc(msg)}</code>`;
  } finally {
    S.busy = false;
    S.running = "";
    renderAll();
    saveChat();
    drain();
  }
  return outcome;
}

const untilIdle = async (): Promise<void> => { while (S.busy) await new Promise((r) => setTimeout(r, 500)); };

function context() {
  return {
    projects: S.projects.filter((p) => p.id === chatProject()).map((p) => ({
      name: p.name,
      tasks: p.tasks.length,
      done: p.tasks.filter((t) => t.s === "done").length,
    })),
    apps: [...new Set(outputsForChat().map((a) => a.meta?.split(" · ")[0] ?? "Nexy"))],
    quiet: S.quiet,
    built: outputsForChat().map((a) => ({ what: a.title, status: "built" })),
    open: openPage(),
  };
}

const history: { role: "user" | "assistant"; content: string }[] = [];

const STATES: [RegExp, string][] = [
  [/\bflying\b/i, "airborne in mid-air high in the sky, feet off the ground, clouds around it"],
  [/\bfloating\b/i, "floating in the air, not touching the ground"],
  [/\bswimming\b/i, "swimming underwater"],
  [/\bunderwater\b/i, "completely underwater"],
  [/\bin space\b|\bastronaut\b/i, "in outer space with stars behind"],
];
function sharpen(prompt: string): string {
  const add = STATES.filter(([re]) => re.test(prompt)).map(([, s]) => s);
  return add.length ? `${prompt}, ${add.join(", ")}` : prompt;
}

async function imageQuality(src: string): Promise<string> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d")!;
    x.drawImage(img, 0, 0, 64, 64);
    const d = x.getImageData(0, 0, 64, 64).data;
    const L: number[] = [];
    for (let i = 0; i < d.length; i += 4) L.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    const mean = L.reduce((a, b) => a + b, 0) / L.length;
    const sd = Math.sqrt(L.reduce((a, b) => a + (b - mean) ** 2, 0) / L.length);
    if (sd < 4) return "blank";
    let nd = 0, n = 0;
    for (let y = 0; y < 64; y++) for (let k = 0; k < 63; k++) { nd += Math.abs(L[y * 64 + k] - L[y * 64 + k + 1]); n++; }
    return nd / n > 0.85 * sd ? "noise" : "";
  } catch (e) {
    console.warn("[nexy] image check could not run", e);
    return "";
  }
}

async function playGenerate(medium: "image" | "audio", prompt: string): Promise<void> {
  const { push, showArtifact, generating } = captureWork();
  const who = medium === "image" ? "Own Image Studio" : "Own Beat Studio";
  const holder = push(
    "ai",
    `Asking ${esc(who)} for that. It runs on this machine, so it takes a moment — ` +
      `one model is resident at a time.`,
  );
  status(holder, medium === "image" ? "Painting…" : "Writing the pattern…", medium === "image" ? typicalMs("image") : undefined);
  let gen: ReturnType<typeof generating> | undefined;
  try {
    if (medium === "image") {
      gen = generating(prompt.slice(0, 60), "image", `${who} is painting it on this machine`, typicalMs("image"));
      const paintStart = Date.now();
      const seed = () => Math.floor(Math.random() * 2_000_000_000);
      const d = await patient(() => api<{ image_b64?: string; error?: string }>(
        "/api/apps/images/api/generate",
        { method: "POST", body: JSON.stringify({ prompt: sharpen(prompt), size: "512x512", seed: seed() }) },
      ), retrying(holder, gen), IMAGE_WAITS);
      if (!d.image_b64) throw new Error(d.error ?? "no image came back");
      let src = `data:image/png;base64,${d.image_b64}`;
      let q = await imageQuality(src);
      if (q) {
        holder.querySelector(".bub")!.innerHTML = `The first image came back ${q}. Trying once more…`;
        const again = await api<{ image_b64?: string }>("/api/apps/images/api/generate",
          { method: "POST", body: JSON.stringify({ prompt: sharpen(prompt), size: "512x512", seed: seed() }) }).catch((e) => { console.warn("[nexy] image retry failed", e); return {} as { image_b64?: string }; });
        if (again.image_b64) { src = `data:image/png;base64,${again.image_b64}`; q = await imageQuality(src); }
      }
      if (q) holder.querySelector(".bub")!.innerHTML = `${esc(who)} returned an image, but it is ${q}, twice. It is ${ON_RIGHT} as it came back; this is a fault in the image engine on this machine, not your prompt.`;
      else push("ai", `Done. It is ${ON_RIGHT}, made by ${esc(who)} on this machine. Want variations, or a crop for social?`);
      if (!q) noteMs("image", Date.now() - paintStart);
      gen.replaceWith(imageArtifact({
        id: `gen:image:${Date.now()}`,
        title: `${shortTitle(prompt, "Image")}.png`,
        src,
        meta: `${who} · 512×512 · on device`,
      }));
      return;
    }

    const pat = await patient(() => api<{
      genre?: string; tempo_bpm?: number; key?: string;
      instruments?: string[]; pattern?: Record<string, number[]>; error?: string;
    }>("/api/apps/beat/api/beat-prompt", {
      method: "POST",
      body: JSON.stringify({
        prompt:
          `Write a 16-step drum pattern for: "${prompt}".\n` +
          `Return JSON with exactly these keys and nothing else:\n` +
          `{"genre":string,"tempo_bpm":number,"key":string,"instruments":string[],` +
          `"pattern":{"kick":number[],"snare":number[],"hi_hat":number[],"bass":number[]}}\n` +
          `Every array in "pattern" holds step numbers from 1 to 16 inclusive. ` +
          `Use integers only, no nested objects, no prose anywhere.`,
      }),
    }), retrying(holder));
    if (pat.error) throw new Error(pat.error);

    const clean: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(pat.pattern ?? {}))
      if (Array.isArray(v)) {
        const hits = [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 16))].sort((a, b) => a - b);
        if (hits.length) clean[k] = hits;
      }
    pat.pattern = clean;
    const bpm = Math.min(200, Math.max(60, Number(pat.tempo_bpm) || 90));
    const grid = Object.keys(clean).length > 0;
    if (!grid) {
      holder.querySelector(".bub")!.innerHTML =
        `${esc(who)} did not return a playable grid this time, so the studio opens on the closest preset. Press Play, or shape it yourself.`;
      showArtifact(beatStudioArtifact({ title: `${shortTitle(prompt, "Beat")}.studio`, preset: prompt }));
      return;
    }

    const bits = [pat.genre, pat.tempo_bpm ? `${pat.tempo_bpm} bpm` : "", pat.key].filter(Boolean).join(" · ");
    holder.querySelector(".bub")!.innerHTML =
      `Done — ${esc(bits || "a pattern")}, written on this machine. It is ${ON_RIGHT}: press Play or space, click a step to change it, and WAV renders two bars to a file. Every sound is synthesised here.`;

    showArtifact({ ...beatStudioArtifact({ title: `${shortTitle(prompt, "Beat")}.studio`, bpm, preset: pat.genre ?? prompt, steps: pat.pattern }), meta: `${who} · ${bits} · on device` });
  } catch (e) {
    gen?.fail(`${who} stopped: ${errText(e)}`);
    failedReply(holder.querySelector(".bub")!, `${esc(who)} could not make that this time. It usually works on a second try.`,
      errText(e), () => void playGenerate(medium, prompt));
  } finally {
    settle(holder);
  }
}

const STOP = new Set(["the", "a", "an", "to", "for", "of", "and", "on", "in", "with", "as", "task", "it"]);
const stem = (w: string) => w.slice(0, 5);
function findTask<T extends { t: string }>(tasks: T[], needle: string): { task?: T; fuzzy: boolean; candidates?: T[] } {
  const exact = tasks.filter((t) => t.t.toLowerCase().includes(needle));
  if (exact.length === 1) return { task: exact[0], fuzzy: false };
  if (exact.length > 1) return { fuzzy: false, candidates: exact.slice(0, 3) };
  const words = needle.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
  if (!words.length) return { fuzzy: false };
  const stems = tasks.map((t) => new Set(t.t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(stem)));
  const df = (w: string) => stems.filter((h) => h.has(w)).length || 1;
  const scored = tasks.map((t, i) => {
    const hit = words.filter((w) => stems[i].has(w));
    return { t, hits: hit.length, weight: hit.reduce((a, w) => a + 1 / df(w) + 1e-3 * (words.length - words.indexOf(w)), 0) };
  }).sort((a, b) => b.weight - a.weight || b.hits - a.hits);
  const [best, next] = scored;
  if (!best || best.hits === 0 || best.hits / words.length < 0.5) return { fuzzy: false };
  if (next && Math.abs(next.weight - best.weight) < 1e-9)
    return { fuzzy: false, candidates: scored.filter((x) => Math.abs(x.weight - best.weight) < 1e-9).slice(0, 3).map((x) => x.t) };
  return { task: best.t, fuzzy: true };
}

async function playBoardEdit(i: { kind: string; title: string; role?: string; state?: string }): Promise<void> {
  const { P, push } = captureWork();
  const p = P();
  if (!p) { push("ai", "There is no project open to change."); return; }
  const holder = push("ai", `Working on the board…`);
  const bub = holder.querySelector(".bub")!;

  try {
    if (i.kind === "addTask") {
      const d = await api<{ task?: { title: string }; placement?: string; note?: string }>(
        `/api/apps/startup/api/pm/projects/${encodeURIComponent(p.id)}/tasks`,
        { method: "POST", body: JSON.stringify({ title: i.title }) },
      );
      bub.innerHTML =
        `Added <b>${esc(d.task?.title ?? i.title)}</b>` +
        (d.placement ? ` to ${esc(d.placement)}` : "") + `.` +
        (d.note ? `<div class="feednote" style="margin-top:8px">${esc(d.note)}</div>` : "");
    } else {
      const needle = i.title.replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, "").toLowerCase();
      const { task: match, fuzzy, candidates } = findTask(p.tasks, needle);
      if (!match) {
        bub.innerHTML =
          candidates?.length
            ? `Did you mean ${candidates.map((c) => `<b>${esc(c.t)}</b>`).join(" or ")}? Nothing was changed.`
            : `No task on <b>${esc(p.name)}</b> matches “${esc(needle)}”. Nothing was changed.`;
        return;
      }
      const target = String(i.role ?? "").trim();
      const toHuman = /^(me|myself|you)$/i.test(target);
      if (i.kind === "completeTask" && i.state === "review") {
        bub.innerHTML = `The board has no Review column yet, so <b>${esc(match.t)}</b> is unchanged. Say “mark it doing” or “mark it done”.`;
        return;
      }
      const body = i.kind === "completeTask"
        ? { status: i.state ?? "done" }
        : toHuman ? { owner: "human" } : { role: target };

      const res = await api<{ changed?: string[]; task?: { role?: string; owner?: string } }>(
        `/api/apps/startup/api/pm/projects/${encodeURIComponent(p.id)}/tasks/${encodeURIComponent(match.id)}`,
        { method: "PATCH", body: JSON.stringify(body) },
      );

      const changed = res.changed ?? [];
      if (i.kind === "completeTask") {
        const st = i.state === "todo" ? "to do" : i.state ?? "done";
        bub.innerHTML = changed.includes("status")
          ? `Done, <b>${esc(match.t)}</b> is now ${st}.`
          : `<b>${esc(match.t)}</b> was already ${st}, so nothing changed.`;
      } else if (!changed.length) {
        bub.innerHTML = `<b>${esc(match.t)}</b> is unchanged — the board reports nothing was altered.`;
      } else {
        bub.innerHTML = toHuman
          ? `<b>${esc(match.t)}</b> is yours now.`
          : `Assigned <b>${esc(match.t)}</b> to ${esc(res.task?.role ?? target)}.`;
      }
      if (fuzzy) bub.innerHTML += `<div class="feednote" style="margin-top:8px">Closest task to “${esc(needle)}”.</div>`;
    }

    loaded.delete(p.id);
    await loadProjectDetail(p.id);
    renderAll();
    reshowPlan(p.id);
  } catch (e) {
    bub.innerHTML = `That did not change: <code>${esc(errText(e))}</code>`;
  }
}

// what the model wrote, as safe markdown: no raw HTML, links only http(s) and opened outside
const bubbleText = (t: string) => renderMd(t);
// the typing cursor goes at the end of the last line written, not under it
const withCursor = (html: string) => {
  const end = /<\/(?:p|li|h3|h4)>(?:<\/(?:ul|ol|blockquote)>)*$/.exec(html);
  return end ? `${html.slice(0, end.index)}<span class="cur"></span>${end[0]}` : `${html}<span class="cur"></span>`;
};
const structured = (t: string) => t.length > 1500 && (/^#{1,6} /m.test(t) || (t.match(/^\s*(\d+\.|[-*]) /gm) ?? []).length >= 3 || (t.match(/^\s*\|.*\|\s*$/gm) ?? []).length >= 3);
const firstPart = (t: string) => (t.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^#{1,6} /.test(p)) ?? t).slice(0, 400);

function typeOut(el: HTMLElement, text: string): Promise<void> {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { el.innerHTML = bubbleText(text); return Promise.resolve(); }
  const step = Math.max(2, Math.ceil(text.length / 330));
  const th = $("#thread");
  return new Promise((done) => {
    let i = 0;
    const tick = () => {
      i += step;
      if (i >= text.length) { el.innerHTML = bubbleText(text); done(); return; }
      el.innerHTML = withCursor(bubbleText(text.slice(0, i)));
      if (th) th.scrollTop = th.scrollHeight;
      setTimeout(tick, 9);
    };
    tick();
  });
}

// the last 12 messages, plus the opening exchange: "what was my first question?" needs it,
// and the agent keys a conversation by its first message (2026-10-20: forgotten by turn 10)
function recent<T>(thread: T[]): T[] {
  return thread.length > 14 ? [...thread.slice(0, 2), ...thread.slice(-12)] : thread;
}

// The agent's screen slides in once the agent opens its browser for this reply, never on a guess
// from the wording: a search-only answer left it open on an empty screen (2026-10-28).
function watchBrowsing(chat: string | null, show: () => void): { stop(browsed?: boolean): void } {
  let shown = false, done = false, since = 0, timer = 0;
  const reveal = () => {
    if (shown) return;
    shown = true;
    void screenAvailable().then((ok) => { if (ok) show(); });
  };
  const poll = async () => {
    if (done || shown || !chat) return;
    try {
      const q = `chat=${encodeURIComponent(chat)}${since ? `&since=${since}` : ""}${EVAL ? "&eval=1" : ""}`;
      const r = await api<{ browsing: boolean; now?: number }>(`/api/v1/browsing?${q}`);
      if (r.now) since = r.now;
      if (r.browsing) return reveal();
    } catch (e) { console.warn("[nexy] could not ask whether the agent is browsing", e); }
    if (!done) timer = window.setTimeout(() => void poll(), 3000);
  };
  void poll();
  return {
    stop(browsed) {
      done = true; clearTimeout(timer);
      if (!browsed) return;
      // after the reply's own table or file opens: what it browsed stays in front
      if (shown) setTimeout(show, 0); else reveal();
    },
  };
}

// The agent needs the person for one step: a button under its reply opens its screen and takes control.
function offerTakeover(holder: HTMLElement, what: string): void {
  const card = document.createElement("div");
  card.className = "takeover-ask";
  card.style.cssText = "margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap";
  card.innerHTML = `<span class="faint">${esc(what)}</span><button type="button" class="btn small">Take control</button>`;
  card.querySelector("button")!.addEventListener("click", () => {
    if (!takeControlFor(what)) showArtifact(screenArtifact());
  });
  holder.querySelector(".bub")?.appendChild(card);
}

// Streams a reply as it is written. A dropped connection reconnects to the same reply, which kept
// going on the server, instead of asking again. The server pings every 15 s, so this long without
// a byte means the socket is dead: reconnect rather than wait forever.
const STREAM_IDLE_MS = 40_000;
// No turn id this long after asking means the machine may be gone: one quick health check says.
const PROBE_MS = 8_000;
// onWait: the engine's own words for a slow start, when it has them
async function streamReply<T>(body: string, onText: (t: string) => void, onDrop: (gone: boolean) => void, onWait?: (note: string) => void): Promise<T> {
  let id = "";
  let abort = new AbortController(), idle = 0;
  // why the first request was stopped: before Chrome 98 abort() drops its reason, and fetch
  // rejects with a bare AbortError that is never retried
  let gone: DOMException | null = null;
  const probe = window.setTimeout(() => {
    if (id) return;
    fetch("/api/v1/health", { signal: timeoutSignal(5_000), cache: "no-store" }).then(
      (r) => { if (!r.ok) console.warn(`[nexy] health check: ${httpMsg(r.status)}`); },
      (e) => { console.warn("[nexy] the machine did not answer a health check", e); if (!id) { gone = new DOMException(GONE, "AbortError"); abort.abort(gone); } },
    );
  }, PROBE_MS);
  const alive = () => { clearTimeout(idle); const a = abort; idle = window.setTimeout(() => a.abort(new Error("the reply stream went silent")), STREAM_IDLE_MS); };
  const attempt = () => { abort.abort(); abort = new AbortController(); alive(); return abort.signal; };
  const read = async (r: Response): Promise<T | null> => {
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = "", ev = "";
    for (;;) {
      const { value, done } = await reader.read();
      alive();
      if (done) return null;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.startsWith("event:")) { ev = line.slice(6).trim(); continue; }
        if (!line.startsWith("data:")) continue;
        const d = JSON.parse(line.slice(5));
        if (ev === "turn") { id = String(d.id ?? ""); if (typeof d.wait === "string" && d.wait) onWait?.(d.wait); }
        else if (ev === "text") onText(String(d.text ?? ""));
        else if (ev === "done") {
          if (d.status >= 400) throw new HttpError(d.status, String(d.body?.error ?? ""));
          return d.body as T;
        }
      }
    }
  };
  try {
    let r: Response | null = await fetch("/api/v1/chat", { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body, signal: attempt() })
      .catch((e: unknown) => { throw gone ?? e; });
    if (!r.ok) {
      const detail = await r.json().then((j) => String(j?.error ?? ""), () => "");
      throw new HttpError(r.status, detail);
    }
    if (!(r.headers.get("content-type") ?? "").includes("text/event-stream")) return (await r.json()) as T;
    for (let n = 0; ; n++) {
      try {
        const out = r && await read(r);
        if (out) return out;
      } catch (e) {
        if (e instanceof HttpError) throw e;
        console.warn("[nexy] the reply stream broke", e);
      }
      if (!id) throw new Error("the connection dropped before the reply started");
      if (n >= 30) throw new Error("the connection kept dropping. Send it again when it is steady");
      onDrop(n > 0 && !r);
      await sleep(Math.min(1000 * 2 ** n, 10_000));
      r = await fetch(`/api/v1/chat-turn?id=${encodeURIComponent(id)}`, { headers: { accept: "text/event-stream" }, signal: attempt() }).catch((e) => {
        console.warn("[nexy] could not reconnect yet", e);
        return null;
      });
      if (r?.status === 404) throw new Error("that reply was lost when the connection dropped. Send it again");
      if (r && !r.ok) r = null;
    }
  } finally {
    clearTimeout(idle);
    clearTimeout(probe);
    abort.abort();
  }
}

// an odd "**" left by a cut: the last one goes
const closeBold = (t: string): string => ((t.match(/\*\*/g)?.length ?? 0) % 2 ? t.replace(/\*\*(?![\s\S]*\*\*)/, "") : t);

// how often a reply being written is saved, so a quit or crash keeps what had arrived
const PARTIAL_SAVE_MS = 3_000;
// a reply with no words this long gets the engine's own note, where it has one
const WAIT_NOTE_MS = 3_000;
// what "Continue?" sends. A continued answer keeps the question it continues: its document was
// titled "continue-from-where-you-stop" (QA 2026-11-12) and is now the same document, grown.
const CONTINUE = "Continue from where you stopped.";
// per chat and title: the document an answer made, and the answer that last went into it
const answerDocs = new Map<string, { md: string; last: string }>();
async function playChat(text: string, priv = false): Promise<void> {
  const { push, pushBlock, showArtifact, conversation, context, attachedDocs, saveChat } = captureWork();
  const holder = push("ai", "");
  // until it settles, a saved copy of this reply is marked interrupted, with the question to ask again
  holder.dataset.pending = "1";
  holder.dataset.q = text;
  const chat = currentChatId();
  const slot = engineSlot();
  status(holder, "Thinking", typicalMs("chat"));
  const browsing = priv ? null : watchBrowsing(chat, () => showArtifact(screenArtifact()));
  const askedAt = Date.now();
  const thread = conversation(priv);
  const continuing = text === CONTINUE;
  const asked = continuing ? [...thread].reverse().find((m) => m.role === "user" && m.content !== CONTINUE)?.content ?? text : text;
  // the document the cut answer went into, if that answer is the one just before
  const docKey = `${chat ?? ""}\n${slugOf(asked)}.md`;
  const prior = continuing ? answerDocs.get(docKey) : undefined;
  const grows = !!prior && thread[thread.length - 1]?.role === "assistant" && thread[thread.length - 1].content === prior.last;
  // the engine this chat talks to: fixed on its first turn, before its first save
  const engine = priv ? undefined : slot.claim(await loadEngines().then(pickedEngine));
  thread.push({ role: "user", content: text });
  saveChat();
  let savedAt = Date.now();
  // the last words on screen: if the model dies mid-answer, they stay up with Ask again
  let kept = "";
  try {
    type Reply = { choices?: { message?: { content?: string; reasoning_content?: string } }[]; error?: string; browsed?: boolean; cut?: boolean; stopped?: boolean; broke?: boolean; engine?: string };
    // tz: routines the agent makes run at this device's local time
    const body = JSON.stringify({ messages: recent(thread), context: context(), private: priv, docs: await attachedDocs(priv), stream: true, tz: deviceZone(), ...(chat ? { chat } : {}), ...(engine ? { engine } : {}), ...(EVAL ? { eval: true } : {}) });
    const bub = holder.querySelector<HTMLElement>(".bub")!;
    let streamed = false, waitNote = 0;
    const d = await patient(() => streamReply<Reply>(body, (t) => {
      const shown = t && takeoverAsk(t).answer;
      if (!shown) {
        if (streamed) { streamed = false; bub.innerHTML = ""; status(holder, "Thinking", typicalMs("chat")); }
        return;
      }
      streamed = true;
      kept = shown;
      bub.innerHTML = withCursor(bubbleText(shown));
      if (Date.now() - savedAt > PARTIAL_SAVE_MS) { savedAt = Date.now(); saveChat(); }
      const th = $("#thread"); if (th) th.scrollTop = th.scrollHeight;
    }, (gone) => {
      status(holder, gone ? away() : "The connection dropped. Reconnecting, and the reply keeps going meanwhile.");
      stopClock(holder);
    }, (note) => {
      clearTimeout(waitNote);
      waitNote = window.setTimeout(() => { if (!streamed && holder.querySelector(".bub .wait")) status(holder, note); }, WAIT_NOTE_MS);
    }).finally(() => clearTimeout(waitNote)), (n, secs, of, e) => {
      if (unreachable(e)) { status(holder, away()); stopClock(holder); }
      else status(holder, `The model is busy or loading on this machine. Trying again in ${secs}s (${n} of ${of}).`);
    });

    browsing?.stop(d.browsed);
    const m = d.choices?.[0]?.message;
    // the agent asks for the person (a password, a code, a CAPTCHA) with a marker it ends the reply on
    const told = takeoverAsk([m?.content, m?.reasoning_content].filter(Boolean).join("\n\n").trim());
    const ask = told.ask;
    // an answer cut mid-bold showed a stray "**" (QA 2026-11-12)
    const answer = d.cut || d.stopped ? closeBold(told.answer) : told.answer;
    const offer = () => {
      if (ask && !priv) offerTakeover(holder, ask);
      // the model hit its length limit: say so rather than stop mid-sentence
      if (d.cut) holder.querySelector(".bub")!.insertAdjacentHTML("beforeend", `<div class="feednote" data-cut>Answer cut short. <button type="button" class="btn small" data-continue>Continue?</button></div>`);
      // the engine went quiet mid-answer, or ran past the cap: what it wrote stays
      else if (d.stopped) holder.querySelector(".bub")!.insertAdjacentHTML("beforeend", `<div class="feednote" data-cut>${d.broke ? "This answer stopped before it finished." : "That answer was taking too long, so I stopped it."} <button type="button" class="btn small" data-continue>Continue?</button></div>`);
    };
    if (answer) noteMs("chat", Date.now() - askedAt);

    if (!answer) throw new Error(d.error ?? "the model returned an empty message");
    thread.push({ role: "assistant", content: answer });
    if (!priv) labelReply(holder, engine ?? d.engine);
    // the agent says a routine it made waits in Routines: its card follows, to answer here
    if (!priv && /\bRoutines\b/.test(answer)) showWaitingRoutines({ push: (_w, html) => push("ai", html), block: pushBlock }, bindChat(chatThread))
      .catch((e: Error) => console.warn("[nexy] waiting routines not shown", e));

    const lifted = grows ? null : fromReply(answer, asked);
    if (lifted) {
      showArtifact(lifted.artifact);
      // everything but the table stays in the chat: the pane holds only the table, and showing the
      // first paragraph alone lost the price and the paragraph after it (2026-10-28)
      const prose = lifted.prose.split("\n").filter((l) => !l.trim().startsWith("|")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
      holder.querySelector(".bub")!.innerHTML =
        (prose ? `${bubbleText(prose.length > 2000 ? `${prose.slice(0, 2000)}…` : prose)}<br>` : "") + `<span class="faint">${esc(lifted.note).replace(/\bon the right\b/g, ON_RIGHT)}</span>`;
      offer();
      return;
    }
    if (grows || structured(answer)) {
      // a continuation with no document of its own to grow gets its own, named for the question
      const title = continuing && !grows ? `${slugOf(asked, 18)}-continued.md` : `${slugOf(asked)}.md`;
      const md = grows ? `${prior!.md.trimEnd()}\n\n${answer.trimStart()}` : answer;
      answerDocs.set(`${chat ?? ""}\n${title}`, { md, last: answer });
      showArtifact(markdownArtifact({ title, meta: "Nexy · on device", md }));
      holder.querySelector(".bub")!.innerHTML = `${bubbleText(firstPart(answer))}<br><span class="faint">The full answer is ${ON_RIGHT}.</span>`;
      offer();
      return;
    }
    if (streamed) bub.innerHTML = bubbleText(answer);
    else await typeOut(bub, answer);
    offer();
  } catch (e) {
    thread.pop();
    console.warn("[nexy] the answer failed", e);
    // Ollama killed mid-answer lost the words already shown and ended on a raw error (QA 2026-11-12)
    holder.querySelector(".bub")!.innerHTML = unreachable(e) ? esc(away())
      : `${kept ? bubbleText(closeBold(kept)) : ""}<div class="feednote bad" data-interrupted="1">${kept ? "This answer stopped before it finished." : "The model on this machine did not answer."} <span class="faint">(${esc((e as Error).message)})</span> <button type="button" class="btn small" data-ask-again="${esc(text)}">Ask again</button></div>`;
  } finally {
    browsing?.stop();
    delete holder.dataset.pending;
    delete holder.dataset.q;
  }
}


const queue: { text: string; el: HTMLElement; skel?: HTMLElement; send: () => Promise<void> }[] = [];

// How long work takes on this machine, from what it actually took here.
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const measured = (kind: "image" | "chat", fallback: number) => {
  try { return median(JSON.parse(localStorage.getItem(`nexy.eta.${kind}`) ?? "[]")) || fallback; } catch { return fallback; }
};
function typicalMs(kind: "site" | "diagram" | "image" | "chat"): number {
  if (kind === "chat") return measured("chat", 30_000);
  if (kind === "image") return measured("image", 90_000);
  const diagram = (p: string) => /flowchart|diagram/i.test(p);
  const secs = median(S.builds.filter((b) => b.status === "built" && b.secs > 30 && diagram(b.prompt) === (kind === "diagram")).slice(0, 20).map((b) => b.secs));
  return secs ? secs * 1000 : kind === "diagram" ? 240_000 : 540_000;
}
function noteMs(kind: "image" | "chat", ms: number): void {
  try { const k = `nexy.eta.${kind}`, xs = JSON.parse(localStorage.getItem(k) ?? "[]"); xs.unshift(ms); localStorage.setItem(k, JSON.stringify(xs.slice(0, 10))); } catch { /* storage off: the default stands */ }
}
const kindOf = (text: string): "site" | "diagram" | "image" | "chat" => {
  const k = classify(text);
  return k.kind === "make" ? (k.deliverable === "diagram" ? "diagram" : "site") : k.kind === "build" ? "site" : k.kind === "generate" ? "image" : "chat";
};
const minutes = (ms: number) => (ms < 60_000 ? "under a minute" : `about ${Math.round(ms / 60_000)} min`);

function renumber(): void {
  // what is running now, plus everything ahead in line
  let wait = Math.max(0, S.eta.start + S.eta.ms - Date.now());
  queue.forEach((q, i) => {
    const n = q.el.querySelector(".qd b");
    if (n) n.textContent = `${i === 0 ? "next" : `#${i + 1} in line`} · starts in ${minutes(wait)}`;
    wait += typicalMs(kindOf(q.text));
  });
}
setInterval(() => { if (queue.length) renumber(); }, 15_000);

// prompts sent while the model was busy go next, whatever held it
function drain(): void {
  const next = queue.shift();
  if (next) { next.skel?.remove(); renumber(); setTimeout(() => void next.send(), 0); }
}

function enqueue(text: string): void {
  const el = push("me", esc(text));
  el.querySelector(".bub")?.insertAdjacentHTML("beforeend", `<div class="feednote qd">Queued, <b></b> · <button class="qx" type="button">Cancel</button></div>`);
  // where its answer will appear, so the wait has a shape
  const skel = push("ai", `<div class="skel" aria-label="Waiting its turn"><i></i><i></i><i></i></div>`);
  const q = { text, el, skel, send: bindChat(() => send(text, el)) };
  queue.push(q);
  el.querySelector(".qx")?.addEventListener("click", () => {
    const i = queue.indexOf(q);
    if (i < 0) return;
    queue.splice(i, 1);
    skel.remove();
    el.querySelector(".qd")!.textContent = "Cancelled";
    renumber();
  });
  renumber();
}
const FRUSTRATED = /\b(does ?n[o']?t work|did ?n[o']?t work|not working|not what i (asked|wanted|meant)|that'?s wrong|still (broken|wrong|not)|is broken|useless|try again|wtf|ugh+)\b/i;

function rephrased(prev: string, next: string, at?: number): boolean {
  if (!at || Date.now() - at > 5 * 60_000) return false;
  const w = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const a = w(prev), b = w(next);
  if (a.size < 2 || b.size < 2 || prev.trim().toLowerCase() === next.trim().toLowerCase()) return false;
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / (a.size + b.size - inter) >= 0.5;
}

function feedback(signal: "up" | "down" | "frustration" | "runError" | "rephrase", extra: { prompt: string; reply?: string; note?: string; error?: string; artifact?: string }): void {
  if (isPrivate() || EVAL || !extra.prompt) return;
  fetch("/api/v1/feedback", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ signal, ...extra }) })
    .then((r) => { if (!r.ok) console.warn("[nexy] feedback not saved", r.status); })
    .catch((e) => console.warn("[nexy] feedback not saved", e));
}

// Good / not right sit in the reply's action row, drawn like copy and retry.
// a reply that is a failure: asking people to rate an error reads as a joke
const FAILURE = /could not|did not answer|stopped before it finished|did not complete|stopped:|is not answering|isn't answering|went wrong|local fault/i;
function rateBar(msg: HTMLElement, prompt: string): void {
  const acts = msg.querySelector<HTMLElement>(".macts");
  if (isPrivate() || EVAL || !acts || acts.querySelector("[data-r]")) return;
  if (msg.querySelector(".feednote.bad") || FAILURE.test(msg.querySelector(".bub")?.textContent ?? "")) return;
  acts.insertAdjacentHTML("beforeend",
    `<button type="button" data-r="up" title="Good">${ICON_UP}</button><button type="button" data-r="down" title="Not right">${ICON_DOWN}</button>`);
  const reply = () => (msg.querySelector(".bub")?.textContent ?? "").slice(0, 2000);
  const note = (html: string): HTMLElement => {
    let n = msg.querySelector<HTMLElement>(".rate");
    if (!n) {
      n = document.createElement("div");
      n.className = "rate";
      n.style.cssText = "display:flex;gap:4px;align-items:center;margin:4px 0 0 4px;font-size:12px;opacity:.7";
      msg.appendChild(n);
    }
    n.innerHTML = html;
    return n;
  };
  acts.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-r]");
    if (!b || b.disabled) return;
    acts.querySelectorAll<HTMLButtonElement>("[data-r]").forEach((x) => { x.disabled = true; x.style.opacity = x === b ? "1" : ".35"; });
    b.style.color = "#fff";
    if (b.dataset.r === "up") { feedback("up", { prompt, reply: reply() }); note(`<span class="faint">Thanks. Noted on this machine only.</span>`); }
    if (b.dataset.r === "down") {
      const bar = note(`<input class="rate-note" placeholder="What was wrong? (optional)" style="flex:1;min-width:180px;font:inherit;padding:4px 8px;border-radius:8px;border:1px solid var(--line,#333);background:transparent;color:inherit">` +
        `<button class="btn small" data-send>Send</button>`);
      const inp = bar.querySelector<HTMLInputElement>(".rate-note")!;
      const go = () => { feedback("down", { prompt, reply: reply(), note: inp.value.trim() || undefined }); note(`<span class="faint">Thanks. Kept on this machine to improve answers; it never leaves it.</span>`); };
      bar.querySelector<HTMLButtonElement>("[data-send]")!.onclick = go;
      inp.onkeydown = (k) => { if (k.key === "Enter") go(); };
      inp.focus();
    }
  };
}

const seenFaults = new Set<string>();
addEventListener("message", (e: MessageEvent) => {
  const err = e.data?.nexyRunError;
  if (!err) return;
  const key = `${lastBuild()?.brief ?? ""}|${err}`;
  if (seenFaults.has(key)) return;
  seenFaults.add(key);
  feedback("runError", { prompt: lastBuild()?.brief ?? turnState().lastTurn.prompt, error: String(err).slice(0, 300), artifact: "app" });
});

async function playFeedbackLog(what: "show" | "clear"): Promise<void> {
  const { push, showArtifact } = captureWork();
  try {
    if (what === "clear") {
      const r = await fetch("/api/v1/feedback", { method: "DELETE", headers: { "content-type": "application/json" } });
      if (!r.ok) throw new Error(httpMsg(r.status));
      push("ai", "Cleared. Your feedback log on this machine is empty.");
      return;
    }
    const r = await fetch("/api/v1/feedback");
    const d = (await r.json()) as { entries?: { at: number; signal: string; prompt: string; note?: string; error?: string }[]; error?: string };
    if (!r.ok) throw new Error(d.error ?? httpMsg(r.status));
    const rows = d.entries ?? [];
    const icon: Record<string, string> = { up: "👍", down: "👎", frustration: "😤", runError: "⚠️" };
    push("ai", rows.length
      ? `${rows.length} item${rows.length === 1 ? "" : "s"}, ${ON_RIGHT}. They are stored only on this machine; say <b>clear my feedback</b> to delete them.`
      : "No feedback recorded yet. Ratings you give with 👍/👎 are kept here, on this machine only.");
    if (!rows.length) return;
    showArtifact({
      id: `feedback:${Date.now()}`, kind: "doc", title: "feedback-log", meta: "on this machine only",
      render: (h) => {
        h.innerHTML = `<div class="pad">` + rows.map((e) =>
          `<div style="padding:8px 0;border-bottom:1px solid var(--line,#2a2a2a)"><b>${icon[e.signal] ?? esc(e.signal)}</b> ` +
          `<span class="faint">${esc(new Date(e.at).toLocaleString())}</span><div>${esc(e.prompt.slice(0, 160))}</div>` +
          (e.note ? `<div class="faint">“${esc(e.note)}”</div>` : "") + (e.error ? `<div class="faint"><code>${esc(e.error)}</code></div>` : "") +
          `</div>`).join("") + `</div>`;
      },
    });
  } catch (e) {
    push("ai", `Could not ${what} the feedback log: <code>${esc(errText(e))}</code>`);
  }
}

// Answered without the model, so they run even while a plan or build holds it: a visitor
// who changes topic mid-plan gets Paint or a view at once instead of a place in line.
const INSTANT = new Set(["view", "canvasView", "paint", "help", "connections"]);
function instant(intent: ReturnType<typeof classify>): void {
  if (intent.kind === "view") {
    showTab(intent.tab);
    push("ai", esc(intent.say));
  } else if (intent.kind === "canvasView") {
    const p = P();
    if (p) { showArtifact(planArtifact(p, intent.view)); push("ai", esc(intent.say)); }
    else push("ai", "There is no project open to show that for.");
  } else if (intent.kind === "paint") {
    push("ai", "Building you a paint workspace: brush, shapes, fill, eraser, colours, undo, and Save straight into Files.");
    showArtifact(paintArtifact({ title: "Drawing app" }));
    push("ai", `Ready ${ON_RIGHT}. Draw something and press Save; it lands in Files through Own Image Studio.`);
  } else if (intent.kind === "help") {
    push("ai", "Ask for a site, app, game, diagram, image or beat and I make it on this machine in a few minutes. For something bigger, say “start a project” and I plan it and run a team of agents through it. Your chats, projects and files stay here.");
  } else if (intent.kind === "connections") {
    push("ai", "Here is everything I can reach right now, grouped by what it is and whether it can carry anything off this machine.");
    showArtifact(connectionsArtifact((name) => void send(`Connect ${name}`)));
  }
}

// Shared by send()'s direct generate/make paths and autopilotRun() (which calls
// playMake() on its own after a project's tasks finish, bypassing send() entirely).
// Confirms the work actually succeeded — a failed build's bubble does not say
// "Done" — before treating it as a chat turn worth remembering.
const lastAiSaidDone = () => {
  const last = [...document.querySelectorAll<HTMLElement>("#thread .m.ai")].pop()?.innerText ?? "";
  return /^\s*Done\b|\bDone\b[.—-]/.test(last);
};

const revisesOpenPage = (text: string, kind: Parameters<typeof asksToChangePage>[1]) =>
  asksToChangePage(text, kind) && isOpen() && !!editablePage();

async function playRevise(text: string, priv: boolean, part?: Picked | null): Promise<void> {
  const { push, conversation } = captureWork();
  const page = editablePage();
  if (!page) return;
  const holder = push("ai", "");
  status(holder, part ? `Changing ${part.label.split(":")[0]} in “${plainName(page.title)}”` : `Changing “${plainName(page.title)}” on this machine`, typicalMs("chat"));
  // a part picked on the page: name it and quote it, so the edit lands there and nowhere else
  const instruction = part
    ? `Change only this part of the page and leave everything else as it is. The part (${part.label}, at ${part.path}) is currently:\n${part.html}\n\nThe change: ${text}`
    : text;
  const bub = holder.querySelector(".bub")!;
  try {
    type Revised = { html?: string; say?: string; missed?: number; error?: string };
    const d = await patient(() => api<Revised>("/api/v1/revise", { method: "POST", body: JSON.stringify({ html: page.source, instruction, kind: page.kind }) }),
      (n, secs, of) => status(holder, `The model is busy or loading on this machine. Trying again in ${secs}s (${n} of ${of}).`));
    if (!d.html || !applyRevision(page.id, d.html, "that change")) throw new Error("the page changed or closed while I was working, so I left it as it is");
    const say = (d.say || "Changed it.").replace(/\.?$/, ".");
    bub.innerHTML = `Done — ${esc(say)} It is ${ON_RIGHT}; say “undo” to put it back.` +
      (d.missed ? `<div class="feednote" style="margin-top:6px">${d.missed} part${d.missed === 1 ? "" : "s"} of the change did not match the page and ${d.missed === 1 ? "was" : "were"} skipped.</div>` : "");
    conversation(priv).push({ role: "user", content: text }, { role: "assistant", content: `I changed the page in the work pane: ${say}` });
  } catch (e) {
    bub.innerHTML = `I could not change the page: <code>${esc(errText(e))}</code> Nothing on it was changed.`;
  }
}

// The open page as Nexy should know it: a short map first (outline, sections, buttons,
// colours, images, products with prices), then its words. Questions about the page are
// answered from what is there, not from memory of the request (2026-10-25: "what colour is
// the header?" had only the flattened text to go on).
function openPage(): { title: string; text: string } | undefined {
  const p = isOpen() ? editablePage() : null;
  if (!p) return undefined;
  const doc = new DOMParser().parseFromString(renderedFor(p.id) || p.source, "text/html");
  const clean = (t: string | null | undefined, n = 80) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const uniq = (xs: string[], n: number) => [...new Set(xs.filter(Boolean))].slice(0, n);
  const lines: string[] = [];
  const outline = [...doc.querySelectorAll("h1,h2,h3")].map((h) => `${"  ".repeat(Number(h.tagName[1]) - 1)}${h.tagName.toLowerCase()}: ${clean(h.textContent)}`).slice(0, 30);
  if (outline.length) lines.push("Outline:", ...outline);
  const sections = [...doc.querySelectorAll("header,nav,main,section,article,aside,footer")].map((el) => {
    const name = el.id ? `#${el.id}` : el.classList[0] ? `.${el.classList[0]}` : "";
    return `${el.tagName.toLowerCase()}${name}${el.querySelector("h1,h2,h3") ? `: ${clean(el.querySelector("h1,h2,h3")!.textContent, 50)}` : ""}`;
  });
  if (sections.length) lines.push(`Sections (top to bottom): ${uniq(sections, 20).join(" | ")}`);
  const actions = uniq([...doc.querySelectorAll("button,a[href],input[type=submit]")].map((b) => clean(b.textContent || (b as HTMLInputElement).value, 40)), 25);
  if (actions.length) lines.push(`Buttons and links: ${actions.join(" | ")}`);
  // colours: named CSS variables first, then the most used literal colours
  const css = [...doc.querySelectorAll("style")].map((x) => x.textContent ?? "").join("\n") + [...doc.querySelectorAll("[style]")].map((x) => x.getAttribute("style")).join(";");
  const vars = uniq([...css.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/gi)].map((m) => `${m[1]} ${m[2]}`), 12);
  const counts = new Map<string, number>();
  for (const m of css.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)/gi)) counts.set(m[0].toLowerCase(), (counts.get(m[0].toLowerCase()) ?? 0) + 1);
  const top = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([c]) => c);
  if (vars.length || top.length) lines.push(`Colours: ${[...vars, ...top.filter((c) => !vars.some((v) => v.endsWith(c)))].join(", ")}`);
  const imgs = [...doc.querySelectorAll("img")];
  if (imgs.length) lines.push(`Images (${imgs.length}): ${uniq(imgs.map((i) => clean(i.getAttribute("alt"), 40)), 12).join(" | ") || "no alt text"}`);
  // products: anything showing a price, named by the nearest heading in its card
  const PRICE = /(?:[$€£¥₱₹]|\b(?:PHP|USD|EUR|GBP)\s?)\s?\d[\d,.]*/;
  const items = [...doc.body?.querySelectorAll("*") ?? []].filter((el) => el.children.length === 0 && PRICE.test(el.textContent ?? "")).map((el) => {
    let card: Element | null = el;
    for (let i = 0; i < 5 && card && !card.querySelector("h1,h2,h3,h4,h5,strong,b"); i++) card = card.parentElement;
    const name = clean(card?.querySelector("h1,h2,h3,h4,h5,strong,b")?.textContent, 40);
    return `${name || "item"} ${clean(PRICE.exec(el.textContent ?? "")?.[0], 16)}`;
  });
  if (items.length) lines.push(`Products and prices (${items.length}): ${uniq(items, 20).join(" | ")}`);
  for (const s of doc.querySelectorAll("script,style,noscript")) s.remove();
  const words = clean(doc.body?.textContent, 6000);
  const map = lines.join("\n");
  const text = `${map}${map ? "\n\nPage text: " : ""}${words}`.slice(0, 6000);
  return text.trim() ? { title: plainName(p.title), text } : undefined;
}

// typing in an example starts the visitor's own chat; a routine the example set carries over
function leaveExample(): void {
  noteExampleRoutine($("#thread .msg.me .bub")?.textContent ?? "");
  newChat();
}

async function send(text: string, shown?: HTMLElement): Promise<void> {
  text = text.trim();
  // two jobs in one message: the first starts, the second queues behind it
  const parts = shown ? null : splitTasks(text);
  if (parts) { const first = send(parts[0]); void send(parts[1]); return first; }
  if (!text || chatDeleted()) return;
  const ready = chatReady();
  if (ready) {
    const resume = bindChat(() => send(text, shown));
    try { await ready; await resume(); }
    catch (e) { toast(`This chat could not be opened: ${errText(e)}`); }
    return;
  }
  if (viewingExample()) leaveExample();
  const localTurn = turnState();
  const { push, pushBlock, showArtifact, P, saveChat, nameChat, noteUserMessage, onReply, typingOff,
    attachSample, playMemory, playSocial, playConnect, instant, autopilot, addRole, playMake,
    playChart, playWorkLog, playBoardEdit, playGenerate, playBuild, playChat, playFeedbackLog, visible, noteBuild } = captureWork();
  const lastOfChat = bindChat(lastBuild);
  let built = false;
  if (S.busy) {
    const inp = $<HTMLTextAreaElement>("#input");
    if (S.running && classify(text).kind === "pausePlan") {
      if (inp) { inp.value = ""; inp.style.height = "auto"; }
      push("me", esc(text));
      pausePlan();
      return;
    }
    if (inp) { inp.value = ""; inp.style.height = "auto"; }
    const quick = classify(text);
    if (INSTANT.has(quick.kind)) { noteUserMessage(text); push("me", esc(text)); instant(quick); saveChat(); return; }
    // A build runs on the server and is only polled here, so a question need not wait the
    // 9-12 minutes it takes. Images still queue: image and build text at once is what ran
    // the GPU out of memory (2026-10-17).
    if (S.job === "build" && quick.kind === "chat") {
      noteUserMessage(text); push("me", esc(text)); saveChat();
      void playChat(text, isPrivate()).finally(() => saveChat());
      return;
    }
    noteUserMessage(text);
    enqueue(text);
    saveChat();
    return;
  }
  S.busy = true;
  const inp = $<HTMLTextAreaElement>("#input");
  if (inp) { inp.value = ""; inp.style.height = "auto"; }
  // typing while reading an example starts the visitor's own chat
  if (viewingExample()) leaveExample();
  if (localTurn.lastTurn.prompt && FRUSTRATED.test(text))
    feedback("frustration", { prompt: localTurn.lastTurn.prompt, reply: (localTurn.lastTurn.el?.querySelector(".bub")?.textContent ?? "").slice(0, 2000), note: text });
  else if (localTurn.lastTurn.prompt && rephrased(localTurn.lastTurn.prompt, text, localTurn.lastTurn.at))
    feedback("rephrase", { prompt: localTurn.lastTurn.prompt, reply: (localTurn.lastTurn.el?.querySelector(".bub")?.textContent ?? "").slice(0, 2000), note: text });
  shown?.querySelector(".qd")?.remove();
  const mine = shown ?? push("me", esc(text));
  // this chat's turns: a follow-up about mail it read stays a mail read
  const { nowPrivate } = guard(text, conversation(false) ?? []);
  // An image, beat or build leaves no chat turn, so "what is her name?" next had nothing to
  // refer to. When the work succeeded and its chat is still the one on screen, the model
  // hears what was asked and what was made.
  const madeIt = (note: string) => {
    if (!visible() || !lastAiSaidDone()) return;
    conversation(nowPrivate).push({ role: "user", content: text }, { role: "assistant", content: note });
  };
  // the message that tripped the switch was posted before it: it is private too
  if (nowPrivate) mine.dataset.private = "1";
  // saved before any answer: a quit or crash mid-reply must not lose the question
  else { noteUserMessage(text); did("ask"); saveChat(); }
  typingOn();
  try {
    // a job given while the model downloads waits for it, and says so
    if (!modelState().ready) {
      push("ai", `Got it. I’ll start the moment ${esc(modelState().model ?? "the model")} finishes downloading.`);
      await modelReady();
    }
    if (nowPrivate && /connect|telegram|instagram|linkedin|slack|gmail|drive|owncloud|cloud|render on|publish|share/i.test(text) && !/local/i.test(text)) {
      push("ai", "This is an encrypted, device-only chat, so I will not connect an outside app, use the cloud, or publish from here. I can do all of it locally, or you can start a regular chat for that.");
      return;
    }
    const fb = /^(?:please\s+)?(show|view|open|clear|delete|wipe|forget)\s+(?:all\s+)?(?:my|the)\s+feedback\b/i.exec(text);
    if (fb) { await playFeedbackLog(/show|view|open/i.test(fb[1]) ? "show" : "clear"); return; }
    // the message after "Send back" is the owner's note; the task reruns with it
    if (S.redo && !nowPrivate) {
      const r = S.redo;
      S.redo = null;
      if (inp) inp.placeholder = "Talk to Nexy";
      await reviewTask(r.pid, r.taskId, "redo", text);
      push("ai", `Sent back. <b>${esc(r.title)}</b> is being redone with your note.`);
      const p = S.projects.find((x) => x.id === r.pid);
      if (p) setTimeout(() => void autopilot(p), 0);
      return;
    }
    if (/\b(use|try|with|load|attach)\s+(?:it\s+(?:on|with)\s+)?(?:the\s+|some\s+)?(sample|example|demo|dummy|fake|test)\s+(data|files?|numbers|figures|sheets?|records)\b/i.test(text)) { await attachSample(text); return; }
    const mem = matchMemory(text);
    if (mem) { await playMemory(mem, { push, block: (el) => void pushBlock(el), isPrivate }); return; }
    const soc = matchSocial(text);
    if (soc) { await playSocial(soc, { push, showArtifact, project: P()?.name, block: (t, r, rows) => void pushBlock(summaryBlock(t, r, rows)) }); return; }

    const conn = connectIntent(text);
    const intent = retryOf(text, lastOfChat()) ?? classify(text);
    // what this computer's model can't do is held back before it runs (src/client/capability.ts)
    if (caps && !conn) {
      const revises = !!(pickedFor(editablePage()?.id) && isOpen()) || revisesOpenPage(text, intent.kind);
      const task = taskOf(intent, text, revises);
      const v = verdictFor(caps, task);
      if (v === "block") { pushBlock(gateCard(task, caps)); return; }
      if (v === "warn" && warnsFor(task)) push("ai", esc(WARN_NOTE));
    }
    if (intent.kind === "rebuild") {
      built = true;
      S.job = "build"; S.eta = { start: Date.now(), ms: typicalMs(intent.deliverable === "diagram" ? "diagram" : "site") };
      await playMake(intent.brief, intent.deliverable, undefined, { error: intent.error });
      madeIt(`I built ${intent.deliverable === "diagram" ? "a diagram" : "it"} again: ${titleFor(intent.brief)}. It is open in the work pane.`);
    } else if (conn) {
      await playConnect(conn, { block: pushBlock, say: (h) => void push("ai", h) });
    } else if (connectorAsk(text, conversation(nowPrivate) ?? [])) {
      // the owner's own mail or files: read through the connected app, never a chart search or a build
      await playChat(text, nowPrivate);
    } else if (pickedFor(editablePage()?.id) && isOpen()) {
      // the person picked a part of the page: this message is about that part
      const part = pickedFor(editablePage()?.id);
      clearPick();
      await playRevise(text, nowPrivate, part);
    } else if (revisesOpenPage(text, intent.kind)) {
      await playRevise(text, nowPrivate);
    } else if (INSTANT.has(intent.kind)) {
      instant(intent);
    } else if (intent.kind === "startPlan" || intent.kind === "resumePlan") {
      const p = P();
      if (!p) push("ai", "There is no project open to start. Tell me what you want built, or open a project first.");
      else if (!p.tasks.some((t) => t.s !== "done")) push("ai", "Every task on this plan is already done.");
      else if (S.running) push("ai", `Already running <b>${esc(S.running)}</b>. One model is resident on this machine, so tasks go one at a time.`);
      else setTimeout(() => void autopilot(p), 0);
    } else if (intent.kind === "pausePlan") {
      pausePlan();
    } else if (intent.kind === "addRole") {
      await addRole(intent.role);
    } else if (intent.kind === "customRebuild") {
      const lb = lastBuild();
      built = !!lb;
      if (lb) await playMake(lb.brief, lb.deliverable, "phaser");
      else push("ai", "There is nothing built in this chat yet to redo. Tell me what to make.");
    } else if (intent.kind === "chart") {
      await playChart(text, nowPrivate);
    } else if (intent.kind === "workLog") {
      playWorkLog(intent.days);
    } else if (intent.kind === "addTask" || intent.kind === "completeTask" || intent.kind === "assignTask") {
      await playBoardEdit(intent as { kind: string; title: string; role?: string; state?: string });
    } else if (intent.kind === "status") {
      const p = P();
      if (!p) { push("ai", "There is no project open yet. Ask me to build something and I will put a plan together."); }
      else {
        const doing = new Set(p.tasks.filter((t) => t.s === "doing" && !t.human).map((t) => t.who)).size;
        const mine = p.tasks.filter((t) => t.human && t.s !== "done");
        push("ai", `Here is where ${esc(p.name)} stands.`);
        pushBlock(summaryBlock(p.name, "this project", [
          { k: "Progress", v: `${p.progress}%` },
          { k: "Tasks done", v: `${p.tasks.filter((t) => t.s === "done").length} of ${p.tasks.length}` },
          { k: "Agents working", v: String(doing), off: !doing },
          { k: "Files in the project", v: String(outputsForChat().length) },
          { k: "Left the device", v: "only web searches you asked for" },
          { k: "Needs you", v: mine.length ? mine[0].t : "nothing", off: !mine.length },
        ]));
      }
    } else if (intent.kind === "edit") {
      const r = handleEdit(text);
      push("ai", esc(r ? r.say : "That edit did not reach the page."));
    } else if (intent.kind === "generate" && !hasApp(intent.medium === "image" ? "images" : "beat")) {
      push("ai", esc(intent.medium === "image" ? imagesOff() : notHereYet("Making music")));
    } else if (intent.kind === "make" && !(intent.deliverable === "diagram" ? hasStudio("build") : hasApp("build"))) {
      push("ai", esc(notHereYet(intent.deliverable === "diagram" ? "Drawing diagrams" : "Building websites and apps")));
    } else if (intent.kind === "build" && !hasApp("startup")) {
      push("ai", esc(notHereYet("Running projects with a team of agents")));
    } else if (intent.kind === "generate") {
      S.eta = { start: Date.now(), ms: typicalMs("image") };
      await playGenerate(intent.medium, intent.prompt);
      madeIt(`I made ${intent.medium === "image" ? "an image" : "a beat"} of: ${intent.prompt}. It is open in the work pane.`);
    } else if (intent.kind === "unavailable") {
      push("ai", esc(intent.say));
    } else if (intent.kind === "make") {
      built = true;
      S.job = "build"; S.eta = { start: Date.now(), ms: typicalMs(intent.deliverable === "diagram" ? "diagram" : "site") };
      // a site goes across the owner's devices when this Own 1 can; otherwise the normal builder
      if (intent.deliverable === "diagram" || !(await playSwarm(intent.brief, (el) => pushBlock(el))))
        await playMake(intent.brief, intent.deliverable);
      else noteBuild({ brief: intent.brief, deliverable: intent.deliverable, outcome: "done" });
      madeIt(`I built ${intent.deliverable === "diagram" ? "a diagram" : "it"}: ${titleFor(intent.brief)}. It is open in the work pane.`);
    } else if (intent.kind === "build") {
      S.job = "build"; S.eta = { start: Date.now(), ms: typicalMs("site") };
      await playBuild(text);
    } else {
      S.eta = { start: Date.now(), ms: typicalMs("chat") };
      await playChat(text, nowPrivate);
    }
  } finally {
    typingOff();
    S.busy = false;
    S.job = "";
    if (visible() && !nowPrivate && hasApp("startup")) suggestProject(text, classify(text).kind);
    let el: Element | null = mine.nextElementSibling, last: HTMLElement | null = null;
    for (; el; el = el.nextElementSibling) if (el.classList.contains("ai")) last = el as HTMLElement;
    if (last) rateBar(last, text);
    localTurn.lastTurn = { prompt: text, el: last, at: Date.now() };
    // a turn after a build: a bare "try again" no longer means that build
    const lb = lastOfChat();
    if (!built && lb && !lb.next) noteBuild({ ...lb, next: true });
    if (last && visible()) { if (!nowPrivate) void onReply(last.querySelector(".bub")?.textContent ?? ""); }
    // finished in a chat the person has left: say so where they are now
    else if (last) toast(`Done in another chat: “${text.length > 40 ? text.slice(0, 40) + "…" : text}”`);
    saveChat();
    if (last) nameChat(last.querySelector(".bub")?.textContent ?? "");
    drain();
  }
}

function showTab(name: string): void {
  $$(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === name));
  $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === name));
}

function wireTabs(): void {
  $$(".tab").forEach((t) =>
    t.addEventListener("click", () => showTab(t.dataset.tab!)),
  );
}

function wireComposer(): void {
  const inp = $<HTMLTextAreaElement>("#input"), btn = $<HTMLButtonElement>("#sendBtn");
  if (!inp) return;
  const size = () => { inp.style.height = "auto"; inp.style.height = `${Math.min(inp.scrollHeight, 160)}px`; };
  inp.addEventListener("input", () => { size(); if (btn) btn.disabled = !inp.value.trim(); });
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(inp.value); }
  });
  btn?.addEventListener("click", () => void send(inp.value));
  // "Continue?" under an answer cut at the length limit or stopped as too slow; "Ask again" under one cut off
  // before it finished (saveChat in shell.ts)
  document.addEventListener("click", (e) => {
    const more = (e.target as Element | null)?.closest<HTMLButtonElement>("#thread [data-continue]");
    if (more) { more.remove(); void send(CONTINUE); return; }
    if ((e.target as Element | null)?.closest("#thread [data-open-work]")) { if (!reopen()) toast("That work is no longer open"); return; }
    const again = (e.target as Element | null)?.closest<HTMLButtonElement>("#thread [data-ask-again]");
    if (!again) return;
    const q = again.dataset.askAgain ?? "";
    again.remove();
    if (q) void send(q);
  });

  const pick = $<HTMLInputElement>("#filePick");
  $("#attachBtn")?.addEventListener("click", () => pick?.click());
  pick?.addEventListener("change", () => {
    const files = Array.from(pick.files ?? []);
    pick.value = "";
    void attachFiles(files);
  });
}

const UNBUILT: Record<string, string> = {
  pmKeys: "N new chat, ⌘K commands, [ sidebar, space talk, Esc close",
  pmOut: "There is no sign-in to sign out of; the demo gate is in front of the whole box.",
};

function wireUnbuilt(): void {
  for (const [id, why] of Object.entries(UNBUILT)) {
    const el = $(`#${id}`);
    if (!el) continue;
    el.title = why;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toast(why);
    });
  }
}

function toast(msg: string): void {
  let t = $("#toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  window.clearTimeout((t as HTMLElement & { _h?: number })._h);
  (t as HTMLElement & { _h?: number })._h = window.setTimeout(() => t!.classList.remove("show"), 3200);
}

function wireNewProject(): void {
  const ov = $("#ovProj");
  if (!ov) return;
  $("#newProject")?.addEventListener("click", () => { ov.classList.add("open"); setTimeout(() => $<HTMLInputElement>("#npName")?.focus(), 0); });
  ov.querySelectorAll<HTMLElement>(".field").forEach((f) => {
    const opts = f.querySelectorAll<HTMLElement>(".opt");
    opts.forEach((o) => o.addEventListener("click", () => { opts.forEach((x) => x.classList.remove("sel")); o.classList.add("sel"); }));
  });
  $("#npCreate")?.addEventListener("click", () => {
    const name = $<HTMLInputElement>("#npName"), goal = $<HTMLTextAreaElement>("#npGoal");
    const n = name?.value.trim() ?? "", g = goal?.value.trim() ?? "";
    const cloud = ov.querySelector<HTMLElement>("[data-loc].sel")?.dataset.loc?.startsWith("OwnCloud");
    const enc = ov.querySelector<HTMLElement>("[data-priv].sel")?.dataset.priv === "1";
    if (!n && !g) { toast("Give the project a name or a first job"); return; }
    ov.classList.remove("open");
    if (name) name.value = "";
    if (goal) goal.value = "";
    newChat();
    showTab("chat");
    if (cloud) toast(`OwnCloud is not connected, so this project lives on ${here}`);
    if (enc) {
      setPrivate(true);
      toast("Ultra-private: nothing is saved as a project, and nothing leaves this device");
      if (g) void send(g);
      return;
    }
    void send(`Build ${n ? `${n}: ` : ""}${g || n}`);
  });
}

function wireProfile(): void {
  const b = $("#profileBtn"), m = $("#pmenu");
  if (!b || !m) return;
  $("#pmHelp")?.addEventListener("click", () => { m.classList.remove("open"); void send("What can you do?"); });
  const ws = $("#pmWs");
  if (ws) {
    ws.innerHTML = `<button type="button" class="pm-i cur">${esc($("#pmWsName")?.textContent?.trim() || here)}<span class="led"></span></button><button type="button" class="pm-i" id="pmNewWs">New workspace</button>`;
    $("#pmNewWs")?.addEventListener("click", () => { m.classList.remove("open"); toast("One workspace per machine for now; projects already keep their own files and history"); });
  }
  b.addEventListener("click", (e) => { e.stopPropagation(); m.classList.toggle("open"); });
  document.addEventListener("click", () => m.classList.remove("open"));
}

function emptyState(): void {
  const th = $("#thread");
  if (!th) return;
  const cur = th.querySelector("#emptyState");
  const empty = !th.querySelector(".msg");
  const name = P()?.name;
  document.body.classList.toggle("home", empty && !name && !viewingExample());
  if (!empty || viewingExample()) { cur?.remove(); return; }
  // no project open: the home greeting and its suggestions
  if (!name) { if (!cur?.classList.contains("home")) { cur?.remove(); th.appendChild(homeNode()); } return; }
  if (cur?.classList.contains("home")) cur.remove();
  const html = `This is <b>${esc(name)}</b>. Ask me anything, or tell me what to build and I will put a team on it. Everything runs on this machine unless you say otherwise.`;
  if (cur?.isConnected) { const t = cur.querySelector(".t"); if (t && t.innerHTML !== html) t.innerHTML = html; return; }
  const d = document.createElement("div");
  d.className = "m ai";
  d.id = "emptyState";
  d.innerHTML = `<div class="t">${html}</div>`;
  th.appendChild(d);
}

async function boot(): Promise<void> {
  initAurora();
  wireTabs(); wireComposer(); wireProfile(); wireNewProject(); wireUnbuilt(); initCanvas();
  document.querySelectorAll<HTMLElement>("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest(".ov")?.classList.remove("open")));
  setFirstWork(() => {
    return outputsForChat()[0] ?? null;
  });
  initShell({
    send, showTab, toast, renderSide, history, isPrivate,
    showResult: (o) => void showExample(o),
    projects: () => S.projects.map((p) => ({ id: p.id, name: p.name })),
    currentProject: () => S.cur,
    fresh: () => { S.cur = ""; },
    selectProject: (id) => { S.cur = id; },
    openProject,
    needs: () => P()?.tasks.filter((t) => t.human && t.s !== "done").length ?? 0,
    promote: () => void promoteChat(),
    engineChanged: renderEngineChip,
    engineItems,
  });
  initEngineChat(toast);
  initSettings({ send, toast, roster: ROSTER, projects: () => S.projects.map((p) => ({ name: p.name, taskCount: p.taskCount, doneCount: p.doneCount })) });
  initPrivate({ history, say: (t) => { push("ai", esc(t)); }, toast });
  initLanding({ send: (t) => void send(t), settings: openSettings, toast, talk: () => $("#waveBtn")?.click() });
  installReporter({
    endpoint: "/api/v1/problem-report", app: "nexy", version: document.documentElement.dataset.version,
    team: isBeta ? "/api/v1/beta-report" : undefined,
    conversation: () => history.map((t) => ({ role: t.role, text: String(t.content) })),
    blocked: () => (isPrivate() ? "Reports are off in an ultra-private chat, so nothing from it is ever kept." : null),
    // what is open, and the last few turns, so the owner can see what led up to it
    snapshot: () => {
      const a = currentArtifact();
      return {
        chat: currentChatId(), tab: $(".tab.active")?.textContent?.trim() ?? "",
        open: a ? { id: a.id, kind: a.kind, title: a.title, building: !!a.gen } : null,
        turns: history.slice(-6).map((t) => ({ role: t.role, text: String(t.content).slice(0, 500) })),
        busy: S.busy, running: S.running,
      };
    },
  });
  $("#reportBtn")?.addEventListener("click", openReporter);
  $("#betaBtn")?.addEventListener("click", openReporter);
  addEventListener("nexy:report", openReporter);
  $("#cvEdit")?.addEventListener("click", () => {
    const inp = $<HTMLTextAreaElement>("#input");
    if (!inp) return;
    // a start that fits what is open; the box lights up so the change is seen
    const kind = currentArtifact()?.kind;
    inp.value = kind === "html" ? "Change the headline to "
      : kind === "game" ? "Change the game so "
      : kind === "image" ? "Make a new version of this image with "
      : kind === "diagram" ? "Change the diagram so "
      : "Change it so ";
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
    inp.dispatchEvent(new Event("input"));
    inp.closest(".composer, form, .inbar")?.classList.add("nudge");
    setTimeout(() => inp.closest(".composer, form, .inbar")?.classList.remove("nudge"), 1200);
  });
  initPublishing({ isPrivate, save: flushChat, current: () => {
    const a = currentArtifact();
    return a && !a.gen && !a.ephemeral ? { chat: visibleChat(), output: a.id, title: a.title, kind: a.kind } : null;
  } });
  initShare({
    isPrivate, toast,
    current: () => {
      const a = currentArtifact();
      if (!a || a.gen) return null;
      const dl = $<HTMLElement>("#cvDownload");
      return {
        title: a.title, kind: a.kind, project: P()?.name ?? here,
        text: a.source ? () => a.source!.get() : undefined,
        download: dl && dl.style.display !== "none" ? () => dl.click() : undefined,
      };
    },
  });
  window.addEventListener("nexy:toast", (e) => toast(String((e as CustomEvent).detail)));
  $("#panelClose")?.addEventListener("click", () => { document.body.classList.remove("panel-open"); $("#panel")?.classList.remove("open"); });
  window.addEventListener("nexy:panel", (e) => openPanel(String((e as CustomEvent).detail)));
  window.addEventListener("nexy:screen", () => showArtifact(screenArtifact()));
  window.addEventListener("nexy:done", (e) => notify(String((e as CustomEvent).detail)));
  window.addEventListener("nexy:project-changed", (e) => void refreshProject(String((e as CustomEvent).detail)));
  window.addEventListener("nexy:files-changed", () => { renderFiles(); renderApps(); renderHead(); });
  window.addEventListener("nexy:chat-selected", () => { renderAll(); });
  window.addEventListener("nexy:outputs-changed", (e) => {
    if (String((e as CustomEvent).detail) === visibleChat()) { renderFiles(); renderApps(); renderHead(); }
  });
  window.addEventListener("nexy:open-build", (e) => {
    const b = (e as CustomEvent<{ id: string; kind: string; title: string; ts: number }>).detail;
    showArtifact(artifactFor({ kind: b.kind === "game" ? "game" : "html", title: b.title, appLabel: "Own Build", app: "build", ts: b.ts,
      href: `/api/apps/build/api/director/runs/${encodeURIComponent(b.id)}/preview` }));
  });
  window.addEventListener("nexy:make", (e) => {
    if (S.busy) { toast("Nexy is still on the last request; build it again when that finishes."); return; }
    S.busy = true;
    void playMake(String((e as CustomEvent).detail)).finally(() => { S.busy = false; });
  });
  window.addEventListener("nexy:private", () => { if (!isPrivate()) forgetPrivateOutputs(); renderAll(); });
  window.addEventListener("message", (e) => void fromFrame(e));
  window.addEventListener("nexy:send", (e) => void send(String((e as CustomEvent).detail)));
  window.addEventListener("nexy:open-doc", (e) => {
    const d = (e as CustomEvent<{ title: string; who: string; md: string }>).detail;
    showArtifact(markdownArtifact({ title: `${slugOf(d.title)}.md`, meta: `Own Startup · ${d.who} · on device`, md: d.md }));
  });
  window.addEventListener("nexy:review", (e) => {
    const d = (e as CustomEvent<{ pid: string; taskId: string; verdict: string }>).detail;
    onReview(d.pid, d.taskId, d.verdict);
  });

  // the greeting doesn't wait for the studios to answer
  emptyState();
  // The saved chats (and the examples list) were fetched only after projects, then builds, one
  // after the other: ~1.6 s of waiting before the examples showed. All three start together now;
  // what renders, and in what order, is unchanged.
  const chatsReq = fetch("/api/v1/chats");
  chatsReq.catch((e: Error) => console.warn("[nexy] saved chats request failed", e));
  const projectsLoaded = (async () => {
    try {
      await loadProjects();
      if (S.cur) await loadProjectDetail(S.cur);
    } catch (e) {
      S.projectsError = errText(e);
    }
  })();
  await Promise.all([projectsLoaded, loadBuilds()]);
  renderAll();
  emptyState();
  restoreChats(chatsReq)
    .then(() => { if (!$("#chatWrap")?.hidden) did("ask"); })
    .catch((e: Error) => console.warn("[nexy] saved chats unavailable", e));
  welcome();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshChats().catch((e: Error) => console.warn("[nexy] chat list not refreshed", e));
  });
  const th = $("#thread");
  if (th) new MutationObserver(emptyState).observe(th, { childList: true });
  setTimeout(() => $<HTMLTextAreaElement>("#input")?.focus(), 200);

  // ?ask=<text> — the desktop's own input box opens Nexy with this as a fresh
  // thread's first message, rather than the box itself typing into an app.
  // One-shot: strip it from the URL so reloading or sharing the link never
  // resends it.
  const ask = new URLSearchParams(location.search).get("ask");
  if (ask) {
    window.history.replaceState(null, "", location.pathname + location.hash);
    newChat();
    void send(ask);
  }

  try {
    await loadFeed();
    renderHead(); renderFiles(); renderApps(); renderActivity();
  } catch (e) {
    renderFiles(`<div class="feednote bad">The feed did not load: ${esc(errText(e))}</div>`);
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void boot());
else void boot();
