import { here, onOwn1 } from "./place";
import { classifyEdit } from "./edit-loop";
import type { LastBuild } from "../lib/chat-output";

export type Intent =
  | { kind: "addTask"; title: string }
  | { kind: "completeTask"; title: string; state: "done" | "doing" | "todo" | "review" }
  | { kind: "assignTask"; title: string; role: string }
  | { kind: "unavailable"; say: string }
  | { kind: "view"; tab: string; say: string }
  | { kind: "connections" }
  | { kind: "help" }
  | { kind: "paint" }
  | { kind: "status" }
  | { kind: "startPlan" }
  | { kind: "pausePlan" }
  | { kind: "resumePlan" }
  | { kind: "addRole"; role: string }
  | { kind: "workLog"; days: number }
  | { kind: "customRebuild" }
  | { kind: "chart" }
  | { kind: "canvasView"; view: string; say: string }
  | { kind: "generate"; medium: "image" | "audio"; prompt: string }
  | { kind: "edit"; text: string }
  | { kind: "build" }
  | { kind: "make"; brief: string; deliverable: "web_app" | "diagram" }
  | { kind: "rebuild"; brief: string; deliverable: "web_app" | "diagram"; error: string; fix: string }
  | { kind: "chat" };

const VIEWS: [RegExp, string, string][] = [
  [/\b(show|open|go to)\b.*\bboard\b|^board$/i, "tasks", "Board is open."],
  [/\b(show|open|go to)\b.*\btasks?\b|^tasks?$/i, "tasks", "Tasks are open."],
  [/\b(show|open|go to)\b.*\bagents?\b|^agents?$/i, "agents", "Agents are open."],
  [/\b(show|open|go to)\b.*\bfiles?\b|^files?$/i, "files", "Files are open."],
  [/\b(show|open|go to)\b.*\bactivity\b|^activity$/i, "activity", "Activity is open."],
];

const START_PLAN =
  /^\s*(?:please\s+|ok\s+|now\s+)?(?:start|kick off|run|begin|get going on)\s+(?:the\s+)?(?:team|plan|work|tasks|agents)\b|^\s*(?:start|run|kick off)\s+the\s+project\b/i;

const PAUSE_PLAN =
  /^\s*(?:please\s+)?(?:pause|stop|halt|hold)\s+(?:everything|all(?:\s+(?:agents|tasks|work))?|(?:the\s+)?(?:team|agents|plan|work|tasks))\b|^\s*pause\s*[.!]?\s*$/i;
const RESUME_PLAN =
  /^\s*(?:please\s+)?(?:resume|unpause)(?:\s+(?:everything|all|(?:the\s+)?(?:team|agents|plan|work|tasks)))?\s*[.!]?\s*$|^\s*continue\s+(?:the\s+)?(?:team|plan|work|tasks)\b/i;

const ADD_ROLE =
  /^\s*(?:please\s+)?(?:add|hire|bring in|bring on)\s+(?:a|an)\s+(.*?\b(?:pm|manager|lead|engineer|developer|designer|writer|editor|analyst|researcher|reviewer|auditor|assistant|specialist|agent|marketer|strategist|coordinator|consultant|producer|director|officer|architect|scientist|expert|accountant|lawyer))(?:\s+(?:to|on(?:to)?)\s+(?:this|the)\s+(?:project|team))?\s*[.!]?\s*$/i;

const CANVAS_VIEWS: [RegExp, string][] = [
  [/\b(show|open)\b.*\btimeline\b|^timeline$/i, "timeline"],
  [/\b(show|open)\b.*\brisks?\b|^risks?$/i, "risks"],
  [/\b(show|open)\b.*\bplan\b|^plan$/i, "plan"],
  [/\b(show|open)\b.*\boverview\b|^overview$/i, "overview"],
];

function stripLead(s: string): string {
  return s.replace(/^\s*(?:an?\s+)?(?:image|picture|photo|illustration|logo|artwork|drawing|beat|track|song|music|tune|melody|loop)\s+(?:of|for|about)?\s*/i, "").trim() || s.trim();
}

