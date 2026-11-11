import type { APIRoute } from "astro";
import { append, clean, clear, list } from "../../../lib/feedback/store";
import { owner } from "../../../lib/owner";
import { count as heldPrivate, owner as sessionOwner } from "./private/_session";
import { wantsEval } from "../../../lib/eval";

export const prerender = false;

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

export const POST: APIRoute = async (ctx) => {
  let body: any;
  try { body = await ctx.request.json(); } catch { return json({ error: "invalid json" }, 400); }
  if (body?.private === true || heldPrivate(sessionOwner(ctx)) > 0) return json({ error: "private", note: "Private turns are never recorded." }, 409);
  if (wantsEval(body?.eval === true)) return json({ ok: true, skipped: "eval" });
  const e = clean(body);
  if (!e) return json({ error: "needs signal and prompt" }, 400);
  try {
    await append(owner(ctx), e);
    return json({ ok: true });
  } catch (err: any) {
    if (err?.name === "PrivateSessionOpen") return json({ error: "private", note: "Private turns are never recorded." }, 409);
    return json({ error: `could not save: ${String(err?.message ?? err).slice(0, 120)}` }, 500);
  }
};

export const GET: APIRoute = async (ctx) => {
  try { return json({ entries: await list(owner(ctx)) }); }
  catch (err: any) { return json({ error: String(err?.message ?? err).slice(0, 120) }, 500); }
};

export const DELETE: APIRoute = async (ctx) => {
  try { await clear(owner(ctx)); return json({ ok: true }); }
  catch (err: any) { return json({ error: String(err?.message ?? err).slice(0, 120) }, 500); }
};
