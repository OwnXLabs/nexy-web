import { promises as fs } from "node:fs";
import * as path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { emptyState, NETWORKS, type Draft, type Slot, type SocialState } from "./types.ts";

const DATA_DIR =
  process.env.NEXY_SOCIAL_DATA_DIR ??
  (process.env.NEXY_DATA_DIR ? path.join(process.env.NEXY_DATA_DIR, "social") : "/var/lib/nexy/social");

const OWNER_FILE = path.join(DATA_DIR, "autopilot.json");
export const evalScope = new AsyncLocalStorage<boolean>();
const EVAL_FILE = path.join(DATA_DIR, "autopilot-eval.json");
// One autopilot per owner: nobody sees or edits another owner's drafts.
export const ownerScope = new AsyncLocalStorage<string>();
const OWNER_ID = /^o_[a-z0-9_]{1,48}$/;
const file = () => {
  if (evalScope.getStore()) return EVAL_FILE;
  const who = ownerScope.getStore();
  return who && OWNER_ID.test(who) ? path.join(DATA_DIR, "owners", `${who}.json`) : OWNER_FILE;
};

export const storePath = (): string => file();

function sanitise(raw: unknown): SocialState {
  const s = emptyState();
  const o = (raw ?? {}) as Partial<SocialState>;
  if (!o || typeof o !== "object") return s;

  s.paused = o.paused === true;
  s.createdAt = Number(o.createdAt) || s.createdAt;
  s.updatedAt = Number(o.updatedAt) || s.updatedAt;
  if (o.window && typeof o.window.from === "string" && typeof o.window.to === "string") {
    s.window = { from: o.window.from, to: o.window.to };
  }
  s.pillars = (Array.isArray(o.pillars) ? o.pillars : []).filter((p): p is string => typeof p === "string" && !!p.trim()).map((p) => p.trim().slice(0, 60)).slice(0, 6);
  for (const n of NETWORKS) {
    const v = Number(o.cadence?.[n]);
    if (Number.isInteger(v) && v >= 0 && v <= 7) s.cadence[n] = v;
  }

  s.drafts = (Array.isArray(o.drafts) ? o.drafts : [])
    .filter((d): d is Draft => !!d && typeof d.id === "string" && typeof d.text === "string")
    .map((d) => ({ ...d, off: d.off === true }));

  const ids = new Set(s.drafts.map((d) => d.id));
  s.schedule = (Array.isArray(o.schedule) ? o.schedule : [])
    .filter((x): x is Slot => !!x && typeof x.id === "string" && ids.has(x.draftId))
    .map((x) => ({
      ...x,
      at: Number(x.at) || 0,
      state: x.state === "held" ? "held" : "scheduled",
    }));

  s.log = (Array.isArray(o.log) ? o.log : [])
    .filter((l) => l && typeof l.msg === "string")
    .map((l) => ({ ts: Number(l.ts) || 0, msg: String(l.msg) }))
    .slice(-200);

  return s;
}

let lastError: string | null = null;
export const storeError = (): string | null => lastError;

export async function load(): Promise<SocialState> {
  try {
    const raw = await fs.readFile(file(), "utf8");
    lastError = null;
    return sanitise(JSON.parse(raw));
  } catch (e: any) {
    if (e?.code !== "ENOENT") lastError = `could not read ${file()}: ${String(e?.message ?? e)}`;
    return emptyState();
  }
}

export class PrivateSessionOpen extends Error {
  constructor() {
    super("An ultra-private session is open, so nothing can be saved to this machine. End the session first, or the draft will only live in this page.");
    this.name = "PrivateSessionOpen";
  }
}

let privateOpen = false;
export const setPrivateSession = (open: boolean) => { privateOpen = open; };
export const isPrivateSession = () => privateOpen;

export async function save(s: SocialState): Promise<void> {
  if (privateOpen) throw new PrivateSessionOpen();
  return saveUnchecked(s);
}

async function saveUnchecked(s: SocialState): Promise<void> {
  s.updatedAt = Date.now();
  const clean = sanitise(s);
  clean.updatedAt = s.updatedAt;
  try {
    const target = file();
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(clean, null, 2), "utf8");
    await fs.rename(tmp, target);
    lastError = null;
  } catch (e: any) {
    lastError = `could not write ${file()}: ${String(e?.message ?? e)}`;
    throw new Error(lastError);
  }
}

let chain: Promise<unknown> = Promise.resolve();
export function update<T>(fn: (s: SocialState) => T | Promise<T>): Promise<{ state: SocialState; result: T }> {
  const next = chain.then(async () => {
    const s = await load();
    const result = await fn(s);
    await save(s);
    return { state: s, result };
  });
  chain = next.catch(() => undefined);
  return next;
}

export function log(s: SocialState, msg: string): void {
  s.log.push({ ts: Date.now(), msg });
  if (s.log.length > 200) s.log = s.log.slice(-200);
}

export const _internals = { sanitise, DATA_DIR, FILE: OWNER_FILE };
