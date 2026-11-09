import type { NexyEngine } from "./types";
import { hermesEngine, testEngine } from "./hermes";
import { localEngine } from "./local";
import { chosen } from "./registry";

const REGISTRY: Record<string, NexyEngine> = {
  gateway: hermesEngine,
  local: localEngine,
};

export function selectEngine(): NexyEngine {
  const want = (process.env.NEXY_ENGINE ?? "").trim();
  if (want && REGISTRY[want]?.available()) return REGISTRY[want];
  if (hermesEngine.available()) return hermesEngine;
  return localEngine;
}

// owner: the signed-in owner, whose pick in Settings decides the agent engine
export function engineFor(isPrivate: boolean, isEval = false, owner: string | null = null): NexyEngine {
  if (isPrivate) return localEngine;
  if (isEval) return testEngine;
  const c = owner ? chosen(owner) : null;
  if (c && c.engine.available()) return c.engine;
  return selectEngine();
}

export const engine: NexyEngine = selectEngine();
// the stateless model on this box: the fallback when the agent stalls, and the ultra-private path
export { localEngine };
export { ENGINES, chosen, pick, pickedId } from "./registry";
export type { EngineChoice } from "./registry";
export type { ChatResult, ChatTurn, NexyEngine } from "./types";
