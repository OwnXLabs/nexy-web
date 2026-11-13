import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import type { NexyEngine } from "./types";
import { gatewayEngine, hermesEngine } from "./hermes";

// Agent engines an owner can pick in Settings. Each speaks the OpenAI chat API plus the
// sessions/jobs API Nexy's gateway client uses (Hermes' API server, Nexy Engine).
// NEXY_ENGINES=hermes,nexy-engine,openclaw with NEXY_ENGINE_<ID>_URL and NEXY_ENGINE_<ID>_KEY_FILE
// (or _KEY). The deploy-time agent (NEXY_AGENT_URL) is always listed, as "hermes" by default.
// NEXY_ENGINE_<ID>_LABEL and _NOTE name an engine in Settings. Where a gate signs people in (Nexy
// Cloud), NEXY_ENGINE_<ID>_USER_URLS="u01=http://…,u02=…" gives a person their own copy of the
// engine, with its own key in NEXY_ENGINE_<ID>_USER_KEYS="u01:<key>,…"; anyone else, or anyone
// without a key, uses the shared one.
export interface EngineChoice { id: string; label: string; note: string; engine: NexyEngine; users?: Map<string, NexyEngine> }

const LABELS: Record<string, [string, string]> = {
  "hermes": ["Hermes", "Nous Research's agent; the default"],
  "nexy-engine": ["Nexy Engine", "OwnX's own small agent engine"],
  "openclaw": ["OpenClaw", "Open-source agent gateway"],
  "ironclaw": ["IronClaw", "NEAR AI's sandboxed agent"],
  "zeroclaw": ["ZeroClaw", "Lightweight agent runtime"],
};
const envKey = (id: string) => id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
function readKey(id: string): string {
  const file = process.env[`NEXY_ENGINE_${envKey(id)}_KEY_FILE`];
  if (file) {
    try { return readFileSync(file, "utf8").trim(); }
    catch (e) { console.warn(`[nexy] engine ${id}: key file unreadable: ${(e as Error).message}`); return ""; }
  }
  return process.env[`NEXY_ENGINE_${envKey(id)}_KEY`] ?? "";
}

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
    if (key) out.set(user, gatewayEngine(url, key, id));
    else console.warn(`[nexy] engine ${id}: no key for ${user}, who uses the shared one`);
  }
  return out;
}

function build(): EngineChoice[] {
  const out: EngineChoice[] = [];
  const base = (process.env.NEXY_AGENT_NAME ?? "hermes").trim() || "hermes";
  if (hermesEngine.available()) out.push(choice(base, hermesEngine));
  for (const raw of (process.env.NEXY_ENGINES ?? "").split(",")) {
    const id = raw.trim().toLowerCase();
    if (!/^[a-z0-9-]{1,32}$/.test(id) || out.some((c) => c.id === id)) continue;
    const url = process.env[`NEXY_ENGINE_${envKey(id)}_URL`] ?? "";
    if (!url) { console.warn(`[nexy] engine ${id}: no NEXY_ENGINE_${envKey(id)}_URL, not listed`); continue; }
    out.push({ ...choice(id, gatewayEngine(url, readKey(id), id)), users: perUser(id) });
  }
  return out;
}
function choice(id: string, engine: NexyEngine): EngineChoice {
  const [label, note] = LABELS[id] ?? [id, "Agent engine on this machine"];
  const k = envKey(id);
  return { id, label: process.env[`NEXY_ENGINE_${k}_LABEL`] || label, note: process.env[`NEXY_ENGINE_${k}_NOTE`] || note, engine };
}

export const ENGINES: EngineChoice[] = build();

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
  return ENGINES.find((c) => c.id === id) ?? ENGINES[0];
}

// the engine for this person: their own copy where they have one, else the shared one
export const engineOf = (c: EngineChoice, user: string | null): NexyEngine =>
  (user && c.users?.get(user)) || c.engine;
