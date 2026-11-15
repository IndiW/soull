import { build } from "esbuild";
import { createRequire } from "node:module";
import path from "node:path";
import { mkdir, copyFile } from "node:fs/promises";
export const options = {
  entryPoints: ["ui/main.tsx"],
  bundle: true,
  outdir: "dist",
  entryNames: "app",
  sourcemap: true,
  format: "esm",
  target: "safari17",
  jsx: "automatic",
  logLevel: "info",
  plugins: [
    {
      name: "local-node-resolution",
      setup(build) {
        build.onResolve({ filter: /^[^./]|^@/ }, (args) => {
          try {
            return {
              path: createRequire(
                path.join(args.resolveDir, "resolve.cjs"),
              ).resolve(args.path),
            };
          } catch {
            return undefined;
          }
        });
      },
    },
  ],
};
await mkdir("dist", { recursive: true });
await copyFile("ui/index.html", "dist/index.html");
if (process.argv[1]?.endsWith("build.mjs")) await build(options);
