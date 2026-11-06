import type { APIRoute } from "astro";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const prerender = false;

// Connect the owner's own Telegram bot to Nexy. This writes TELEGRAM_BOT_TOKEN and
// TELEGRAM_ALLOWED_USERS to an env file; the box's Nexy Telegram bridge reads it (and is
// restarted when it changes), so the agent engine itself never talks to Telegram.
//
// Off unless the box sets NEXY_TELEGRAM_ENV, and only answers a signed-in owner
// (xnode-auth identity), so it never appears on a shared demo. The token is written
// once, 0600, and never returned.
const FILE = process.env.NEXY_TELEGRAM_ENV ?? "";
const TRUSTED = process.env.NEXY_TRUST_XNODE_AUTH === "1";
const TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,64}$/;
const USERS = /^\d{4,15}(,\d{4,15})*$/;

const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function allowed(request: Request): Response | null {
  // reading "not set up on this box" is an answer, not an error; changing it is refused
  if (!FILE) return request.method === "GET" ? json({ enabled: false }) : json({ enabled: false, error: "Telegram is not set up on this machine." }, 404);
  if (!TRUSTED || !request.headers.get("xnode-auth-user")) return json({ error: "sign in as the owner first" }, 403);
  return null;
}

async function current(): Promise<{ token?: string; users?: string }> {
  try {
    const text = await readFile(FILE, "utf8");
    const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim();
    return { token: get("TELEGRAM_BOT_TOKEN"), users: get("TELEGRAM_ALLOWED_USERS") };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}

async function botName(token: string): Promise<string> {
  const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10_000) });
  const d = (await r.json().catch(() => null)) as { ok?: boolean; result?: { username?: string }; description?: string } | null;
  if (!r.ok || !d?.ok || !d.result?.username) throw new Error(d?.description ?? `Telegram answered ${r.status}`);
  return d.result.username;
}

export const GET: APIRoute = async ({ request }) => {
  const no = allowed(request);
  if (no) return no;
  try {
    const { token, users } = await current();
    if (!token) return json({ enabled: true, connected: false });
    const bot = await botName(token).catch((e) => `unverified (${(e as Error).message})`);
    return json({ enabled: true, connected: true, bot, users: users ?? "" });
  } catch (e) {
    return json({ error: `could not read the Telegram setting: ${(e as Error).message}` }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  const no = allowed(request);
  if (no) return no;
  let body: { token?: unknown; users?: unknown };
  try { body = await request.json(); } catch { return json({ error: "body must be JSON" }, 400); }
  const token = String(body.token ?? "").trim();
  const users = String(body.users ?? "").replace(/\s+/g, "");
  if (!TOKEN.test(token)) return json({ error: "that does not look like a bot token (it should look like 123456789:AA…)" }, 400);
  if (!USERS.test(users)) return json({ error: "your Telegram user ID is a number (ask @userinfobot); separate several with commas" }, 400);
  let bot: string;
  try { bot = await botName(token); }
  catch (e) { return json({ error: `Telegram rejected the token: ${(e as Error).message}` }, 400); }
  try {
    await mkdir(dirname(FILE), { recursive: true, mode: 0o700 });
    const tmp = `${FILE}.tmp`;
    await writeFile(tmp, `TELEGRAM_BOT_TOKEN=${token}\nTELEGRAM_ALLOWED_USERS=${users}\n`, { mode: 0o600 });
    await rename(tmp, FILE);
  } catch (e) {
    return json({ error: `the token could not be saved: ${(e as Error).message}` }, 500);
  }
  return json({ ok: true, bot });
};

export const DELETE: APIRoute = async ({ request }) => {
  const no = allowed(request);
  if (no) return no;
  try { await rm(FILE, { force: true }); return json({ ok: true }); }
  catch (e) { return json({ error: `could not disconnect: ${(e as Error).message}` }, 500); }
};
