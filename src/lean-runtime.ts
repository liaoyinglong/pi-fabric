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

const leanConfig = (context: ExtensionContext): FabricConfig => {
  const config = loadFabricConfig({
    cwd: context.cwd,
    agentDir: getAgentDir(),
    projectTrusted: context.isProjectTrusted(),
  });
  // V2 deliberately ignores the historical persistent-runtime switches even
  // when an old config file still contains them. Keeping the fields readable
  // makes migration painless while the runtime itself has only the lean graph.
  config.fullCodeMode = true;
  config.mesh.enabled = false;
  config.memory.enabled = false;
  config.schema.mode = "off";
  config.components = [];
  config.capture.enabled = true;
  config.capture.hideFromModel = true;
  config.capture.advisory.mode = "disabled";
  config.compaction.engine = "pi";
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
    const mcp = new McpProvider(context.cwd, config.mcp, {
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

    const workerPath = fileURLToPath(new URL("./worker.js", import.meta.url));
    const agents = new AgentManager(context.cwd, config.agents, {
      workerPath,
      fabricExtensionPath: this.extensionPath,
      fullCodeMode: true,
      projectRoot,
      retention: config.retention,
    });
    registry.register(new LeanAgentsProvider(agents));

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
