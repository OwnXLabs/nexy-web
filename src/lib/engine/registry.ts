import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import type { NexyEngine } from "./types";
import { gatewayEngine, hermesEngine } from "./hermes";
import { DEFAULT_AGENT, openclawEngine } from "./openclaw";
import { keyFrom } from "./key";

// Agent engines an owner can pick in Settings. Each speaks the OpenAI chat API plus the
// sessions/jobs API Nexy's gateway client uses (Hermes' API server, Nexy Engine).
// NEXY_ENGINES=hermes,nexy-engine,openclaw with NEXY_ENGINE_<ID>_URL and NEXY_ENGINE_<ID>_KEY_FILE
// (or _KEY). The deploy-time agent (NEXY_AGENT_URL) is always listed, as "hermes" by default.
// NEXY_ENGINE_<ID>_LABEL and _NOTE name an engine in Settings. Where a gate signs people in (Nexy
// Cloud), NEXY_ENGINE_<ID>_USER_URLS="u01=http://…,u02=…" gives a person their own copy of the
// engine, with its own key in NEXY_ENGINE_<ID>_USER_KEYS="u01:<key>,…"; anyone else, or anyone
// without a key, uses the shared one.
// OpenClaw speaks the OpenAI chat API only; NEXY_ENGINE_OPENCLAW_AGENT names its agent target.
// NEXY_DEFAULT_ENGINE=nexy-engine is the engine for anyone who has not picked one; unset, it is the
// deploy-time agent.
export interface EngineChoice { id: string; label: string; note: string; engine: NexyEngine; users?: Map<string, NexyEngine> }

// what an engine keeps that Nexy can show: the UI offers only these
export const capsOf = (e: NexyEngine) => ({ memory: !!e.memory, routines: !!e.routines });

const LABELS: Record<string, [string, string]> = {
  "hermes": ["Hermes", "Nous Research's agent"],
  "nexy-engine": ["Nexy Engine", "OwnX's own small agent engine"],
  "openclaw": ["OpenClaw", "Open-source agent gateway"],
  "ironclaw": ["IronClaw", "NEAR AI's sandboxed agent"],
  "zeroclaw": ["ZeroClaw", "Lightweight agent runtime"],
};
const envKey = (id: string) => id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
const readKey = (id: string): string => keyFrom(`NEXY_ENGINE_${envKey(id)}_KEY_FILE`, `NEXY_ENGINE_${envKey(id)}_KEY`);

const pairs = (v: string | undefined, sep: string): [string, string][] =>
  (v ?? "").split(",").map((p) => p.trim()).filter((p) => p.includes(sep))
    .map((p) => [p.slice(0, p.indexOf(sep)).trim(), p.slice(p.indexOf(sep) + 1).trim()]);
function perUser(id: string): Map<string, NexyEngine> | undefined {
  const urls = pairs(process.env[`NEXY_ENGINE_${envKey(id)}_USER_URLS`], "=");
  if (!urls.length) return undefined;
  const keys = new Map(pairs(process.env[`NEXY_ENGINE_${envKey(id)}_USER_KEYS`], ":"));
  const out = new Map<string, NexyEngine>();
  for (const [user, url] of urls) {
    const key = keys.get(user);
    if (key) out.set(user, engineAt(id, url, key));
    else console.warn(`[nexy] engine ${id}: no key for ${user}, who uses the shared one`);
  }
  return out;
}

// engines that speak as themselves: Nexy's persona, its rules and the identity guard are for Nexy Engine
const OWN_IDENTITY = /^(?:hermes(?:-.*)?|openclaw)$/;
const named = (id: string, e: NexyEngine): NexyEngine => (OWN_IDENTITY.test(id) ? { ...e, ownIdentity: true } : e);

function engineAt(id: string, url: string, key: string): NexyEngine {
  if (id === "openclaw") return named(id, openclawEngine(url, key, process.env.NEXY_ENGINE_OPENCLAW_AGENT?.trim() || DEFAULT_AGENT, id));
  return named(id, gatewayEngine(url, key, id));
}

// the Mac, Windows and phone apps: Nexy and the engine the app starts, nothing else
const COMPUTER = process.env.NEXY_STUDIOS === "off" && process.env.NEXY_PLACE !== "cloud";

