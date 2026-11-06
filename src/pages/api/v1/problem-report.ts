import type { APIRoute } from "astro";
import * as path from "node:path";
import { ReportRefused, saveReport } from "../../../lib/problem-reports";
import { owner } from "../../../lib/owner";
import { count as heldPrivate, owner as sessionOwner } from "./private/_session";

export const prerender = false;

const DIR = process.env.NEXY_DATA_DIR ? path.join(process.env.NEXY_DATA_DIR, "reports") : "/var/lib/nexy/reports";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// "Report a problem": saved on this box for its owner, never while an ultra-private chat is open
export const POST: APIRoute = async (ctx) => {
  if (heldPrivate(sessionOwner(ctx)) > 0) return json({ error: "Reports are off while an ultra-private chat is open." }, 409);
  let body: any;
  try { body = await ctx.request.json(); } catch { return json({ error: "body must be JSON" }, 400); }
  try {
    return json({ ok: true, id: await saveReport(DIR, body, { owner: owner(ctx) }) });
  } catch (e) {
    if (e instanceof ReportRefused) return json({ error: e.message }, e.status);
    return json({ error: `could not save: ${String((e as Error).message).slice(0, 120)}` }, 500);
  }
};
