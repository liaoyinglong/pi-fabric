import type {
  FabricActionDescriptor,
  FabricInvocationContext,
  FabricProvider,
  FabricProviderListRequest,
} from "./protocol.js";
import { AgentManager, effectiveAgentTimeoutMs } from "./agents/manager.js";
import type { AgentRunRequest, AgentRunResult, FabricSteeringMode } from "./agents/types.js";
import { isFabricThinking } from "./thinking.js";
import { describeSubagentRoles, resolveSubagentRole } from "./subagents/profiles.js";

const emptySchema = { type: "object", properties: {}, additionalProperties: false };
const idSchema = {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
  additionalProperties: false,
};
const runProperties = {
  task: { type: "string", description: "Self-contained task for the child worker" },
  profile: { type: "string", description: "Configured semantic subagent profile, such as research, explore, deep, or review" },
  name: { type: "string", description: "Optional display name; does not select the model/profile" },
  timeoutMs: { type: "number" },
  worktree: { type: "boolean" },
  schema: { type: "object", additionalProperties: true },
};
const runSchema = {
  type: "object",
  properties: runProperties,
  required: ["task"],
  additionalProperties: false,
};
const recurseSchema = {
  type: "object",
  properties: runProperties,
  required: ["task", "profile"],
  additionalProperties: false,
};
const messageSchema = {
  type: "object",
  properties: { id: { type: "string" }, message: { type: "string" }, data: {} },
  required: ["id", "message"],
  additionalProperties: false,
};
const modeSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    mode: { type: "string", enum: ["all", "one-at-a-time"] },
  },
  required: ["id", "mode"],
  additionalProperties: false,
};

export const LEAN_AGENT_ACTIONS: FabricActionDescriptor[] = [
  { name: "run", description: "Run one configured child worker and wait for its result", inputSchema: runSchema, risk: "agent" },
  { name: "spawn", description: "Start one configured child worker and return a handle", inputSchema: runSchema, risk: "agent" },
  {
    name: "recurse",
    description: "Run one recursive Pi child under the configured depth, call, and cost budgets and return a compact result",
    inputSchema: recurseSchema,
    risk: "agent",
  },
  { name: "wait", description: "Wait for a spawned child worker", inputSchema: idSchema, risk: "read" },
  { name: "status", description: "Read the latest status of a local child worker", inputSchema: idSchema, risk: "read" },
  { name: "list", description: "List child workers created by this Pi host", inputSchema: emptySchema, risk: "read" },
  { name: "profiles", description: "List configured semantic subagent profiles", inputSchema: emptySchema, risk: "read" },
  { name: "stop", description: "Stop a local child worker", inputSchema: idSchema, risk: "agent" },
  {
    name: "cleanup",
    description: "Remove a completed worker run and optional Git worktree branch",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, deleteBranch: { type: "boolean" } },
      required: ["id"],
      additionalProperties: false,
    },
    risk: "write",
  },
  { name: "steer", description: "Steer a running Pi/Claude child between turns", inputSchema: messageSchema, risk: "agent" },
  { name: "followUp", description: "Queue a follow-up for a running Pi/Claude child", inputSchema: messageSchema, risk: "agent" },
  { name: "setSteeringMode", description: "Configure steer delivery mode for a child", inputSchema: modeSchema, risk: "agent" },
  { name: "setFollowUpMode", description: "Configure follow-up delivery mode for a child", inputSchema: modeSchema, risk: "agent" },
  {
    name: "compact",
    description: "Request advisory compaction of a running Pi child",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, instructions: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    risk: "agent",
  },
];

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined;

const projectTrusted = (context: FabricInvocationContext): boolean =>
  context.extensionContext.isProjectTrusted();

