import type { APIRoute } from "astro";
import { clean, Conflict, StorageFull, example, exampleAsset, examples, get, list, put, remove } from "../../../lib/chats";
import { owner } from "../../../lib/owner";
import { enginesShown } from "../../../lib/box";
import { ENGINES, chosen } from "../../../lib/engine";

export const prerender = false;

const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// a chat's engine stays on disk; the client sees it only where it may pick one
const hide = <T extends { engine?: string }>(c: T): T => { const { engine: _, ...rest } = c; return rest as T; };

// the owner's saved chats; ultra-private chats never reach here
export const GET: APIRoute = async (ctx) => {
  const who = owner(ctx);
  const shown = enginesShown(ctx.request);
  const id = ctx.url.searchParams.get("id");
  try {
    if (!id) {
      const chats = await list(who);
      return json({ chats: shown ? chats : chats.map(hide), examples: await examples() });
    }
    if (ctx.url.searchParams.get("asset") === "open") {
      const a = await exampleAsset(id);
      return a ? new Response(new Uint8Array(a.bytes), { headers: { "content-type": a.type, "cache-control": "public, max-age=86400" } }) : json({ error: "no such example image" }, 404);
    }
    const c = (await get(who, id)) ?? (await example(id));
    return c ? json({ chat: shown ? c : hide(c) }) : json({ error: "no such chat" }, 404);
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
  const b = (body as { base?: unknown }).base;
  // a new chat keeps the engine it was started on; one this machine does not run is not taken
  // only Continue (chat-continue.ts) links a chat to the one it came from
  c.from = undefined;
  if (c.engine && !ENGINES.some((e) => e.id === c.engine)) c.engine = undefined;
  try { await put(who, c, typeof b === "number" && Number.isFinite(b) ? b : 0, chosen(who)?.id); return json({ ok: true, ts: c.ts, ...(c.engine && enginesShown(ctx.request) ? { engine: c.engine } : {}) }); }
  catch (e) {
    if (e instanceof Conflict) return json({ error: e.message, ts: e.current }, 409);
    if (e instanceof StorageFull) return json({ error: e.message }, 507);
    return json({ error: `the chat could not be saved: ${(e as Error).message}` }, 500);
  }
};

export const DELETE: APIRoute = async (ctx) => {
  const who = owner(ctx);
  try { await remove(who, String(ctx.url.searchParams.get("id") ?? "")); return json({ ok: true }); }
  catch (e) { return json({ error: `the chat could not be deleted: ${(e as Error).message}` }, 500); }
};
