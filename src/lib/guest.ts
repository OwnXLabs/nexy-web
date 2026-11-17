// A shared Own 1 reached with a guest code (Community AI): the desktop app sets NEXY_OWN1_GUEST=1.
// The box takes text only from a guest (400 "guests may send text only"), and answers 503 while its
// AI is down; that 503 is not counted against the guest's day, so it is said as "try again", not a
// failure.
export const guestHere = (): boolean => process.env.NEXY_OWN1_GUEST === "1";

export const TEXT_ONLY = "This shared Own 1 takes text only; describe the image in words.";
export const SHARED_OFFLINE = "The shared Own 1's AI is offline right now. Try again in a few minutes.";

/** The plain words for a model failure on a shared Own 1, or null when it is any other failure. */
export function guestFault(e: unknown): { reply: string; result: "guest-text-only" | "guest-offline" } | null {
  const m = String((e as Error)?.message ?? e);
  if (/guests may send text only/i.test(m)) return { reply: TEXT_ONLY, result: "guest-text-only" };
  // the model server's own 503 (llama-swap 503), or the app's router naming the Own 1's 503
  if (guestHere() && (/^llama-swap 503\b/.test(m) || /Own ?1 answered 503/i.test(m))) return { reply: SHARED_OFFLINE, result: "guest-offline" };
  return null;
}
