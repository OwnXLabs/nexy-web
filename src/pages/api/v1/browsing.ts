import type { APIRoute } from "astro";
import { stat } from "node:fs/promises";
import { owner } from "./private/_session";
import { owner as signedOwner } from "../../../lib/owner";
import { engineFor } from "../../../lib/engine";
import { agentSessionKey } from "../../../lib/agent-turn";

export const prerender = false;

const SCREEN = process.env.NEXY_SCREEN_DIR ?? "/var/lib/nexy-screen";

// where the box opens a page on the agent's screen itself (before the agent runs), it leaves a
// request file; the screen should show from that moment, not when the reply arrives
async function openedOnScreen(since: number): Promise<boolean> {
  try { return (await stat(`${SCREEN}/open/request`)).mtimeMs >= since; }
  catch (e: any) {
    if (e?.code !== "ENOENT") console.warn("[nexy] could not read the screen's open request", e?.message);
    return false;
  }
}

const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { "content-type": "application/json", "cache-control": "no-store" } });

// Polled while a reply is on its way: has the agent opened its browser for this chat yet? The
// session key binds the caller, so nobody can ask about another visitor's chat. The first call
// carries no `since` and gets this machine's clock, so a browser's wrong clock cannot matter.
export const GET: APIRoute = async (ctx) => {
  const q = ctx.url.searchParams;
  if (!q.has("since")) return json({ browsing: false, now: Date.now() });
  const session = agentSessionKey(owner(ctx), ctx.cookies.get("own1_demo_sid")?.value, q.get("chat"));
  const since = Number(q.get("since"));
  if (Number.isFinite(since) && await openedOnScreen(since)) return json({ browsing: true });
  const eng = engineFor(false, q.get("eval") === "1", signedOwner(ctx));
  if (!session || !Number.isFinite(since) || !eng.browsed) return json({ browsing: false });
  try {
    return json({ browsing: await eng.browsed(session, since) });
  } catch (e) {
    console.warn("[nexy] could not read the agent's tool use", (e as Error).message);
    return json({ browsing: false });
  }
};
