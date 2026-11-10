import type { APIRoute } from "astro";
import { owner } from "../../../lib/owner";
import { sse } from "../../../lib/turns";

export const prerender = false;

// Picks a streamed reply back up after the connection dropped: what is written so far, then the rest.
export const GET: APIRoute = (ctx) => {
  const id = ctx.url.searchParams.get("id") ?? "";
  return sse(id, owner(ctx)) ?? new Response(JSON.stringify({ error: "that reply is no longer here" }), { status: 404, headers: { "content-type": "application/json" } });
};
