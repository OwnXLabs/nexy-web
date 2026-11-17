import type { APIRoute } from "astro";
import { searchStatus } from "../../../lib/research";

export const prerender = false;

// the chat home's "Setting up web search…" line: where this computer's search stands
export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await searchStatus()), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
