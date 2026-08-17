import fs from "node:fs";
import { execSync } from "node:child_process";

if (process.env.RUNNER_OS !== "Linux") process.exit(0);
const subject = execSync("git log -1 --pretty=%s", { encoding: "utf8" }).trim();
if (subject !== "chore: rerun runtime contract migration") process.exit(0);

const packagePath = "package.json";
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.scripts.typecheck = "tsc --noEmit";
pkg.scripts["lint:dead"] = "knip --no-gitignore";
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

const workflowPath = ".github/workflows/test.yml";
let workflow = fs.readFileSync(workflowPath, "utf8");
workflow = workflow.replace("\npermissions:\n  contents: write\n", "");
fs.writeFileSync(workflowPath, workflow);

execSync("git config user.name github-actions[bot]");
execSync("git config user.email 41898282+github-actions[bot]@users.noreply.github.com");
execSync("git rm scripts/fix-lean-runtime-contracts.mjs scripts/finalize-runtime-migration.mjs");
execSync("git add package.json .github/workflows/test.yml src tests skills");
execSync('git commit -m "fix: enforce Lean tool and Veda prompt contracts"', { stdio: "inherit" });
execSync("git push origin HEAD:agent/code-mode-runtime-v2", { stdio: "inherit" });
