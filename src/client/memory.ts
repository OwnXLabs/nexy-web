import { httpMsg, errText } from "./http";
export type MemCmd =
  | { kind: "memShow" } | { kind: "memForget" }
  | { kind: "routineMake"; cron: string; local: string; human: string; prompt: string; name: string }
  | { kind: "routineList" } | { kind: "routineStop"; what: string } | { kind: "routineRunLast" };

export interface MemUI {
  push(who: "ai", html: string): HTMLElement;
  block(el: HTMLElement): void;
  isPrivate(): boolean;
  // run a task now, as a normal turn in this chat
  runNow?(prompt: string): Promise<void>;
}

// the routine set in this page, so "run it now" right after means that routine
let lastRoutine: { name: string; prompt: string } | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** The device's time zone, e.g. "Asia/Manila": routine times are read and shown in it. */
export const deviceZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

const LOCAL = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
/** A moment on this device's clock: "Fri 13 Nov, 8:00 am". */
export const localTime = (iso: string): string => LOCAL.format(new Date(iso));

const clock = (h: number, m: number) => `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;

/** A schedule in plain words. tz: the zone it runs in; null when the agent reads it in UTC. */
export function scheduleText(schedule: string, tz: string | null): string {
  const s = schedule.trim().toLowerCase();
  const every = /^every (\d+)([mhd])$/.exec(s);
  if (every) {
    const unit = { m: "minute", h: "hour", d: "day" }[every[2] as "m" | "h" | "d"];
    return every[1] === "1" ? `every ${unit}` : `every ${every[1]} ${unit}s`;
  }
  const daily = /^daily (\d{1,2}):(\d{2})$/.exec(s), cron = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|mon-fri)$/.exec(s);
  const text = daily ? `every day at ${clock(+daily[1], +daily[2])}`
    : cron ? `${cron[3] === "*" ? "every day" : "every weekday"} at ${clock(+cron[2], +cron[1])}`
    : schedule;
  return tz == null ? `${text} (UTC)` : tz === deviceZone() ? text : `${text} (${tz} time)`;
}

export function parseSchedule(text: string, now = new Date()): { cron: string; local: string; human: string; prompt: string } | null {
  const m = /^\s*(?:please\s+)?(?:(?:every|each)\s+(day|morning|evening|night|weekday|hour|sunday|monday|tuesday|wednesday|thursday|friday|saturday)|(daily|hourly))(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\s*[,:-]?\s+(.{4,})$/i.exec(text);
  if (!m) return null;
  const unit = (m[1] ?? (m[2]?.toLowerCase() === "hourly" ? "hour" : "day")).toLowerCase();
  const prompt = m[6].trim();
  if (unit === "hour") return { cron: "0 * * * *", local: "0 * * * *", human: "every hour", prompt };
  let h = m[3] ? Number(m[3]) : unit === "morning" ? 8 : unit === "evening" ? 18 : unit === "night" ? 21 : 9;
  const min = m[4] ? Number(m[4]) : 0;
  if (m[5]?.toLowerCase() === "pm" && h < 12) h += 12;
  if (m[5]?.toLowerCase() === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  const local = new Date(now); local.setHours(h, min, 0, 0);
  const uh = local.getUTCHours(), um = local.getUTCMinutes(), shift = local.getUTCDay() - local.getDay();
  const s = shift > 1 ? -1 : shift < -1 ? 1 : shift;
  const dow = (d: number) => (((d + s) % 7) + 7) % 7;
  const at = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  // cron: the same in UTC, for an agent that reads schedules in UTC; local: on this device's clock
  const onClock = (days: string) => `${min} ${h} * * ${days}`;
  if (unit === "weekday") return { cron: `${um} ${uh} * * ${[1, 2, 3, 4, 5].map(dow).join(",")}`, local: onClock("1-5"), human: `every weekday at ${at}`, prompt };
  const d = DAYS.indexOf(unit);
  if (d >= 0) return { cron: `${um} ${uh} * * ${dow(d)}`, local: onClock(String(d)), human: `every ${unit[0].toUpperCase()}${unit.slice(1)} at ${at}`, prompt };
  return { cron: `${um} ${uh} * * *`, local: onClock("*"), human: `every day at ${at}`, prompt };
}

export function matchMemory(text: string): MemCmd | null {
  const t = text.trim();
  if (/^(?:what do you remember|what do you know about me|show (?:me )?(?:your|my) memory|what have you remembered)\b/i.test(t)) return { kind: "memShow" };
  if (/^(?:please\s+)?forget (?:everything|all of it|what you remember|our conversations|all our conversations)\b/i.test(t)) return { kind: "memForget" };
  if (/^(?:show|list|what are) (?:me )?(?:my|the) routines?\b|^my routines$/i.test(t)) return { kind: "routineList" };
  const stop = /^(?:stop|cancel|delete|remove) (?:the |my )?(.+?) routine\b/i.exec(t);
  if (stop) return { kind: "routineStop", what: stop[1] };
  const s = parseSchedule(t);
  if (s) return { kind: "routineMake", ...s, name: s.prompt.replace(/^(?:send me|give me|tell me|remind me to|remind me)\s+/i, "").slice(0, 60) };
  if (lastRoutine && /^(?:please\s+)?(?:run|do|try|test)\s+(?:it|that|this|the routine)(?:\s+(?:now|once|again))?\b/i.test(t)) return { kind: "routineRunLast" };
  return null;
}

/** Leaving an example that set a routine: "run it now" next means that routine, not "run what?" */
export function noteExampleRoutine(firstMessage: string): void {
  const s = parseSchedule(firstMessage.trim());
  if (s) lastRoutine = { name: s.prompt.slice(0, 60), prompt: s.prompt };
}

const EVAL = typeof location !== "undefined" && new URLSearchParams(location.search).get("eval") === "1";

async function call(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(EVAL ? { "x-nexy-eval": "1" } : {}), ...(init.headers ?? {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.note ?? d?.error ?? httpMsg(r.status));
  return d;
}

function blockEl(title: string, right: string, rows: string, foot = "", cls = ""): HTMLElement {
  const el = document.createElement("div");
  el.className = cls ? `block ${cls}` : "block";
  el.innerHTML = `<div class="bh">${esc(title)}<span class="r">${esc(right)}</span></div>${rows}${foot}`;
  return el;
}
const row = (k: string, v: string, off = false) => `<div class="row"><span class="led${off ? " off" : " ok"}"></span><span>${esc(k)}</span><span class="v">${esc(v)}</span></div>`;

export async function playMemory(cmd: MemCmd, ui: MemUI): Promise<void> {
  try {
    if (cmd.kind === "memShow") {
      const { items } = await call("/api/v1/memory");
      if (!items.length) { ui.push("ai", "I am not keeping any conversations right now. Nothing is stored for me to remember."); return; }
      const rows = items.slice(0, 8).map((x: any) => row(x.title, `${x.messages} messages${x.startedAt ? ` · ${new Date(x.startedAt).toLocaleDateString()}` : ""}`)).join("") +
        (items.length > 8 ? row(`and ${items.length - 8} more`, "", true) : "");
      const foot = `<div class="ba"><a class="btn small" href="/api/v1/memory?export=1" download="nexy-memory.json">Export</a> <button class="btn small" data-forget>Forget all</button></div>`;
      const el = blockEl("What I remember", `${items.length} conversation${items.length === 1 ? "" : "s"}, on this machine`, rows, foot);
      wireForget(el, items.length, ui);
      ui.block(el);
      ui.push("ai", "These are the conversations I keep, all on this machine. Export takes them with you to another engine; forget removes them for good.");
      return;
    }
    if (cmd.kind === "memForget") {
      const { items } = await call("/api/v1/memory");
      if (!items.length) { ui.push("ai", "There is nothing to forget: I am not keeping any conversations."); return; }
      const el = blockEl("Forget everything?", "cannot be undone", row(`${items.length} conversation${items.length === 1 ? "" : "s"} I keep`, "on this machine"),
        `<div class="ba"><button class="btn small" data-forget>Forget all ${items.length}</button></div>`);
      wireForget(el, items.length, ui, true);
      ui.block(el);
      return;
    }
    if (cmd.kind === "routineMake") {
      if (ui.isPrivate()) { ui.push("ai", "A routine keeps its results, so I cannot set one up from an ultra-private chat. End the private session first."); return; }
      // the schedule on this device's clock, with the UTC one for an agent without time zones
      const { routine } = await call("/api/v1/routines", { method: "POST", body: JSON.stringify({ name: cmd.name, schedule: cmd.local, utcSchedule: cmd.cron, tz: deviceZone(), prompt: cmd.prompt }) });
      ui.block(blockEl(`Routine: ${cmd.name}`, cmd.human, row("What it does", cmd.prompt) + row("When", cmd.human) +
        row("Next run", routine.nextRunAt ? localTime(routine.nextRunAt) : "set by the scheduler"), "", "routine"));
      lastRoutine = { name: cmd.name, prompt: cmd.prompt };
      ui.push("ai", `Set. I will do this ${esc(cmd.human)}, on this machine, and keep the result. Say <b>show my routines</b> to see the latest one.${ui.runNow ? " Here is the first one now, so you can see what it looks like." : ""}`);
      // a first run straight away: what the owner will get, without waiting for the schedule
      if (ui.runNow) await ui.runNow(cmd.prompt);
      return;
    }
    if (cmd.kind === "routineRunLast") {
      if (!lastRoutine || !ui.runNow) { ui.push("ai", "There is no routine from this chat to run. Say <b>show my routines</b> to see them."); return; }
      await ui.runNow(lastRoutine.prompt);
      return;
    }
    if (cmd.kind === "routineList") {
      const { routines } = await call("/api/v1/routines");
      if (!routines.length) { ui.push("ai", "No routines yet. Try “every weekday at 8am, summarise what my projects need”."); return; }
      const waiting = routines.filter((r: any) => r.pending), live = routines.filter((r: any) => !r.pending);
      if (live.length) ui.block(blockEl("Routines", `${live.length} on this machine`, live.map((r: any) =>
        row(r.name, `${scheduleText(r.schedule, r.tz ?? null)}${r.nextRunAt ? ` · next ${localTime(r.nextRunAt)}` : ""}${r.lastRunAt ? ` · last ${localTime(r.lastRunAt)}` : " · not run yet"}`, !r.enabled)).join(""), "", "routine"));
      for (const r of waiting) ui.block(pendingEl(r, ui));
      if (waiting.length) ui.push("ai", `${waiting.length === 1 ? "One routine is" : `${waiting.length} routines are`} waiting for you. I set ${waiting.length === 1 ? "it" : "them"} up while reading something from outside, so ${waiting.length === 1 ? "it" : "they"} will not run until you confirm.`);
      const latest = routines.find((r: any) => r.lastResult);
      if (latest) ui.push("ai", `Latest from <b>${esc(latest.name)}</b>:<br>${esc(latest.lastResult).slice(0, 700).replace(/\n/g, "<br>")}`);
      return;
    }
    if (cmd.kind === "routineStop") {
      const { routines } = await call("/api/v1/routines");
      const hit = routines.filter((r: any) => r.name.toLowerCase().includes(cmd.what.toLowerCase()));
      if (hit.length !== 1) { ui.push("ai", hit.length ? `More than one routine matches “${esc(cmd.what)}”: ${hit.map((r: any) => esc(r.name)).join(", ")}. Which one?` : `No routine matches “${esc(cmd.what)}”. Nothing was stopped.`); return; }
      await call(`/api/v1/routines?id=${encodeURIComponent(hit[0].id)}`, { method: "DELETE" });
      ui.push("ai", `Stopped <b>${esc(hit[0].name)}</b>. It will not run again.`);
    }
  } catch (e) {
    ui.push("ai", `That did not work: <code>${esc(errText(e))}</code>`);
  }
}

// what put outside content in front of the agent, in plain words
function originText(o: unknown): string {
  if (!o) return "not known";
  const plain: Record<string, string> = { read_page: "a web page", web_search: "a web search", run: "a command", list_files: "file names", read_file: "a file", recall: "saved notes" };
  return String(o).split(", ").map((p) => {
    if (p === "earlier in this chat") return p;
    if (p === "content passed in with the message") return "an attached file, mail or page";
    const [tool, ...rest] = p.split(" ");
    return `${plain[tool] ?? "outside content"}${rest.length ? ` (${rest.join(" ")})` : ""}`;
  }).join(", ");
}

/** A routine made while outside content was in context: the owner confirms or discards it. */
function pendingEl(r: any, ui: MemUI): HTMLElement {
  // confirming sends this device's zone, so an agent with zones runs it on this clock
  const el = blockEl(`Waiting for you: ${r.name}`, "not running yet",
    row("What it will run", r.prompt, true) + row("When", scheduleText(r.schedule, r.tz == null ? null : deviceZone()), true) + row("Came from", originText(r.origin), true),
    `<div class="ba"><button class="btn small" data-confirm>Confirm</button> <button class="btn small" data-discard>Discard</button></div>`, "routine");
  const buttons = [...el.querySelectorAll<HTMLButtonElement>("[data-confirm], [data-discard]")];
  for (const b of buttons) b.onclick = async () => {
    const action = b.hasAttribute("data-confirm") ? "confirm" : "discard";
    buttons.forEach((x) => { x.disabled = true; });
    try {
      const d = await call("/api/v1/routines", { method: "PATCH", body: JSON.stringify({ id: r.id, action, tz: deviceZone() }) });
      el.querySelector(".ba")!.textContent = action === "confirm" ? "Confirmed" : "Discarded";
      ui.push("ai", action === "confirm"
        ? `Confirmed <b>${esc(r.name)}</b>. ${d?.routine?.nextRunAt ? `First run ${esc(localTime(d.routine.nextRunAt))}.` : "It runs on its schedule."}`
        : `Discarded <b>${esc(r.name)}</b>. It will not run.`);
    } catch (e) {
      buttons.forEach((x) => { x.disabled = false; });
      ui.push("ai", `Nothing changed: <code>${esc(errText(e))}</code>`);
    }
  };
  return el;
}

function wireForget(el: HTMLElement, n: number, ui: MemUI, direct = false): void {
  const b = el.querySelector<HTMLButtonElement>("[data-forget]");
  if (!b) return;
  let armed = direct;
  b.onclick = async () => {
    if (!armed) { armed = true; b.textContent = `Yes, forget all ${n}`; return; }
    b.disabled = true;
    try {
      const { forgotten } = await call("/api/v1/memory?all=1", { method: "DELETE" });
      ui.push("ai", `Forgotten: ${forgotten} conversation${forgotten === 1 ? "" : "s"}, removed from this machine.`);
      b.textContent = "Forgotten";
    } catch (e) {
      b.disabled = false;
      ui.push("ai", `Nothing was forgotten: <code>${esc(errText(e))}</code>`);
    }
  };
}
