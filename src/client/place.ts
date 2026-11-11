// Where Nexy runs: an Own1 with its studios, or a computer with chat only. The server says which.
const root = typeof document === "undefined" ? undefined : document.documentElement;
export const onOwn1 = root?.dataset.place !== "computer";
export const here = onOwn1 ? "this Own1" : "this computer";
const apps = new Set((root?.dataset.apps ?? "").split(" ").filter(Boolean));
// a beta build shows the BETA badge and can send reports to the Nexy team
export const isBeta = root?.dataset.beta === "1";
export const hasApp = (id: string): boolean => apps.has(id);
// speech on this computer (the desktop app) or Own Voice on an Own1: same calls, different home
export const localVoice = root?.dataset.voice === "local";
export const voiceApi = (op: "stt" | "tts" | "voices"): string => (localVoice ? `/api/v1/voice/${op}` : `/api/apps/voice/api/${op}`);
export const notHereYet = (what: string): string =>
  `${what} isn't in Nexy on this computer yet; it's coming in an update. It works today on an Own1 or Nexy Cloud.`;