const runRequest = (
  raw: Record<string, unknown>,
  context: FabricInvocationContext,
  manager: AgentManager,
): AgentRunRequest => {
  const { args } = resolveSubagentRole(raw, manager.cwd, {
    projectTrusted: projectTrusted(context),
  });
  const runner = args.runner === "pi" || args.runner === "claude" || args.runner === "cli"
    ? args.runner
    : manager.config.runner;
  const cli = args.cli === "agy" || args.cli === "droid" ? args.cli : undefined;
  const inheritedModel =
    runner === "pi" && !manager.config.model && context.extensionContext.model
      ? `${context.extensionContext.model.provider}/${context.extensionContext.model.id}`
      : undefined;
  const timeoutMs =
    typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs)
      ? effectiveAgentTimeoutMs(manager.config.timeoutMs, args.timeoutMs)
      : undefined;
  const transport =
    args.transport === "auto" || args.transport === "process" || args.transport === "tmux" ||
    args.transport === "screen" || args.transport === "localterm" || args.transport === "herdr"
      ? args.transport
      : undefined;
  const thinking = isFabricThinking(args.thinking) ? args.thinking : undefined;
  const tools = strings(args.tools);
  return {
    task: String(args.task ?? ""),
    runner,
    ...(cli ? { cli } : {}),
    ...(typeof args.name === "string" ? { name: args.name } : {}),
    ...(transport ? { transport } : {}),
    ...(typeof args.model === "string" ? { model: args.model } : inheritedModel ? { model: inheritedModel } : {}),
    ...(thinking ? { thinking } : {}),
    ...(tools ? { tools } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(typeof args.extensions === "boolean" ? { extensions: args.extensions } : {}),
    ...(typeof args.recursive === "boolean" ? { recursive: args.recursive } : {}),
    ...(typeof args.worktree === "boolean" ? { worktree: args.worktree } : {}),
    ...(typeof args.schema === "object" && args.schema !== null && !Array.isArray(args.schema)
      ? { schema: args.schema as Record<string, unknown> }
      : {}),
  };
};

const compactRecursiveResult = (result: AgentRunResult): Record<string, unknown> => ({
  id: result.id,
  name: result.name,
  status: result.status,
  text: result.text,
  ...(result.value !== undefined ? { value: result.value } : {}),
  ...(result.error ? { error: result.error } : {}),
  turns: result.turns,
  toolCalls: result.toolCalls,
  usage: result.usage,
});

export class LeanAgentsProvider implements FabricProvider {
  readonly name = "agents";
  readonly description = "Profile-based subagents backed by Pi, Claude, or pluggable CLI adapters";

  constructor(readonly manager: AgentManager) {}

  async list(request: FabricProviderListRequest): Promise<FabricActionDescriptor[]> {
    const query = request.query?.toLowerCase();
    return LEAN_AGENT_ACTIONS.filter((action) =>
      query ? `${action.name} ${action.description}`.toLowerCase().includes(query) : true,
    );
  }

  async describe(actionName: string): Promise<FabricActionDescriptor | undefined> {
    return LEAN_AGENT_ACTIONS.find((action) => action.name === actionName);
  }

  async invoke(
    actionName: string,
    args: Record<string, unknown>,
    context: FabricInvocationContext,
  ): Promise<unknown> {
    switch (actionName) {
      case "run":
        return this.manager.run(runRequest(args, context, this.manager), context.signal);
      case "spawn":
        return this.manager.spawn(runRequest(args, context, this.manager), context.signal);
      case "recurse": {
        const request = runRequest(args, context, this.manager);
        if (request.runner !== "pi") {
          throw new Error("Recursive subagent profiles must use runner: pi");
        }
        return compactRecursiveResult(
          await this.manager.run({ ...request, recursive: true }, context.signal),
        );
      }
      case "wait":
        return this.manager.wait(String(args.id));
      case "status":
        return this.manager.status(String(args.id));
      case "list":
        return this.manager.list();
      case "profiles":
      case "roles":
        return describeSubagentRoles(this.manager.cwd, {
          projectTrusted: projectTrusted(context),
        });
      // Kept as an unlisted compatibility action for existing scripts. Model
      // routing now belongs in semantic profiles, not in ordinary call sites.
      case "models": {
        const runner = args.runner === "claude" || args.runner === "cli" || args.runner === "pi"
          ? args.runner
          : this.manager.config.runner;
        if (runner === "claude") return this.manager.claudeModels(args.refresh === true);
        if (runner === "cli") return [];
        const model = context.extensionContext.model;
        return model
          ? [{ provider: model.provider, id: model.id, name: model.name, key: `${model.provider}/${model.id}` }]
          : [];
      }
      case "stop":
        return this.manager.stop(String(args.id));
      case "cleanup":
        return this.manager.cleanup(String(args.id), args.deleteBranch === true);
      case "steer":
        return this.manager.steer(String(args.id), String(args.message), args.data);
      case "followUp":
        return this.manager.followUp(String(args.id), String(args.message), args.data);
      case "setSteeringMode":
        return this.manager.setSteeringMode(String(args.id), args.mode as FabricSteeringMode);
      case "setFollowUpMode":
        return this.manager.setFollowUpMode(String(args.id), args.mode as FabricSteeringMode);
      case "compact":
        return this.manager.compact(
          String(args.id),
          typeof args.instructions === "string" ? args.instructions : undefined,
        );
      default:
        throw new Error(`Unknown agents action: ${actionName}`);
    }
  }
}
