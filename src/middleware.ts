import { defineMiddleware } from "astro:middleware";
import { evalScope, ownerScope } from "./lib/social/store.ts";
import { owner } from "./lib/owner";
import { wantsEval } from "./lib/eval";
import { capFor, hostAllowed, misdirected, overCap, tooLarge } from "./lib/gate";

export const onRequest = defineMiddleware(async (ctx, next) => {
  if (!hostAllowed(ctx.request.headers.get("host"))) return misdirected();
  const cap = capFor(ctx.url.pathname);
  if (await overCap(ctx.request, cap)) return tooLarge(cap);
  const run = () => wantsEval(ctx.request.headers.get("x-nexy-eval") === "1") ? evalScope.run(true, next) : next();
  // social autopilot state is per owner, like saved chats
  return ctx.url.pathname.startsWith("/api/v1/social/") ? ownerScope.run(owner(ctx), run) : run();
});
