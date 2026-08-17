import { getAgentDir, type ExtensionContext, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CapturedToolCatalog } from "./capture/catalog.js";
import { loadFabricConfig, type FabricConfig } from "./config.js";
import { ActionRegistry } from "./core/action-registry.js";
import { PI_CORE_TOOL_NAME_SET } from "./core/pi-tools.js";
import { FabricExecutionService, type FabricExecutionResult } from "./execution-service.js";
import { AgentManager } from "./agents/manager.js";
import { LeanAgentsProvider } from "./lean-agents-provider.js";
import { CapturedToolsProvider } from "./providers/captured-tools-provider.js";
import { McpDescriptorCacheStore } from "./providers/mcp-descriptor-cache.js";
import { McpProvider } from "./providers/mcp-provider.js";
import { PiToolsProvider } from "./providers/pi-tools-provider.js";
import { RestrictedFabricProvider } from "./providers/restricted-provider.js";

const BACKGROUND_COMPLETION_MAX_CHARS = 8_000;

export interface LeanExecutionRequest {
  code: string;
  strings?: Record<string, string>;
  signal: AbortSignal | undefined;
  parentToolCallId: string;
  context: ExtensionContext;
  tokenBudget?: number;
  agentBudget?: number;
  display?: { name?: string; description?: string };
  onPartial?: (snapshot: {
    audits: unknown[];
    phases: string[];
    progress?: string | undefined;
  }) => void;
}

const REMOVED_LEAN_PROVIDERS = [
  "mesh",
  "memory",
  "state",
  "schema",
  "components",
  "compact",
  "council",
  "rlm",
] as const;

export const leanMcpDiscoveryRoot = (
  cwd: string,
  agentDir: string,
  projectTrusted: boolean,
): string => projectTrusted ? cwd : agentDir;

export const leanMcpCachePath = (
  projectRoot: string,
  agentDir: string,
  projectTrusted: boolean,
): string => projectTrusted
  ? path.join(projectRoot, ".pi", "fabric", "mcp-descriptors.json")
  : path.join(agentDir, "fabric", "mcp-descriptors.json");

export interface RecursiveChildToolGrants {
  piTools: string[];
  extensionTools: string[];
}

/**
 * A recursive Pi child is launched with its profile's original tool allowlist
 * plus fabric_exec. Lean removes those direct tools from the child model, but
 * keeps the original allowlist as a hard capability boundary inside Code Mode.
 */
export const recursiveChildToolGrants = (
  activeTools: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): RecursiveChildToolGrants | undefined => {
  if (!env.PI_FABRIC_PARENT_RUN || env.PI_FABRIC_FULL_CODE_MODE !== "true") return undefined;
  const granted = [...new Set(activeTools.filter((name) => name !== "fabric_exec"))];
  return {
    piTools: granted.filter((name) => PI_CORE_TOOL_NAME_SET.has(name)),
    extensionTools: granted.filter((name) => !PI_CORE_TOOL_NAME_SET.has(name)),
  };
};

const leanConfig = (
  context: ExtensionContext,
  agentDir: string,
  projectTrusted: boolean,
): FabricConfig => {
  const config = loadFabricConfig({
    cwd: context.cwd,
    agentDir,
    projectTrusted,
  });
  config.fullCodeMode = true;
  config.schema.mode = "off";
  config.capture.enabled = true;
  config.capture.hideFromModel = true;
  config.capture.advisory.mode = "disabled";
  return config;
};

export class LeanCodeModeRuntime {
  #config: FabricConfig | undefined;
  #registry: ActionRegistry | undefined;
  #execution: FabricExecutionService | undefined;
  #agents: AgentManager | undefined;
  #mcp: McpProvider | undefined;
  #cwd: string | undefined;

  constructor(
    readonly pi: ExtensionAPI,
    readonly capturedTools: CapturedToolCatalog,
    readonly extensionPath: string,
  ) {}

  get ready(): boolean {
    return this.#execution !== undefined;
  }

