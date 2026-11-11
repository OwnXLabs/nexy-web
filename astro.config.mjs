import { defineConfig } from "astro/config";
import node from "@astrojs/node";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  // keep v5's HTML-aware whitespace handling (v7 defaults to "jsx")
  compressHTML: true,
  vite: {
    ssr: { noExternal: true },
    // minify CSS as Vite 6 did: Vite 8's default (Lightning CSS) writes range media queries, which the
    // macOS 13.0 web view ignores, and drops backdrop-filter where a -webkit- copy follows it
    build: { cssMinify: "esbuild" },
  },
});
