import { engineFailure } from "../../../lib/engine/plain-error";
import type { APIContext, APIRoute } from "astro";
import { engineFor } from "../../../lib/engine";
import { boxAllowed, boxRefused } from "../../../lib/box";
import { owner } from "../../../lib/owner";
import { wantsEval } from "../../../lib/eval";

export const prerender = false;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// the engine this owner's chats use; null when none is configured, "none" when it keeps no memory
const mem = (ctx: APIContext) => {
  const e = engineFor(false, wantsEval(ctx.request.headers.get("x-nexy-eval") === "1"), owner(ctx));
  return !e.available() ? null : e.memory ?? "none";
};
const NONE = "The agent engine picked in Settings keeps no memory Nexy can show.";
const NOT_SET = "The agent that keeps memory is not configured on this machine.";

export const GET: APIRoute = async (ctx) => {
  const { url, request } = ctx;
  if (!boxAllowed(request)) return boxRefused();
  const m = mem(ctx);
  if (!m) return json({ error: NOT_SET }, 503);
  if (m === "none") return json({ available: false, note: NONE, items: [], sessions: [] });
  try {
    return url.searchParams.get("export") === "1" ? json({ exportedAt: new Date().toISOString(), sessions: await m.export() }) : json({ items: await m.list() });
  } catch (e: any) { return json(engineFailure(e, "memory"), 502); }
};

export const DELETE: APIRoute = async (ctx) => {
  const { url, request } = ctx;
  if (!boxAllowed(request)) return boxRefused();
  const m = mem(ctx);
  if (!m) return json({ error: NOT_SET }, 503);
  if (m === "none") return json({ available: false, note: NONE, forgotten: 0 });
  const id = url.searchParams.get("id") ?? undefined;
  if (!id && url.searchParams.get("all") !== "1") return json({ error: "name one conversation (id) or all=1" }, 400);
  try { return json({ forgotten: await m.forget(id) }); }
  catch (e: any) { return json(engineFailure(e, "memory"), 502); }
};