  get config(): FabricConfig {
    if (!this.#config) throw new Error("Pi Code Mode runtime is not initialized");
    return this.#config;
  }

  get registry(): ActionRegistry {
    if (!this.#registry) throw new Error("Pi Code Mode runtime is not initialized");
    return this.#registry;
  }

  get agentManager(): AgentManager | undefined {
    return this.#agents;
  }

  async initialize(context: ExtensionContext): Promise<void> {
    if (this.#cwd === context.cwd && this.#execution) return;
    await this.close();

    const agentDir = getAgentDir();
    const projectTrusted = context.isProjectTrusted();
    const config = leanConfig(context, agentDir, projectTrusted);
    const registry = new ActionRegistry();
    const grants = recursiveChildToolGrants(this.pi.getActiveTools());
    const capturedProvider = new CapturedToolsProvider(this.capturedTools);
    const piProvider = new PiToolsProvider(context.cwd, this.capturedTools, capturedProvider);
    registry.register(
      grants
        ? new RestrictedFabricProvider(piProvider, grants.piTools)
        : piProvider,
    );
    registry.register(
      grants
        ? new RestrictedFabricProvider(capturedProvider, grants.extensionTools)
        : capturedProvider,
    );

    const projectRoot = process.env.PI_FABRIC_PROJECT_ROOT ?? context.cwd;
    let mcp: McpProvider | undefined;
    if (config.mcp.enabled) {
      const mcpRoot = leanMcpDiscoveryRoot(context.cwd, agentDir, projectTrusted);
      mcp = new McpProvider(mcpRoot, config.mcp, {
        ...(config.mcp.cache.enabled
          ? {
              cache: new McpDescriptorCacheStore(
                leanMcpCachePath(projectRoot, agentDir, projectTrusted),
              ),
            }
          : {}),
      });
      registry.register(mcp);
      mcp.warmup();
    } else {
      registry.markUnavailable("mcp", "MCP support is disabled in Fabric configuration");
    }

    let agents: AgentManager | undefined;
    if (config.agents.enabled) {
      const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));
      agents = new AgentManager(context.cwd, config.agents, {
        workerPath,
        fabricExtensionPath: this.extensionPath,
        fullCodeMode: true,
        projectRoot,
        retention: config.retention,
        onBackgroundComplete: (result) => {
          const durationMs = Math.max(0, (result.finishedAt ?? Date.now()) - result.startedAt);
          const duration =
            durationMs < 60_000
              ? `${Math.round(durationMs / 1_000)}s`
              : `${(durationMs / 60_000).toFixed(1)}m`;
          const summary = result.text || result.error || "no result";
          const clippedSummary =
            summary.length > BACKGROUND_COMPLETION_MAX_CHARS
              ? `${summary.slice(0, BACKGROUND_COMPLETION_MAX_CHARS)}\n[completion truncated]`
              : summary;
          this.pi.sendMessage(
            {
              customType: "pi-fabric-agent-complete",
              content: `Fabric agent ${result.id.slice(0, 8)} ${result.status} after ${duration}: ${clippedSummary}`,
              display: true,
              details: result,
            },
            { deliverAs: "followUp", triggerTurn: true },
          );
        },
      });
      registry.register(new LeanAgentsProvider(agents));
    } else {
      registry.markUnavailable("agents", "One-shot agents are disabled in Fabric configuration");
    }

    for (const provider of REMOVED_LEAN_PROVIDERS) {
      registry.markUnavailable(provider, `${provider} is not part of the Lean V2 runtime`);
    }

    this.#config = config;
    this.#registry = registry;
    this.#agents = agents;
    this.#mcp = mcp;
    this.#cwd = context.cwd;
    this.#execution = new FabricExecutionService(
      registry,
      config,
      undefined,
      undefined,
      undefined,
      undefined,
      this.capturedTools,
    );
  }

  async execute(request: LeanExecutionRequest): Promise<FabricExecutionResult> {
    await this.initialize(request.context);
    return this.#execution!.execute({
      code: request.code,
      ...(request.strings ? { strings: request.strings } : {}),
      signal: request.signal,
      parentToolCallId: request.parentToolCallId,
      context: request.context,
      ...(request.tokenBudget !== undefined ? { tokenBudget: request.tokenBudget } : {}),
      ...(request.agentBudget !== undefined ? { maxAgentCalls: request.agentBudget } : {}),
      ...(request.display ? { display: request.display } : {}),
      onPartial: (snapshot) => request.onPartial?.(snapshot),
    });
  }

  async close(): Promise<void> {
    const agents = this.#agents;
    const mcp = this.#mcp;
    this.#execution = undefined;
    this.#registry = undefined;
    this.#agents = undefined;
    this.#mcp = undefined;
    this.#config = undefined;
    this.#cwd = undefined;
    await Promise.allSettled([
      agents?.close() ?? Promise.resolve(),
      mcp?.close() ?? Promise.resolve(),
    ]);
  }
}