function build(): EngineChoice[] {
  const out: EngineChoice[] = [];
  const base = (process.env.NEXY_AGENT_NAME ?? "hermes").trim() || "hermes";
  // the id stays as it was, so the app's saved chats keep their engine
  if (COMPUTER) {
    if (hermesEngine.available()) out.push({ id: base, label: LABELS["nexy-engine"][0], note: LABELS["nexy-engine"][1], engine: hermesEngine });
    return out;
  }
  if (hermesEngine.available()) out.push(choice(base, named(base, hermesEngine)));
  for (const raw of (process.env.NEXY_ENGINES ?? "").split(",")) {
    const id = raw.trim().toLowerCase();
    if (!/^[a-z0-9-]{1,32}$/.test(id) || out.some((c) => c.id === id)) continue;
    const url = process.env[`NEXY_ENGINE_${envKey(id)}_URL`] ?? "";
    if (!url) { console.warn(`[nexy] engine ${id}: no NEXY_ENGINE_${envKey(id)}_URL, not listed`); continue; }
    out.push({ ...choice(id, engineAt(id, url, readKey(id))), users: perUser(id) });
  }
  return out;
}
function choice(id: string, engine: NexyEngine): EngineChoice {
  const [label, note] = LABELS[id] ?? [id, "Agent engine on this machine"];
  const k = envKey(id);
  return { id, label: process.env[`NEXY_ENGINE_${k}_LABEL`] || label, note: process.env[`NEXY_ENGINE_${k}_NOTE`] || note, engine };
}

export const ENGINES: EngineChoice[] = build();

const WANTED = COMPUTER ? "" : (process.env.NEXY_DEFAULT_ENGINE ?? "").trim().toLowerCase();
const configured = WANTED ? ENGINES.find((c) => c.id === WANTED) ?? null : null;
if (WANTED && !configured) console.warn(`[nexy] NEXY_DEFAULT_ENGINE=${WANTED} is not on this machine; the default stays ${ENGINES[0]?.id ?? "the local model"}`);
// the engine of anyone who has not picked one; null only with no engine at all
export const defaultChoice = (): EngineChoice | null => configured ?? ENGINES[0] ?? null;
// the configured default, for paths with no owner; null where none is set or it is missing
export const configuredDefault = (): EngineChoice | null => configured;

// one choice per owner, kept with the owner's other data on this machine
const FILE = process.env.NEXY_DATA_DIR ? path.join(process.env.NEXY_DATA_DIR, "engines.json") : "/var/lib/nexy/engines.json";
let picks: Record<string, string> | null = null;
function load(): Record<string, string> {
  if (picks) return picks;
  try { picks = JSON.parse(readFileSync(FILE, "utf8")) ?? {}; }
  catch (e) {
    // no file yet: nobody has picked. Anything else is said, not silently treated as no picks
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[nexy] engine picks unreadable, using defaults: ${(e as Error).message}`);
    picks = {};
  }
  return picks!;
}
export function pickedId(owner: string): string | null {
  const id = load()[owner];
  return id && ENGINES.some((c) => c.id === id) ? id : null;
}
export function pick(owner: string, id: string): void {
  if (!ENGINES.some((c) => c.id === id)) throw new Error("unknown engine");
  const all = { ...load(), [owner]: id };
  mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
  renameSync(tmp, FILE);
  picks = all;
}
export function chosen(owner: string | null): EngineChoice | null {
  if (!ENGINES.length) return null;
  const id = owner ? pickedId(owner) : null;
  return ENGINES.find((c) => c.id === id) ?? defaultChoice();
}

export const choiceById = (id: string | null | undefined): EngineChoice | null => ENGINES.find((c) => c.id === id) ?? null;
// engines that may answer a fact question from their own memory unless told to search (Nexy Engine searches on its own)
// (Hermes in each of its modes, such as Nexy Cloud's hermes-think)
export const searchesWhenTold = (id: string): boolean => /^hermes(?:-|$)/.test(id) || id === "openclaw";
export const labelOf = (id: string): string => choiceById(id)?.label ?? id;

// the engine for this person: their own copy where they have one, else the shared one
export const engineOf = (c: EngineChoice, user: string | null): NexyEngine =>
  (user && c.users?.get(user)) || c.engine;
