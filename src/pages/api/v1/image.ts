// An image made on the shared Own 1 this computer's AI runs on (a guest code, or paired for AI only):
// the app's router takes it to the box, signed like chat and counted like chat. Refusals (the daily
// limit, a code that ended, a box that is down) come back in the router's own words.
import type { APIRoute } from "astro";
import { guestOn, sharedImagesUrl } from "../../../lib/guest";
import { refusal } from "../../../lib/engine/plain-error";

export const prerender = false;

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const SIZES = new Set(["256x256", "512x512", "768x768", "1024x1024"]);

export const POST: APIRoute = async ({ request }) => {
  const base = sharedImagesUrl();
  if (!base) return json({ error: "not-here" }, 404);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
  if (body?.private === true) return json({ error: "private", note: `Ultra-private is on, and the image would be made on ${guestOn()}. Turn it off to make one.` }, 409);
  const prompt = String(body?.prompt ?? "").trim().slice(0, 1000);
  if (!prompt) return json({ error: "missing prompt" }, 400);
  const size = SIZES.has(body?.size) ? body.size : "512x512";
  const seed = Number.isInteger(body?.seed) ? body.seed : undefined;
  let res: Response;
  try {
    res = await fetch(`${base}/v1/images/generations`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "txt2img", prompt, n: 1, size, ...(seed === undefined ? {} : { seed }), response_format: "b64_json" }),
      signal: AbortSignal.timeout(240_000),
    });
  } catch (e: any) {
    console.warn(`[nexy] shared image: ${String(e?.message ?? e).slice(0, 200)}`);
    return json({ error: `${guestOn()} did not answer in time.` }, 504);
  }
  const text = await res.text();
  if (!res.ok) {
    // the router's refusal: its sentence and status; the raw text only in the log
    console.warn(`[nexy] shared image: ${res.status} ${text.slice(0, 300)}`);
    const r = refusal(`${res.status}: ${text}`);
    if (r) return json({ error: "refused", note: r.message }, r.code);
    return json({ error: `${guestOn()} could not make that image.` }, 502);
  }
  let b64 = "";
  try { b64 = String(JSON.parse(text)?.data?.[0]?.b64_json ?? ""); } catch { /* said below */ }
  if (!b64) return json({ error: `${guestOn()} sent no image back.` }, 502);
  return json({ image_b64: b64 });
};
