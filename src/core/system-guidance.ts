export const fabricExecutionKernelGuidance = (fullCodeMode: boolean): string =>
  fullCodeMode
    ? "Pi Code Mode: use `fabric_exec` as the model-facing execution gateway. Pi core actions are `pi.read`, `pi.bash`, `pi.edit`, `pi.write`, `pi.grep`, `pi.find`, and `pi.ls`; run shell commands with `pi.bash` (`pi.exec` does not exist). Core ABI: `pi.read`/`pi.grep`/`pi.find`/`pi.ls` resolve to strings; `pi.bash`/`pi.edit`/`pi.write` resolve to `{ok,output,details}` envelopes. The sandbox is not Node.js: `process` and `require` are unavailable. Compose related operations in one program and return only the bounded result needed by the caller."
    : "Pi Fabric leaves Pi core and registered extension tools on their native direct execution path.";

const dependencyAwareCompositionGuidance =
  " For dependent work inside one `fabric_exec`, use ordinary `await`; use `Promise.all(...)` or `all({...})` only for independent work. Keep side effects explicitly ordered.";

export interface FabricExecutionGuidanceOptions {
  mcpEnabled?: boolean;
}

export const defaultFabricExecutionGuidance = (
  fullCodeMode: boolean,
  options: FabricExecutionGuidanceOptions = {},
): string => {
  const mcpEnabled = options.mcpEnabled !== false;
  const surfaces = [
    "use `pi.*` for Pi core tools",
    "`extensions.*` for captured extension tools",
    ...(mcpEnabled ? ["`mcp.<server>.<tool>(args)` for known MCP tools"] : []),
  ].join(", ");
  const discovery = mcpEnabled
    ? " Use `tools.search`/`tools.describe` for discovery and `tools.call({ref,args})` only for computed or dynamic refs."
    : " Use `tools.search`/`tools.describe` for available dynamic actions and `tools.call({ref,args})` only for computed refs.";
  const base = fullCodeMode
    ? `Inside \`fabric_exec\`, ${surfaces}.${discovery} Detailed Code Mode patterns stay progressive in the \`fabric-exec\` skill; the primitive ABI required to write a correct first call is stated here.`
    : "Use `fabric_exec` only when programmatic composition materially helps the task; native Pi tools remain direct.";
  return base + dependencyAwareCompositionGuidance;
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
