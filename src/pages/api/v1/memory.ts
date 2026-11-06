import type { APIRoute } from "astro";
import { engineFor } from "../../../lib/engine";

export const prerender = false;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const mem = (r: Request) => { const e = engineFor(false, r.headers.get("x-nexy-eval") === "1"); return e.available() ? e.memory : undefined; };

export const GET: APIRoute = async ({ url, request }) => {
  const m = mem(request);
  if (!m) return json({ error: "The agent that keeps memory is not configured on this machine." }, 503);
  try {
    return url.searchParams.get("export") === "1" ? json({ exportedAt: new Date().toISOString(), sessions: await m.export() }) : json({ items: await m.list() });
  } catch (e: any) { return json({ error: String(e?.message ?? e).slice(0, 200) }, 502); }
};

export const DELETE: APIRoute = async ({ url, request }) => {
  const m = mem(request);
  if (!m) return json({ error: "The agent that keeps memory is not configured on this machine." }, 503);
  const id = url.searchParams.get("id") ?? undefined;
  if (!id && url.searchParams.get("all") !== "1") return json({ error: "name one conversation (id) or all=1" }, 400);
  try { return json({ forgotten: await m.forget(id) }); }
  catch (e: any) { return json({ error: String(e?.message ?? e).slice(0, 200) }, 502); }
};
