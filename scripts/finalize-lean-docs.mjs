import fs from "node:fs/promises";

const read = (path) => fs.readFile(path, "utf8");
const write = (path, content) => fs.writeFile(path, content);
const replace = (source, before, after, label) => {
  if (!source.includes(before)) throw new Error(`doc anchor not found: ${label}`);
  return source.replace(before, after);
};
const replaceSection = (source, start, end, replacement, label) => {
  const a = source.indexOf(start);
  if (a < 0) throw new Error(`doc section start not found: ${label}`);
  const b = source.indexOf(end, a);
  if (b < 0) throw new Error(`doc section end not found: ${label}`);
  return source.slice(0, a) + replacement + source.slice(b);
};

// README: the physical-cleanup caveat is no longer true.
const readmePath = "README.md";
let readme = await read(readmePath);
readme = replace(
  readme,
  "Lean V2 does not expose the persistent Fabric product systems that are outside this scope: Actor, Mesh, State, Schema runtime, Memory, RLM skills, Prewalk, resident hosts, the Component supervisor, trajectory handoff, the Fabric dashboard, and main-session Fabric compaction. Some low-level compatibility code is still being removed from the fork internals; it is not part of the Lean V2 public capability surface.",
  "Lean V2 removes the persistent Fabric product systems that are outside this scope: Actor, Mesh, State, Schema runtime, Memory, RLM skills, Prewalk, resident hosts, the Component supervisor, trajectory handoff, the Fabric dashboard, and main-session Fabric compaction. The shared Code Mode and agent runtime no longer carries the old Actor/Mesh/trajectory plumbing or dormant QuickJS globals for those systems.",
  "README physical boundary",
);
await write(readmePath, readme);

// Architecture: replace the old cleanup backlog with the now-current boundary.
const architecturePath = "docs/lean-code-mode.md";
let architecture = await read(architecturePath);
architecture = architecture.replace("## Removed public systems", "## Physically removed product systems");
architecture = replaceSection(
  architecture,
  "## Remaining internal compatibility code\n",
  "## Configuration boundary\n",
  `## Physical cleanup status

The Full Fabric product paths listed above are no longer merely hidden from the Lean public API:

- QuickJS no longer creates Memory, State, Schema, Components, Mesh, Council, RLM, Actor, participant, or trajectory-handoff globals/helpers.
- \`FabricExecutionService\` and \`FabricInvocationContext\` no longer carry deferred handoff state or hooks.
- \`AgentManager\`, worker arguments, worker environment propagation, lifecycle records, and retention no longer carry Actor/Mesh identity, capability-digest ownership, durable residency, session-seed, or thinking-transfer fields.
- trajectory handoff/session-seed source files and Actor archive retention have been removed.

Lean intentionally retains one-shot child features that are useful independently of those systems: runner sessions for steering/follow-up, child compaction for running Pi workers, session export, worktrees, budgets, transports, and bounded recursive Pi children.

\`schema.mode\` and \`fullCodeMode\` remain broad TypeScript fields only for low-level ExecutionService test coverage; the live Lean loader normalizes them to Full Code Mode with Schema off. They do not reconnect the removed Schema product runtime.

`,
  "architecture compatibility backlog",
);
architecture = replace(
  architecture,
  "That assertion is a guard against accidentally reconnecting the removed product runtimes. It is not yet a proof that all compatibility symbols inside shared AgentManager, worker, ExecutionService, and QuickJS modules have been deleted. The remaining compatibility list above is the physical-cleanup backlog.",
  "That assertion guards against accidentally reconnecting removed product runtimes. The shared QuickJS, ExecutionService, AgentManager, worker, and retention paths are also covered by Lean-specific tests and source-level contracts so the removed Actor/Mesh/trajectory surfaces do not silently return.",
  "architecture build boundary",
);
await write(architecturePath, architecture);

// Configuration: Actor archive retention has been physically removed.
const configPath = "docs/configuration.md";
let config = await read(configPath);
config = config.replace("| `actorRunArchiveMs` | `604800000` | Legacy compatibility field left from the removed Actor runtime |\n", "");
config = config.replace("\n`actorRunArchiveMs` is not part of the Lean V2 product surface and should not be used for new configuration. Its remaining compatibility code is scheduled for removal from the lean branch.\n", "\n");
await write(configPath, config);

// Usage: remove the now-obsolete migration caveat.
const usagePath = "docs/usage.md";
let usage = await read(usagePath);
usage = replace(
  usage,
  "Removed Full Fabric provider groups do not activate those providers in Lean V2. A few internal compatibility fields are still accepted while the implementation is being physically reduced; see [Configuration Reference](configuration.md) for the exact active fields.",
  "Removed Full Fabric provider groups do not activate those providers in Lean V2. See [Configuration Reference](configuration.md) for the exact active fields and defaults.",
  "usage compatibility caveat",
);
usage = usage.replace(
  "Persistent Actor, Mesh, State, Schema runtime, Memory, RLM, Prewalk, resident-host, and trajectory-handoff APIs are not part of the Lean V2 public capability surface.",
  "Persistent Actor, Mesh, State, Schema runtime, Memory, RLM, Prewalk, resident-host, and trajectory-handoff systems are removed from Lean V2; they are not model-facing APIs or shared agent-runtime compatibility paths.",
);
await write(usagePath, usage);

console.log("Lean V2 documentation synchronized with physical cleanup");
