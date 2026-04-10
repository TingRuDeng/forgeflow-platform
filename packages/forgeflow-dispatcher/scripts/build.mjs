import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(packageRoot, "dist");

mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(packageRoot, "src", "cli.ts")],
  outfile: path.join(outdir, "cli.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  banner: {
    js: "#!/usr/bin/env node",
  },
  sourcemap: false,
  legalComments: "none",
  external: [
    "node:crypto",
    "node:fs",
    "node:http",
    "node:https",
    "node:os",
    "node:path",
    "node:sqlite",
    "node:url",
  ],
});
