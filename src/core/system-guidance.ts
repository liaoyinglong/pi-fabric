export const fabricExecutionKernelGuidance = (fullCodeMode: boolean): string =>
  fullCodeMode
    ? "Pi Code Mode: use `fabric_exec` as the model-facing execution gateway. Call Pi core tools as `pi.*` inside `code`; compose related operations in one program and return only the bounded result needed by the caller."
    : "Pi Fabric is in orchestration-only mode. Pi core and registered extension tools remain on their native direct execution path.";

const dependencyAwareCompositionGuidance =
  " For dependent work inside one `fabric_exec`, use ordinary `await`; use `parallel(...)` or `all({...})` only for independent work. Keep side effects explicitly ordered.";

const semanticSubagentGuidance =
  " When delegation is useful, prefer configured semantic subagent roles over raw model ids. Discover the current role catalog with `agents.roles({})`, then pass the chosen role name as `name` to `agents.run`, `agents.spawn`, or workflow `agent(...)`. Use bounded cheaper evidence-gathering roles for search and repetitive inspection, and stronger roles only for difficult reasoning, implementation decisions, or independent verification. The caller should not need to name a model in ordinary conversation.";

export const defaultFabricExecutionGuidance = (fullCodeMode: boolean): string =>
  (fullCodeMode
    ? "Inside `fabric_exec`, use `pi.*` for Pi core tools, `extensions.*` for captured extension tools, and `mcp.<server>.<tool>(args)` for known MCP tools. Use `tools.search`/`tools.describe` for discovery and `tools.call({ref,args})` only for computed or dynamic refs. Named one-shot workers are available through `agents.*`; workflow helpers such as `agent(...)`, `parallel(...)`, and `pipeline(...)` orchestrate those workers inside the same Code Mode program. Detailed contracts stay progressive in the `fabric-exec`, `fabric-subagents`, and `fabric-workflow` skills rather than in the system prompt."
    : "Use `fabric_exec` only for orchestration surfaces that are explicitly needed by the task; native Pi tools remain direct.") +
  semanticSubagentGuidance +
  dependencyAwareCompositionGuidance;

export const fabricSchemaGuidance = (mode: "off" | "audit" | "enforce"): string | undefined => {
  if (mode === "enforce") {
    return "Schema enforce mode is a legacy compatibility mode for this branch. Protected-workspace changes must follow the configured schema gate.";
  }
  if (mode === "audit") {
    return "Schema audit mode is a legacy compatibility mode and reports actions that enforce mode would block.";
  }
  return undefined;
};
