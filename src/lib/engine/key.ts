import { readFileSync } from "node:fs";

// a key from a file (kept out of the environment and the Nix store), else from the variable itself
export function keyFrom(fileVar: string, keyVar: string): string {
  const file = process.env[fileVar];
  if (file) {
    try { return readFileSync(file, "utf8").trim(); }
    catch (e) { console.warn(`[nexy] ${fileVar} unreadable: ${(e as Error).message}`); return ""; }
  }
  return process.env[keyVar] ?? "";
}

export const AGENT_KEY = keyFrom("NEXY_AGENT_KEY_FILE", "NEXY_AGENT_KEY");
