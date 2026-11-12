import { shape, typeLabel, plainName } from "./state";
import type { Project, Task, TaskState, UpstreamProject } from "./state";
import type { Artifact } from "./canvas";
import { classify } from "./intent";
import { httpMsg, errText } from "./http";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

type View = "overview" | "plan" | "tasks" | "board" | "timeline" | "agents" | "risks" | "docs" | "activity";

const VIEWS: [View, string][] = [
  ["overview", "Overview"], ["plan", "Plan"], ["tasks", "Tasks"], ["board", "Board"],
  ["timeline", "Timeline"], ["agents", "Agents"], ["risks", "Risks"], ["docs", "Docs"],
  ["activity", "Activity"],
];

const COLORS = ["#7C5CFF", "#3BD1C4", "#FF8C68", "#FFD166", "#F49AD3", "#9999FF", "#4ADE80"];
const STATES: [TaskState, string][] = [["todo", "To do"], ["doing", "Doing"], ["done", "Done"]];
const NEXT: Record<TaskState, TaskState> = { todo: "doing", doing: "done", done: "todo" };
const ROLES: Record<string, string> = {
  "Market researcher": "Research", "Legal reviewer": "Legal", "Smart contract engineer": "Engineering",
  "Software developer": "Engineering", "Security auditor": "Security", "Data analyst": "Research",
  Designer: "Design", Copywriter: "Marketing", "Executive assistant": "Operations", Nexy: "Project management",
};

const CSS = `
.pmw .kan.k3{grid-template-columns:repeat(3,minmax(0,1fr))}
.canvas.narrow .pmw .kan.k3{grid-template-columns:repeat(2,minmax(0,1fr))}
.pmw .ttable.t5 .th,.pmw .ttable.t5 .trow{grid-template-columns:1fr 150px 110px 110px 80px}
.canvas.narrow .pmw .ttable.t5 .th,.canvas.narrow .pmw .ttable.t5 .trow{grid-template-columns:1fr 110px 70px}
.pmw .kc,.pmw .tk{cursor:pointer}.pmw .kc{cursor:grab}
.pmw .busy{opacity:.5;pointer-events:none}
.pmw .gantt .gw{background:var(--gl)}
.pmw .gantt .gh .gw span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:3px 4px}
.pmw .gbar.phf{opacity:.9;height:16px;top:5px}
.pmw .gms.off i{background:transparent;outline:1px solid #fff}
.pmw a.file{color:inherit;text-decoration:none}
.pmw .pbuild{margin:0 0 12px;padding:10px 14px;border:1px solid var(--line);border-radius:12px}
.pmw .pbuild .faint{margin-left:0;text-align:left;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pmw .pbuild .pbtns{display:flex;gap:6px;margin-left:auto}
`;

function injectCss(): void {
  if (document.getElementById("nexy-pm-css")) return;
  const s = document.createElement("style");
  s.id = "nexy-pm-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

const PM = "/api/apps/startup/api/pm/projects";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", accept: "application/json" },
  });
  const body: unknown = await r.json().catch((e: unknown) => {
    console.warn("[plan] non-JSON reply", e);
    return null;
  });
  if (!r.ok) {
    const msg = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "";
    throw new Error(msg || httpMsg(r.status));
  }
  return body as T;
}

const say = (detail: string) => window.dispatchEvent(new CustomEvent("nexy:toast", { detail }));
const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const led = (s: TaskState) => `led${s === "done" ? " ok" : s === "doing" ? "" : " off"}`;
const owner = (t: Task) => (t.human ? "You" : t.who);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

interface Model {
  p: Project;
  phases: { n: string; c: string; tasks: Task[] }[];
  ms: { n: string; tasks: Task[] }[];
  by: Map<string, Task[]>;
}

