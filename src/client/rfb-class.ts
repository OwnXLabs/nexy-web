// noVNC's lib/ is CommonJS with exports.default; bundlers hand the default import over as the class
// or as the whole exports object (Astro 7 does the latter), so take the class from either shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rfbClass<T>(mod: any): T {
  const c = typeof mod === "function" ? mod : typeof mod?.default === "function" ? mod.default : mod?.default?.default;
  if (typeof c !== "function") throw new Error("the screen viewer did not load");
  return c as T;
}
