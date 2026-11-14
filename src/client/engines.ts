import { enginesHere } from "./place";

// The agent engines on this machine and the owner's pick for new chats. Labels and Continue show
// only where there is a real choice: a one-engine install (the desktop app) shows nothing new.
export type Caps = { memory: boolean; routines: boolean };
export type EngineList = { engines: ({ id: string; label: string; note: string } & Caps)[]; selected: string | null; default?: string | null };

let list: EngineList | null = null;
let loading: Promise<EngineList | null> | null = null;

export function loadEngines(fresh = false): Promise<EngineList | null> {
  if (!enginesHere) return Promise.resolve(null);
  if (loading && !fresh) return loading;
  loading = fetch("/api/v1/engines").then(async (x) => {
    const r = x.ok ? await x.json() as EngineList : null;
    if (r && !Array.isArray(r.engines)) { console.warn("[nexy] engines: not a list"); return null; }
    return r;
  })
    .catch((e) => { console.warn("[nexy] engines unavailable", e); return null; })
    .then((r) => { list = r; window.dispatchEvent(new CustomEvent("nexy:engines")); return r; });
  return loading;
}

export const manyEngines = (): boolean => (list?.engines.length ?? 0) > 1;
export const engineLabel = (id: string | undefined): string => list?.engines.find((e) => e.id === id)?.label ?? "";
// the engine new chats start on
export const pickedEngine = (): string | undefined => list?.selected ?? list?.default ?? list?.engines[0]?.id;
export const otherEngines = (id: string | undefined) => (list?.engines ?? []).filter((e) => e.id !== id);
