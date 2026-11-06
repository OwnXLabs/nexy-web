import { connectors, anyConnected, NOT_CONNECTED } from "../../../../lib/social/networks.ts";
import { storeError, storePath } from "../../../../lib/social/store.ts";
import type { SocialState } from "../../../../lib/social/types.ts";

export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export function envelope(state: SocialState, extra: Record<string, unknown> = {}) {
  return {
    state,
    connectors: connectors(),
    publishes: anyConnected(),
    notice: NOT_CONNECTED,
    runner: "none",
    store: { path: storePath(), error: storeError() },
    ...extra,
  };
}

export async function readJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
