export const fabricExecutionKernelGuidance = (fullCodeMode: boolean): string =>
  fullCodeMode
    ? "Pi Code Mode: use `fabric_exec` as the model-facing execution gateway. Call Pi core tools as `pi.*` inside `code`; compose related operations in one program and return only the bounded result needed by the caller."
    : "Pi Fabric is in orchestration-only mode. Pi core and registered extension tools remain on their native direct execution path.";

const dependencyAwareCompositionGuidance =
  " For dependent work inside one `fabric_exec`, use ordinary `await`; use `parallel(...)` or `all({...})` only for independent work. Keep side effects explicitly ordered.";

const semanticSubagentGuidance =
  " When delegation is useful, route by semantic profile rather than raw model id. Discover profiles with `agents.profiles({})`, then pass `profile` to `agents.run`, `agents.spawn`, or workflow `agent(...)`; `name` is display-only. Prefer bounded cheaper profiles for search and repetitive inspection, and stronger profiles only for difficult reasoning, implementation decisions, or independent verification. Use `agents.recurse({profile,task})` only when a Pi profile genuinely needs recursive decomposition beyond one child context; ordinary delegation should stay on run/spawn. The caller should not need to name a model in ordinary conversation.";

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
  ].join(", ");
  const discovery = mcpEnabled
    ? " Use `tools.search`/`tools.describe` for discovery and `tools.call({ref,args})` only for computed or dynamic refs."
    : " Use `tools.search`/`tools.describe` for available dynamic actions and `tools.call({ref,args})` only for computed refs.";
  const agents = agentsEnabled
    ? " Profile-based one-shot workers are available through `agents.*`; workflow helpers such as `agent(...)`, `parallel(...)`, and `pipeline(...)` orchestrate those workers inside the same Code Mode program."
    : " One-shot agents and agent-backed workflow delegation are disabled by configuration.";
  const progressive =
    " Detailed contracts stay progressive in the `fabric-exec`, `fabric-subagents`, and `fabric-workflow` skills rather than in the system prompt.";
  const base = fullCodeMode
    ? `Inside \`fabric_exec\`, ${surfaces}.${discovery}${agents}${progressive}`
    : "Use `fabric_exec` only for orchestration surfaces that are explicitly needed by the task; native Pi tools remain direct.";
  return base + (agentsEnabled ? semanticSubagentGuidance : "") + dependencyAwareCompositionGuidance;
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
