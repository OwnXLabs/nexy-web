import type { APIRoute } from "astro";
import { gateUser } from "../../../lib/owner";
import { own1Offered, own1On, setOwn1 } from "../../../lib/own1";

export const prerender = false;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// this person's "Use the home network when it's free": offered only on Nexy Cloud, to a signed-in person
export const GET: APIRoute = async (ctx) => {
  const user = gateUser(ctx.request);
  return json({ offered: own1Offered(user), on: own1On(user) });
};

export const POST: APIRoute = async (ctx) => {
  const user = gateUser(ctx.request);
  if (!own1Offered(user)) return json({ error: "Not offered here." }, 404);
  const body = await ctx.request.json().catch(() => null);
  if (typeof body?.on !== "boolean") return json({ error: "on must be true or false" }, 400);
  setOwn1(user, body.on);
  return json({ on: body.on });
};
