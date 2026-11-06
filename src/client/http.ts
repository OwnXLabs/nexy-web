// What a failed request means to a person. Status codes go to the console, never the screen.
export function httpMsg(status: number): string {
  console.warn(`[nexy] HTTP ${status}`);
  if (status === 502 || status === 504) return "it is still loading or restarting on this machine; try again in a minute";
  if (status === 503 || status === 429) return "it is busy with another job on this machine";
  if (status === 401 || status === 403) return "it needs you to sign in again";
  if (status === 404) return "it was not found";
  return "it did not work this time";
}
