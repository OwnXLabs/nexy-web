import type { APIRoute } from "astro";
import { load } from "../../../../lib/social/store.ts";
import { envelope, json } from "./_shared.ts";

export const prerender = false;

export const GET: APIRoute = async () => json(envelope(await load()));
