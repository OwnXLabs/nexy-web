import type { APIRoute } from "astro";
import { applyPause, plan } from "../../../../lib/social/schedule.ts";
import { log, update } from "../../../../lib/social/store.ts";
import { envelope, json, readJson } from "./_shared.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = (await readJson(request)) ?? {};

  try {
    const { state, result } = await update((s) => {
      const live = s.drafts.filter((d) => !d.off);
      if (!live.length) return { ok: false as const };
      s.schedule = plan(s.drafts, {
        startInDays: body.startInDays,
        perDay: body.perDay,
        times: Array.isArray(body.times) ? body.times.map(String) : undefined,
        cadence: s.cadence,
      });
      applyPause(s);
      log(
        s,
        `${s.schedule.length} post${s.schedule.length === 1 ? "" : "s"} queued — nothing will publish, no network is connected`,
      );
      return { ok: true as const };
    });
    if (!result.ok) return json({ error: "there are no drafts to schedule yet" }, 409);
    return json(envelope(state, { scheduled: state.schedule.length }));
  } catch (e: any) {
    return json({ error: `the schedule could not be saved: ${String(e?.message ?? e)}` }, 500);
  }
};
