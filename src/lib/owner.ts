import type { APIContext } from "astro";
import { createHash } from "node:crypto";
import { adopt } from "./chats";

export const COOKIE = "own_owner";

const MAX_AGE = 60 * 60 * 24 * 365;

export const SHAPE = /^o_[a-z0-9]{1,12}_[a-f0-9]{16}$/;

const fresh = () =>
  `o_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

// Behind xnode-auth the signed-in identity IS the owner, so one person's data follows
// them across devices. Only enable where an xnode-auth block guards every path: without
// one, Xnode-Auth-User is just a header anyone can send.
const TRUST_XNODE_AUTH = process.env.NEXY_TRUST_XNODE_AUTH === "1";

export function identityOwner(request: Request): string | null {
  const identity = TRUST_XNODE_AUTH ? request.headers.get("xnode-auth-user") : null;
  return identity ? `o_xauth_${createHash("sha256").update(identity).digest("hex").slice(0, 16)}` : null;
}

export function owner(ctx: APIContext): string {
  const signedIn = identityOwner(ctx.request);
  const existing = ctx.cookies.get(COOKIE)?.value;
  if (signedIn) {
    if (existing && SHAPE.test(existing) && existing !== signedIn)
      adopt(existing, signedIn).catch((e) => console.warn(`[nexy] adopting chats failed: ${(e as Error).message}`));
    return signedIn;
  }

  if (existing && SHAPE.test(existing)) return existing;

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
