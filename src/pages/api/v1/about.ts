import type { APIRoute } from "astro";
import { readFile } from "node:fs/promises";

export const prerender = false;

// About on a computer: the desktop app's version (NEXY_APP_VERSION) and what its last update check
// found, {"state": "current" | "available" | "failed", "version"?, "checked"} in NEXY_UPDATE_STATUS,
// written by the app. Neither is set on an Own1.
const STATES = ["current", "available", "failed"];
const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { "content-type": "application/json", "cache-control": "no-store" } });

export const GET: APIRoute = async () => {
  const version = (process.env.NEXY_APP_VERSION ?? "").slice(0, 40);
  const file = process.env.NEXY_UPDATE_STATUS ?? "";
  let update: { state: string; version?: string; checked: number } | null = null;
  if (file) {
    try {
      const s = JSON.parse(await readFile(file, "utf8"));
      if (STATES.includes(s?.state)) update = { state: s.state, version: typeof s.version === "string" ? s.version.slice(0, 40) : undefined, checked: Number(s.checked) || 0 };
      else console.warn("[nexy] update status has no known state");
    } catch (e: any) {
      if (e?.code !== "ENOENT") console.warn("[nexy] update status unreadable:", e?.message);
    }
  }
  return json({ version, update });
};
