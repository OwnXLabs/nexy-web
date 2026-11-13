import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import { boxOwner } from "../../../lib/owner";

export const prerender = false;

const DIR = process.env.NEXY_SCREEN_DIR ?? "/var/lib/nexy-screen";
// the same check nginx makes before it lets the stream through
const SESSION = process.env.NEXY_DEMO_SESSION_URL ?? "http://127.0.0.1:4321/api/demo-session";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// "yes" holds the live demo session, "no" does not, "unknown" when no desktop answers
async function session(request: Request): Promise<"yes" | "no" | "unknown"> {
  try {
    const r = await fetch(SESSION, { headers: { cookie: request.headers.get("cookie") ?? "" }, signal: AbortSignal.timeout(3000) });
    return r.ok ? "yes" : "no";
  } catch (e) {
    console.warn("[nexy] demo session check unreachable", (e as Error).message);
    return "unknown";
  }
}

// While a person drives, this file exists and the agent engine pauses its browser: the person
// may be typing a password, so the agent neither acts on the page nor reads it.
const CONTROL = `${DIR}/control/human`;
const driving = () => fs.access(CONTROL).then(() => true, (e: NodeJS.ErrnoException) => {
  if (e.code !== "ENOENT") console.warn("[nexy] screen: control state unreadable", e.message);
  return false;
});
const secret = (name: string) => fs.readFile(`${DIR}/${name}`, "utf8").then((t) => t.trim(), (e: NodeJS.ErrnoException) => {
  if (e.code !== "ENOENT" && e.code !== "EACCES") console.warn(`[nexy] screen: ${name} password unreadable`, e.message);
  return "";
});

// Watching needs the live demo session (no desktop beside this Nexy: local development).
// Whoever may watch may also take control: on the demo that is the one visitor holding the
// slot, on an owner's box the owner. The control password is only handed out by POST.
export const GET: APIRoute = async ({ request }) => {
  const password = await secret("view");
  if (!password) return json({ available: false });
  // local development opts in to watching without a demo session; nowhere else may a failed check open it
  const local = process.env.NEXY_SCREEN_LOCAL === "1" && (await session(request)) === "unknown";
  if (!local && !boxOwner(request) && (await session(request)) !== "yes") return json({ available: true, watch: false, reason: "Sign in to the demo to watch the agent's screen." });
  return json({ available: true, watch: true, control: true, driving: await driving(), password, path: "/screen/ws" });
};

// { take: true } hands the caller the control password and pauses the agent; { release: true }
// gives the screen back. Only the slot holder or the box's signed-in owner, never on a guess:
// with no desktop to ask, nobody may take control.
export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try { body = JSON.parse(await request.text()); } catch (e) { return json({ error: `bad json: ${(e as Error).message}` }, 400); }
  if (!boxOwner(request) && (await session(request)) !== "yes") return json({ error: "Only the person signed in to the demo can use the agent's screen." }, 403);
  if (body?.take === true) {
    const full = await secret("full");
    if (!full) return json({ error: "The agent's screen cannot be controlled on this machine." }, 503);
    try {
      await fs.writeFile(CONTROL, JSON.stringify({ since: Date.now() }), { mode: 0o640 });
    } catch (e) {
      // never hand over control the agent does not know about: it would keep acting under the person
      console.warn("[nexy] screen: could not pause the agent", (e as Error).message);
      return json({ error: "The agent could not be paused, so control stays with it." }, 503);
    }
    return json({ ok: true, driving: true, password: full });
  }
  if (body?.release === true) {
    await fs.rm(CONTROL, { force: true });
    return json({ ok: true, driving: false });
  }
  return json({ error: "take or release" }, 400);
};
