import type { APIContext } from "astro";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { identityOwner } from "../../../../lib/owner";

export interface Turn {
  role: "user" | "assistant";
  content: string;
  ts: number;
}

export function owner(ctx: Pick<APIContext, "cookies" | "request">): string {
  return identityOwner(ctx.request) ?? (ctx.cookies.get("nexy_owner")?.value?.slice(0, 64) || "local");
}

const held = new Map<string, Turn[]>();

const MAX_TURNS = Number(process.env.NEXY_PRIVATE_MAX_TURNS ?? 200);

export function hold(who: string, turn: Turn): void {
  const turns = held.get(who) ?? [];
  turns.push(turn);
  while (turns.length > MAX_TURNS) turns.shift();
  held.set(who, turns);
}

export const list = (who: string): Turn[] => [...(held.get(who) ?? [])];

export const count = (who: string): number => held.get(who)?.length ?? 0;

// an ultra-private session is open for this owner until it is forgotten
export const privateOpen = (who: string): boolean => count(who) > 0;

export function forget(who: string): number {
  const n = count(who);
  held.delete(who);
  return n;
}

export function forgetAll(): void {
  held.clear();
}

const LOG = (): string => process.env.NEXY_TURN_LOG ?? "";

export const journalPath = (): string => LOG();

export function record(who: string, turn: Turn, isPrivate = false): boolean {
  if (isPrivate) return false;
  const path = LOG();
  if (!path) return false;
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({ owner: who, ...turn })}\n`, "utf8");
    return true;
  } catch (e: unknown) {
    console.error("[nexy.private] turn log write failed:", (e as Error)?.message ?? e);
    return false;
  }
}

export function readJournal(path = LOG()): Array<Record<string, unknown>> {
  if (!path) return [];
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

export function remember(who: string, turn: Turn, isPrivate: boolean): void {
  if (isPrivate) hold(who, turn);
  else record(who, turn, false);
}

export interface Upstream {
  via: "gateway" | "local";
  persists: boolean;
  why: string;
}

// engine: the one this turn goes to; its own words say what keeps the turn
export function upstreamFor(engine: { id: string; upstream?: string } | null, isPrivate: boolean): Upstream {
  if (isPrivate)
    return {
      via: "local",
      persists: false,
      why: "ultra-private: the stateless model on this box, so nothing upstream keeps the turn",
    };
  if (engine?.id === "gateway")
    return { via: "gateway", persists: true, why: engine.upstream ?? "the agent gateway, which keeps memory and sessions" };
  return { via: "local", persists: false, why: "no gateway configured" };
}
