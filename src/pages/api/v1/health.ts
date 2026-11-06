import type { APIRoute } from "astro";
const started = Date.now();
export const prerender = false;
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      status: "ok",
      primitive: "nexy",
      capability: "composite",
      version: "0.1.0",
      uptime_secs: Math.floor((Date.now() - started) / 1000),
      ts: Math.floor(Date.now() / 1000),
    }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
