import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { ENGINES } from "./engine/registry";

// Nexy Cloud: "Use John's Own 1 when it's free", off by default and kept per signed-in person.
// When on, that person's turns ask the engine for NEXY_OWN1_MODEL, which the model network sends to
// John's Own1 while it is free. Offered only where the shared engine answers the person: an engine
// of their own (a microVM) takes the setting with its next image.
export const OWN1_MODEL = (process.env.NEXY_OWN1_MODEL ?? "").trim();

const FILE = process.env.NEXY_DATA_DIR ? path.join(process.env.NEXY_DATA_DIR, "own1.json") : "/var/lib/nexy/own1.json";
let on: Record<string, boolean> | null = null;
function load(): Record<string, boolean> {
  if (on) return on;
  try { on = JSON.parse(readFileSync(FILE, "utf8")) ?? {}; }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[nexy] Own 1 settings unreadable, all off: ${(e as Error).message}`);
    on = {};
  }
  return on!;
}

export const own1Offered = (user: string | null): user is string =>
  !!OWN1_MODEL && !!user && ENGINES.every((c) => !c.users?.has(user));
export const own1On = (user: string | null): boolean => own1Offered(user) && load()[user] === true;
export function setOwn1(user: string, value: boolean): void {
  const all = { ...load() };
  if (value) all[user] = true; else delete all[user];
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(all), { mode: 0o600 });
  renameSync(`${FILE}.tmp`, FILE);
  on = all;
}
