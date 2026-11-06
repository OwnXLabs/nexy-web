import type { APIRoute } from "astro";
import { clean, example, exampleAsset, examples, get, list, put, remove } from "../../../lib/chats";
import { owner } from "../../../lib/owner";

export const prerender = false;

const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// the owner's saved chats; ultra-private chats never reach here
export const GET: APIRoute = async (ctx) => {
  const who = owner(ctx);
  const id = ctx.url.searchParams.get("id");
  try {
    if (!id) return json({ chats: await list(who), examples: await examples() });
    if (ctx.url.searchParams.get("asset") === "open") {
      const a = await exampleAsset(id);
      return a ? new Response(new Uint8Array(a.bytes), { headers: { "content-type": a.type, "cache-control": "public, max-age=86400" } }) : json({ error: "no such example image" }, 404);
    }
    const c = (await get(who, id)) ?? (await example(id));
    return c ? json({ chat: c }) : json({ error: "no such chat" }, 404);
  } catch (e) {
    return json({ error: `chats could not be read: ${(e as Error).message}` }, 500);
  }
};

export const POST: APIRoute = async (ctx) => {
  const who = owner(ctx);
  let body: unknown;
  try { body = await ctx.request.json(); } catch { return json({ error: "body must be JSON" }, 400); }
  const c = clean(body);
  if (!c) return json({ error: "not a chat (bad id, project or size)" }, 400);
  try { await put(who, c); return json({ ok: true, ts: c.ts }); }
  catch (e) { return json({ error: `the chat could not be saved: ${(e as Error).message}` }, 500); }
};

export const DELETE: APIRoute = async (ctx) => {
  const who = owner(ctx);
  try { await remove(who, String(ctx.url.searchParams.get("id") ?? "")); return json({ ok: true }); }
  catch (e) { return json({ error: `the chat could not be deleted: ${(e as Error).message}` }, 500); }
};
