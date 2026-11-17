import type { APIRoute } from "astro";
import { count as heldPrivate, owner as sessionOwner } from "./private/_session";

export const prerender = false;

// "Add a screenshot" in the desktop app: a picture of Nexy's own window, taken by the app from its
// web view (no browser capture prompt, nothing outside that window). The app serves it beside the
// log tail; elsewhere there is none and the page offers a file instead. Paired phones never reach
// this (the app's phone door refuses it).
const TAIL = process.env.NEXY_LOG_TAIL_URL ?? "";

export const GET: APIRoute = async (ctx) => {
  const plain = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (!TAIL) return plain(404, "no picture of the window here");
  if (heldPrivate(sessionOwner(ctx)) > 0) return plain(409, "Reports are off while an ultra-private chat is open.");
  try {
    const r = await fetch(`${TAIL}/shot`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok || r.headers.get("content-type") !== "image/png") return plain(503, "the app could not take a picture of the window");
    return new Response(await r.arrayBuffer(), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  } catch (e) {
    console.error(`screenshot: the app did not answer: ${(e as Error).message}`);
    return plain(503, "the app could not take a picture of the window");
  }
};
