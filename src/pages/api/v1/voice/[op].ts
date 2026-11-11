import type { APIRoute } from "astro";
import { boxAllowed, boxRefused } from "../../../../lib/box";
import { isWav, localVoice, prepare, speak, status, transcribe, voices } from "../../../../lib/voice";

// Speech on this computer, for the same calls the page makes to Own Voice on an Own1:
//   GET status | voices    POST prepare | stt (a WAV) | tts ({ text, voice_id })
export const prerender = false;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const MAX_WAV = 25 * 1024 * 1024; // about 13 minutes at 16 kHz

const guard = (request: Request) =>
  !boxAllowed(request) ? boxRefused() : !localVoice() ? json({ error: "Speech is not set up on this computer." }, 404) : null;

export const GET: APIRoute = async ({ params, request }) => {
  const no = guard(request); if (no) return no;
  if (params.op === "status") return json(status());
  if (params.op === "voices") {
    try { return json({ voices: await voices() }); }
    catch (e: any) { return json({ error: `No voices on this computer: ${String(e?.message ?? e).slice(0, 160)}` }, 502); }
  }
  return json({ error: "unknown" }, 404);
};

export const POST: APIRoute = async ({ params, request }) => {
  const no = guard(request); if (no) return no;
  if (params.op === "prepare") return json(prepare());
  if (params.op === "stt") {
    if (status().state !== "ready") return json({ error: "Speech is still getting ready on this computer.", ...prepare() }, 503);
    const body = new Uint8Array(await request.arrayBuffer());
    if (body.length > MAX_WAV) return json({ error: "That recording is too long." }, 413);
    if (!isWav(body)) return json({ error: "Send the recording as a WAV." }, 415);
    try { return json({ text: await transcribe(body) }); }
    catch (e: any) { return json({ error: String(e?.message ?? e).slice(0, 200) }, 500); }
  }
  if (params.op === "tts") {
    const b = (await request.json().catch(() => ({}))) as { text?: unknown; voice_id?: unknown };
    const text = typeof b.text === "string" ? b.text.trim().slice(0, 4000) : "";
    if (!text) return json({ error: "Nothing to say." }, 400);
    try {
      const wav = await speak(text, typeof b.voice_id === "string" ? b.voice_id : undefined);
      return new Response(new Uint8Array(wav), { headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
    } catch (e: any) { return json({ error: String(e?.message ?? e).slice(0, 200) }, 500); }
  }
  return json({ error: "unknown" }, 404);
};
