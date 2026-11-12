// What a failed request means to a person. Status codes go to the console, never the screen.
export function httpMsg(status: number): string {
  console.warn(`[nexy] HTTP ${status}`);
  if (status === 502 || status === 504) return "it is still loading or restarting on this machine; try again in a minute";
  if (status === 503 || status === 429) return "it is busy with another job on this machine";
  if (status === 401 || status === 403) return "it needs you to sign in again";
  if (status === 404) return "it was not found";
  return "it did not work this time";
}

// A request that never got an answer from the machine: aborted, timed out, or the network
// failed. The browser's own wording ("The user aborted a request.", "Failed to fetch") means
// nothing to a person, so it is never shown.
export function unreachable(e: unknown): boolean {
  const name = (e as Error | undefined)?.name ?? "", msg = String((e as Error | undefined)?.message ?? e);
  return name === "AbortError" || name === "TimeoutError" ||
    (e instanceof TypeError && /fetch|network|load failed|connection/i.test(msg)) ||
    /aborted|went silent|connection dropped before|kept dropping/i.test(msg);
}
export const away = (): string =>
  `${typeof document !== "undefined" && document.documentElement.dataset.place === "computer" ? "Your computer" : "Your Own1"} isn't answering. Nexy will reconnect when it's back.`;
// what to show for a failed request: plain wording for a machine that can't be reached
export const errText = (e: unknown): string => (unreachable(e) ? away() : String((e as Error | undefined)?.message ?? e));
