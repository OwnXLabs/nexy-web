import type { APIRoute } from "astro";
import { get } from "../../../lib/chats";
import { owner } from "../../../lib/owner";

export const prerender = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});
const base = () => process.env.NEXY_PUBLISHER_URL?.replace(/\/$/, "");
const NAME = /^[a-z0-9][a-z0-9-]{1,40}$/;
interface Publication { name: string; run: string; url: string }

async function publisher(path: string, who: string, body?: unknown): Promise<any> {
  const response = await fetch(`${base()}/publish/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-nexy-owner": who, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  if (!response.ok) {
    // the demo publisher answers JSON, the private one plain text; show only the message
    let message = text;
    try { message = JSON.parse(text).error ?? text; } catch { /* plain text */ }
    throw Object.assign(new Error(String(message).slice(0, 300) || "Publisher failed"), { status: response.status });
  }
  return path.startsWith("status?") ? JSON.parse(text) : text;
}

async function target(who: string, chat: string, output: string): Promise<{ run: string; html?: string } | Response> {
  // Never accept a machine-wide run ID from the browser. Resolve an output in
  // this owner's saved conversation, excluding shared examples/private sessions.
  const saved = await get(who, chat);
  const artifact = saved?.outputs?.find((o) => o.id === output);
  if (!artifact) return json({ error: "Save this conversation's website before deploying it." }, 404);
  if (!["html", "game"].includes(artifact.kind)) return json({ error: "Only website and game builds can be deployed." }, 400);
  const run = /^build:([A-Za-z0-9_-]{1,64})$/.exec(artifact.id)?.[1];
  return run ? { run, html: artifact.source } : json({ error: "This output has no saved website build to deploy." }, 400);
}

async function status(run: string, who: string): Promise<{ publications: Publication[] }> {
  const result = await publisher(`status?run=${encodeURIComponent(run)}`, who);
  if (!Array.isArray(result.publications)) throw new Error("Publisher needs the Nexy status API update.");
  const publications = result.publications.filter((p: Publication) => {
    if (p.run !== run || !NAME.test(p.name)) return false;
    try { return ["https:", "http:"].includes(new URL(p.url).protocol); } catch { return false; }
  });
  return { publications };
}
const failure = (e: any) => json({ error: e.message ?? "Publisher unavailable" },
  [400, 404, 409, 422, 429].includes(e.status) ? e.status : 502);

async function session(ctx: Parameters<APIRoute>[0]): Promise<Response | null> {
  const url = process.env.NEXY_PUBLISH_SESSION_URL;
  if (!url) return null; // Private deployment uses its existing nginx owner auth.
  const r = await fetch(url, { headers: { cookie: ctx.request.headers.get("cookie") ?? "" }, signal: AbortSignal.timeout(8_000) });
  return r.status === 204 ? null : json({ error: "Open the Desktop and sign into an active demo session to publish." }, 401);
}

export const GET: APIRoute = async (ctx) => {
  if (!base()) return json({ enabled: false, publications: [] });
  try { const denied = await session(ctx); if (denied) return denied; } catch (e) { return failure(e); }
  const who = owner(ctx);
  const chat = ctx.url.searchParams.get("chat");
  if (!chat) return json({ enabled: true });
  try {
    const output = await target(who, chat, ctx.url.searchParams.get("output") ?? "");
    if (output instanceof Response) return output;
    return json({ enabled: true, servesBuild: !!process.env.NEXY_PUBLISH_SESSION_URL, ...await status(output.run, who) });
  } catch (e) { return failure(e); }
};

export const POST: APIRoute = async (ctx) => {
  // Publishing changes public visibility. Require a same-origin browser request.
  // HTTPS terminates at nginx; Astro may see its loopback HTTP URL. Host still
  // identifies the external app. Do not trust an arbitrary forwarded-host header.
  let sameOrigin = false;
  try {
    const origin = new URL(ctx.request.headers.get("origin") ?? "");
    const configuredOrigin = process.env.NEXY_PUBLISH_ORIGIN;
    sameOrigin = ["https:", "http:"].includes(origin.protocol) && (configuredOrigin
      ? origin.origin === new URL(configuredOrigin).origin
      : origin.host === (ctx.request.headers.get("host") ?? ctx.url.host));
  } catch { /* missing/invalid origin */ }
  if (!sameOrigin) return json({ error: "Same-origin request required." }, 403);
  if (!base()) return json({ error: "Publishing is not configured on this Nexy." }, 503);
  try { const denied = await session(ctx); if (denied) return denied; } catch (e) { return failure(e); }
  const who = owner(ctx);
  let body: any;
  try { body = await ctx.request.json(); } catch { return json({ error: "Body must be JSON." }, 400); }
  if (!body || typeof body !== "object" || !["publish", "unpublish"].includes(body.action)) return json({ error: "Unknown publishing action." }, 400);
  try {
    const output = await target(who, String(body.chat ?? ""), String(body.output ?? ""));
    if (output instanceof Response) return output;
    const { run, html } = output;
    const current = await status(run, who);
    if (body.action === "publish") {
      const name = String(body.name ?? "").trim().toLowerCase();
      if (name && !NAME.test(name)) return json({ error: "Use 2–41 lowercase letters, numbers or hyphens for the address." }, 400);
      if (!current.publications.length) await publisher("publish", who, { run, name, html });
    } else {
      // Read names from the publisher, not the request. Only remove this run's
      // publications, including links created by the standalone management page.
      for (const p of current.publications) await publisher("unpublish", who, { name: p.name, run });
    }
    return json({ enabled: true, ...await status(run, who) });
  } catch (e) { return failure(e); }
};