function model(p: Project): Model {
  const group = (key: (t: Task) => string) => {
    const m = new Map<string, Task[]>();
    for (const t of p.tasks) {
      const k = key(t);
      const list = m.get(k);
      if (list) list.push(t);
      else m.set(k, [t]);
    }
    return m;
  };
  const phases = [...group((t) => t.goal)].map(([n, tasks], i) => ({ n, c: COLORS[i % COLORS.length], tasks }));
  const ms = [...group((t) => t.ms)].map(([n, tasks]) => ({ n, tasks }));
  const by = group(owner);
  by.delete("You");
  return { p, phases, ms, by };
}

const phaseOf = (m: Model, t: Task) => m.phases.find((ph) => ph.n === t.goal) ?? { n: t.goal, c: COLORS[0], tasks: [] };
const msIndex = (m: Model, t: Task) => m.ms.findIndex((x) => x.n === t.ms) + 1;
const ownPill = (t: Task) => `<span class="own${t.human ? " hu" : ""}">${esc(owner(t))}</span>`;
const swatch = (c: string) => `<i class="sw2" style="background:${c}"></i>`;
const doneOf = (ts: Task[]) => ts.filter((t) => t.s === "done").length;

function msLed(ts: Task[]): string {
  if (ts.every((t) => t.s === "done")) return "led ok";
  return ts.some((t) => t.s === "doing") ? "led" : "led off";
}

export interface PlanBuild { id: string; kind: string; title: string; ts: number }

// what to build for a plan: its objective, with the tasks as what it should include
export function planBrief(objective: string, p: Project): string {
  const parts = [...new Set(p.tasks.map((t) => t.t))].slice(0, 14);
  return parts.length ? `${objective}\n\nIt should include: ${parts.join("; ")}.` : objective;
}

export const buildable = (objective: string): boolean => !!objective && classify(objective).kind === "make";

