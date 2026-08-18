export const fabricExecutionKernelGuidance = (fullCodeMode: boolean): string =>
  fullCodeMode
    ? "Pi Code Mode: use `fabric_exec` as the model-facing execution gateway. Pi core actions are `pi.read`, `pi.bash`, `pi.edit`, `pi.write`, `pi.grep`, `pi.find`, and `pi.ls`; run shell commands with `pi.bash` (`pi.exec` does not exist). Core ABI: `pi.read`/`pi.grep`/`pi.find`/`pi.ls` resolve to strings; `pi.bash`/`pi.edit`/`pi.write` resolve to `{ok,output,details}` envelopes. For non-trivial multi-step work, maintain the session task list inside the program with `await todo([...])`; each call replaces the complete list and `await todo([])` clears it. The sandbox is not Node.js: `process` and `require` are unavailable. Compose related operations in one program and return only the bounded result needed by the caller."
    : "Pi Fabric is in orchestration-only mode. Pi core and registered extension tools remain on their native direct execution path.";

const dependencyAwareCompositionGuidance =
  " For dependent work inside one `fabric_exec`, use ordinary `await`; use `parallel(...)` or `all({...})` only for independent work. Keep side effects explicitly ordered.";

const autonomousSubagentGuidance =
  " Main owns delegation. Do not wait for the user to name a Fabric skill, role, model, or subagent. Keep simple single-context work in Main; delegate when isolation protects Main context, independent work can run in parallel, a cheaper worker is sufficient, or independent verification materially helps. For each child, Main creates a temporary `role` and optional bounded `instructions`, then selects a tier and capability policy. Tiers: `fast` for cheap bounded search/evidence/repetitive inspection; `balance` for routine reasoning, debugging, implementation, and verification; `strong` for ambiguous bugs, architecture/high-impact decisions, difficult reasoning, or independent review. Policies: `inspect` is read-only; `execute` adds shell execution but no edits; `modify` allows scoped edits in the current workspace; `isolated` allows scoped edits in an isolated worktree. Call `agents.run({tier,policy,role,task})` or `agents.spawn(...)`; use `agents.routing({})` only when active overrides need inspection. Prefer the lowest tier that can reliably finish the bounded task, and escalate only when evidence is insufficient or the task is genuinely harder than expected. Parallelize only independent work; never let concurrent children write overlapping files. Subagents return compact results rather than raw transcripts. Use `agents.recurse({tier,policy,role,task})` only when one child context is genuinely insufficient and the selected tier resolves to Pi. Main remains responsible for synthesis, final decisions, and integration.";

export interface FabricExecutionGuidanceOptions {
  agentsEnabled?: boolean;
  mcpEnabled?: boolean;
}

export const defaultFabricExecutionGuidance = (
  fullCodeMode: boolean,
  options: FabricExecutionGuidanceOptions = {},
): string => {
  const agentsEnabled = options.agentsEnabled !== false;
  const mcpEnabled = options.mcpEnabled !== false;
  const surfaces = [
    "use `pi.*` for Pi core tools",
    "`extensions.*` for captured extension tools",
    ...(mcpEnabled ? ["`mcp.<server>.<tool>(args)` for known MCP tools"] : []),
    "`todo([...])` for the session-local task list",
  ].join(", ");
  const discovery = mcpEnabled
    ? " Use `tools.search`/`tools.describe` for discovery and `tools.call({ref,args})` only for computed or dynamic refs."
    : " Use `tools.search`/`tools.describe` for available dynamic actions and `tools.call({ref,args})` only for computed refs.";
  const agents = agentsEnabled
    ? " Tier/policy-routed one-shot workers are available through `agents.*`; workflow helpers such as `agent(...)`, `parallel(...)`, and `pipeline(...)` orchestrate those workers inside the same Code Mode program."
    : " One-shot agents and agent-backed workflow delegation are disabled by configuration.";
  const progressive =
    " Detailed orchestration patterns stay progressive in the `fabric-exec`, `fabric-subagents`, and `fabric-workflow` skills; the primitive ABI required to write a correct first call is stated here.";
  const base = fullCodeMode
    ? `Inside \`fabric_exec\`, ${surfaces}.${discovery}${agents}${progressive}`
    : "Use `fabric_exec` only for orchestration surfaces that are explicitly needed by the task; native Pi tools remain direct.";
  return base + (agentsEnabled ? autonomousSubagentGuidance : "") + dependencyAwareCompositionGuidance;
};

export const fabricSchemaGuidance = (mode: "off" | "audit" | "enforce"): string | undefined => {
  if (mode === "enforce") {
    return "Schema enforce mode is a legacy compatibility mode for this branch. Protected-workspace changes must follow the configured schema gate.";
  }
  if (mode === "audit") {
    return "Schema audit mode is a legacy compatibility mode and reports actions that enforce mode would block.";
  }
  return undefined;
};