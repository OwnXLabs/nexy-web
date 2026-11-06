import type { APIRoute } from "astro";
import { log, update } from "../../../../lib/social/store.ts";
import { NETWORKS } from "../../../../lib/social/types.ts";
import { envelope, json, readJson } from "./_shared.ts";

export const prerender = false;

const TIME = /^\d{1,2}:\d{2}$/;

export const POST: APIRoute = async ({ request }) => {
  const body = (await readJson(request)) ?? {};
  try {
    const { state } = await update((s) => {
      if (Array.isArray(body.pillars)) {
        s.pillars = body.pillars.filter((p: unknown): p is string => typeof p === "string" && !!p.trim()).map((p: string) => p.trim().slice(0, 60)).slice(0, 6);
        log(s, `pillars set: ${s.pillars.join(", ") || "none"}`);
      }
      if (body.cadence && typeof body.cadence === "object") {
        for (const n of NETWORKS) {
          const v = Number(body.cadence[n]);
          if (Number.isInteger(v) && v >= 0 && v <= 7) s.cadence[n] = v;
        }
        log(s, `cadence: ${NETWORKS.map((n) => `${n} ${s.cadence[n]}/week`).join(", ")}`);
      }
      if (body.window && TIME.test(String(body.window.from)) && TIME.test(String(body.window.to))) {
        s.window = { from: String(body.window.from), to: String(body.window.to) };
        log(s, `posting window ${s.window.from} to ${s.window.to}`);
      }
    });
    return json(envelope(state));
  } catch (e) {
    return json({ error: `that could not be saved: ${(e as Error).message}` }, 500);
  }
};
