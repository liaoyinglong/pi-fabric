#!/usr/bin/env node

const runnerIndex = process.argv.indexOf("--runner");
const runner = runnerIndex >= 0 ? process.argv[runnerIndex + 1] : undefined;

if (runner === "cli") {
  await import("./worker-cli.js");
} else {
  await import("./worker.js");
}
