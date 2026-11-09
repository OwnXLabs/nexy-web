import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import type { NexyEngine } from "./types";
import { gatewayEngine, hermesEngine } from "./hermes";

// Agent engines an owner can pick in Settings. Each speaks the OpenAI chat API plus the
// sessions/jobs API Nexy's gateway client uses (Hermes' API server, Nexy Engine).
// NEXY_ENGINES=hermes,nexy-engine,openclaw with NEXY_ENGINE_<ID>_URL and NEXY_ENGINE_<ID>_KEY_FILE
// (or _KEY). The deploy-time agent (NEXY_AGENT_URL) is always listed, as "hermes" by default.
export interface EngineChoice { id: string; label: string; note: string; engine: NexyEngine }

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

function build(): EngineChoice[] {
  const out: EngineChoice[] = [];
  const base = (process.env.NEXY_AGENT_NAME ?? "hermes").trim() || "hermes";
  if (hermesEngine.available()) out.push(choice(base, hermesEngine));
  for (const raw of (process.env.NEXY_ENGINES ?? "").split(",")) {
    const id = raw.trim().toLowerCase();
    if (!/^[a-z0-9-]{1,32}$/.test(id) || out.some((c) => c.id === id)) continue;
    const url = process.env[`NEXY_ENGINE_${envKey(id)}_URL`] ?? "";
    if (!url) { console.warn(`[nexy] engine ${id}: no NEXY_ENGINE_${envKey(id)}_URL, not listed`); continue; }
    out.push(choice(id, gatewayEngine(url, readKey(id))));
  }
  return out;
}
function choice(id: string, engine: NexyEngine): EngineChoice {
  const [label, note] = LABELS[id] ?? [id, "Agent engine on this machine"];
  return { id, label, note, engine };
}

export const ENGINES: EngineChoice[] = build();

// one choice per owner, kept with the owner's other data on this machine
const FILE = process.env.NEXY_DATA_DIR ? path.join(process.env.NEXY_DATA_DIR, "engines.json") : "/var/lib/nexy/engines.json";
let picks: Record<string, string> | null = null;
function load(): Record<string, string> {
  if (picks) return picks;
  try { picks = JSON.parse(readFileSync(FILE, "utf8")) ?? {}; }
  catch { picks = {}; }
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
