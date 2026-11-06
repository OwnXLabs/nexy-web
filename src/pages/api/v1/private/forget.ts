import type { APIRoute } from "astro";
import { forget, owner } from "./_session";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const forgotten = forget(owner(ctx));
  return new Response(JSON.stringify({ forgotten }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