const MAKE_VERB = /\b(build|make|create|code|write|design|give me|i want|i need)\b/i;
// a build verb as an ask: at the start of a sentence, or after "can you", "please", "I want you to"
// (2026-10-28: "each cup costs $1.20 to make", "how do I set up my router?" started builds)
const ASKS_TO_MAKE = /(?:^|[.!?]\s+)(?:(?:hey\s+)?nexy[,\s]+)?(?:please\s+)?(?:(?:can|could|would|will) you\s+(?:please\s+)?|i(?: want|'d like| would like| need) you to\s+|help me\s+|let'?s\s+)?(?:build|create|make|set up|launch|start a project)\b/i;
const REFERS_BACK = /^\s*(?:please\s+)?(?:can you\s+)?make\s+(?:it|that|this|them|those)\s+(?!(?:a|an|into|as)\b)/i;
const OPENS_EXISTING = /^\s*(?:please\s+)?(?:can you\s+)?(?:open|visit|go to|browse|pull up|bring up|load|show me)\s+(?!(?:me\s+)?(?:up\s+)?(?:a|an|new|another)\b)/i;

const DELIVERABLE =
  /\b(app|application|game|canvas|website|web ?site|landing page|web ?page|tool|dashboard|calculator|clone|widget|prototype|one[- ]pager|sell ?sheet)\b/i;

const NO_VIDEO =
  `Making videos isn't in Nexy yet, so there is nothing on ${here} to ask.`;

const INSTALL = /^\s*(?:please\s+)?(?:can you\s+)?install\s+\S/i;
const NO_STORE =
  onOwn1
    ? "I cannot install that from here. The App Store on the desktop lists the apps this Own1 runs, and you can open them there, " +
      "but installing new apps is not switched on yet. Nothing was changed."
    : "I cannot install apps on this computer. Nothing was changed.";

const DESKTOP = /\b(?:clean\s*up|tidy(?:\s*up)?|organi[sz]e|arrange|sort\s+out)\s+(?:my\s+|the\s+)?desktop\b/i;
const NO_DESKTOP =
  "I cannot arrange the desktop from here yet: Nexy has no control over the desktop's windows. Nothing was moved.";
const CLOUD_GPU = /\bcloud\b.*\b(?:gpu|render|compute|faster|power)\b|\b(?:gpu|render|compute)\b.*\bcloud\b|\bmore (?:gpu|power)\b/i;
const STATUS = /^\s*(?:where are we|status|progress|update me|how are we doing|what(?:'s| is) the status|how is (?:it|the project) going)\b[\s?.!]*$/i;
const CLOUD = /\b(?:render|move|migrate|send|upload|offload|run|sync|back\s*up|copy|transfer)\b.*\bown\s?cloud\b/i;
const NO_CLOUD =
  `OwnCloud offload is not connected to this machine yet, so nothing can be sent there. Everything here runs on ${here}. Nothing was changed.`;
const RENDER_VIDEO = /^\s*(?:please\s+)?render\s+(?:the\s+)?(?:shots?|scenes?|frames?|video|film|reel)\b/i;
const NO_RENDER =
  "There is no video renderer in this demo, and OwnCloud offload is not connected, so there is nowhere to render that, locally or remotely. Nothing was started.";
const WORK_LOG = /\bwhat\s+(?:have\s+)?(?:you|we)\s+(?:have\s+)?(?:worked\s+on|done|built|made)\b|\bwhat\s+did\s+(?:you|we)\s+(?:do|work\s+on|make|build)\b(?!\s+(?:to|with|about|in)\b)|\bhow\s+much\s+compute\b/i;
const WORK_REPORT = (s: string) => /\b(worked on|compute|usage|gpu|last 30 days|last month)\b/i.test(s) && /\b(show|what|how much|report)\b/i.test(s);

const DIAGRAM =
  /\b(flow ?chart|flow ?diagram|diagram|org ?chart|mind ?map|sequence diagram|state machine|swimlane)\b/i;

const TEXT_ANSWER = /\b(tables?|csv|list|summary|email|letter|outline|paragraphs?|poem|checklist|budget|breakdown)\b/i;
const NOT_A_DELIVERABLE = /\b(app ?store|install|uninstall|what apps|which apps|my apps)\b/i;

// Only these make a request a project (plan, agents, tasks). Anything else short that
// asks to build something is one deliverable, built directly in minutes.
const PROJECT =
  /\b(projects?|start-?up|roadmap|campaign|go[- ]to[- ]market|investors?|fundrais\w*|milestones?|(?:a|the|full|business|marketing|project|launch) plan|plan (?:it|this|out|everything)|in \d+\s*(?:days?|weeks?|months?))\b/i;

// "wesite", "webiste": one typo must not turn a page into an 11-task project.
const NOUNS = ["website", "webpage", "landing", "dashboard", "calculator", "prototype", "application"];
function near(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
function namesDeliverable(s: string): boolean {
  if (DELIVERABLE.test(s)) return true;
  return s.toLowerCase().split(/[^a-z]+/).some((w) => w.length >= 5 && NOUNS.some((n) => near(w, n)));
}

// a short ask with no verb ("simple wesite for apples") still asks for the thing,
// unless it is a question or about something that already exists
const QUESTION = /\?|^\s*(?:what|how|why|when|where|who|which|can|could|do|does|did|is|are|was|should|would|will|tell|explain)\b/i;
const ABOUT_EXISTING = /\b(?:my|our|your|the|this|that)\s+(?:\w+\s+)?(?:site|website|app|page|game)\b|\b(?:is|was|are|isn't|doesn't|broken|down|slow|error)\b/i;

const PAINT_ASK = /\b(?:i want to|i'd like to|i wanna|let me|can i)\s+(?:draw|paint|sketch|doodle)\b|\bdraw (?:a |some )?paint(?:ing)?\b|\bdrawing (?:pad|board)\b/i;

export function classify(text: string): Intent {
  const s = text.trim();

  if (/^\s*(?:help|what can you do|what do you do)\s*[?.!]*\s*$/i.test(s)) return { kind: "help" };
  const retry = retryOf(s, null);
  if (retry) return retry;
  if (/\b(?:paint|drawing|sketch)\s*(?:app|pad|canvas|workspace)\b|\bcanvas to draw\b|^\s*(?:open\s+)?(?:paint|sketch(?:pad)?)\s*$/i.test(s)) return { kind: "paint" };
  if (PAINT_ASK.test(s) && !DIAGRAM.test(s)) return { kind: "paint" };
  if (/\b(show|what|list|see)\b.*\b(connections?|connected|reach|access)\b/i.test(s)) return { kind: "connections" };
  if (START_PLAN.test(s)) return { kind: "startPlan" };
  if (PAUSE_PLAN.test(s)) return { kind: "pausePlan" };
  if (RESUME_PLAN.test(s)) return { kind: "resumePlan" };
  if (INSTALL.test(s)) return { kind: "unavailable", say: NO_STORE };
  if (/^\s*(?:hey\s+nexy[,\s]+)?(?:please\s+)?(?:can you\s+)?(?:show|give|draw|make|plot)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:bar\s+|line\s+)?(?:graph|chart|plot)\s+(?:of|for|showing|on|about)\b|^\s*(?:plot|chart|graph)\s+(?:the\s+)?\w/i.test(s)) return { kind: "chart" };
  if (/^\s*(?:please\s+)?(?:make|build|write|try)\s+(?:a|me a|it as a)?\s*(?:fully\s+)?custom(?:\s+version)?\b|\bfrom scratch\b|^\s*(?:please\s+)?add (?:the rest|them|those|what(?:'s| is) missing)\b/i.test(s)) return { kind: "customRebuild" };
  if (DESKTOP.test(s)) return { kind: "unavailable", say: NO_DESKTOP };
  if (RENDER_VIDEO.test(s)) return { kind: "unavailable", say: NO_RENDER };
  if (CLOUD.test(s) || CLOUD_GPU.test(s)) return { kind: "unavailable", say: NO_CLOUD };
  if (STATUS.test(s)) return { kind: "status" };
  if (WORK_LOG.test(s)) return { kind: "workLog", days: /\b(?:today)\b/i.test(s) ? 1 : /\bweek\b/i.test(s) ? 7 : 30 };
  if (WORK_REPORT(s)) return { kind: "workLog", days: /\b(?:today)\b/i.test(s) ? 1 : /\bweek\b/i.test(s) ? 7 : 30 };
  const role = ADD_ROLE.exec(s);
  if (role) return { kind: "addRole", role: role[1].trim() };
  for (const [re, tab, say] of VIEWS) if (re.test(s)) return { kind: "view", tab, say };
  for (const [re, view] of CANVAS_VIEWS) {
    if (re.test(s)) {
      return { kind: "canvasView", view, say: `Opened ${view[0].toUpperCase()}${view.slice(1)} on the right.` };
    }
  }

  if (classifyEdit(s)) return { kind: "edit", text: s };

  const add = /^\s*add (?:a )?task:?\s+(.+)$/i.exec(s);
  if (add) return { kind: "addTask", title: add[1].trim() };

  const done = /^\s*(?:mark|set)\s+(.+?)\s+(?:as\s+|to\s+)?(done|complete[d]?|finished|doing|in progress|todo|to do|review)\s*$/i.exec(s);
  if (done) {
    const w = done[2].toLowerCase();
    const state = /doing|progress/.test(w) ? "doing" : /to ?do/.test(w) ? "todo" : w === "review" ? "review" : "done";
    return { kind: "completeTask", title: done[1].trim(), state };
  }

  const assign = /^\s*assign\s+(.+?)\s+to\s+(.+?)\s*$/i.exec(s);
  if (assign) return { kind: "assignTask", title: assign[1].trim(), role: assign[2].trim() };

  const gen = /^(?:please\s+)?(?:can you\s+)?(?:generate|draw|paint|make|create)\s+(?:me\s+)?(?:an?\s+)?(.+)$/i.exec(s);
  if (gen && !/\b(app|application|tool|program|workspace|editor|game|site|website)\b/i.test(gen[1])) {
    const rest = gen[1];
    if (/\b(image|picture|photo|illustration|logo|artwork|drawing)\b/i.test(rest)) {
      return { kind: "generate", medium: "image", prompt: stripLead(rest) };
    }
    if (/\b(beat|track|song|music|tune|melody|loop|pattern|rhythm|groove)\b/i.test(rest)) {
      return { kind: "generate", medium: "audio", prompt: stripLead(rest) };
    }
    if (/\b(video|clip|animation|film)\b/i.test(rest)) {
      return { kind: "unavailable", say: NO_VIDEO };
    }
  }

  if (/^\s*add\b/i.test(s)) return { kind: "chat" };

  if (MAKE_VERB.test(s) && /\b(video|clip|animation|film|reel)\b/i.test(s)) {
    return { kind: "unavailable", say: NO_VIDEO };
  }

  if (DIAGRAM.test(s) && !NOT_A_DELIVERABLE.test(s)) {
    return { kind: "make", brief: s, deliverable: "diagram" };
  }

  // "make it shorter" is about the last reply (or the open page, caught before this); it built a
  // text-shortening app (2026-10-28). "make it a website" still builds.
  if (REFERS_BACK.test(s)) return { kind: "chat" };

  // opening a site that exists is the agent's job, not a build: "open the first one's website"
  // built a new one (2026-10-28). "show me a website for…" still builds.
  if (OPENS_EXISTING.test(s) && !MAKE_VERB.test(s)) return { kind: "chat" };

  const words = s.split(/\s+/).length;
  if (MAKE_VERB.test(s) && namesDeliverable(s) && !NOT_A_DELIVERABLE.test(s) && !PROJECT.test(s) && (!QUESTION.test(s) || ASKS_TO_MAKE.test(s))) {
    return { kind: "make", brief: s, deliverable: "web_app" };
  }
  if (words <= 8 && namesDeliverable(s) && !QUESTION.test(s) && !ABOUT_EXISTING.test(s) && !NOT_A_DELIVERABLE.test(s) && !PROJECT.test(s)) {
    return { kind: "make", brief: s, deliverable: "web_app" };
  }

  // Tables, a list, an email: an answer in the chat, however long the ask. "make two small
  // tables… table 1 = …" ran past 30 words and was taken for a team project (QA 2026-11-12).
  if (ASKS_TO_MAKE.test(s) && TEXT_ANSWER.test(s) && !namesDeliverable(s) && !PROJECT.test(s)) return { kind: "chat" };

  if (ASKS_TO_MAKE.test(s)) {
    // A project only when it reads like one; a short single ask is built directly.
    if (PROJECT.test(s) || /\bstart a project\b/i.test(s) || words > 30 || NOT_A_DELIVERABLE.test(s)) return { kind: "build" };
    return { kind: "make", brief: s, deliverable: "web_app" };
  }

  return { kind: "chat" };
}

// "make an image of a lighthouse, then a website for it" is two jobs; only the first ran
// (2026-10-20). Split only when both halves are work Nexy does, so a question that says
// "then" stays one message. The second half queues like a second message.
const WORK = new Set<Intent["kind"]>(["generate", "make", "chart", "paint", "build"]);
const THEN = /\s*(?:[,;.]\s*)?(?:and\s+)?\bthen\b[,\s]+|\s*[,;.]\s*(?:and\s+)?after that[,\s]+/i;
export function splitTasks(text: string): [string, string] | null {
  const m = THEN.exec(text);
  if (!m) return null;
  const a = text.slice(0, m.index).trim(), b = text.slice(m.index + m[0].length).trim();
  if (a.length < 6 || b.length < 6 || !WORK.has(classify(a).kind)) return null;
  if (WORK.has(classify(b).kind)) return [a, b];
  // "…, then an image of a dog" borrows the first half's verb
  const verb = /^\s*(?:please\s+)?(?:can you\s+)?(generate|draw|paint|make|create|build)\b/i.exec(a)?.[1];
  const b2 = verb && /^(?:an?|one|another|some|the same)\b/i.test(b) ? `${verb} ${b}` : "";
  return b2 && WORK.has(classify(b2).kind) ? [a, b2] : null;
}

// With a built page open, a change to it, not a new build. Before this, "make the background
// darker" hit the build catch-all and rebuilt the whole site from scratch, and "add a pricing
// section" went to chat, which cannot touch the page (design feedback, 2026-10-23). Asking for
// something new ("build me a shop", "a new website") still builds.
const NEW_THING = /\b(?:new|another|different|second|separate|fresh)\s+(?:\w+\s+){0,2}(?:website|site|web ?app|app|game|landing page|diagram|project|plan|deck)\b|\bfrom scratch\b|\bstart (?:over|again)\b|\b(?:build|create|design|make|give|write|generate|draw|plan)\s+(?:me\s+)?(?:a|an)\s/i;
const CHANGES_PAGE = /\b(?:make|change|update|add|remove|delete|drop|use|set|turn|switch|replace|swap|move|put|rename|increase|decrease|enlarge|shrink|redo|fix|tweak|edit|adjust|hide|include|insert|bigger|smaller|larger|darker|lighter|bolder|brighter|rounder|rounded|centre|center|align)\b/i;
const ASKS_ABOUT = /^\s*(?:what|how|why|when|where|who|which|whose|is|are|was|were|does|do|did|has|have|tell me|explain|describe|summari[sz]e)\b/i;
export function asksToChangePage(text: string, kind: Intent["kind"]): boolean {
  if (kind !== "make" && kind !== "build" && kind !== "chat") return false;
  return CHANGES_PAGE.test(text) && !ASKS_ABOUT.test(text) && !NEW_THING.test(text);
}

// "build again" after a build reruns that build's brief, told what went wrong; it built a page
// titled "again" and lost the brief and the error (demo, 2026-11-13).
const RETRY = new RegExp(
  "^\\s*(?:(?:ok(?:ay)?|please|so|hmm|no|nope)[,.!\\s]+)*" +
  "(?:(?:that|it)\\s+(?:didn['’]?t|did not|doesn['’]?t|does not)\\s+work[,.!;\\s]*)?" +
  "(?:(?:can|could|would) you\\s+)?(?:please\\s+)?" +
  "(again|retry|rebuild(?:\\s+(?:it|that|this))?|(?:try|build|do|make|run)(?:\\s+(?:it|that|this))?\\s+again|(?:fix|redo)(?:\\s+(?:it|that|this))?)" +
  "(?:\\s+please)?[\\s.!?]*$", "i");
const NAMES_BUILD = /\b(?:re)?build\b/i;

export const NOTHING_TO_REBUILD = "There is nothing built in this chat yet to build again. What should I build?";

export function fixNote(error: string): string {
  return `The previous build failed its run check with: ${error}. Fix that.`;
}

// last: the chat's last build. A bare "again" or "try again" counts only right after it;
// "fix it" only when it failed. Saying "build" asks for one even with nothing to rebuild.
export function retryOf(text: string, last: LastBuild | null | undefined): Intent | null {
  const m = RETRY.exec(text);
  if (!m) return null;
  const build = NAMES_BUILD.test(text);
  const fix = /^(?:fix|redo)\b/i.test(m[1]);
  if (!last) return build ? { kind: "unavailable", say: NOTHING_TO_REBUILD } : null;
  if (last.next && !build) return null;
  if (fix && last.outcome !== "failed") return null;
  const error = last.outcome === "failed" ? last.error ?? "" : "";
  return { kind: "rebuild", brief: last.brief, deliverable: last.deliverable, error, fix: error ? fixNote(error) : "" };
}
