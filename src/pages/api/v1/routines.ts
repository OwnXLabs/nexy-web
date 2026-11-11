import type { APIRoute } from "astro";
import { engineFor } from "../../../lib/engine";
import { boxAllowed, boxRefused } from "../../../lib/box";
import { identityOwner } from "../../../lib/owner";
import { wantsEval } from "../../../lib/eval";

export const prerender = false;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const rt = (r: Request) => { const e = engineFor(false, wantsEval(r.headers.get("x-nexy-eval") === "1"), identityOwner(r)); return e.available() ? e.routines : undefined; };
const NONE = "Routines need the agent's scheduler, which is not configured on this machine.";

export const GET: APIRoute = async ({ request }) => {
  if (!boxAllowed(request)) return boxRefused();
  const r = rt(request); if (!r) return json({ error: NONE }, 503);
  try { return json({ routines: await r.list() }); } catch (e: any) { return json({ error: String(e?.message ?? e).slice(0, 200) }, 502); }
};

export const POST: APIRoute = async ({ request }) => {
  if (!boxAllowed(request)) return boxRefused();
  const r = rt(request); if (!r) return json({ error: NONE }, 503);
  let b: any; try { b = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
  if (b?.private === true) return json({ error: "private", note: "A routine keeps its results, so it cannot be made from an ultra-private chat." }, 409);
  const name = String(b?.name ?? "").trim().slice(0, 80), schedule = String(b?.schedule ?? "").trim(), prompt = String(b?.prompt ?? "").trim().slice(0, 2000);
  if (!name || !schedule || !prompt) return json({ error: "name, schedule and prompt are required" }, 400);
  try { return json({ routine: await r.create({ name, schedule, prompt }) }); } catch (e: any) { return json({ error: String(e?.message ?? e).slice(0, 200) }, 502); }
};

export const DELETE: APIRoute = async ({ url, request }) => {
  if (!boxAllowed(request)) return boxRefused();
  const r = rt(request); if (!r) return json({ error: NONE }, 503);
  const id = url.searchParams.get("id"); if (!id) return json({ error: "id required" }, 400);
  try { await r.remove(id); return json({ ok: true }); } catch (e: any) { return json({ error: String(e?.message ?? e).slice(0, 200) }, 502); }
};

// the owner's answer to a routine made while outside content was in the agent's context
export const PATCH: APIRoute = async ({ request }) => {
  if (!boxAllowed(request)) return boxRefused();
  const r = rt(request); if (!r) return json({ error: NONE }, 503);
  let b: any; try { b = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
  const id = String(b?.id ?? "").trim(), action = b?.action;
  if (!id || (action !== "confirm" && action !== "discard")) return json({ error: "id and action (confirm or discard) are required" }, 400);
  if (!r.confirm || !r.discard) return json({ error: "This agent does not hold routines for confirmation." }, 501);
  try {
    if (action === "confirm") return json({ routine: { id, ...(await r.confirm(id)) } });
    await r.discard(id); return json({ ok: true });
  } catch (e: any) { return json({ error: String(e?.message ?? e).slice(0, 200) }, 502); }
};
