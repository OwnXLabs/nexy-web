export type TaskState = "todo" | "doing" | "done";

export interface Task {
  id: string; t: string; who: string; s: TaskState; goal: string; ms: string;
  human: boolean;
  review?: "pending" | "approved";   // AI work waiting for the owner, or accepted
  result?: string;                   // what an AI employee delivered (the plan's Docs)
}
export interface Agent { n: string; task: string; on: boolean }
export interface FileRow { n: string; by: string; when: string; app?: string; href?: string; kind?: string }

// what a file is, in words a person uses; never a file extension
const BY_KIND: Record<string, string> = { game: "Game", html: "Site", site: "Site", project: "Plan", plan: "Plan", image: "Image", audio: "Audio", voice: "Voice", doc: "Doc", table: "Sheet", sheet: "Sheet", diagram: "Chart", deck: "Slides" };
const BY_APP: Record<string, string> = { "Own Startup": "Plan", Qiki: "Site", "Own Build": "Site", "Own Beat Studio": "Audio", "Own Voice Studio": "Voice", "Own Image Studio": "Image", "Own Docs": "Doc" };
const BY_EXT: Record<string, string> = { png: "Image", jpg: "Image", jpeg: "Image", webp: "Image", gif: "Image", wav: "Audio", mp3: "Audio", pdf: "Doc", md: "Doc", txt: "Doc", docx: "Doc", csv: "Sheet", xlsx: "Sheet", pptx: "Slides", html: "Site", plan: "Plan" };
export function typeLabel(f: { kind?: string; n?: string; app?: string }): string {
  const ext = (f.n ?? "").match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase() ?? "";
  return BY_KIND[f.kind ?? ""] ?? BY_EXT[ext] ?? BY_APP[f.app ?? ""] ?? "File";
}

// names Nexy made itself lose the extension and the dashes; a person's own files keep theirs
export const plainName = (n: string): string =>
  /^[\w-]+\.(html?|plan|app|game|md|csv|png|mmd)$/i.test(n) || /\.(html?|plan|app|game)$/i.test(n)
    ? n.replace(/\.[a-z]+$/i, "").replace(/[-_]+/g, " ").trim()
    : n;
export interface Event { t: string; x: string; k: "on" | "off" | "warn" }

export interface Project {
  id: string; em: string; name: string; loc: string;
  progress: number; next: string;
  taskCount: number; doneCount: number;
  tasks: Task[]; agents: Agent[]; files: FileRow[]; activity: Event[];
}

interface UpstreamSub { id: string; title: string; done?: boolean | string }
interface UpstreamTask {
  id: string; title: string; status?: string;
  owner?: string;
  role?: string;
  review?: string;
  result?: string;
  priority?: string; deadline?: string; subtasks?: UpstreamSub[];
}
interface UpstreamMs { title: string; tasks?: UpstreamTask[] }
interface UpstreamGoal { title: string; milestones?: UpstreamMs[] }
export interface UpstreamProject {
  id: string; title: string; goals?: UpstreamGoal[]; objective?: string;
  taskCount?: number; doneCount?: number;
}

function foldState(s: string | undefined): TaskState {
  const v = (s ?? "").toLowerCase();
  if (/done|complete|finished|shipped/.test(v)) return "done";
  if (/doing|progress|running|active|started/.test(v)) return "doing";
  return "todo";
}

function owner(t: UpstreamTask): string {
  if (typeof t.role === "string" && t.role.trim()) return t.role.trim();
  return (t.owner ?? "").toLowerCase() === "human" ? "You" : "Nexy";
}

const EMOJI = ["🚀", "🎬", "📈", "📦", "🧭", "🛠", "🌱", "📊"];

export function shape(u: UpstreamProject, i = 0): Project {
  const tasks: Task[] = [];
  for (const g of u.goals ?? []) {
    for (const m of g.milestones ?? []) {
      for (const t of m.tasks ?? []) {
        tasks.push({ id: t.id, t: t.title, who: owner(t), s: foldState(t.status), goal: g.title, ms: m.title, human: (t.owner ?? "").toLowerCase() === "human", review: t.review === "pending" || t.review === "approved" ? t.review : undefined, result: typeof t.result === "string" && t.result.trim() ? t.result.slice(0, 20000) : undefined });
      }
    }
  }

  const byRole = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.who === "Nexy") continue;
    const list = byRole.get(t.who);
    if (list) list.push(t);
    else byRole.set(t.who, [t]);
  }
  const agents: Agent[] = [...byRole.entries()].map(([n, ts]) => {
    const doing = ts.find((x) => x.s === "doing");
    const next = ts.find((x) => x.s === "todo");
    return {
      n,
      task: doing ? doing.t
          : next ? `waiting: ${next.t}`
          : `${ts.length} task${ts.length === 1 ? "" : "s"} done`,
      on: !!doing,
    };
  });

  const loaded = (u.goals ?? []).length > 0;
  const done = loaded ? tasks.filter((t) => t.s === "done").length : Number(u.doneCount ?? 0);
  const total = loaded ? tasks.length : Number(u.taskCount ?? 0);

  const next = tasks.find((t) => t.s === "doing") ?? tasks.find((t) => t.s === "todo");

  return {
    id: u.id,
    em: EMOJI[i % EMOJI.length],
    name: u.title,
    loc: "Own 1, this desk",
    progress: total ? Math.round((done / total) * 100) : 0,
    taskCount: total, doneCount: done,
    next: next ? next.t : "",
    tasks, agents, files: [], activity: [],
  };
}
