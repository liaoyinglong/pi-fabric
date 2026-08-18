import { getAgentDir, type ExtensionContext, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { CapturedToolCatalog } from "./capture/catalog.js";
import { loadFabricConfig, type FabricConfig } from "./config.js";
import { ActionRegistry } from "./core/action-registry.js";
import { FabricExecutionService, type FabricExecutionResult } from "./execution-service.js";
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
  onPartial?: (snapshot: {
    audits: unknown[];
    phases: string[];
    progress?: string | undefined;
  }) => void;
}

const REMOVED_LEAN_PROVIDERS = [
  "agents",
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
  #mcp: McpProvider | undefined;
  #cwd: string | undefined;

  constructor(
    readonly pi: ExtensionAPI,
    readonly capturedTools: CapturedToolCatalog,
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

    const agentDir = getAgentDir();
    const projectTrusted = context.isProjectTrusted();
    const config = leanConfig(context, agentDir, projectTrusted);
    const registry = new ActionRegistry();
    const capturedProvider = new CapturedToolsProvider(this.capturedTools);
    const piProvider = new PiToolsProvider(context.cwd, this.capturedTools, capturedProvider);
    registry.register(piProvider);
    registry.register(capturedProvider);

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

    for (const provider of REMOVED_LEAN_PROVIDERS) {
      registry.markUnavailable(provider, `${provider} is not part of the Lean V2 runtime`);
    }

    this.#config = config;
    this.#registry = registry;
    this.#mcp = mcp;
    this.#cwd = context.cwd;
    this.#execution = new FabricExecutionService(
      registry,
      config,
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
      onPartial: (snapshot) => request.onPartial?.(snapshot),
    });
  }

  async close(): Promise<void> {
    const mcp = this.#mcp;
    this.#execution = undefined;
    this.#registry = undefined;
    this.#mcp = undefined;
    this.#config = undefined;
    this.#cwd = undefined;
    await (mcp?.close() ?? Promise.resolve());
  }
}
