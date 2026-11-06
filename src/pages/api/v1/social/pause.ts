import type { APIRoute } from "astro";
import { applyPause } from "../../../../lib/social/schedule.ts";
import { log, update } from "../../../../lib/social/store.ts";
import { envelope, json, readJson } from "./_shared.ts";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = (await readJson(request)) ?? {};
  const want = body.paused;
  if (typeof want !== "boolean") return json({ error: "paused must be true or false" }, 400);

  try {
    const { state } = await update((s) => {
      s.paused = want;
      applyPause(s);
      log(s, want ? "autopilot paused" : "autopilot resumed");
    });
    return json(
      envelope(state, {
        paused: state.paused,
        stops:
          "Nothing was running to stop. This is recorded on disk and survives a restart, so a scheduler built later starts from your answer.",
      }),
    );
  } catch (e: any) {
    return json({ error: `that could not be saved, so it will not survive a restart: ${String(e?.message ?? e)}` }, 500);
  }
};
