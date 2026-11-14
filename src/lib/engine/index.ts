import type { NexyEngine } from "./types";
import { hermesEngine, testEngine } from "./hermes";
import { localEngine } from "./local";
import { choiceById, chosen, configuredDefault, engineOf } from "./registry";

const REGISTRY: Record<string, NexyEngine> = {
  gateway: hermesEngine,
  local: localEngine,
};

export function selectEngine(): NexyEngine {
  const want = (process.env.NEXY_ENGINE ?? "").trim();
  // NEXY_DEFAULT_ENGINE, where it is set and here, unless this machine is set to the model alone
  const d = want === "local" ? null : configuredDefault()?.engine;
  if (d?.available()) return d;
  if (want && REGISTRY[want]?.available()) return REGISTRY[want];
  if (hermesEngine.available()) return hermesEngine;
  return localEngine;
}

// owner: the signed-in owner, whose pick in Settings decides the agent engine
// user: the person a gate signed in, who may have their own copy of the engine
// chat: the engine a chat is fixed to, which wins over the owner's current pick
export function engineFor(isPrivate: boolean, isEval = false, owner: string | null = null, user: string | null = null, chat: string | null = null): NexyEngine {
  if (isPrivate) return localEngine;
  if (isEval) return testEngine;
  const c = choiceById(chat) ?? (owner ? chosen(owner) : null);
  const e = c ? engineOf(c, user) : null;
  if (e && e.available()) return e;
  return selectEngine();
}

export const engine: NexyEngine = selectEngine();
// the stateless model on this box: the fallback when the agent stalls, and the ultra-private path
export { localEngine };
export { ENGINES, capsOf, choiceById, chosen, defaultChoice, engineOf, labelOf, pick, pickedId, searchesWhenTold } from "./registry";
export type { EngineChoice } from "./registry";
export type { ChatResult, ChatTurn, NexyEngine } from "./types";
