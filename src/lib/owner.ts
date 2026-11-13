import type { APIContext } from "astro";
import { createHash } from "node:crypto";
import { adopt } from "./chats";

export const COOKIE = "own_owner";

const MAX_AGE = 60 * 60 * 24 * 365;

// o_xauth_ and o_gate_ ids are derived from a signed-in identity, so a cookie may never carry one
const fromCookie = (v: string | undefined): v is string => !!v && /^o_[a-z0-9]{1,12}_[a-f0-9]{16}$/.test(v) && !/^o_(?:xauth|gate)_/.test(v);

const fresh = () =>
  `o_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

// Behind xnode-auth the signed-in identity IS the owner, so one person's data follows
// them across devices. Only enable where an xnode-auth block guards every path: without
// one, Xnode-Auth-User is just a header anyone can send.
const TRUST_XNODE_AUTH = process.env.NEXY_TRUST_XNODE_AUTH === "1";
// started straight from entry.mjs (serve.mjs warns itself; the app's launcher sets the header at its own door)
if (TRUST_XNODE_AUTH && !process.env.NEXY_SOCKET && process.env.ASTRO_NODE_AUTOSTART !== "disabled")
  console.warn("[nexy] WARNING: NEXY_TRUST_XNODE_AUTH=1 on TCP. Any local process can claim to be the owner; start dist/server/serve.mjs with NEXY_SOCKET.");

// Behind Nexy Cloud's gate each person signs in with their own code, and the gate names them in
// x-nexy-user, dropping any copy a visitor sends. Only enable where that gate is the sole caller
// (NEXY_SOCKET): each person's data is their own, and none of them is the box's owner.
const TRUST_GATE_USER = process.env.NEXY_TRUST_GATE_USER === "1";
if (TRUST_GATE_USER && !process.env.NEXY_SOCKET && process.env.ASTRO_NODE_AUTOSTART !== "disabled")
  console.warn("[nexy] WARNING: NEXY_TRUST_GATE_USER=1 on TCP. Any local process can name a user; start dist/server/serve.mjs with NEXY_SOCKET.");

const hashed = (kind: string, id: string) => `o_${kind}_${createHash("sha256").update(id).digest("hex").slice(0, 16)}`;

// the person the gate signed in, as the gate names them ("u01"); null without a trusted gate
export function gateUser(request: Request): string | null {
  const u = TRUST_GATE_USER ? request.headers.get("x-nexy-user") : null;
  return u && /^[A-Za-z0-9_-]{1,32}$/.test(u) ? u : null;
}

// the box's owner, signed in through xnode-auth: whole-box features are theirs alone
export function boxOwner(request: Request): string | null {
  const identity = TRUST_XNODE_AUTH ? request.headers.get("xnode-auth-user") : null;
  return identity ? hashed("xauth", identity) : null;
}

// whoever is signed in, the box's owner or a gate's user: whose chats and picks these are
export function identityOwner(request: Request): string | null {
  const u = gateUser(request);
  return u ? hashed("gate", u) : boxOwner(request);
}

export function owner(ctx: APIContext): string {
  const signedIn = identityOwner(ctx.request);
  const existing = ctx.cookies.get(COOKIE)?.value;
  if (signedIn) {
    // a gate's user may be on a shared browser: what it made before sign-in stays with the browser
    if (fromCookie(existing) && existing !== signedIn && !gateUser(ctx.request))
      adopt(existing, signedIn).catch((e) => console.warn(`[nexy] adopting chats failed: ${(e as Error).message}`));
    return signedIn;
  }

  if (fromCookie(existing)) return existing;

  const id = fresh();
  const domain = process.env.OWN_OWNER_DOMAIN || undefined;
  ctx.cookies.set(COOKIE, id, {
    path: "/",
    maxAge: MAX_AGE,
    ...(domain ? { domain: `.${domain}` } : {}),
    sameSite: "lax",
    httpOnly: true,
    secure: ctx.url.protocol === "https:",
  });
  return id;
}
