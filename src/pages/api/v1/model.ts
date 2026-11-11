import type { APIRoute } from "astro";
import { readFile } from "node:fs/promises";

export const prerender = false;

// While the app that hosts Nexy is still downloading its model, it writes
// {"model": "<name>", "completed": <bytes>, "total": <bytes>} to NEXY_MODEL_STATUS.
// No file (or no setting) means the model is ready.
const FILE = process.env.NEXY_MODEL_STATUS ?? "";

const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const GET: APIRoute = async () => {
  if (!FILE) return json({ ready: true });
  let raw: string;
  try { raw = await readFile(FILE, "utf8"); }
  catch (e: any) {
    if (e?.code !== "ENOENT") console.warn("[nexy] model status unreadable:", e?.message);
    return json({ ready: true });
  }
  try {
    const s = JSON.parse(raw) as { model?: unknown; completed?: unknown; total?: unknown };
    const total = Number(s.total) || 0, done = Number(s.completed) || 0;
    if (total > 0 && done >= total) return json({ ready: true });
    return json({ ready: false, model: String(s.model ?? "the model").slice(0, 60), progress: total > 0 ? Math.max(0, Math.min(99, Math.floor((done / total) * 100))) : 0 });
  } catch (e) {
    console.warn("[nexy] model status is not JSON:", (e as Error).message);
    return json({ ready: true });
  }
};
