import type { APIRoute } from "astro";
import { APPS } from "../../../lib/apps";

export const prerender = false;

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      primitive: "nexy",
      capability: "composite",
      version: "0.1.0",
      endpoints: [
        { method: "GET", path: "/", scope: "read", summary: "the unified surface" },
        { method: "GET", path: "/api/v1/health", scope: "read" },
        { method: "GET", path: "/api/v1/manifest", scope: "read" },
        { method: "GET", path: "/api/v1/feed", scope: "read", summary: "everything the box has made, across apps" },
        { method: "*", path: "/api/apps/{app}/{path}", scope: "proxy", summary: "server-side proxy to an app's own API" },
      ],
      apps: APPS.map((a) => ({ id: a.id, label: a.label, kind: a.kind ?? null, history: !!a.history })),
    }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
