import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
export const options = {
  entryPoints: ["ui/main.tsx"],
  bundle: true,
  minify: true,
  outdir: "dist",
  entryNames: "app",
  sourcemap: true,
  format: "esm",
  target: "safari17",
  jsx: "automatic",
  logLevel: "info",
  // Use esbuild's browser-aware package exports instead of Node's require resolver.
  platform: "browser",
  conditions: ["browser"],
  define: { "process.env.NODE_ENV": '"production"' },
};
await mkdir("dist", { recursive: true });
await copyFile("ui/index.html", "dist/index.html");
if (process.argv[1]?.endsWith("build.mjs")) await build(options);
