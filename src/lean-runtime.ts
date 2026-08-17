import { getAgentDir, type ExtensionContext, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CapturedToolCatalog } from "./capture/catalog.js";
import { loadFabricConfig, type FabricConfig } from "./config.js";
import { ActionRegistry } from "./core/action-registry.js";
import { FabricExecutionService, type FabricExecutionResult } from "./execution-service.js";
import { AgentManager } from "./agents/manager.js";
import { LeanAgentsProvider } from "./lean-agents-provider.js";
import { CapturedToolsProvider } from "./providers/captured-tools-provider.js";
import { McpDescriptorCacheStore } from "./providers/mcp-descriptor-cache.js";
import { McpProvider } from "./providers/mcp-provider.js";
import { PiToolsProvider } from "./providers/pi-tools-provider.js";

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

const leanConfig = (context: ExtensionContext): FabricConfig => {
  const config = loadFabricConfig({
    cwd: context.cwd,
    agentDir: getAgentDir(),
    projectTrusted: context.isProjectTrusted(),
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

  async initialize(context: ExtensionContext): Promise<void> {
    if (this.#cwd === context.cwd && this.#execution) return;
    await this.close();

    const config = leanConfig(context);
    const registry = new ActionRegistry();
    const capturedProvider = new CapturedToolsProvider(this.capturedTools);
    registry.register(new PiToolsProvider(context.cwd, this.capturedTools, capturedProvider));
    registry.register(capturedProvider);

    const projectRoot = process.env.PI_FABRIC_PROJECT_ROOT ?? context.cwd;
    let mcp: McpProvider | undefined;
    if (config.mcp.enabled) {
      mcp = new McpProvider(context.cwd, config.mcp, {
        ...(config.mcp.cache.enabled
          ? {
              cache: new McpDescriptorCacheStore(
                path.join(projectRoot, ".pi", "fabric", "mcp-descriptors.json"),
              ),
            }
          : {}),
      });
      registry.register(mcp);
      mcp.warmup();
    } else {
      registry.markUnavailable("mcp", "MCP support is disabled in Fabric configuration");
    }

    const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));
    const agents = new AgentManager(context.cwd, config.agents, {
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
