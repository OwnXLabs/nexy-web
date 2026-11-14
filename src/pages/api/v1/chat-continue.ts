import type { APIRoute } from "astro";
import { randomBytes } from "node:crypto";
import { get, put, type SavedChat } from "../../../lib/chats";
import { ENGINES, chosen, labelOf } from "../../../lib/engine";
import { owner } from "../../../lib/owner";

export const prerender = false;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// Continue a saved chat on another engine, which the owner has agreed to share it with: a NEW chat
// on that engine holding the transcript so far, linked to the original. The original keeps its
// engine. An ultra-private chat is never shared: it is not saved, and a request marked private is refused.
export const POST: APIRoute = async (ctx) => {
  const body = await ctx.request.json().catch(() => null) as { from?: unknown; engine?: unknown; private?: unknown } | null;
  if (!body) return json({ error: "body must be JSON" }, 400);
  if (body.private === true) return json({ error: "An ultra-private chat stays on this machine, so it can't be shared with another engine." }, 403);
  const who = owner(ctx);
  const engine = typeof body.engine === "string" ? body.engine : "";
  if (!ENGINES.some((e) => e.id === engine)) return json({ error: "That engine isn't on this machine." }, 400);
  let from: SavedChat | null;
  try { from = await get(who, String(body.from ?? "")); }
  catch (e) { return json({ error: `the chat could not be read: ${(e as Error).message}` }, 500); }
  if (!from) return json({ error: "no such chat" }, 404);
  const was = from.engine ?? chosen(who)?.id;
  if (was === engine) return json({ error: `This chat is already with ${labelOf(engine)}.` }, 400);
  const note = `<div class="feednote" data-continued="${esc(from.id)}">Continued from “${esc(from.title)}”${was ? ` with ${esc(labelOf(was))}` : ""}. ${esc(labelOf(engine))} has its own copy from here.</div>`;
  const chat: SavedChat = {
    id: `c${Date.now().toString(36)}${randomBytes(3).toString("hex")}`.slice(0, 25), pid: from.pid, title: from.title, ts: Date.now(),
    html: note + from.html, history: from.history, projectId: from.projectId, engine, from: { id: from.id, title: from.title },
  };
  try { await put(who, chat, 0); }
  catch (e) { return json({ error: `the chat could not be saved: ${(e as Error).message}` }, 500); }
  return json({ chat });
};
