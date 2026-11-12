import type { APIRoute } from "astro";
import { engineFor } from "../../../lib/engine";
import { boxAllowed, boxRefused } from "../../../lib/box";
import { identityOwner } from "../../../lib/owner";
import { wantsEval } from "../../../lib/eval";
import { ownerZone } from "../../../lib/tz";

export const prerender = false;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const rt = (r: Request) => { const e = engineFor(false, wantsEval(r.headers.get("x-nexy-eval") === "1"), identityOwner(r)); return e.available() ? e.routines : undefined; };
const NONE = "Routines need the agent's scheduler, which is not configured on this machine.";
// the owner's zone from the request body: a name, undefined when none, or a 400 for one nobody knows
const zoneOf = (b: any): string | undefined | Response => {
  try { return ownerZone(b?.tz) ?? undefined; }
  catch (e) { if (e instanceof RangeError) return json({ error: `unknown time zone: ${e.message}`.slice(0, 200) }, 400); throw e; }
};

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
  const tz = zoneOf(b); if (tz instanceof Response) return tz;
  const utcSchedule = String(b?.utcSchedule ?? "").trim() || undefined;
  try { return json({ routine: await r.create({ name, schedule, prompt, tz, utcSchedule }) }); } catch (e: any) { return json({ error: String(e?.message ?? e).slice(0, 200) }, 502); }
};

export const DELETE: APIRoute = async ({ url, request }) => {
  if (!boxAllowed(request)) return boxRefused();
  const r = rt(request); if (!r) return json({ error: NONE }, 503);
  const id = url.searchParams.get("id"); if (!id) return json({ error: "id required" }, 400);
  try { await r.remove(id); return json({ ok: true }); } catch (e: any) { return json({ error: String(e?.message ?? e).slice(0, 200) }, 502); }
};

// the owner's answer to a routine made while outside content was in the agent's context, the
// owner pausing and resuming one, or running one now
export const PATCH: APIRoute = async ({ request }) => {
  if (!boxAllowed(request)) return boxRefused();
  const r = rt(request); if (!r) return json({ error: NONE }, 503);
  let b: any; try { b = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
  const id = String(b?.id ?? "").trim(), action = b?.action;
  if (id && action === "run") {
    if (!r.runNow) return json({ error: "This agent cannot run a routine on request." }, 501);
    try { return json({ run: { id, ...(await r.runNow(id)) } }); }
    catch (e: any) { return json({ error: String(e?.message ?? e).slice(0, 200) }, 502); }
  }
  if (id && (action === "pause" || action === "resume")) {
    if (!r.setPaused) return json({ error: "This agent cannot pause routines." }, 501);
    try { return json({ routine: { id, ...(await r.setPaused(id, action === "pause")) } }); }
    catch (e: any) { return json({ error: String(e?.message ?? e).slice(0, 200) }, 502); }
  }
  if (!id || (action !== "confirm" && action !== "discard")) return json({ error: "id and action (confirm, discard, pause, resume or run) are required" }, 400);
  if (!r.confirm || !r.discard) return json({ error: "This agent does not hold routines for confirmation." }, 501);
  const tz = zoneOf(b); if (tz instanceof Response) return tz;
  try {
    if (action === "confirm") return json({ routine: { id, ...(await r.confirm(id, tz)) } });
    await r.discard(id); return json({ ok: true });
  } catch (e: any) { return json({ error: String(e?.message ?? e).slice(0, 200) }, 502); }
};
