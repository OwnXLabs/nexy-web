// Loads a browser module (src/client, extensionless imports) in Node: bundled with esbuild, then
// imported from memory. For the parts that need no window.
import { build } from "esbuild";
import path from "node:path";

export async function clientModule<T = any>(file: string): Promise<T> {
  const r = await build({ entryPoints: [path.join(import.meta.dirname, "..", file)], bundle: true, write: false, format: "esm", platform: "neutral", logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString("base64")}`) as Promise<T>;
}
