import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { ENGINES } from "./engine/registry";

// Nexy Cloud's model network, per signed-in person. Text and code go to John's Own1 while it is free,
// on by default ("Use John's Own 1 when it's free" turns it off: the local model alone). Paid boost
// (cloud providers first) is a per-person flag, off for everyone until payment exists. Nexy asks the
// engine for NEXY_NETWORK_MODEL plus "+boost" and/or "+own1"; the bare name is the local model.
// Only where the shared engine answers the person: an engine of their own (a microVM) takes it with
// its next image.
export const NETWORK_MODEL = (process.env.NEXY_NETWORK_MODEL ?? "").trim();
export const OWN1_NOTICE = "Your messages are answered on a computer in John's home: best effort for performance, no privacy guarantees.";

type Prefs = { own1?: false; boost?: true; noticed?: true };
const FILE = process.env.NEXY_DATA_DIR ? path.join(process.env.NEXY_DATA_DIR, "network.json") : "/var/lib/nexy/network.json";
let all: Record<string, Prefs> | null = null;
function load(): Record<string, Prefs> {
  if (all) return all;
  try { all = JSON.parse(readFileSync(FILE, "utf8")) ?? {}; }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[nexy] model network settings unreadable, defaults used: ${(e as Error).message}`);
    all = {};
  }
  return all!;
}
function save(user: string, p: Prefs): void {
  const next = { ...load(), [user]: p };
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(next), { mode: 0o600 });
  renameSync(`${FILE}.tmp`, FILE);
  all = next;
}

export const own1Offered = (user: string | null): user is string =>
  !!NETWORK_MODEL && !!user && ENGINES.every((c) => !c.users?.has(user));
export const own1On = (user: string | null): boolean => own1Offered(user) && load()[user]?.own1 !== false;
export const boostPaid = (user: string | null): boolean => own1Offered(user) && load()[user]?.boost === true;
export function setOwn1(user: string, on: boolean): void {
  const { own1: _, ...rest } = load()[user] ?? {};
  save(user, on ? rest : { ...rest, own1: false });
}
// the model this person's turn asks the engine for; undefined: the engine's own (the local model)
export function networkModel(user: string | null): string | undefined {
  const flags = (boostPaid(user) ? "+boost" : "") + (own1On(user) ? "+own1" : "");
  return flags ? NETWORK_MODEL + flags : undefined;
}
// true once per person, the first time a turn of theirs may go to John's Own1
export function firstOwn1Use(user: string | null): boolean {
  if (!own1On(user) || load()[user as string]?.noticed) return false;
  save(user as string, { ...load()[user as string], noticed: true });
  return true;
}
