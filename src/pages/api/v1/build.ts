import type { APIRoute } from "astro";
import { owner } from "../../../lib/owner";
import { builderAvailable, busy, start, stream } from "../../../lib/local-build";

export const prerender = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

// Build a website, app or game on this computer: { brief, fix? } → { id }. fix: why the last try failed.
export const POST: APIRoute = async (ctx) => {
  if (!(await builderAvailable())) return json({ error: "building isn't set up on this computer" }, 404);
  const body = await ctx.request.json().catch(() => null);
  const brief = String(body?.brief ?? "").trim().slice(0, 4000);
  if (!brief) return json({ error: "say what to build" }, 400);
  if (busy()) return json({ error: "already building something on this computer" }, 429);
  return json({ id: start(owner(ctx), brief, String(body?.fix ?? "").slice(0, 300)) });
};

// ?id=… streams progress, then the page (replayed after a dropped connection)
export const GET: APIRoute = (ctx) =>
  stream(ctx.url.searchParams.get("id") ?? "", owner(ctx)) ?? json({ error: "that build is no longer here" }, 404);
