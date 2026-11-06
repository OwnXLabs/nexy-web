import type { APIRoute } from "astro";
import { pickDraft, rewriteDraft } from "../../../../lib/social/draft.ts";
import { complete } from "../../../../lib/social/model.ts";
import { parseNetwork, SPECS } from "../../../../lib/social/networks.ts";
import { load, log, update } from "../../../../lib/social/store.ts";
import { envelope, json, readJson } from "./_shared.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await readJson(request);
  if (!body) return json({ error: "bad json" }, 400);

  const net = parseNetwork(body.network);
  const draftId = body.draftId ? String(body.draftId) : undefined;
  if (!net && !draftId) return json({ error: "say which network's draft to rewrite" }, 400);

  const instruction = String(body.instruction ?? "").trim();
  if (!instruction) return json({ error: "say what to change" }, 400);

  const before = await load();
  const target = pickDraft(before.drafts, net ?? "x", draftId);
  if (!target) {
    return json(
      { error: net ? `there is no ${SPECS[net].label} draft yet` : "no draft with that id" },
      404,
    );
  }

  let next;
  try {
    next = await rewriteDraft(target, instruction, complete);
  } catch (e: any) {
    return json({ error: `the model on this machine did not rewrite it: ${String(e?.message ?? e).slice(0, 200)}` }, 502);
  }

  try {
    const { state, result } = await update((s) => {
      const i = s.drafts.findIndex((d) => d.id === target.id);
      if (i < 0) return false;
      s.drafts[i] = next;
      log(s, `${SPECS[next.net].label} draft rewritten: ${instruction.slice(0, 80)}`);
      return true;
    });
    if (!result) return json({ error: "that draft was removed while it was being rewritten" }, 409);
    return json(envelope(state, { rewrote: next.id }));
  } catch (e: any) {
    return json({ error: `rewritten but not saved: ${String(e?.message ?? e)}` }, 500);
  }
};
