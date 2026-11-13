// Where Nexy runs: an Own1 with its studios, a computer with chat only, or Nexy Cloud (chat only,
// hosted). The server says which.
const root = typeof document === "undefined" ? undefined : document.documentElement;
const place = root?.dataset.place ?? "own1";
export const onOwn1 = place === "own1";
export const inCloud = place === "cloud";
export const here = onOwn1 ? "this Own1" : inCloud ? "Nexy Cloud" : "this computer";
const apps = new Set((root?.dataset.apps ?? "").split(" ").filter(Boolean));
// a beta build shows the BETA badge and can send reports to the Nexy team
export const isBeta = root?.dataset.beta === "1";
export const hasStudio = (id: string): boolean => apps.has(id);
// building pages: the Own Build studio, or on a computer the engine's builder
export const buildsHere = !onOwn1 && apps.has("builder");
export const hasApp = (id: string): boolean => apps.has(id) || (id === "build" && buildsHere);
// speech on this computer (the desktop app) or Own Voice on an Own1: same calls, different home
export const localVoice = root?.dataset.voice === "local";
export const voiceApi = (op: "stt" | "tts" | "voices"): string => (localVoice ? `/api/v1/voice/${op}` : `/api/apps/voice/api/${op}`);
// Nexy Cloud is "Coming soon" (setup and Home): never offered as a place to do something today
export const notHereYet = (what: string): string => inCloud
  ? `${what} isn't in Nexy Cloud yet: it needs a GPU server, and Nexy Cloud has none so far. It works today on an Own1.`
  : `${what} isn't in Nexy on this computer yet; it's coming in an update. It works today on an Own1.`;
// Images on a computer are switched on in Nexy Home, where its hardware can run them. The page
// can't tell whether it can, so the wording covers both.
export const imagesOff = (): string => onOwn1 || inCloud ? notHereYet("Making images")
  : `Making images is off. Turn on "Make images on this ${/Windows/.test(navigator.userAgent) ? "PC" : "Mac"}" in Nexy Home first. If Home doesn't offer it, this computer can't make images, but an Own1 can.`;
// the address shown on built pages
export const siteHost = onOwn1 ? "own1.local" : "this-computer.local";
