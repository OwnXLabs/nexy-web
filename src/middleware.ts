import { defineMiddleware } from "astro:middleware";
import { evalScope, ownerScope } from "./lib/social/store.ts";
import { owner } from "./lib/owner";
import { wantsEval } from "./lib/eval";

export const onRequest = defineMiddleware((ctx, next) => {
  const run = () => wantsEval(ctx.request.headers.get("x-nexy-eval") === "1") ? evalScope.run(true, next) : next();
  // social autopilot state is per owner, like saved chats
  return ctx.url.pathname.startsWith("/api/v1/social/") ? ownerScope.run(owner(ctx), run) : run();
});
