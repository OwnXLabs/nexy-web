import { readFileSync } from "node:fs";

// A studio in its own container wants a service token: NEXY_<STUDIO>_TOKEN_FILE holds it, sent as
// Bearer to that studio only. Read at call time with a short cache, so a rotation needs no restart.
// Unset: no header, as before. The token never goes to the browser, another studio or a log.
const TTL_MS = 5_000;
const cache = new Map<string, { at: number; token: string }>();

export const tokenVar = (id: string) => `NEXY_${id.toUpperCase()}_TOKEN_FILE`;

/** Whether this studio is set up to need a token (the file is named, readable or not). */
export const wantsToken = (id: string): boolean => !!process.env[tokenVar(id)];

function token(id: string): string {
  const v = tokenVar(id), file = process.env[v];
  if (!file) return "";
  const hit = cache.get(v);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.token;
  let t = "";
  try { t = readFileSync(file, "utf8").trim(); }
  catch (e) { console.warn(`[nexy] ${v} unreadable (${(e as NodeJS.ErrnoException).code ?? "error"}); calls go without a token`); }
  cache.set(v, { at: Date.now(), token: t });
  return t;
}

/** The Authorization header for one studio's server-side calls, or none. */
export function studioAuth(id: string): Record<string, string> {
  const t = token(id);
  return t ? { authorization: `Bearer ${t}` } : {};
}

/** What the owner sees when a studio with a token set refuses Nexy. */
export const refused = (label: string) =>
  `${label} turned Nexy away: its service key on this Own 1 is missing or out of date. The Own 1's settings need fixing; nothing you did.`;
