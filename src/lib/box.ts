import { boxOwner, identityOwner } from "./owner";

// Whole-box features (the agent's memory across every chat, its scheduled routines) belong to the
// box's owner, not to whoever reached the page. Off unless the deployment says who the owner is:
//   NEXY_BOX_FEATURES=owner  a signed-in xnode-auth identity (needs NEXY_TRUST_XNODE_AUTH=1)
//   NEXY_BOX_FEATURES=open   single-user installs already gated in front (the Nexy app, loopback Docker)
export function boxAllowed(request: Request): boolean {
  const mode = process.env.NEXY_BOX_FEATURES;
  if (mode === "open") return true;
  // a gate user is one of many people, never the owner
  if (mode === "owner") return boxOwner(request) !== null;
  return false;
}

// an engine pick is one person's own: anyone signed in may make theirs, or the box's owner
export const pickAllowed = (request: Request): boolean => boxAllowed(request) || identityOwner(request) !== null;

export const boxRefused = () =>
  new Response(JSON.stringify({ error: "Only the owner of this machine can do this." }), {
    status: 403,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
