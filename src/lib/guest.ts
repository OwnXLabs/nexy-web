// A shared Own 1 reached with a guest code (Community AI): the desktop app sets NEXY_OWN1_GUEST=1.
// The box takes text only from a guest (400 "guests may send text only"), and answers 503 while its
// AI is down; that 503 is not counted against the guest's day, so it is said as "try again", not a
// failure.
export const guestHere = (): boolean => process.env.NEXY_OWN1_GUEST === "1";
/** Whose Own 1 a guest is on, as the app names it ("John's Own 1", NEXY_OWN1_GUEST_ON), or "the shared Own 1". */
const named = (): string => {
  const n = (process.env.NEXY_OWN1_GUEST_ON ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim();
  return n && [...n].length <= 60 ? n : "";
};
export const guestOn = (): string => named() || "the shared Own 1";
/** This computer's AI runs on someone's Own 1: a guest code, or a device paired for AI only (the app names it). */
export const sharedHere = (): boolean => guestHere() || !!named();
/** The router's door to that Own 1 for images (NEXY_SHARED_IMAGES_URL), when the app gives one. */
export const sharedImagesUrl = (): string => (process.env.NEXY_SHARED_IMAGES_URL ?? "").replace(/\/+$/, "");

export const TEXT_ONLY = "This shared Own 1 takes text only; describe the image in words.";
export const SHARED_OFFLINE = "The shared Own 1's AI is offline right now. Try again in a few minutes.";
export const SHARED_BUSY = "The shared Own 1 is busy with its owner's work. Try again shortly.";

/** The plain words for a model failure on a shared Own 1, or null when it is any other failure. */
export function guestFault(e: unknown): { reply: string; result: "guest-text-only" | "guest-busy" | "guest-offline" } | null {
  const m = String((e as Error)?.message ?? e);
  if (/guests may send text only/i.test(m)) return { reply: TEXT_ONLY, result: "guest-text-only" };
  // the app's router (or the box) saying busy comes as a 503 too: busy, not offline
  if (guestHere() && /busy with its owner'?s work/i.test(m)) return { reply: SHARED_BUSY, result: "guest-busy" };
  // the model server's own 503 (llama-swap 503), or the app's router naming the Own 1's 503
  if (guestHere() && (/^llama-swap 503\b/.test(m) || /Own ?1 answered 503/i.test(m))) return { reply: SHARED_OFFLINE, result: "guest-offline" };
  return null;
}
