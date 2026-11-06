import type { APIRoute } from "astro";
import { Busy, revise } from "../../../lib/revise";

export const prerender = false;

const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const MAX_HTML = 2_000_000;

// change the page open on the right, in place; the client keeps the previous version for undo
export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "body must be JSON" }, 400); }
  const html = String(body?.html ?? "");
  const instruction = String(body?.instruction ?? "").trim();
  if (!html.trim() || !instruction) return json({ error: "html and instruction are required" }, 400);
  if (html.length > MAX_HTML) return json({ error: "that page is too large to edit here" }, 413);
  try {
    const r = await revise(html, instruction, { game: body?.kind === "game" });
    if (!r.applied) return json({ error: "none of the model's changes matched the page", missed: r.missed }, 422);
    return json(r);
  } catch (e) {
    if (e instanceof Busy) return json({ error: e.message }, 429);
    return json({ error: (e as Error).message }, 502);
  }
};
