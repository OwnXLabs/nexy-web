import type { APIRoute } from "astro";
import { BetaRefused, context, forward, isBeta, tidy } from "../../../lib/beta-report";
import { count as heldPrivate, owner as sessionOwner } from "./private/_session";

export const prerender = false;

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const PRIVATE = "Reports are off while an ultra-private chat is open.";

// what the preview needs from this side: versions and the scrubbed log tail
export const GET: APIRoute = async (ctx) => {
  if (!isBeta()) return json({ error: "not a beta build" }, 404);
  if (heldPrivate(sessionOwner(ctx)) > 0) return json({ error: PRIVATE }, 409);
  return json(await context());
};

// send to the Nexy team, only when the tester pressed send
export const POST: APIRoute = async (ctx) => {
  if (!isBeta()) return json({ error: "not a beta build" }, 404);
  if (heldPrivate(sessionOwner(ctx)) > 0) return json({ error: PRIVATE }, 409);
  let body: unknown;
  try { body = await ctx.request.json(); } catch { return json({ error: "body must be JSON" }, 400); }
  try {
    return json({ ok: true, ref: await forward(tidy(body)) });
  } catch (e) {
    if (e instanceof BetaRefused) return json({ error: e.message }, e.status);
    console.error("beta report:", e);
    return json({ error: `could not send: ${String((e as Error).message).slice(0, 120)}` }, 500);
  }
};
