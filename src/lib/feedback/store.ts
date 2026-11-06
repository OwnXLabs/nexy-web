import { promises as fs } from "node:fs";
import * as path from "node:path";
import { isPrivateSession, PrivateSessionOpen } from "../social/store.ts";

const DIR = process.env.NEXY_DATA_DIR ? path.join(process.env.NEXY_DATA_DIR, "feedback") : "/var/lib/nexy/feedback";

export type Signal = "up" | "down" | "frustration" | "runError" | "rephrase";
export interface Entry {
  at: number; signal: Signal; prompt: string; reply?: string; note?: string;
  artifact?: string; error?: string; intent?: string;
}

const file = (owner: string) => path.join(DIR, `${owner.replace(/[^\w-]/g, "_").slice(0, 64) || "owner"}.jsonl`);
const cut = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : undefined);
const SIGNALS: Signal[] = ["up", "down", "frustration", "runError", "rephrase"];

export function clean(raw: any): Entry | null {
  if (!raw || !SIGNALS.includes(raw.signal)) return null;
  const prompt = cut(raw.prompt, 2000);
  if (!prompt) return null;
  return { at: Date.now(), signal: raw.signal, prompt, reply: cut(raw.reply, 2000), note: cut(raw.note, 1000),
    artifact: cut(raw.artifact, 40), error: cut(raw.error, 300), intent: cut(raw.intent, 40) };
}

export async function append(owner: string, e: Entry): Promise<void> {
  if (isPrivateSession()) throw new PrivateSessionOpen();
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.appendFile(file(owner), `${JSON.stringify(e)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function list(owner: string, limit = 200): Promise<Entry[]> {
  try {
    const t = await fs.readFile(file(owner), "utf8");
    return t.trim().split("\n").filter(Boolean).slice(-limit).map((l) => JSON.parse(l) as Entry).reverse();
  } catch (e: any) {
    if (e?.code === "ENOENT") return [];
    throw e;
  }
}

export async function clear(owner: string): Promise<void> {
  await fs.rm(file(owner), { force: true });
}
