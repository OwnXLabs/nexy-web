import type { APIRoute } from "astro";
import { randomUUID } from "node:crypto";
import { logTurn, whereIn } from "../../../lib/turn-log.ts";
import { plainError } from "../../../lib/chat-output.ts";

export const prerender = false;

const KINDS = new Set(["web_app", "diagram", "game"]);
const BUILDERS = new Set(["own-build", "engine"]);

// A build that failed its run check or stopped with an error, as one turn line: the build's id,
// kind, the brief's length (never its text), how long it took and the error. The build's own
// files live in memory on the box and go with a restart; this line stays.
export const POST: APIRoute = async ({ request }) => {
  const b = await request.json().catch(() => null);
  const full = typeof b?.error === "string" ? b.error.replace(/\s+/g, " ").trim() : "";
  // the line number only, never the code on it
  const error = plainError(full).slice(0, 300);
  const build = typeof b?.build === "string" && /^[\w:.-]{1,120}$/.test(b.build) ? b.build : "";
  if (!error || !build) return new Response(JSON.stringify({ error: "build and error required" }), { status: 400, headers: { "content-type": "application/json" } });
  const where = whereIn(full);
  logTurn("build", {
    turn: randomUUID().slice(0, 8), result: "build-failed", build,
    kind: KINDS.has(b.kind) ? b.kind : "web_app",
    builder: BUILDERS.has(b.builder) ? b.builder : "own-build",
    briefChars: Number.isFinite(b.briefChars) ? Math.max(0, Math.round(b.briefChars)) : 0,
    ms: Number.isFinite(b.ms) ? Math.max(0, Math.round(b.ms)) : 0,
    error, ...(where ? { where } : {}),
  });
  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};
