import type { APIRoute } from "astro";
import { ENGINES, chosen, pick } from "../../../lib/engine";
import { owner } from "../../../lib/owner";
import { boxRefused, pickAllowed as allowed } from "../../../lib/box";

export const prerender = false;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// the agent engines on this machine, and which one this owner's chats use
export const GET: APIRoute = async (ctx) => {
  if (!allowed(ctx.request)) return boxRefused();
  const c = chosen(owner(ctx));
  return json({ engines: ENGINES.map((e) => ({ id: e.id, label: e.label, note: e.note })), selected: c?.id ?? null });
};

export const POST: APIRoute = async (ctx) => {
  if (!allowed(ctx.request)) return boxRefused();
  const body = await ctx.request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  try { pick(owner(ctx), id); }
  catch (e) { return json({ error: (e as Error).message }, 400); }
  return json({ selected: id });
};
