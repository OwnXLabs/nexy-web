import type { APIRoute } from "astro";
import { researchChart } from "../../../lib/research";
import { connectorAsk } from "../../../lib/connector-ask";

export const prerender = false;

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
  if (body?.private === true) return json({ error: "private", note: "Web search is off in ultra-private mode: a search would leave this machine." }, 409);
  const question = String(body?.question ?? "").trim();
  if (!question) return json({ error: "missing question" }, 400);
  // the owner's own mail or files are never looked for on the public web
  const own = connectorAsk(question);
  if (own) return json({ error: "own-app", note: `That is about your own ${own.label}, so I won't search the web for it. Ask me to search your ${own.label} and I'll read it there.` }, 409);
  try {
    return json(await researchChart(question));
  } catch (e: any) {
    return json({ error: String(e?.message ?? e).slice(0, 160) }, 502);
  }
};
