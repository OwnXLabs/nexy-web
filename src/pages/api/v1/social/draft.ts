import type { APIRoute } from "astro";
import { draftPosts } from "../../../../lib/social/draft.ts";
import { complete } from "../../../../lib/social/model.ts";
import { parseNetwork } from "../../../../lib/social/networks.ts";
import { load, log, update } from "../../../../lib/social/store.ts";
import { NETWORKS, type Network } from "../../../../lib/social/types.ts";
import { envelope, json, readJson } from "./_shared.ts";
import { refusal } from "../../../../lib/engine/plain-error.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  if (!body) return json({ error: "bad json" }, 400);

  const brief = String(body.brief ?? "").trim();
  if (!brief) return json({ error: "a brief is required" }, 400);

  const asked: unknown[] = Array.isArray(body.networks) ? body.networks : NETWORKS;
  const nets = asked.map(parseNetwork).filter((n): n is Network => !!n);
  if (!nets.length) return json({ error: "no network I recognise; use instagram, linkedin or x" }, 400);

  const unique = [...new Set(nets)];

  let drafts;
  try {
    drafts = await draftPosts({ brief, networks: unique, perNetwork: body.perNetwork, pillars: (await load()).pillars }, complete);
  } catch (e: any) {
    // the router's refusal: its sentence, with its status; the raw text only in the log
    const r = refusal(e);
    if (r) { console.warn(`[nexy] social draft: ${String(e?.message ?? e).slice(0, 400)}`); return json({ error: r.message }, r.code); }
    return json({ error: `the model on this machine did not write the posts: ${String(e?.message ?? e).slice(0, 200)}` }, 502);
  }

  try {
    const { state } = await update((s) => {
      s.drafts.push(...drafts);
      log(s, `${drafts.length} draft${drafts.length === 1 ? "" : "s"} written on this machine`);
    });
    return json(envelope(state, { added: drafts.map((d) => d.id) }));
  } catch (e: any) {
    return json({ error: `the drafts were written but could not be saved: ${String(e?.message ?? e)}` }, 500);
  }
};
