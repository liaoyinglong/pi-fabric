#!/usr/bin/env node
import { build } from "esbuild";

const result = await build({
  entryPoints: {
    "lean-index": "src/lean-index.ts",
    "public-protocol": "src/public-protocol.ts",
  },
  outdir: "dist",
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node24",
  splitting: true,
  sourcemap: true,
  metafile: true,
  logLevel: "info",
});

const bundledPackages = Object.keys(result.metafile.inputs).filter((input) =>
  input.includes("node_modules/"),
);
if (bundledPackages.length > 0) {
  throw new Error(`Package code was bundled unexpectedly:\n${bundledPackages.join("\n")}`);
}
