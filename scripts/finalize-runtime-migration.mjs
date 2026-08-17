import { execSync } from "node:child_process";

if (process.env.RUNNER_OS !== "Linux") process.exit(0);
const subject = execSync("git log -1 --pretty=%s", { encoding: "utf8" }).trim();
if (subject !== "chore: apply runtime contract migration") process.exit(0);

execSync("git config user.name github-actions[bot]");
execSync("git config user.email 41898282+github-actions[bot]@users.noreply.github.com");
execSync("git checkout HEAD^ -- package.json");
execSync("git rm scripts/fix-lean-runtime-contracts.mjs scripts/finalize-runtime-migration.mjs");
execSync("git add package.json src tests skills");
execSync('git commit -m "fix: enforce Lean tool and Veda prompt contracts"', { stdio: "inherit" });
execSync("git push origin HEAD:agent/code-mode-runtime-v2", { stdio: "inherit" });
