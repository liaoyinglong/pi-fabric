import { DEFAULT_FABRIC_CONFIG } from "./config.js";
import { AGENTS_ACTION_DESCRIPTORS } from "./providers/agents-actions.js";
import { AgentsProvider } from "./providers/agents-provider.js";
import type { FabricActionDescriptor, FabricInvocationContext } from "./protocol.js";
import { describeSubagentRoles, resolveSubagentRole } from "./subagents/profiles.js";

const PATCH_SYMBOL = Symbol.for("pi-fabric.lean-code-mode.v1");

const ONE_SHOT_AGENT_ACTIONS = new Set([
  "run",
  "spawn",
  "wait",
  "status",
  "list",
  "models",
  "stop",
  "cleanup",
  "steer",
  "followUp",
  "setSteeringMode",
  "setFollowUpMode",
  "compact",
]);

const applyLeanDefaults = (): void => {
  DEFAULT_FABRIC_CONFIG.fullCodeMode = true;
  DEFAULT_FABRIC_CONFIG.mesh.enabled = false;
  DEFAULT_FABRIC_CONFIG.memory.enabled = false;
  DEFAULT_FABRIC_CONFIG.capture.enabled = true;
  DEFAULT_FABRIC_CONFIG.capture.hideFromModel = true;
  DEFAULT_FABRIC_CONFIG.capture.advisory.mode = "disabled";
  DEFAULT_FABRIC_CONFIG.compaction.engine = "pi";
  DEFAULT_FABRIC_CONFIG.components = [];
};

const roleProperty = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  description:
    "Named subagent role from .pi/fabric/subagents.yaml (project) or ~/.pi/agent/fabric/subagents.yaml (global). Explicit call arguments override role defaults.",
};

const addRoleToSchema = (descriptor: FabricActionDescriptor): void => {
  const schema = descriptor.inputSchema as {
    properties?: Record<string, unknown>;
  };
  if (!schema.properties) return;
  schema.properties.role = roleProperty;
  const name = schema.properties.name;
  if (typeof name === "object" && name !== null && !Array.isArray(name)) {
    schema.properties.name = {
      ...(name as Record<string, unknown>),
      description: "Display name for this run; defaults to the selected role name.",
    };
  }
};

const configureAgentSurface = (): void => {
  const retained = AGENTS_ACTION_DESCRIPTORS.filter((descriptor) =>
    ONE_SHOT_AGENT_ACTIONS.has(descriptor.name),
  );
  AGENTS_ACTION_DESCRIPTORS.splice(0, AGENTS_ACTION_DESCRIPTORS.length, ...retained);
  for (const descriptor of AGENTS_ACTION_DESCRIPTORS) {
    if (descriptor.name === "run" || descriptor.name === "spawn") addRoleToSchema(descriptor);
  }
  AGENTS_ACTION_DESCRIPTORS.push({
    name: "roles",
    description:
      "List configured named one-shot subagent roles and their execution defaults",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    risk: "read",
  });
};

type Invoke = (
  this: AgentsProvider,
  actionName: string,
  args: Record<string, unknown>,
  context: FabricInvocationContext,
) => Promise<unknown>;

const patchAgentsProvider = (): void => {
  const prototype = AgentsProvider.prototype as AgentsProvider & Record<PropertyKey, unknown>;
  if (prototype[PATCH_SYMBOL]) return;
  const original = prototype.invoke as Invoke;
  prototype.invoke = async function leanInvoke(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<unknown> {
    if (actionName === "roles") return describeSubagentRoles(this.manager.cwd);
    if (actionName === "run" || actionName === "spawn") {
      const resolved = resolveSubagentRole(args, this.manager.cwd);
      return original.call(this, actionName, resolved.args, context);
    }
    return original.call(this, actionName, args, context);
  };
  Object.defineProperty(prototype, PATCH_SYMBOL, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
};

export const installLeanCodeMode = (): void => {
  applyLeanDefaults();
  configureAgentSurface();
  patchAgentsProvider();
};
