import { readFileSync, statSync } from "node:fs";
import * as path from "node:path";

const DIR = process.env.NEXY_DATA_DIR ? path.join(process.env.NEXY_DATA_DIR, "overlay") : "/var/lib/nexy/overlay";
const MAX = 4000;
const cache = new Map<string, { mtime: number; text: string }>();

function read(name: string): string {
  const f = path.join(DIR, name);
  try {
    const m = statSync(f).mtimeMs;
    const hit = cache.get(f);
    if (hit && hit.mtime === m) return hit.text;
    const text = readFileSync(f, "utf8").trim().slice(0, MAX);
    cache.set(f, { mtime: m, text });
    return text;
  } catch (e: any) {
    if (e?.code !== "ENOENT") console.warn(`[nexy] overlay ${name} unreadable: ${e?.message ?? e}`);
    return "";
  }
}

export function overlayLines(isEval: boolean): string[] {
  const text = (isEval && read("candidate.md")) || read("active.md");
  return text ? ["", "Standing instructions tuned on this machine from the owner's own feedback:", text] : [];
}
