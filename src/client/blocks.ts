import type { Project, Task } from "./state";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const led = (s: Task["s"]) => (s === "done" ? " ok" : s === "doing" ? "" : " off");

export interface PlanBlockHandlers {
  onStart: (p: Project) => void;
  onAdjust: (p: Project) => void;
}

export function planBlock(p: Project, h: PlanBlockHandlers): HTMLElement {
  const agentCount = p.agents.length;
  const right =
    `${p.tasks.length} task${p.tasks.length === 1 ? "" : "s"}, ` +
    `${agentCount ? `${agentCount} agent${agentCount === 1 ? "" : "s"}` : "no named agents"}, on device`;

  const root = document.createElement("div");
  root.className = "block";
  root.innerHTML =
    `<div class="bh">Plan: ${esc(p.name)}<span class="r">${esc(right)}</span></div>` +
    p.tasks
      .slice(0, 12)
      .map(
        (t) =>
          `<div class="row"><span class="led${led(t.s)}"></span>` +
          `<span>${esc(t.t)}</span><span class="v">${esc(t.who)}</span></div>`,
      )
      .join("") +
    (p.tasks.length > 12
      ? `<div class="row"><span class="led off"></span><span class="faint">and ${p.tasks.length - 12} more</span><span class="v"></span></div>`
      : "") +
    `<div class="ba">` +
    `<button class="btn" type="button" data-a="adjust">Adjust</button>` +
    `<button class="btn primary" type="button" data-a="start">Start</button>` +
    `</div>`;

  root.querySelector<HTMLElement>('[data-a="start"]')?.addEventListener("click", () => h.onStart(p));
  root.querySelector<HTMLElement>('[data-a="adjust"]')?.addEventListener("click", () => h.onAdjust(p));
  return root;
}

export function resumeBlock(
  p: Project,
  onGo: () => void,
): HTMLElement | null {
  const left = p.tasks.filter((t) => t.s !== "done");
  const mine = left.filter((t) => t.who !== "You").length;
  if (!left.length || !mine) return null;

  const done = p.tasks.length - left.length;
  const yours = left.length - mine;
  const pct = p.tasks.length ? Math.round((done / p.tasks.length) * 100) : 0;

  const root = document.createElement("div");
  root.className = "block";
  root.innerHTML =
    `<div class="bh">${esc(p.name)} is ${pct}% done<span class="r">${done}/${p.tasks.length} tasks</span></div>` +
    `<div class="row"><span class="led off"></span><span>${mine} more Nexy can run on this machine</span><span class="v"></span></div>` +
    (yours
      ? `<div class="row"><span class="led off"></span><span class="faint">${yours} assigned to you</span><span class="v"></span></div>`
      : "") +
    `<div class="ba"><button class="btn primary" type="button" data-a="go">Continue on autopilot</button></div>`;
  root.querySelector<HTMLElement>('[data-a="go"]')?.addEventListener("click", () => { markStarted(root, "Autopilot on."); onGo(); });
  return root;
}

export function markStarted(block: HTMLElement, note: string): void {
  const ba = block.querySelector(".ba");
  if (ba) ba.innerHTML = `<span class="done">${esc(note)}</span>`;
}

export function agentsBlock(p: Project): HTMLElement | null {
  if (!p.agents.length) return null;
  const live = p.agents.filter((a) => a.on);
  if (!live.length) return null;
  const root = document.createElement("div");
  root.className = "block";
  root.innerHTML =
    `<div class="bh">Working now<span class="r">${live.length} agent${live.length === 1 ? "" : "s"}</span></div>` +
    live
      .map(
        (a) =>
          `<div class="row"><span class="led"></span>` +
          `<span>${esc(a.n)}</span><span class="v">${esc(a.task)}</span></div>`,
      )
      .join("");
  return root;
}

export function summaryBlock(title: string, right: string, rows: { k: string; v: string; off?: boolean }[]): HTMLElement {
  const root = document.createElement("div");
  root.className = "block";
  root.innerHTML =
    `<div class="bh">${esc(title)}<span class="r">${esc(right)}</span></div>` +
    rows
      .map((r) => `<div class="row"><span class="led${r.off ? " off" : " ok"}"></span><span>${esc(r.k)}</span><span class="v">${esc(r.v)}</span></div>`)
      .join("");
  return root;
}

export function filesBlock(title: string, names: string[]): HTMLElement {
  const root = document.createElement("div");
  root.className = "block";
  root.innerHTML =
    `<div class="bh">${esc(title)}<span class="r">${names.length} file${names.length === 1 ? "" : "s"}</span></div>` +
    names
      .map((n) => `<div class="row"><span class="led ok"></span><span>${esc(n)}</span><span class="v"></span></div>`)
      .join("");
  return root;
}

export function consentBlock(
  docs: { id: string; filename: string }[],
  onAllow: (doc: { id: string; filename: string }, row: HTMLElement) => void,
): HTMLElement {
  const root = document.createElement("div");
  root.className = "block";
  root.innerHTML =
    `<div class="bh">Let Nexy read ${docs.length === 1 ? "it" : "them"}?<span class="r">${docs.length} file${docs.length === 1 ? "" : "s"}</span></div>` +
    docs
      .map(
        (d, i) =>
          `<div class="row" data-i="${i}"><span class="led off"></span><span>${esc(d.filename)}</span>` +
          `<span class="v"><button class="btn small" type="button" data-a="allow">Allow</button></span></div>`,
      )
      .join("") +
    `<div class="ba"><span class="faint">Until you allow it, the file is yours alone — Own Docs can answer from it and Nexy cannot.</span></div>`;

  root.querySelectorAll<HTMLElement>(".row").forEach((row, i) => {
    row.querySelector<HTMLElement>('[data-a="allow"]')?.addEventListener("click", () => onAllow(docs[i], row));
  });
  return root;
}

// while it runs: progress, and Pause / Resume as in the design
export function autopilotBlock(name: string, onPause: () => void, onResume: () => void): { el: HTMLElement; set(done: number, total: number, state: "running" | "paused" | "finished", note?: string): void } {
  const el = document.createElement("div");
  el.className = "block";
  const set = (done: number, total: number, state: "running" | "paused" | "finished", note = "") => {
    el.innerHTML =
      `<div class="bh"><span class="led${state === "running" ? "" : state === "finished" ? " ok" : " off"}"></span> Autopilot ${state === "running" ? "running" : state}<span class="r">${done}/${total} done</span></div>` +
      (note ? `<div class="row"><span class="faint">${esc(note)}</span></div>` : "") +
      (state === "finished" ? "" : `<div class="ba"><button class="btn" type="button" data-a="t">${state === "running" ? "Pause autopilot" : "Resume autopilot"}</button></div>`);
    el.querySelector('[data-a="t"]')?.addEventListener("click", state === "running" ? onPause : onResume);
  };
  return { el, set };
}
