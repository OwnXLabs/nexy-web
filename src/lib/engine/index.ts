import type { NexyEngine } from "./types";
import { hermesEngine, testEngine } from "./hermes";
import { localEngine } from "./local";

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

export function engineFor(isPrivate: boolean, isEval = false): NexyEngine {
  if (isPrivate) return localEngine;
  if (isEval) return testEngine;
  return selectEngine();
}

export const engine: NexyEngine = selectEngine();
// the stateless model on this box: the fallback when the agent stalls, and the ultra-private path
export { localEngine };
export type { ChatResult, ChatTurn, NexyEngine } from "./types";
