// What this computer's model can do, from the desktop app (NEXY_CAPS, from the capability file it ships).
// A job the model can't do here is held back before it runs: one plain card, and where it can run instead.
import { routineAsk } from "../lib/routine-ask.ts";
import { gameBrief, buildKind, BUILD_REFUSED } from "../lib/caps.ts";
import type { Intent } from "./intent";

export type Task = "chat" | "research" | "summarise" | "routine" | "build_site" | "build_game" | "diagram" | "edit_page";
export type Verdict = "allow" | "warn" | "block";
export interface Caps { model: string; tier: string; tested: boolean; class: string; tasks: Partial<Record<Task, Verdict>>; cloud?: Partial<Record<Task, Verdict>> | null }

export function readCaps(raw: string | undefined | null): Caps | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Caps;
    return c && typeof c.tasks === "object" ? c : null;
  } catch (e) {
    console.warn("[nexy] capabilities unreadable; nothing held back", e);
    return null;
  }
}

export const caps: Caps | null = typeof document === "undefined" ? null : readCaps(document.documentElement.dataset.caps);

export { gameBrief, buildKind };
const RESEARCH = /\b(?:research|compare|competitors?|look up|find out about)\b/i;
const SUMMARISE = /\b(?:summari[sz]e|sum up|tl;?dr)\b/i;

/** Which kind of job a request is. revises: it changes the page that is open. */
export function taskOf(intent: Intent, text: string, revises = false): Task {
  if (revises) return "edit_page";
  if (intent.kind === "make" || intent.kind === "rebuild")
    return intent.deliverable === "diagram" ? "diagram" : gameBrief(intent.brief) ? "build_game" : "build_site";
  if (intent.kind === "customRebuild" || intent.kind === "build") return gameBrief(text) ? "build_game" : "build_site";
  if (intent.kind !== "chat") return "chat";
  if (routineAsk(text)) return "routine";
  if (SUMMARISE.test(text)) return "summarise";
  return RESEARCH.test(text) ? "research" : "chat";
}

// no capabilities (an Own1, Nexy Cloud, an older app): nothing is held back
export const verdictFor = (c: Caps | null, t: Task): Verdict => c?.tasks[t] ?? "allow";

const BUILDS = new Set<Task>(["build_site", "build_game", "diagram", "edit_page"]);
export const WARN_NOTE = "This computer’s AI can only make simple versions of this.";
export const warnsFor = (t: Task) => BUILDS.has(t);
export const THIN = "It ran, but came out very thin. This computer’s AI is too small for this.";

const NEEDS: Record<Task, string> = {
  build_site: "Building websites and games", build_game: "Building websites and games", diagram: "Drawing diagrams",
  edit_page: "Changing a built page", routine: "Setting up routines", research: "Researching", summarise: "Summarising", chat: "This",
};
export const blockLine = (t: Task) => t === "build_site" || t === "build_game" ? BUILD_REFUSED : `${NEEDS[t]} needs a bigger AI than this computer can run.`;

type App = { own1?: string; guest?: string; cloud?: string };
const app = (): App => (typeof window === "undefined" ? {} : ((window as unknown as { nexyApp?: App }).nexyApp ?? {}));

/** The card for a job held back. Buttons only for places the app can open from here; Nexy Cloud only if it can do the job. */
export function gateCard(t: Task, c: Caps | null): HTMLElement {
  const a = app();
  const el = document.createElement("div");
  el.className = "block";
  el.dataset.gate = t;
  const go: [string, string, string][] = [];
  if (a.guest) go.push(["guest", "Use a community code", a.guest]);
  if (a.cloud && c?.cloud && (c.cloud[t] ?? "block") !== "block") go.push(["cloud", "Use Nexy Cloud", a.cloud]);
  if (a.own1) go.push(["own1", "Use my Own 1", a.own1]);
  el.innerHTML = `<div class="bh"></div><div class="row"><span class="led off"></span><span></span></div><div class="ba"></div>`;
  el.querySelector(".bh")!.textContent = blockLine(t);
  el.querySelector(".row span:last-child")!.textContent = go.length
    ? "An Own 1 runs bigger models. Nothing was started on this computer."
    : "An Own 1 runs bigger models: connect one in the Nexy app on your computer. Nothing was started.";
  const ba = el.querySelector(".ba")!;
  for (const [k, label, href] of go) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn${k === "own1" ? " primary" : ""}`;
    b.dataset.a = k;
    b.textContent = label;
    b.onclick = () => { location.href = href; };
    ba.append(b);
  }
  if (!go.length) ba.remove();
  return el;
}
