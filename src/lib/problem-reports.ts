// Problem reports, saved on this box only: <dir>/<id>.json plus <id>.jpg when there is a
// screenshot, readable by the owner over SSH. Kept identical in nexy/src/lib and
// desktop-demo/src/lib.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

const MAX_SHOT = 3_000_000;       // base64 chars, ~2.2 MB of JPEG
const MAX_REPORTS = 500;          // a full folder refuses more, so it cannot fill the disk
const PER_HOUR = 30;
const KINDS = ["bug", "looks", "idea"];
let recent: number[] = [];

const cut = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : "");
// keep the context's shape, cap every string, and drop anything deeply nested or huge
function tidy(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.slice(0, 2000);
  if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
  if (depth > 5) return null;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => tidy(x, depth + 1));
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as object).slice(0, 50).map(([k, x]) => [k.slice(0, 60), tidy(x, depth + 1)]));
  return null;
}

export class ReportRefused extends Error { constructor(msg: string, readonly status: number) { super(msg); } }

export async function saveReport(dir: string, body: any, extra: Record<string, unknown> = {}): Promise<string> {
  const text = cut(body?.text, 5000).trim();
  const shot = typeof body?.screenshot === "string" ? body.screenshot : "";
  const m = shot.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (shot && !m) throw new ReportRefused("the screenshot must be a JPEG or PNG", 400);
  if (shot.length > MAX_SHOT) throw new ReportRefused("that screenshot is too large", 413);
  if (!text && !m) throw new ReportRefused("say what happened, or add a screenshot", 400);
  const now = Date.now();
  recent = recent.filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_HOUR) throw new ReportRefused("too many reports this hour; try again later", 429);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await fs.readdir(dir)).filter((f) => f.endsWith(".json")).length >= MAX_REPORTS) throw new ReportRefused("the report folder is full; the owner needs to clear it", 507);
  recent.push(now);
  const id = `${new Date(now).toISOString().replace(/[-:]/g, "").slice(0, 15)}-${randomBytes(3).toString("hex")}`;
  if (m) await fs.writeFile(path.join(dir, `${id}.${m[1] === "png" ? "png" : "jpg"}`), Buffer.from(m[2], "base64"), { mode: 0o600 });
  const report = {
    id, at: new Date(now).toISOString(), app: cut(body?.app, 20), kind: KINDS.includes(body?.kind) ? body.kind : "bug",
    text, screenshot: m ? `${id}.${m[1] === "png" ? "png" : "jpg"}` : null, context: tidy(body?.context), ...extra,
  };
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
  return id;
}
