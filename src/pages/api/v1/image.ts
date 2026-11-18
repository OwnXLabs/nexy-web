// An image made on the shared Own 1 this computer's AI runs on (a guest code, or paired for AI only):
// the app's router takes it to the box, signed like chat and counted like chat. Refusals (the daily
// limit, a code that ended, a box that is down, an image that failed there) come back in the router's
// own words.
import type { APIRoute } from "astro";
import http from "node:http";
import { guestOn, sharedImagesUrl } from "../../../lib/guest";
import { refusal } from "../../../lib/engine/plain-error";

export const prerender = false;

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const SIZES = new Set(["256x256", "512x512", "768x768", "1024x1024"]);
// the router waits up to 420 s for an image on an Own 1 (about 195 s is usual): this waits a little longer
const SHARED_IMAGE_MS = 440_000;

// node:http, not fetch: fetch gives up on a response that has not started after 300 s
function post(url: string, body: string, ms: number): Promise<{ status: number; text: string }> {
  return new Promise((ok, no) => {
    const req = http.request(new URL(url), { method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => { clearTimeout(t); ok({ status: res.statusCode ?? 0, text }); });
      res.on("error", (e) => { clearTimeout(t); no(e); });
    });
    const t = setTimeout(() => req.destroy(new Error(`no image after ${ms / 1000} s`)), ms);
    req.on("error", (e) => { clearTimeout(t); no(e); });
    req.end(body);
  });
}

export const POST: APIRoute = async ({ request }) => {
  const base = sharedImagesUrl();
  if (!base || !base.startsWith("http://")) return json({ error: "not-here" }, 404);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
  if (body?.private === true) return json({ error: "private", note: `Ultra-private is on, and the image would be made on ${guestOn()}. Turn it off to make one.` }, 409);
  const prompt = String(body?.prompt ?? "").trim().slice(0, 1000);
  if (!prompt) return json({ error: "missing prompt" }, 400);
  const size = SIZES.has(body?.size) ? body.size : "512x512";
  const seed = Number.isInteger(body?.seed) ? body.seed : undefined;
  let res: { status: number; text: string };
  try {
    res = await post(`${base}/v1/images/generations`,
      JSON.stringify({ model: "txt2img", prompt, n: 1, size, ...(seed === undefined ? {} : { seed }), response_format: "b64_json" }), SHARED_IMAGE_MS);
  } catch (e: any) {
    console.warn(`[nexy] shared image: ${String(e?.message ?? e).slice(0, 200)}`);
    return json({ error: `${guestOn()} did not answer in time.` }, 504);
  }
  const { status, text } = res;
  if (status < 200 || status >= 300) {
    // the router's refusal: its sentence and status; the raw text only in the log
    console.warn(`[nexy] shared image: ${status} ${text.slice(0, 300)}`);
    const r = refusal(`${status}: ${text}`);
    if (r) return json({ error: "refused", note: r.message }, r.code);
    return json({ error: `${guestOn()} could not make that image.` }, 502);
  }
  let b64 = "";
  try { b64 = String(JSON.parse(text)?.data?.[0]?.b64_json ?? ""); } catch { /* said below */ }
  if (!b64) return json({ error: `${guestOn()} sent no image back.` }, 502);
  return json({ image_b64: b64 });
};
