import type { APIRoute } from "astro";
import { boxOwner, owner } from "../../../lib/owner";
import { boxDeps, busy, page, sse, start } from "../../../lib/swarm-runs";

export const prerender = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});

// Start a swarm build: { prompt } → { id }. Owner only; off unless the box has given a job route.
export const POST: APIRoute = async (ctx) => {
  const deps = boxDeps();
  if (!deps) return json({ error: "building across devices isn't set up on this Own 1 yet" }, 404);
  // only a signed-in Own 1 user: the build runs on the owner's devices
  if (!boxOwner(ctx.request)) return json({ error: "sign in to your Own 1 first" }, 401);
  const who = owner(ctx);
  const body = await ctx.request.json().catch(() => null);
  const prompt = String(body?.prompt ?? "").trim().slice(0, 2000);
  if (!prompt) return json({ error: "say what to build" }, 400);
  if (busy(who)) return json({ error: "a build is already running" }, 429);
  return json({ id: start(who, prompt, deps) });
};

// ?id=… streams progress (and replays it after a dropped connection); add &page=1 for the finished page.
export const GET: APIRoute = (ctx) => {
  const id = ctx.url.searchParams.get("id") ?? "", who = owner(ctx);
  if (ctx.url.searchParams.get("page")) {
    const html = page(id, who);
    if (!html) return json({ error: "not ready" }, 404);
    // the page is model-written: no scripts, no outside requests, even if cleaning missed something
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox" } });
  }
  return sse(id, who) ?? json({ error: "that build is no longer here" }, 404);
};
