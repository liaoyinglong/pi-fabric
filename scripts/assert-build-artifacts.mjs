#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const stable = ["lean-index.js", "protocol.js", "worker.js"];
const declarations = stable.map((file) => file.replace(/\.js$/, ".d.ts"));
const required = [
  ...stable,
  ...stable.map((file) => `${file}.map`),
  ...declarations,
  ...declarations.map((file) => `${file}.map`),
];
const missing = required.filter((file) => !existsSync(join(dist, file)));
if (missing.length > 0) throw new Error(`Missing build artifacts:\n${missing.join("\n")}`);

const chunksDir = join(dist, "chunks");
const chunks = existsSync(chunksDir)
  ? readdirSync(chunksDir).filter((file) => file.endsWith(".js"))
  : [];
for (const chunk of chunks) {
  if (!existsSync(join(chunksDir, `${chunk}.map`))) {
    throw new Error(`Missing source map for chunk ${chunk}`);
  }
}

const sources = [
  ...stable.map((file) => readFileSync(join(dist, file), "utf8")),
  ...chunks.map((file) => readFileSync(join(chunksDir, file), "utf8")),
].join("\n");
for (const forbidden of [
  "src/fabric-runtime-state.ts",
  "src/actors/manager.ts",
  "src/mesh/store.ts",
  "src/schema/controller.ts",
  "src/state/store.ts",
  "src/providers/memory-provider.ts",
  "src/residency/host.ts",
  "src/prewalk/",
]) {
  if (sources.includes(forbidden)) {
    throw new Error(`Lean build still reaches legacy runtime module: ${forbidden}`);
  }
}

for (const file of stable) {
  const checked = spawnSync(process.execPath, ["--check", join(dist, file)], { encoding: "utf8" });
  if (checked.status !== 0) throw new Error(checked.stderr || `Syntax check failed: ${file}`);
}
await Promise.all(
  stable.filter((file) => file !== "worker.js").map((file) =>
    import(new URL(`../dist/${file}`, import.meta.url)),
  ),
);
console.log(`lean build artifacts verified (${stable.length} entrypoints, ${chunks.length} chunks)`);