// a plan whose objective is something to build gets the build itself, not only its tasks
function buildBar(objective: string, b: PlanBuild | null | undefined): string {
  if (!buildable(objective)) return "";
  const when = b ? new Date(b.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  return `<div class="srow2 pbuild"><span class="led${b ? " ok" : " off"}"></span>` +
    (b ? `<b>Built ${esc(when)}</b><span class="faint">${esc(b.title)}</span>` : b === null ? `<b>Not built yet</b><span class="faint">The tasks describe it; building makes the ${esc(/\bgame\b/i.test(objective) ? "game" : "page")} you can open here.</span>` : `<b>Checking for a build…</b>`) +
    `<span class="pbtns">${b ? `<button class="btn small primary" type="button" data-preview>Preview</button>` : ""}` +
    `<button class="btn small${b ? " ghost" : " primary"}" type="button" data-buildit>${b ? "Rebuild" : "Build it"}</button></span></div>`;
}

// AI work waits for the owner: approve it, or send it back with a note (nexy.ts "nexy:review")
export const reviewRow = (t: { id: string; t: string; who: string }) =>
  `<div class="srow2"><span class="led"></span><b>Review: ${esc(t.t)}</b><span class="faint">${esc(t.who)}</span>` +
  `<span class="pbtns"><button class="btn small primary" type="button" data-review="approve" data-id="${esc(t.id)}">Approve</button>` +
  `<button class="btn small ghost" type="button" data-review="redo" data-id="${esc(t.id)}">Send back</button></span></div>`;

function overview(m: Model, objective: string, bar = ""): string {
  const { p } = m;
  const open = p.tasks.filter((t) => t.s !== "done");
  const needs = p.tasks.filter((t) => t.human && t.s !== "done");
  const reviews = p.tasks.filter((t) => t.review === "pending");
  const working = [...m.by.values()].filter((ts) => ts.some((t) => t.s === "doing")).length;
  const done = doneOf(p.tasks);
  const sub = objective || (p.next ? `Next: ${p.next}` : "");
  const status =
    p.tasks.length && done === p.tasks.length ? `<span class="pill"><span class="led ok"></span>Complete</span>`
    : p.tasks.some((t) => t.s !== "todo") ? `<span class="pill"><span class="led"></span>${done} of ${p.tasks.length} done</span>`
    : `<span class="pill"><span class="led off"></span>Not started</span>`;
  const k = (l: string, v: string, extra = "") => `<div class="k"><div class="l">${l}</div><div class="v">${v}</div>${extra}</div>`;
  const card = (h: string, rows: string) => `<div class="scard"><h4>${h}</h4>${rows}</div>`;
  return (
    `<div class="pmhead"><div><h3>${esc(p.name)}</h3>${sub ? `<p class="sp">${esc(sub)}</p>` : ""}</div>${status}</div>` + bar +
    `<div class="kpi5">` +
    k("Progress", `${p.progress}%`, `<div class="progress" style="margin-top:6px"><i style="width:${p.progress}%"></i></div>`) +
    k("Open tasks", String(open.length)) +
    k("Done", String(done)) +
    k("Agents working", `${working} of ${m.by.size}`) +
    k("Needs you", String(needs.length + reviews.length)) +
    `</div><div class="sgrid">` +
    card("Needs you", needs.length || reviews.length
      ? reviews.map(reviewRow).join("") +
        needs.map((t) => `<div class="srow2"><span class="led warn"></span><b>${esc(t.t)}</b><span class="faint">${esc(t.ms)}</span></div>`).join("")
      : `<div class="faint">Nothing waiting on you.</div>`) +
    card("Milestones", m.ms.map((x) =>
      `<div class="srow2"><span class="${msLed(x.tasks)}"></span><b>${esc(x.n)}</b><span class="faint">${doneOf(x.tasks)} of ${x.tasks.length}</span></div>`).join("") ||
      `<div class="faint">No milestones yet.</div>`) +
    card("Phases", m.phases.map((ph) =>
      `<div class="srow2">${swatch(ph.c)}<b>${esc(ph.n)}</b><span class="faint">${doneOf(ph.tasks)} of ${ph.tasks.length} done</span></div>`).join("") ||
      `<div class="faint">No phases yet.</div>`) +
    card("Agents", [...m.by].map(([a, ts]) =>
      `<div class="srow2"><span class="led${ts.some((t) => t.s === "doing") ? "" : " off"}"></span><b>${esc(a)}</b><span class="faint">${plural(ts.length, "task")}</span></div>`).join("") ||
      `<div class="faint">No agents on this plan.</div>`) +
    `</div>`
  );
}

function plan(m: Model): string {
  const needs = m.p.tasks.filter((t) => t.human).length;
  return (
    `<h3>Plan</h3><p class="sp">${plural(m.phases.length, "phase")}, ${plural(m.p.tasks.length, "task")}, ${plural(m.ms.length, "milestone")}. ` +
    `Agents own everything except the ${plural(needs, "item")} marked for you. Click a task to move it on.</p>` +
    m.phases.map((ph) =>
      `<div class="phase"><div class="phh">${swatch(ph.c)}<b>${esc(ph.n)}</b><span class="faint">${doneOf(ph.tasks)} of ${ph.tasks.length} done</span></div>` +
      ph.tasks.map((t) =>
        `<div class="srow2 tk" data-id="${esc(t.id)}"><span class="${led(t.s)}"></span><b>${esc(t.t)}</b>${ownPill(t)}<span class="faint">${esc(t.ms)}</span></div>`).join("") +
      `</div>`).join("") +
    (m.ms.length ? `<div class="faint" style="margin-top:8px">${m.ms.map((x, i) => `◆ ${esc(x.n)}, M${i + 1}`).join(" · ")}</div>` : "")
  );
}

interface Filter { q: string; own: string; s: string }

function tasks(m: Model, f: Filter): string {
  const ts = m.p.tasks.filter((t) =>
    (!f.own || owner(t) === f.own) && (!f.s || t.s === f.s) && (!f.q || t.t.toLowerCase().includes(f.q)));
  const owners = [...m.by.keys(), "You"];
  return (
    `<h3>Tasks</h3><div class="tools2">` +
    `<input placeholder="Filter" data-pf="q" value="${esc(f.q)}">` +
    `<select data-pf="own"><option value="">All owners</option>${owners.map((a) => `<option${f.own === a ? " selected" : ""}>${esc(a)}</option>`).join("")}</select>` +
    `<select data-pf="s"><option value="">All states</option>${STATES.map(([x]) => `<option value="${x}"${f.s === x ? " selected" : ""}>${x}</option>`).join("")}</select>` +
    `<span class="faint" style="margin-left:auto">${plural(ts.length, "task")}</span>` +
    `<input placeholder="Add a task and press Enter" data-add="1" style="width:220px"></div>` +
    `<div class="ttable t5"><div class="th"><span>Task</span><span>Owner</span><span>Phase</span><span>Milestone</span><span>State</span></div>` +
    ts.map((t) => {
      const ph = phaseOf(m, t);
      return (
        `<div class="trow tk" data-id="${esc(t.id)}"><span>${esc(t.t)}${t.human ? ` <em class="hu">needs you</em>` : ""}</span>` +
        `${ownPill(t)}<span title="${esc(ph.n)}">${swatch(ph.c)}${esc(ph.n.split(" ")[0])}</span>` +
        `<span title="${esc(t.ms)}">${esc(t.ms)}</span><span><span class="state ${t.s}">${t.s}</span></span></div>`
      );
    }).join("") +
    (ts.length ? "" : `<div class="trow"><span class="faint">No tasks match.</span></div>`) +
    `</div>`
  );
}

function board(m: Model): string {
  return (
    `<h3>Board</h3><p class="sp">Drag cards between columns, or click one to move it on. Every move is saved to Own Startup.</p><div class="kan k3">` +
    STATES.map(([s, label]) => {
      const ts = m.p.tasks.filter((t) => t.s === s);
      return (
        `<div class="kcol" data-s="${s}"><div class="kh">${label}<span>${ts.length}</span></div>` +
        ts.map((t) =>
          `<div class="kc" draggable="true" data-id="${esc(t.id)}"><div class="kt">${esc(t.t)}</div>` +
          `<div class="km">${swatch(phaseOf(m, t).c)}${ownPill(t)}<span class="faint" title="${esc(t.ms)}">M${msIndex(m, t)}</span></div></div>`).join("") +
        `</div>`
      );
    }).join("") +
    `</div>`
  );
}

function timeline(m: Model): string {
  const total = m.p.tasks.length;
  if (!total) return `<h3>Timeline</h3><div class="faint">No tasks to lay out yet.</div>`;
  const unit = 100 / total;
  const start = new Map<string, number>();
  let at = 0;
  for (const x of m.ms) { start.set(x.n, at); at += x.tasks.length; }
  const slot = new Map<string, number>();
  for (const x of m.ms) x.tasks.forEach((t, i) => slot.set(t.id, (start.get(x.n) ?? 0) + i));
  const lines = m.ms.slice(1).map((x) => {
    const p = (start.get(x.n) ?? 0) * unit;
    return `transparent calc(${p}% - 1px),var(--line) calc(${p}% - 1px) ${p}%,transparent ${p}%`;
  });
  const gl = `linear-gradient(90deg,transparent 0${lines.length ? "," + lines.join(",") : ""},transparent 100%)`;
  const tip = (s: string) => esc(s);
  let out =
    `<h3>Timeline</h3><p class="sp">Milestones in plan order, each as wide as its task count. Own Startup keeps no start dates, so this is sequence, not calendar.</p>` +
    `<div class="gantt" style="--gl:${gl}"><div class="gh"><span class="gl"></span><div class="gw">` +
    m.ms.map((x, i) => `<span style="width:${x.tasks.length * unit}%" title="${esc(x.n)}">M${i + 1} ${esc(x.n)}</span>`).join("") +
    `</div></div>`;
  for (const ph of m.phases) {
    const slots = ph.tasks.map((t) => slot.get(t.id) ?? 0);
    const lo = Math.min(...slots), hi = Math.max(...slots) + 1;
    const share = doneOf(ph.tasks) / ph.tasks.length;
    const info = tip(`<b>${esc(ph.n)}</b><br>${doneOf(ph.tasks)} of ${ph.tasks.length} done`);
    out +=
      `<div class="gr ph"><span class="gl">${swatch(ph.c)}${esc(ph.n)}</span><div class="gw">` +
      `<div class="gbar phb" style="left:${lo * unit}%;width:${(hi - lo) * unit}%;background:${ph.c}" data-tip="${info}"></div>` +
      (share ? `<div class="gbar phf" style="left:${lo * unit}%;width:${(hi - lo) * unit * share}%;background:${ph.c}" data-tip="${info}"></div>` : "") +
      `</div></div>`;
    for (const t of ph.tasks) {
      out +=
        `<div class="gr"><span class="gl t">${esc(t.t)}</span><div class="gw">` +
        `<div class="gbar ${t.s}${t.human ? " hu" : ""}" style="left:${(slot.get(t.id) ?? 0) * unit}%;width:${unit}%;--c:${ph.c}" ` +
        `data-tip="${tip(`<b>${esc(t.t)}</b><br>${esc(owner(t))}, ${esc(t.ms)}, ${t.s}`)}"></div></div></div>`;
    }
  }
  out +=
    `<div class="gr ms"><span class="gl">Milestones</span><div class="gw">` +
    m.ms.map((x) => {
      const end = (start.get(x.n) ?? 0) + x.tasks.length;
      const done = x.tasks.every((t) => t.s === "done");
      return `<div class="gms${done ? "" : " off"}" style="left:${(end - 0.5) * unit}%" title="${esc(x.n)}, ${doneOf(x.tasks)} of ${x.tasks.length} done"><i></i><span>${esc(x.n)}</span></div>`;
    }).join("") +
    `</div></div>`;
  return out + `<div id="gtip" class="gtip" hidden></div></div>`;
}

function agents(m: Model): string {
  const mine = m.p.tasks.filter((t) => t.human);
  return (
    `<h3>Agents</h3><p class="sp">One agent per role in the plan. Anything an agent cannot do is marked for you. Click a task to move it on.</p>` +
    [...m.by].map(([a, ts]) => {
      const doing = ts.filter((t) => t.s === "doing").length;
      return (
        `<div class="agcard"><div class="agh"><span class="led${doing ? "" : " off"}"></span><b>${esc(a)}</b>` +
        `<span class="faint">${esc(ROLES[a] ?? "")}</span>` +
        `<span class="faint" style="margin-left:auto">${doneOf(ts)} done, ${doing} doing, ${ts.length} total</span></div>` +
        `<div class="agt">${ts.map((t) =>
          `<div class="srow2 tk" data-id="${esc(t.id)}"><span class="${led(t.s)}"></span><span>${esc(t.t)}</span><span class="faint">${esc(t.ms)}</span></div>`).join("")}</div></div>`
      );
    }).join("") +
    (mine.length
      ? `<div class="agcard"><div class="agh"><span class="led warn"></span><b>You</b><span class="faint">decisions and signatures</span></div><div class="agt">` +
        mine.map((t) =>
          `<div class="srow2 tk" data-id="${esc(t.id)}"><span class="led${t.s === "done" ? " ok" : " warn"}"></span><span>${esc(t.t)}</span><span class="faint">${esc(t.ms)}</span></div>`).join("") +
        `</div></div>`
      : "")
  );
}

const risks = () =>
  `<h3>Risks</h3><div class="faint">Own Startup does not track risks yet.</div>`;

function docs(p: Project): string {
  const card = (f: Project["files"][number]) => {
    const inner = `<div class="ft">${esc(typeLabel(f))}</div><div style="min-width:0"><div class="fn">${esc(plainName(f.n))}</div><div class="fm">${esc(f.by)}, ${esc(f.when)}</div></div>`;
    return f.href
      ? `<a class="file" href="${esc(f.href)}" target="_blank" rel="noopener">${inner}</a>`
      : `<div class="file">${inner}</div>`;
  };
  // what the AI employees delivered, newest plan order; each opens on the right to read, download or share
  const team = p.tasks.filter((t) => t.s === "done" && t.result).map((t) =>
    `<div class="file" role="button" tabindex="0" data-doc="${esc(t.id)}"><div class="ft">MD</div><div style="min-width:0"><div class="fn">${esc(t.t)}</div><div class="fm">${esc(t.who)}${t.review === "pending" ? ", waiting for your review" : t.review === "approved" ? ", approved" : ""}</div></div></div>`);
  const all = [...team, ...p.files.map(card)];
  return (
    `<h3>Docs</h3><p class="sp">Everything the team writes lands here, on this machine.</p>` +
    (all.length ? `<div class="filegrid">${all.join("")}</div>` : `<div class="faint">No documents yet. They arrive as agents work.</div>`)
  );
}

const activity = (p: Project) =>
  `<h3>Activity</h3>` +
  (p.activity.length
    ? p.activity.map((e) => `<div class="srow2"><span class="faint" style="margin:0;width:44px">${esc(e.t)}</span><span>${e.x}</span></div>`).join("")
    : `<div class="faint">Nothing yet.</div>`);

export function planArtifact(p: Project, initial: string = "overview"): Artifact {
  let view: View = VIEWS.find(([k]) => k === initial)?.[0] ?? "overview";
  const filter: Filter = { q: "", own: "", s: "" };
  let objective = "";
  let busy = false;
  let build: PlanBuild | null | undefined;
  injectCss();

  async function findBuild(): Promise<void> {
    const want = objective.trim().toLowerCase();
    if (!want || !buildable(objective)) return;
    const d = await call<{ runs?: { id: string; prompt?: string; kind?: string; private?: boolean; startedAt?: number }[] }>(
      "/api/apps/build/api/director/runs?limit=200");
    const r = (d.runs ?? []).find((x) => x.kind && !x.private && String(x.prompt ?? "").toLowerCase().includes(want));
    build = r ? { id: r.id, kind: r.kind!, title: String(r.prompt ?? "").split(". ")[0], ts: Number(r.startedAt) || 0 } : null;
  }

  const base = `${PM}/${encodeURIComponent(p.id)}`;

  async function refetch(): Promise<void> {
    const d = await call<{ project?: UpstreamProject }>(base);
    if (!d.project) throw new Error("Own Startup returned no project");
    objective = d.project.objective ?? objective;
    const fresh = shape(d.project);
    Object.assign(p, { ...fresh, em: p.em, loc: p.loc, files: p.files, activity: p.activity });
  }

  return {
    id: `plan:${p.id}`,
    kind: "plan",
    title: p.name,
    meta: `${p.tasks.length} tasks · ${p.progress}% · on device`,
    render(host) {
      const change = async (path: string, init: RequestInit, logLine: string, keepFocus = false) => {
        if (busy) return;
        busy = true;
        host.querySelector(".sbody")?.classList.add("busy");
        try {
          await call(path, init);
          p.activity.unshift({ t: now(), x: logLine, k: "on" });
          await refetch();
          window.dispatchEvent(new CustomEvent("nexy:project-changed", { detail: p.id }));
        } catch (e) {
          say(`Own Startup did not save it: ${errText(e)}`);
        } finally {
          busy = false;
          draw();
          if (keepFocus) host.querySelector<HTMLInputElement>("[data-add]")?.focus();
        }
      };

      const move = (id: string, to: TaskState) => {
        const t = p.tasks.find((x) => x.id === id);
        if (!t || t.s === to) return;
        const label = to === "todo" ? "to do" : to;
        void change(`${base}/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: to }) },
          `<b>You</b> moved “${esc(t.t)}” to ${label}`);
      };

      const draw = () => {
        const m = model(p);
        const tabs = `<div class="stabs">${VIEWS.map(([k, label]) =>
          `<button type="button" class="stab${k === view ? " on" : ""}" data-v="${k}">${label}</button>`).join("")}</div>`;
        const body =
          view === "overview" ? overview(m, objective, buildBar(objective, build))
          : view === "plan" ? plan(m)
          : view === "tasks" ? tasks(m, filter)
          : view === "board" ? board(m)
          : view === "timeline" ? timeline(m)
          : view === "agents" ? agents(m)
          : view === "risks" ? risks()
          : view === "docs" ? docs(p)
          : activity(p);
        host.innerHTML = `<div class="soc pmw" data-plan="${esc(p.id)}">${tabs}<div class="sbody">${body}</div></div>`;
        wire();
      };

      const wire = () => {
        const all = <T extends HTMLElement = HTMLElement>(s: string) => [...host.querySelectorAll<T>(s)];
        all(".stab").forEach((b) => b.addEventListener("click", () => { view = b.dataset.v as View; draw(); }));
        host.querySelector("[data-preview]")?.addEventListener("click", () => {
          if (build) window.dispatchEvent(new CustomEvent("nexy:open-build", { detail: build }));
        });
        host.querySelector("[data-buildit]")?.addEventListener("click", () => {
          window.dispatchEvent(new CustomEvent("nexy:make", { detail: planBrief(objective, p) }));
        });

        all("[data-doc]").forEach((d) => d.addEventListener("click", () => {
          const t = p.tasks.find((x) => x.id === d.dataset.doc);
          if (t?.result) window.dispatchEvent(new CustomEvent("nexy:open-doc", { detail: { title: t.t, who: t.who, md: t.result } }));
        }));

        all("[data-review]").forEach((b) => b.addEventListener("click", () => {
          window.dispatchEvent(new CustomEvent("nexy:review", { detail: { pid: p.id, taskId: b.dataset.id, verdict: b.dataset.review } }));
        }));

        all(".tk, .kc").forEach((r) => r.addEventListener("click", () => {
          const t = p.tasks.find((x) => x.id === r.dataset.id);
          if (t) move(t.id, NEXT[t.s]);
        }));

        all<HTMLInputElement | HTMLSelectElement>("[data-pf]").forEach((i) => {
          const key = i.dataset.pf as keyof Filter;
          i.addEventListener(i.tagName === "INPUT" ? "input" : "change", () => {
            filter[key] = key === "q" ? i.value.toLowerCase() : i.value;
            draw();
            if (key !== "q") return;
            const n = host.querySelector<HTMLInputElement>('[data-pf="q"]');
            if (!n) return;
            n.focus();
            n.setSelectionRange(n.value.length, n.value.length);
          });
        });

        const add = host.querySelector<HTMLInputElement>("[data-add]");
        add?.addEventListener("keydown", (e) => {
          const title = add.value.trim();
          if (e.key !== "Enter" || !title) return;
          void change(`${base}/tasks`, { method: "POST", body: JSON.stringify({ title }) },
            `<b>You</b> added “${esc(title)}”`, true);
        });

        all(".kc").forEach((c) => {
          c.addEventListener("dragstart", (e) => { e.dataTransfer?.setData("text/plain", c.dataset.id ?? ""); c.classList.add("drag"); });
          c.addEventListener("dragend", () => c.classList.remove("drag"));
        });
        all(".kcol").forEach((col) => {
          col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("over"); });
          col.addEventListener("dragleave", () => col.classList.remove("over"));
          col.addEventListener("drop", (e) => {
            e.preventDefault();
            col.classList.remove("over");
            const id = e.dataTransfer?.getData("text/plain");
            if (id) move(id, col.dataset.s as TaskState);
          });
        });

        const gantt = host.querySelector<HTMLElement>(".gantt");
        const tip = host.querySelector<HTMLElement>("#gtip");
        if (!gantt || !tip) return;
        all(".gbar").forEach((g) => {
          g.addEventListener("mousemove", (e) => {
            const box = gantt.getBoundingClientRect();
            tip.hidden = false;
            tip.style.left = `${e.clientX - box.left + 14}px`;
            tip.style.top = `${e.clientY - box.top + 8}px`;
            tip.innerHTML = g.dataset.tip ?? "";
          });
          g.addEventListener("mouseleave", () => { tip.hidden = true; });
        });
      };

      draw();
      if (build === undefined) {
        void refetch().then(findBuild).then(() => {
          if (host.querySelector(".pmw")?.getAttribute("data-plan") === p.id) draw();
        }).catch((e) => console.warn("[nexy] plan build lookup failed", e));
      }
    },
  };
}
