// Where Nexy runs: an Own1 with its studios, or a computer with chat only. The server says which.
const root = typeof document === "undefined" ? undefined : document.documentElement;
export const onOwn1 = root?.dataset.place !== "computer";
export const here = onOwn1 ? "this Own1" : "this computer";
const apps = new Set((root?.dataset.apps ?? "").split(" ").filter(Boolean));
export const hasApp = (id: string): boolean => apps.has(id);
export const notHereYet = (what: string): string =>
  `${what} isn't in Nexy on this computer yet; it's coming in an update. It works today on an Own1 or Nexy Cloud.`;
