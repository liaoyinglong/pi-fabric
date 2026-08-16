import type { FabricActionDescriptor } from "../protocol.js";
import { sanitizeMcpRefPart } from "../ref-names.js";

// Compatibility helper retained because McpProvider re-exports it. The lean
// runtime itself has no capability-advisory subsystem.
export const toMcpAdvisoryDescriptor = (
  descriptor: FabricActionDescriptor,
): FabricActionDescriptor => {
  const server = descriptor.namespace ?? "";
  const prefix = `${server}.`;
  const toolName = descriptor.name.startsWith(prefix)
    ? descriptor.name.slice(prefix.length)
    : descriptor.name;
  const safeServer = sanitizeMcpRefPart(server);
  return {
    ...descriptor,
    name: `${safeServer}.${sanitizeMcpRefPart(toolName)}`,
    namespace: `mcp:${safeServer}`,
  };
};
