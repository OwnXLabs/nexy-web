import type { APIContext, APIRoute } from "astro";
import { byId } from "../../../../lib/apps";
import { COOKIE, owner } from "../../../../lib/owner";
import { refused, studioAuth, wantsToken } from "../../../../lib/studio-token";

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function target(base: string, path: string, search: string): string | null {
  const url = new URL(`${base.replace(/\/$/, "")}/${path.replace(/^\/+/, "")}`);
  const root = new URL(base);
  if (url.origin !== root.origin) return null;
  if (!url.pathname.startsWith(root.pathname.replace(/\/$/, ""))) return null;
  url.search = search;
  return url.toString();
}

const forward = async (ctx: APIContext, who: string) => {
  const { request, params, url } = ctx;
  const app = byId(String(params.app ?? ""));
  if (!app) return json({ error: "unknown app" }, 404);

  const to = target(app.base, String(params.path ?? ""), url.search);
  if (!to) return json({ error: "outside the app" }, 403);

  // the browser's own Authorization is never passed on; the studio's token is added here only
  const headers: Record<string, string> = { cookie: `${app.cookie ?? COOKIE}=${who}`, ...studioAuth(app.id) };
  const ct = request.headers.get("content-type");
  if (ct) headers["content-type"] = ct;

  try {
    const res = await fetch(to, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      signal: AbortSignal.timeout(600_000),
    });
    // a studio that wants a token and refused it: plain words, not "sign in again"
    if (res.status === 401 && wantsToken(app.id)) {
      await res.body?.cancel();
      return json({ error: refused(app.label), app: app.id }, 500);
    }
    return new Response(res.body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "no-store",
        ...(res.headers.get("content-security-policy") ? { "content-security-policy": res.headers.get("content-security-policy")! } : {}),
      },
    });
  } catch (e: any) {
    return json(
      { error: `${app.label} did not answer: ${String(e?.message ?? e).slice(0, 160)}`, app: app.id },
      502,
    );
  }
};

export const GET: APIRoute = (ctx) => forward(ctx, owner(ctx));
export const POST: APIRoute = (ctx) => forward(ctx, owner(ctx));
export const DELETE: APIRoute = (ctx) => forward(ctx, owner(ctx));
export const PATCH: APIRoute = (ctx) => forward(ctx, owner(ctx));
export const PUT: APIRoute = (ctx) => forward(ctx, owner(ctx));
