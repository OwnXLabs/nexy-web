import type { APIRoute } from "astro";
import { shortTitle } from "../../../lib/titles";

export const prerender = false;

const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// a 2-5 word title for a conversation, from its first exchange
export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "body must be JSON" }, 400); }
  const text = String(body?.text ?? "").trim();
  if (!text) return json({ error: "text is required" }, 400);
  try { return json({ title: await shortTitle(text) }); }
  catch (e) { return json({ error: `no title: ${(e as Error).message}` }, 502); }
};
